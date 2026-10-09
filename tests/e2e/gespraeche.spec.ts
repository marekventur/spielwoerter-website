/**
 * Word threads ("Wortgespräche", lib/conversations.ts): private threads between
 * the moderation and one user. Most of this file is the negative side: who must
 * NOT see or post, and which mail must NOT land.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser, seedSuggestion } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { TEST_USER_EMAIL, TEST_USER2_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";

const SECRET = "test-inbound-secret";
const MOD2_EMAIL = "moderator2@example.test";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

const cookie = (session: string) => ({ Cookie: `session=${session}` });

function postsOf(topicId: number) {
  return getTestDb()
    .prepare("SELECT id, user_id, body, source, message_id FROM topic_posts WHERE topic_id = ? ORDER BY id")
    .all(topicId) as { id: number; user_id: number; body: string; source: string; message_id: string }[];
}

function tokenOf(topicId: number, userId: number): string {
  return (
    getTestDb()
      .prepare("SELECT reply_token FROM topic_participants WHERE topic_id = ? AND user_id = ?")
      .get(topicId, userId) as { reply_token: string }
  ).reply_token;
}

/** Moderator opens a thread on the user's removal suggestion for HUND. */
async function setup(request: import("@playwright/test").APIRequestContext) {
  const userId = seedUser(TEST_USER_EMAIL);
  const outsiderId = seedUser(TEST_USER2_EMAIL);
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const suggestionId = seedSuggestion(userId, "hund", "remove", "moderator_rejected");
  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  const userSession = await loginViaApi(TEST_USER_EMAIL);
  const outsiderSession = await loginViaApi(TEST_USER2_EMAIL);

  const res = await request.post("/api/topics/word", {
    headers: cookie(modSession),
    data: { suggestionId, body: "Warum soll HUND raus?" },
  });
  expect(res.status()).toBe(200);
  const { topicId } = (await res.json()) as { topicId: number };
  return { userId, outsiderId, modId, suggestionId, topicId, modSession, userSession, outsiderSession };
}

test("a moderator opens a thread from a suggestion; the same suggestion reuses it", async ({ request }) => {
  const s = await setup(request);
  const again = await request.post("/api/topics/word", {
    headers: cookie(s.modSession),
    data: { suggestionId: s.suggestionId, body: "Noch eine Frage" },
  });
  expect(((await again.json()) as { topicId: number }).topicId).toBe(s.topicId);
  expect(postsOf(s.topicId)).toHaveLength(2);
  const kind = getTestDb().prepare("SELECT kind, word FROM topics WHERE id = ?").get(s.topicId);
  expect(kind).toEqual({ kind: "word", word: "hund" });
});

test("the participant can read and answer; an outsider and anonymous visitors get 404", async ({
  page,
  request,
}) => {
  const s = await setup(request);

  const answer = await request.post(`/api/topics/${s.topicId}/posts`, {
    headers: cookie(s.userSession),
    data: { body: "Weil es ein Eigenname ist." },
  });
  expect(answer.status()).toBe(200);

  const outsiderPost = await request.post(`/api/topics/${s.topicId}/posts`, {
    headers: cookie(s.outsiderSession),
    data: { body: "Ich mische mich ein" },
  });
  expect(outsiderPost.status()).toBe(404);
  expect(postsOf(s.topicId)).toHaveLength(2);

  const outsiderPage = await request.get(`/diskussion/${s.topicId}`, { headers: cookie(s.outsiderSession) });
  expect(outsiderPage.status()).toBe(404);
  const anonPage = await request.get(`/diskussion/${s.topicId}`);
  expect(anonPage.status()).toBe(404);

  await loginAs(page, TEST_USER_EMAIL, `/diskussion/${s.topicId}`);
  await page.goto(`/diskussion/${s.topicId}`);
  await expect(page.getByText("Privates Gespräch zu")).toBeVisible();
  await expect(page.getByText("Weil es ein Eigenname ist.")).toBeVisible();
  // No moderator controls for the user.
  await expect(page.getByRole("button", { name: "Anheften" })).not.toBeVisible();
  await expect(page.getByText("Ausblenden")).not.toBeVisible();
  expect(await page.content()).not.toContain(TEST_MOD_EMAIL);
});

