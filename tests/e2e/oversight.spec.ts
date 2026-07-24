/**
 * Moderation oversight flows: 72h removal delay, scheduled-removal
 * confirm/objection, settled-decision confirmation, word comments with
 * anonymized public history, screen names, changelog page, removal hints.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser, seedSuggestion } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { promoteEligibleDrafts } from "../../lib/promotion";
import {
  TEST_USER_EMAIL,
  TEST_MOD_EMAIL,
  TEST_USER2_EMAIL,
} from "../helpers/test-config";

const MOD2_EMAIL = "moderator2@example.test";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

function cookieHeader(session: string) {
  return { Cookie: `session=${session}` };
}

function suggestionRow(word: string, action: string) {
  return getTestDb()
    .prepare(
      "SELECT id, status, decided_by FROM suggestions WHERE word = ? AND action = ? ORDER BY id DESC"
    )
    .get(word, action) as { id: number; status: string; decided_by: number | null } | undefined;
}

function backdate(id: number, modifier: string) {
  getTestDb()
    .prepare(`UPDATE suggestions SET last_modified_at = datetime('now', '${modifier}') WHERE id = ?`)
    .run(id);
}

test("moderator removal drafts wait 72 hours before auto-approval", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: cookieHeader(session),
    data: { word: "hund", action: "remove" },
  });
  expect(res.status()).toBe(200);

  const row = suggestionRow("hund", "remove")!;
  const db = getTestDb();

  // After the old 60-minute window: still waiting.
  backdate(row.id, "-70 minutes");
  promoteEligibleDrafts(db);
  expect(suggestionRow("hund", "remove")!.status).toBe("draft");

  // After 72 hours: published.
  backdate(row.id, "-73 hours");
  promoteEligibleDrafts(db);
  expect(suggestionRow("hund", "remove")!.status).toBe("moderator_approved");
});

test("another moderator can release a scheduled removal early; the creator cannot", async ({
  request,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const mod2Id = seedUser(MOD2_EMAIL, { isModerator: true });
  const session1 = await loginViaApi(TEST_MOD_EMAIL);
  const session2 = await loginViaApi(MOD2_EMAIL);

  await request.post("/api/suggestions", {
    headers: cookieHeader(session1),
    data: { word: "hund", action: "remove" },
  });
  const row = suggestionRow("hund", "remove")!;

  const own = await request.post(`/api/moderation/scheduled/${row.id}/approve`, {
    headers: cookieHeader(session1),
  });
  expect(own.status()).toBe(403);

  const other = await request.post(`/api/moderation/scheduled/${row.id}/approve`, {
    headers: cookieHeader(session2),
  });
  expect(other.status()).toBe(200);

  const after = suggestionRow("hund", "remove")!;
  expect(after.status).toBe("moderator_approved");
  expect(after.decided_by).toBe(mod2Id);
});

test("objection sends a scheduled removal to the queue with a comment", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(MOD2_EMAIL, { isModerator: true });
  const session1 = await loginViaApi(TEST_MOD_EMAIL);
  const session2 = await loginViaApi(MOD2_EMAIL);

  await request.post("/api/suggestions", {
    headers: cookieHeader(session1),
    data: { word: "hunde", action: "remove" },
  });
  const row = suggestionRow("hunde", "remove")!;

  const noComment = await request.post(`/api/moderation/scheduled/${row.id}/object`, {
    headers: cookieHeader(session2),
    data: {},
  });
  expect(noComment.status()).toBe(400);

  const ok = await request.post(`/api/moderation/scheduled/${row.id}/object`, {
    headers: cookieHeader(session2),
    data: { comment: "Plural von Hund ist korrekt" },
  });
  expect(ok.status()).toBe(200);

  expect(suggestionRow("hunde", "remove")!.status).toBe("needs_moderator");
  const comment = getTestDb()
    .prepare("SELECT body, suggestion_id FROM word_comments WHERE word = 'hunde'")
    .get() as { body: string; suggestion_id: number } | undefined;
  expect(comment?.body).toBe("Plural von Hund ist korrekt");
  expect(comment?.suggestion_id).toBe(row.id);
});

test("scheduled removals actionable on /aenderungen; moderation page shows pointer and list", async ({
  page,
  request,
}) => {
  const mod1Id = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(MOD2_EMAIL, { isModerator: true });
  const session1 = await loginViaApi(TEST_MOD_EMAIL);
  await request.post("/api/suggestions", {
    headers: cookieHeader(session1),
    data: { word: "hund", action: "remove" },
  });

  await loginAs(page, MOD2_EMAIL, "/moderation");
  await page.goto("/moderation");
  await expect(page.getByText("geplante Löschung")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Moderator:innen" })).toBeVisible();
  await expect(page.getByText(`Besucher-${mod1Id}`).first()).toBeVisible();
  // Other users' emails never render — not even for moderators.
  const modContent = await page.content();
  expect(modContent).not.toContain(TEST_MOD_EMAIL);

  // The changelog carries the confirm/object actions for other mods' removals.
  await page.goto("/aenderungen?status=scheduled");
  await expect(page.getByRole("link", { name: "HUND" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt freigeben" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Einspruch" })).toBeVisible();

  // The creator sees no action buttons on their own scheduled removal.
  await loginAs(page, TEST_MOD_EMAIL, "/aenderungen");
  await page.goto("/aenderungen?status=scheduled");
  await expect(page.getByRole("link", { name: "HUND" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Jetzt freigeben" })).toHaveCount(0);
});

test("re-suggesting a rejected removal needs explicit confirmation with comment", async ({
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const rejectedId = seedSuggestion(userId, "katze", "remove", "moderator_rejected");
  getTestDb()
    .prepare("UPDATE suggestions SET moderation_comment = 'Katze ist gültig' WHERE id = ?")
    .run(rejectedId);

  const session = await loginViaApi(TEST_MOD_EMAIL);
  const first = await request.post("/api/suggestions", {
    headers: cookieHeader(session),
    data: { word: "katze", action: "remove" },
  });
  expect(first.status()).toBe(409);
  const body = (await first.json()) as {
    requiresConfirmation?: boolean;
    prior?: { comment?: string };
  };
  expect(body.requiresConfirmation).toBe(true);
  expect(body.prior?.comment).toBe("Katze ist gültig");

  const forced = await request.post("/api/suggestions", {
    headers: cookieHeader(session),
    data: {
      word: "katze",
      action: "remove",
      force: true,
      comment: "Doch ungültig, siehe Regel 4.2",
    },
  });
  expect(forced.status()).toBe(200);
  expect(suggestionRow("katze", "remove")!.status).toBe("draft");
  const comment = getTestDb()
    .prepare("SELECT body FROM word_comments WHERE word = 'katze'")
    .get() as { body: string } | undefined;
  expect(comment?.body).toBe("Doch ungültig, siehe Regel 4.2");
});

test("removing a recently re-added word needs confirmation (anti edit-war)", async ({
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedSuggestion(userId, "hunde", "add", "moderator_approved");

  const session = await loginViaApi(TEST_MOD_EMAIL);
  const res = await request.post("/api/suggestions", {
    headers: cookieHeader(session),
    data: { word: "hunde", action: "remove" },
  });
  expect(res.status()).toBe(409);
  const body = (await res.json()) as { requiresConfirmation?: boolean };
  expect(body.requiresConfirmation).toBe(true);
});

test("word comments are public with screen names; emails never leak", async ({
  page,
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  const session = await loginViaApi(TEST_USER_EMAIL);

  const post = await request.post("/api/word-comments", {
    headers: cookieHeader(session),
    data: { word: "hund", body: "Ist das nicht ein Dativ-e-Fall?" },
  });
  expect(post.status()).toBe(200);

  // Anonymous visitor sees the comment under the automatic screen name.
  await page.context().clearCookies();
  await page.goto("/wort/HUND");
  await page.locator("summary").click();
  await expect(page.getByText("Ist das nicht ein Dativ-e-Fall?")).toBeVisible();
  await expect(page.getByText(`Besucher-${userId}`).first()).toBeVisible();
  const content = await page.content();
  expect(content).not.toContain(TEST_USER_EMAIL);
});

test("moderators can hide comments from the public stream", async ({ page, request }) => {
  seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userSession = await loginViaApi(TEST_USER_EMAIL);
  const modSession = await loginViaApi(TEST_MOD_EMAIL);

  await request.post("/api/word-comments", {
    headers: cookieHeader(userSession),
    data: { word: "hund", body: "Unpassender Kommentar" },
  });
  const comment = getTestDb()
    .prepare("SELECT id FROM word_comments WHERE word = 'hund'")
    .get() as { id: number };

  const hide = await request.post(`/api/word-comments/${comment.id}/hide`, {
    headers: cookieHeader(modSession),
  });
  expect(hide.status()).toBe(200);

  await page.context().clearCookies();
  await page.goto("/wort/HUND");
  await page.locator("summary").click();
  await expect(page.getByText("Unpassender Kommentar")).not.toBeVisible();
});

test("screen name can be set, is validated, and must be unique", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  seedUser(TEST_USER2_EMAIL);
  const session = await loginViaApi(TEST_USER_EMAIL);
  const session2 = await loginViaApi(TEST_USER2_EMAIL);

  const ok = await request.post("/api/profile", {
    headers: cookieHeader(session),
    data: { displayName: "WortFuchs" },
  });
  expect(ok.status()).toBe(200);

  const emailLike = await request.post("/api/profile", {
    headers: cookieHeader(session),
    data: { displayName: "a@b.de" },
  });
  expect(emailLike.status()).toBe(400);

  const duplicate = await request.post("/api/profile", {
    headers: cookieHeader(session2),
    data: { displayName: "wortfuchs" },
  });
  expect(duplicate.status()).toBe(409);

  const reset = await request.post("/api/profile", {
    headers: cookieHeader(session),
    data: { displayName: "" },
  });
  expect(reset.status()).toBe(200);
});

test("changelog page lists decisions, scheduled removals, and filters by action", async ({
  page,
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedSuggestion(userId, "hunde", "add", "moderator_approved");
  seedSuggestion(userId, "katze", "remove", "moderator_rejected");

  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  await request.post("/api/suggestions", {
    headers: cookieHeader(modSession),
    data: { word: "hund", action: "remove" },
  });

  await page.context().clearCookies();
  await page.goto("/aenderungen");
  await expect(page.getByRole("link", { name: "HUNDE" })).toBeVisible();
  await expect(page.getByRole("link", { name: "KATZE" })).toBeVisible();
  await expect(page.getByText("wenn kein Einspruch kommt")).toBeVisible();
  const content = await page.content();
  expect(content).not.toContain(TEST_USER_EMAIL);
  expect(content).not.toContain(TEST_MOD_EMAIL);

  await page.goto("/aenderungen?art=add");
  await expect(page.getByRole("link", { name: "HUNDE" })).toBeVisible();
  await expect(page.getByRole("link", { name: "KATZE" })).not.toBeVisible();
});

test("removal hints flag likely special forms", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const db = getTestDb();
  db.prepare(
    "INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list) VALUES ('umsehen', 'sich umschauen', 'umsehen', 'duden', 'admin', 'accepted')"
  ).run();
  db.prepare(
    "INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list) VALUES ('umsehn', NULL, 'umsehen', 'community', NULL, 'accepted')"
  ).run();

  const session = await loginViaApi(TEST_USER_EMAIL);
  const res = await request.get("/api/removal-hints?words=umsehn,hund", {
    headers: cookieHeader(session),
  });
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { hints: Record<string, string[]> };
  expect(body.hints["umsehn"]?.[0]).toContain("UMSEHEN");
  expect(body.hints["hund"]).toBeUndefined();
});
