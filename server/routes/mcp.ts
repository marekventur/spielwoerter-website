import { Router } from "express";
import { getDb } from "../../lib/db.js";

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: { code: number; message: string };
};

const TOOLS = [
  {
    name: "list_pending",
    description:
      "List all suggestions currently awaiting moderation. Returns id, word, action, descriptions (before/after for change_description), requester email, base form, and submission time.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "approve",
    description: "Approve one or more pending suggestions by their numeric ID.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "Suggestion IDs to approve",
        },
      },
    },
  },
  {
    name: "reject",
    description:
      "Reject one or more pending suggestions by their numeric ID. Rejected words are blocklisted to prevent re-submission.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "Suggestion IDs to reject",
        },
      },
    },
  },
];

type PendingRow = {
  id: number;
  word: string;
  action: string;
  payload: string | null;
  status: string;
  created_at: string;
  current_description: string | null;
  base: string | null;
  requester_email: string | null;
};

type SuggRow = { id: number; word: string; action: string; status: string };

function handleToolCall(
  toolName: string,
  args: Record<string, unknown>
): unknown {
  const db = getDb();

  if (toolName === "list_pending") {
    const items = db
      .prepare(
        `SELECT s.id, s.word, s.action, s.payload, s.status, s.created_at,
                w.description AS current_description, w.base,
                u.email AS requester_email
         FROM suggestions s
         LEFT JOIN words w ON w.word = s.word
         LEFT JOIN users u ON u.id = s.user_id
         WHERE s.status IN ('pending_review', 'needs_moderator')
         ORDER BY COALESCE(w.base, s.word), s.word, s.created_at`
      )
      .all() as PendingRow[];

    if (items.length === 0) {
      return { content: [{ type: "text", text: "No pending suggestions." }] };
    }

    const lines = items.map((item) => {
      const payload = item.payload
        ? (JSON.parse(item.payload) as Record<string, string>)
        : null;
      const parts = [
        `ID: ${item.id}`,
        `Word: ${item.word}`,
        `Action: ${item.action}`,
        `Status: ${item.status}`,
        `Requested by: ${item.requester_email ?? "unknown"}`,
        `Submitted: ${item.created_at}`,
      ];
      if (item.action === "change_description") {
        parts.push(`Current description: ${item.current_description ?? "(none)"}`);
        parts.push(`Proposed description: ${payload?.description ?? "(none)"}`);
      } else if (payload?.description) {
        parts.push(`Description: ${payload.description}`);
      }
      const base = payload?.base ?? item.base;
      if (base) parts.push(`Base form: ${base}`);
      return parts.join("\n");
    });

    return {
      content: [
        {
          type: "text",
          text: `${items.length} pending suggestion(s):\n\n${lines.join("\n\n---\n\n")}`,
        },
      ],
    };
  }

  if (toolName === "approve" || toolName === "reject") {
    const ids = args.ids as unknown[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return {
        content: [{ type: "text", text: "Error: ids must be a non-empty array of integers" }],
        isError: true,
      };
    }

    const decision =
      toolName === "approve" ? "moderator_approved" : "moderator_rejected";
    let count = 0;

    for (const rawId of ids) {
      const id = Number(rawId);
      const row = db
        .prepare("SELECT id, word, action, status FROM suggestions WHERE id = ?")
        .get(id) as SuggRow | undefined;
      if (!row) continue;
      if (!["pending_review", "needs_moderator"].includes(row.status)) continue;

      db.transaction(() => {
        db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(decision, id);
        if (decision === "moderator_rejected") {
          db.prepare(
            "INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, ?)"
          ).run(row.word, row.action);
        }
      })();
      count++;
    }

    const verb = toolName === "approve" ? "Approved" : "Rejected";
    return {
      content: [{ type: "text", text: `${verb} ${count}/${ids.length} suggestion(s).` }],
    };
  }

  return {
    content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
    isError: true,
  };
}

export const mcpRouter = Router();

mcpRouter.post("/:token", (req, res) => {
  const { token } = req.params;
  const db = getDb();

  const mcpToken = db
    .prepare("SELECT id FROM mcp_tokens WHERE token = ?")
    .get(token);
  if (!mcpToken) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }

  const body = req.body as JsonRpcRequest;

  // Notifications have no id — acknowledge without a body
  if (!("id" in body)) {
    res.status(202).end();
    return;
  }

  const { id, method, params = {} } = body;

  let result: unknown;

  switch (method) {
    case "initialize":
      result = {
        protocolVersion: "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "spielwoerter-moderation", version: "1.0.0" },
      };
      break;

    case "ping":
      result = {};
      break;

    case "tools/list":
      result = { tools: TOOLS };
      break;

    case "tools/call": {
      const { name, arguments: args = {} } = params as {
        name: string;
        arguments?: Record<string, unknown>;
      };
      result = handleToolCall(name, args);
      break;
    }

    default:
      res.json({
        jsonrpc: "2.0",
        id,
        error: { code: -32601, message: "Method not found" },
      } as JsonRpcResponse);
      return;
  }

  res.json({ jsonrpc: "2.0", id, result } as JsonRpcResponse);
});