test("users cannot see or post in board topics, or open threads", async ({ request }) => {
  const s = await setup(request);
  const board = await request.post("/api/topics", {
    headers: cookie(s.modSession),
    data: { title: "Intern", body: "Nur für Moderation" },
  });
  const { topicId: boardId } = (await board.json()) as { topicId: number };

  expect((await request.get(`/diskussion/${boardId}`, { headers: cookie(s.userSession) })).status()).toBe(404);
  expect(
    (await request.post(`/api/topics/${boardId}/posts`, { headers: cookie(s.userSession), data: { body: "x" } })).status()
  ).toBe(404);
  expect((await request.get("/diskussion", { headers: cookie(s.userSession) })).status()).toBe(404);
  expect(
    (
      await request.post("/api/topics/word", {
        headers: cookie(s.userSession),
        data: { suggestionId: s.suggestionId, body: "x" },
      })
    ).status()
  ).toBe(403);
});

test("hidden posts never reach the participant", async ({ request }) => {
  const s = await setup(request);
  const extra = await request.post(`/api/topics/${s.topicId}/posts`, {
    headers: cookie(s.modSession),
    data: { body: "Versehentlich gepostet" },
  });
  const { postId } = (await extra.json()) as { postId: number };
  await request.post(`/api/topics/posts/${postId}/hide`, { headers: cookie(s.modSession) });

  const html = await (await request.get(`/diskussion/${s.topicId}`, { headers: cookie(s.userSession) })).text();
  expect(html).not.toContain("Versehentlich gepostet");
  const modHtml = await (await request.get(`/diskussion/${s.topicId}`, { headers: cookie(s.modSession) })).text();
  expect(modHtml).toContain("Versehentlich gepostet");
});

test("the board shows moderation topics by default and word threads behind the filter", async ({
  page,
  request,
}) => {
  const s = await setup(request);
  await request.post("/api/topics", {
    headers: cookie(s.modSession),
    data: { title: "Internes Thema", body: "x" },
  });
  await loginAs(page, TEST_MOD_EMAIL, "/diskussion");
  await page.goto("/diskussion");
  await expect(page.getByText("Internes Thema")).toBeVisible();
  await expect(page.getByText(/HUND: Löschung/)).not.toBeVisible();
  await page.getByRole("tab", { name: "Wortgespräche" }).click();
  await expect(page.getByText(/HUND: Löschung/)).toBeVisible();
  await expect(page.getByText("Internes Thema")).not.toBeVisible();
});

test("users see their threads under Meine Gespräche, not other people's", async ({ request }) => {
  const s = await setup(request);
  const mine = await (await request.get("/gespraeche", { headers: cookie(s.userSession) })).text();
  expect(mine).toContain("HUND: Löschung");
  const theirs = await (await request.get("/gespraeche", { headers: cookie(s.outsiderSession) })).text();
  expect(theirs).not.toContain("HUND: Löschung");
});

test("users are rate-limited", async ({ request }) => {
  const s = await setup(request);
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) {
    const r = await request.post(`/api/topics/${s.topicId}/posts`, {
      headers: cookie(s.userSession),
      data: { body: `Nachricht ${i}` },
    });
    statuses.push(r.status());
  }
  expect(statuses.slice(0, 5)).toEqual([200, 200, 200, 200, 200]);
  expect(statuses[5]).toBe(429);
});

test("mail goes to participants only, and respects the opt-out", async ({ request }) => {
  const s = await setup(request);
  seedUser(MOD2_EMAIL, { isModerator: true });
  const { wordThreadRecipients } = await import("../../lib/conversations");
  const db = getTestDb();

  // Moderator posted: only the user. The uninvolved second moderator gets nothing.
  expect(wordThreadRecipients(db, s.topicId, s.modId).map((r) => r.email)).toEqual([TEST_USER_EMAIL]);
  // User posted: only the moderator who is part of it.
  expect(wordThreadRecipients(db, s.topicId, s.userId).map((r) => r.email)).toEqual([TEST_MOD_EMAIL]);

  db.prepare("UPDATE users SET email_messages = 0 WHERE id = ?").run(s.userId);
  expect(wordThreadRecipients(db, s.topicId, s.modId)).toHaveLength(0);
});

// ── Mail in ────────────────────────────────────────────────────────────────

test("a reply to the personal address lands in the thread", async ({ request }) => {
  const s = await setup(request);
  const token = tokenOf(s.topicId, s.userId);
  const first = postsOf(s.topicId)[0];

  const res = await request.post(`/api/inbound/${SECRET}/gespraech`, {
    form: {
      from: `Festus <${TEST_USER_EMAIL}>`,
      recipient: `gespraech+${token}@mail.test`,
      subject: "Re: [Spielwörter] HUND",
      "body-plain": "Per Mail\n\n> zitiert",
      "stripped-text": "Per Mail",
      "message-headers": JSON.stringify([["In-Reply-To", `<${first.message_id}>`]]),
    },
  });
  expect(res.ok()).toBeTruthy();
  const rows = postsOf(s.topicId);
  expect(rows).toHaveLength(2);
  expect(rows[1]).toMatchObject({ user_id: s.userId, body: "Per Mail", source: "email" });
});

