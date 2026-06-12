import { test, expect, type APIRequestContext } from "@playwright/test";
import {
  cleanDb,
  seedWords,
  seedUser,
  seedSuggestion,
  seedMcpToken,
} from "../helpers/seed";
import { getTestDb } from "../helpers/db";
import { TEST_MOD_EMAIL, TEST_USER_EMAIL } from "../helpers/test-config";

const MOD_TOKEN = "test-mcp-token-moderator";
const USER_TOKEN = "test-mcp-token-regular";

async function callTool(
  request: APIRequestContext,
  token: string,
  name: string,
  args: Record<string, unknown> = {}
): Promise<string> {
  const res = await request.post(`/mcp/${token}`, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = (await res.json()) as {
    result: { content: { type: string; text: string }[] };
  };
  return body.result.content[0].text;
}

test.beforeEach(() => {
  cleanDb();
  seedWords();
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  seedMcpToken(modId, MOD_TOKEN);
  seedMcpToken(userId, USER_TOKEN);
});

test("invalid token is rejected", async ({ request }) => {
  const res = await request.post("/mcp/not-a-token", {
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  expect(res.status()).toBe(401);
});

test("non-moderator token is rejected", async ({ request }) => {
  const res = await request.post(`/mcp/${USER_TOKEN}`, {
    data: { jsonrpc: "2.0", id: 1, method: "ping" },
  });
  expect(res.status()).toBe(403);
});

test("reject with comment stores the reason", async ({ request }) => {
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "ablehnwort", "add", "pending_review");

  const text = await callTool(request, MOD_TOKEN, "reject", {
    ids: [suggId],
    comment: "Eigenname, gehört nicht in die Liste",
  });
  expect(text).toContain("Rejected 1/1");

  const row = getTestDb()
    .prepare("SELECT status, moderation_comment FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string; moderation_comment: string };
  expect(row.status).toBe("moderator_rejected");
  expect(row.moderation_comment).toBe("Eigenname, gehört nicht in die Liste");
});

test("approve_with_changes corrects word and description", async ({ request }) => {
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "tippfeler", "add", "pending_review", {
    description: "ein Fehler",
  });

  const text = await callTool(request, MOD_TOKEN, "approve_with_changes", {
    id: suggId,
    word: "tippfehler",
    description: "ein Fehler beim Tippen",
  });
  expect(text).toContain("Approved");

  const row = getTestDb()
    .prepare(
      "SELECT status, word, payload, original_payload FROM suggestions WHERE id = ?"
    )
    .get(suggId) as {
    status: string;
    word: string;
    payload: string;
    original_payload: string;
  };
  expect(row.status).toBe("moderator_approved");
  expect(row.word).toBe("tippfehler");
  expect(JSON.parse(row.payload).description).toBe("ein Fehler beim Tippen");
  expect(JSON.parse(row.original_payload).word).toBe("tippfeler");
});

test("search_words finds words by substring and umlaut-insensitive match", async ({
  request,
}) => {
  const text = await callTool(request, MOD_TOKEN, "search_words", {
    query: "hund",
  });
  expect(text).toContain("Word: hund");
  expect(text).toContain("Word: hunde");
  expect(text).toContain("ein Haustier");
});

test("edit_word updates the dictionary immediately and queues a sync", async ({
  request,
}) => {
  const text = await callTool(request, MOD_TOKEN, "edit_word", {
    word: "katze",
    description: "ein beliebtes Haustier",
    base: "katze",
  });
  expect(text).toContain('Updated "katze"');

  const db = getTestDb();
  const word = db
    .prepare("SELECT description, base FROM words WHERE word = 'katze'")
    .get() as { description: string; base: string };
  expect(word.description).toBe("ein beliebtes Haustier");
  expect(word.base).toBe("katze");

  // Pre-approved suggestion queued for the sync job
  const sugg = db
    .prepare(
      `SELECT status, action, payload FROM suggestions
       WHERE word = 'katze' AND action = 'change_description'`
    )
    .get() as { status: string; action: string; payload: string };
  expect(sugg.status).toBe("moderator_approved");
  expect(JSON.parse(sugg.payload).description).toBe("ein beliebtes Haustier");
});

test("delete_word removes the word and blocks re-submission", async ({
  request,
}) => {
  const text = await callTool(request, MOD_TOKEN, "delete_word", {
    word: "xyz",
  });
  expect(text).toContain('Deleted "xyz"');

  const db = getTestDb();
  const word = db
    .prepare("SELECT in_list FROM words WHERE word = 'xyz'")
    .get() as { in_list: string };
  expect(word.in_list).toBe("rejected");

  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = 'xyz' AND action = 'remove'")
    .get();
  expect(blocked).toBeTruthy();

  const sugg = db
    .prepare(
      "SELECT status FROM suggestions WHERE word = 'xyz' AND action = 'remove'"
    )
    .get() as { status: string };
  expect(sugg.status).toBe("moderator_approved");
});

test("edit_word on unknown word returns an error", async ({ request }) => {
  const res = await request.post(`/mcp/${MOD_TOKEN}`, {
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "edit_word", arguments: { word: "gibtsnicht", description: "x" } },
    },
  });
  const body = (await res.json()) as {
    result: { isError?: boolean; content: { text: string }[] };
  };
  expect(body.result.isError).toBe(true);
  expect(body.result.content[0].text).toContain("not in the dictionary");
});
