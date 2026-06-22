import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { moderateOne, type ModerationChanges } from "../../lib/moderate.js";
import { normalise } from "../../lib/normalise.js";

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
    description: "Approve one or more pending suggestions by their numeric ID, as submitted. To fix a typo or other small mistake in a submission before approving it, use approve_with_changes instead. Use override=true to re-moderate already-decided suggestions.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "Suggestion IDs to approve",
        },
        override: {
          type: "boolean",
          description: "If true, allows re-moderating already-decided suggestions (bypass status check). Use when correcting a moderation mistake.",
        },
      },
    },
  },
  {
    name: "approve_with_changes",
    description:
      "Approve a single pending suggestion after correcting it, e.g. to fix a typo in the word, description, or base form. Only pass the fields that should change; omitted fields keep the submitted values. The submitter will see the corrected version.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: {
        id: { type: "integer", description: "Suggestion ID to approve" },
        word: { type: "string", description: "Corrected word (replaces the submitted word)" },
        description: { type: "string", description: "Corrected description" },
        base: {
          type: "string",
          description: "Corrected base form (lemma). Pass an empty string to clear it.",
        },
        comment: {
          type: "string",
          description: "Optional note for the submitter, only visible to them",
        },
      },
    },
  },
  {
    name: "reject",
    description:
      "Reject one or more pending suggestions by their numeric ID. Rejected words are blocklisted to prevent re-submission. An optional comment explaining the rejection is stored and shown only to the submitter (and included in their notification email). Use override=true to re-moderate already-decided suggestions.",
    inputSchema: {
      type: "object",
      required: ["ids"],
      properties: {
        ids: {
          type: "array",
          items: { type: "integer" },
          description: "Suggestion IDs to reject",
        },
        comment: {
          type: "string",
          description:
            "Optional reason for the rejection, applied to all given IDs. Visible only to the submitter. Write it in German.",
        },
        override: {
          type: "boolean",
          description: "If true, allows re-moderating already-decided suggestions (bypass status check). Use when correcting a moderation mistake.",
        },
      },
    },
  },
  {
    name: "search_words",
    description:
      "Search the dictionary. Matches the query against word, base form, and description (case-insensitive substring; umlaut-insensitive for exact word matches). Returns word, description, base, list membership, and source.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search text" },
        limit: {
          type: "integer",
          description: "Maximum number of results (default 20, max 100)",
        },
      },
    },
  },
  {
    name: "edit_word",
    description:
      "Edit a dictionary entry directly: change its description and/or base form. The change is applied immediately and synced to the wordlist repository. Only pass the fields that should change; pass an empty string to clear a field.",
    inputSchema: {
      type: "object",
      required: ["word"],
      properties: {
        word: { type: "string", description: "The word to edit (exact match)" },
        description: { type: "string", description: "New description" },
        base: { type: "string", description: "New base form (lemma)" },
      },
    },
  },
  {
    name: "delete_word",
    description:
      "Delete a word from the dictionary. The word is moved to the rejected list (blocking re-submission) immediately and the removal is synced to the wordlist repository.",
    inputSchema: {
      type: "object",
      required: ["word"],
      properties: {
        word: { type: "string", description: "The word to delete (exact match)" },
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
  batch_id: number | null;
  batch_message: string | null;
};

type WordRow = {
  word: string;
  description: string | null;
  base: string | null;
  source: string | null;
  verified_by: string | null;
  in_list: string;
};

function textResult(text: string, isError = false) {
  return { content: [{ type: "text", text }], ...(isError ? { isError: true } : {}) };
}

function handleToolCall(
  toolName: string,
  args: Record<string, unknown>,
  userId: number
): unknown {
  const db = getDb();

  if (toolName === "list_pending") {
    const items = db
      .prepare(
        `SELECT s.id, s.word, s.action, s.payload, s.status, s.created_at,
                w.description AS current_description, w.base,
                u.email AS requester_email,
                s.batch_id, b.message AS batch_message
         FROM suggestions s
         LEFT JOIN words w ON w.word = s.word
         LEFT JOIN users u ON u.id = s.user_id
         LEFT JOIN batches b ON b.id = s.batch_id
         WHERE s.status IN ('pending_review', 'needs_moderator')
         ORDER BY COALESCE(w.base, s.word), s.word, s.created_at`
      )
      .all() as PendingRow[];

    if (items.length === 0) {
      return textResult("No pending suggestions.");
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
      if (item.batch_id) {
        parts.push(`Batch ID: ${item.batch_id}`);
        if (item.batch_message) parts.push(`Batch message: ${item.batch_message}`);
      }
      return parts.join("\n");
    });

    return textResult(
      `${items.length} pending suggestion(s):\n\n${lines.join("\n\n---\n\n")}`
    );
  }

  if (toolName === "approve" || toolName === "reject") {
    const ids = args.ids as unknown[];
    if (!Array.isArray(ids) || ids.length === 0) {
      return textResult("Error: ids must be a non-empty array of integers", true);
    }
    const comment =
      toolName === "reject" && typeof args.comment === "string"
        ? args.comment
        : undefined;
    const override = args.override === true;

    const decision =
      toolName === "approve" ? "moderator_approved" : "moderator_rejected";
    let count = 0;
    for (const rawId of ids) {
      if (moderateOne(db, Number(rawId), decision, { comment, override }).ok) count++;
    }

    const verb = toolName === "approve" ? "Approved" : "Rejected";
    return textResult(`${verb} ${count}/${ids.length} suggestion(s).`);
  }

  if (toolName === "approve_with_changes") {
    const id = Number(args.id);
    if (!Number.isFinite(id)) {
      return textResult("Error: id must be an integer", true);
    }
    const changes: ModerationChanges = {};
    if (typeof args.word === "string") changes.word = args.word;
    if (typeof args.description === "string") changes.description = args.description;
    if (typeof args.base === "string") changes.base = args.base;
    const comment = typeof args.comment === "string" ? args.comment : undefined;

    const result = moderateOne(db, id, "moderator_approved", { changes, comment });
    if (!result.ok) {
      return textResult(`Error: ${result.error}`, true);
    }
    return textResult(`Approved suggestion ${id} with changes.`);
  }

  if (toolName === "search_words") {
    const query = typeof args.query === "string" ? args.query.trim() : "";
    if (!query) {
      return textResult("Error: query must be a non-empty string", true);
    }
    const rawLimit = Number(args.limit);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 100) : 20;

    const pattern = `%${query.toLowerCase()}%`;
    const rows = db
      .prepare(
        `SELECT word, description, base, source, verified_by, in_list
         FROM words
         WHERE normalised = ?
            OR LOWER(word) LIKE ?
            OR LOWER(COALESCE(base, '')) LIKE ?
            OR LOWER(COALESCE(description, '')) LIKE ?
         ORDER BY (normalised = ?) DESC, word
         LIMIT ?`
      )
      .all(normalise(query), pattern, pattern, pattern, normalise(query), limit + 1) as WordRow[];

    if (rows.length === 0) {
      return textResult(`No words found for "${query}".`);
    }

    const hasMore = rows.length > limit;
    const lines = rows.slice(0, limit).map((row) => {
      const parts = [`Word: ${row.word}`, `List: ${row.in_list}`];
      if (row.description) parts.push(`Description: ${row.description}`);
      if (row.base) parts.push(`Base form: ${row.base}`);
      if (row.source) parts.push(`Source: ${row.source}`);
      if (row.verified_by) parts.push(`Verified by: ${row.verified_by}`);
      return parts.join("\n");
    });

    return textResult(
      `${Math.min(rows.length, limit)} result(s)${hasMore ? " (more available, raise limit or refine query)" : ""}:\n\n${lines.join("\n\n---\n\n")}`
    );
  }

  if (toolName === "edit_word" || toolName === "delete_word") {
    const word = typeof args.word === "string" ? args.word.trim().toLowerCase() : "";
    if (!word) {
      return textResult("Error: word must be a non-empty string", true);
    }
    const row = db
      .prepare("SELECT word, description, base, in_list FROM words WHERE word = ?")
      .get(word) as WordRow | undefined;
    if (!row || !["accepted", "uncertain"].includes(row.in_list)) {
      return textResult(`Error: "${word}" is not in the dictionary.`, true);
    }

    if (toolName === "edit_word") {
      const hasDesc = typeof args.description === "string";
      const hasBase = typeof args.base === "string";
      if (!hasDesc && !hasBase) {
        return textResult("Error: pass description and/or base", true);
      }
      const payload: Record<string, string> = {};
      if (hasDesc) payload.description = (args.description as string).trim();
      if (hasBase) payload.base = (args.base as string).trim().toLowerCase();

      // Record as a pre-approved suggestion so the regular sync job pushes it
      // to the wordlist repo; apply locally right away for immediate visibility.
      db.transaction(() => {
        db.prepare(
          `INSERT INTO suggestions (user_id, word, action, payload, status, moderator_fast_track, notified_at)
           VALUES (?, ?, 'change_description', ?, 'moderator_approved', 1, datetime('now'))`
        ).run(userId, word, JSON.stringify(payload));
        if (hasDesc) {
          db.prepare("UPDATE words SET description = ? WHERE word = ?").run(
            payload.description === "" ? null : payload.description,
            word
          );
        }
        if (hasBase) {
          db.prepare("UPDATE words SET base = ? WHERE word = ?").run(
            payload.base === "" ? null : payload.base,
            word
          );
        }
      })();

      return textResult(
        `Updated "${word}". The change is live on the site and will be synced to the wordlist repository within the hour.`
      );
    }

    // delete_word
    db.transaction(() => {
      db.prepare(
        `INSERT INTO suggestions (user_id, word, action, payload, status, moderator_fast_track, notified_at)
         VALUES (?, ?, 'remove', NULL, 'moderator_approved', 1, datetime('now'))`
      ).run(userId, word);
      db.prepare("UPDATE words SET in_list = 'rejected' WHERE word = ?").run(word);
      db.prepare(
        "INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, 'remove')"
      ).run(word);
    })();

    return textResult(
      `Deleted "${word}" from the dictionary. The removal is live on the site and will be synced to the wordlist repository within the hour.`
    );
  }

  return textResult(`Unknown tool: ${toolName}`, true);
}

export const mcpRouter = Router();

mcpRouter.post("/:token", (req, res) => {
  const { token } = req.params;
  const db = getDb();

  const mcpToken = db
    .prepare(
      `SELECT t.id, t.user_id, u.is_moderator
       FROM mcp_tokens t
       JOIN users u ON u.id = t.user_id
       WHERE t.token = ?`
    )
    .get(token) as { id: number; user_id: number; is_moderator: number } | undefined;
  if (!mcpToken) {
    res.status(401).json({ error: "Invalid token" });
    return;
  }
  if (!mcpToken.is_moderator) {
    res.status(403).json({ error: "Token owner is not a moderator" });
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
        serverInfo: { name: "spielwoerter-moderation", version: "1.1.0" },
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
      result = handleToolCall(name, args, mcpToken.user_id);
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