test("mail with a wrong token, a foreign sender or a wrong secret is dropped", async ({ request }) => {
  const s = await setup(request);
  const token = tokenOf(s.topicId, s.userId);
  const send = (path: string, from: string, recipient: string) =>
    request.post(path, {
      form: { from, recipient, subject: "Re", "body-plain": "Eingeschleust", "stripped-text": "Eingeschleust" },
    });

  // Someone else's address with the right token (forwarded or spoofed mail).
  await send(`/api/inbound/${SECRET}/gespraech`, TEST_USER2_EMAIL, `gespraech+${token}@mail.test`);
  // The right address with a guessed token.
  await send(`/api/inbound/${SECRET}/gespraech`, TEST_USER_EMAIL, "gespraech+aaaaaaaaaaaaaaaaaaaa@mail.test");
  // A moderator using the user's token: still not that token's owner.
  await send(`/api/inbound/${SECRET}/gespraech`, TEST_MOD_EMAIL, `gespraech+${token}@mail.test`);
  // Wrong secret.
  const wrong = await send("/api/inbound/nope/gespraech", TEST_USER_EMAIL, `gespraech+${token}@mail.test`);
  expect(wrong.status()).toBe(404);

  expect(postsOf(s.topicId)).toHaveLength(1);
});

test("the moderators' list address can never reach a word thread", async ({ request }) => {
  const s = await setup(request);
  const first = postsOf(s.topicId)[0];
  const title = (getTestDb().prepare("SELECT title FROM topics WHERE id = ?").get(s.topicId) as { title: string }).title;

  // Threading header pointing into the word thread, and a matching subject.
  await request.post(`/api/inbound/${SECRET}/diskussion`, {
    form: {
      from: TEST_MOD_EMAIL,
      subject: `Re: [Spielwörter] ${title}`,
      "body-plain": "Über die Liste",
      "stripped-text": "Über die Liste",
      "message-headers": JSON.stringify([["In-Reply-To", `<${first.message_id}>`]]),
    },
  });

  expect(postsOf(s.topicId)).toHaveLength(1);
  // It became a board topic instead, invisible to the user.
  const board = getTestDb()
    .prepare("SELECT id FROM topics WHERE kind = 'moderation'")
    .all() as { id: number }[];
  expect(board).toHaveLength(1);
});

// ── Entry points ───────────────────────────────────────────────────────────

test("the moderation queue opens a thread with the suggestion's author", async ({ page }) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedSuggestion(userId, "katze", "remove", "needs_moderator");

  await loginAs(page, TEST_MOD_EMAIL, "/moderation");
  await page.goto("/moderation");
  await page.getByRole("button", { name: `Nachricht an Besucher-${userId}` }).first().click();
  await page.getByPlaceholder(/Nachricht an/).fill("Kurze Rückfrage");
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(page).toHaveURL(/\/diskussion\/\d+/);
  await expect(page.getByText("Kurze Rückfrage")).toBeVisible();
  await expect(page.getByText("Privates Gespräch zu")).toBeVisible();
});

test("a moderator can message a commenter from the word page", async ({ page, request }) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userSession = await loginViaApi(TEST_USER_EMAIL);
  await request.post("/api/word-comments", {
    headers: cookie(userSession),
    data: { word: "hund", body: "Ist das wirklich gültig?" },
  });

  await loginAs(page, TEST_MOD_EMAIL, "/wort/HUND");
  await page.goto("/wort/HUND");
  await page.locator("summary").click();
  await page.getByRole("button", { name: `Nachricht an Besucher-${userId}` }).click();
  await page.getByPlaceholder(/Nachricht an/).fill("Ja, steht im Duden.");
  await page.getByRole("button", { name: "Nachricht senden" }).click();
  await expect(page).toHaveURL(/\/diskussion\/\d+/);

  // The commenter sees the thread linked on the word page; the public does not.
  const html = await (await request.get("/wort/HUND", { headers: cookie(userSession) })).text();
  expect(html).toContain("Private Gespräche");
  const anon = await (await request.get("/wort/HUND")).text();
  expect(anon).not.toContain("Private Gespräche");
});
