/**
 * The moderator discussion board (/diskussion): moderators-only access, thread
 * creation and replies, mail recipient selection, and the Mailgun inbound
 * endpoint that turns an email reply into a post.
 *
 * Nothing here asserts on sent mail: MAILGUN_API_KEY is blank in the test env
 * and mailEnabled() is false, so the send path never leaves the process. The
 * observable contract is DB rows and the computed recipient list.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import {
  recipientsFor,
  backlinks,
  normaliseSubject,
  mailAllowlist,
} from "../../lib/topics";
import {
  TEST_USER_EMAIL,
  TEST_MOD_EMAIL,
  TEST_ADMIN_EMAIL,
} from "../helpers/test-config";

const MOD2_EMAIL = "moderator2@example.test";
const MOD3_EMAIL = "moderator3@example.test";
const SECRET = "test-inbound-secret";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

function cookieHeader(session: string) {
  return { Cookie: `session=${session}` };
}

function posts(topicId: number) {
  return getTestDb()
    .prepare(
      "SELECT id, parent_id, user_id, body, source, emailed_at, message_id FROM topic_posts WHERE topic_id = ? ORDER BY id"
    )
    .all(topicId) as {
    id: number;
    parent_id: number | null;
    user_id: number;
    body: string;
    source: string;
    emailed_at: string | null;
    message_id: string | null;
  }[];
}

async function createTopic(request: any, session: string, title: string, body: string) {
  const res = await request.post("/api/topics", {
    headers: cookieHeader(session),
    data: { title, body },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as { topicId: number; postId: number };
}

test("moderator creates a topic; the first post is stamped as mailed", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(MOD2_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);

  const { topicId } = await createTopic(request, session, "Regeln überarbeiten", "Vorschlag …");

  const rows = posts(topicId);
  expect(rows).toHaveLength(1);
  expect(rows[0].source).toBe("web");
  expect(rows[0].message_id).toMatch(/^post-\d+@/);
  // mailEnabled() is false in tests, so the send "succeeds" without sending.
  expect(rows[0].emailed_at).not.toBeNull();
});

test("the thread is one chronological stream; backlinks only when they inform", async ({
  request,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId, postId } = await createTopic(request, session, "Thema", "Erster Beitrag");

  // A second top-level post, then a reply that points back at the *first* one.
  const second = await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(session),
    data: { body: "Zweiter Beitrag" },
  });
  const secondId = (await second.json()).postId as number;
  const third = await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(session),
    data: { body: "Antwort auf den ersten", parentId: postId },
  });
  const thirdId = (await third.json()).postId as number;
  // And one replying to the message directly above it.
  const fourth = await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(session),
    data: { body: "Direkt darauf", parentId: thirdId },
  });
  const fourthId = (await fourth.json()).postId as number;

  const rows = posts(topicId);
  // Strict chronological order — no reordering by parent.
  expect(rows.map((p) => p.id)).toEqual([postId, secondId, thirdId, fourthId]);

  const withAuthor = rows.map((p) => ({
    ...p,
    topic_id: topicId,
    hidden_at: null,
    created_at: "2026-01-01 00:00",
    author_name: null,
  }));
  const marks = backlinks(withAuthor as any);
  // Points back past an intervening post → worth showing.
  expect(marks.get(thirdId)?.id).toBe(postId);
  // Replies to the message directly above → nothing to show.
  expect(marks.has(fourthId)).toBe(false);
  expect(marks.has(secondId)).toBe(false);
});

test("email preferences select who is mailed", async ({ request }) => {
  const authorId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const allId = seedUser(MOD2_EMAIL, { isModerator: true });
  const mineId = seedUser(MOD3_EMAIL, { isModerator: true });
  seedUser(TEST_USER_EMAIL); // not a moderator
  const db = getTestDb();
  db.prepare("UPDATE users SET email_diskussion = 'mine' WHERE id = ?").run(mineId);

  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId } = await createTopic(request, session, "Thema", "Text");

  // 'mine' has not posted in this thread yet, so they are not mailed.
  let emails = recipientsFor(db, topicId, authorId).map((r) => r.email);
  expect(emails).toEqual([MOD2_EMAIL]);

  // Once they post, they are in.
  const mineSession = await loginViaApi(MOD3_EMAIL);
  await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(mineSession),
    data: { body: "Ich bin dabei" },
  });
  emails = recipientsFor(db, topicId, authorId).map((r) => r.email).sort();
  expect(emails).toEqual([MOD2_EMAIL, MOD3_EMAIL].sort());

  // 'none' opts out entirely, and the author is never mailed about their own post.
  db.prepare("UPDATE users SET email_diskussion = 'none' WHERE id = ?").run(allId);
  emails = recipientsFor(db, topicId, authorId).map((r) => r.email);
  expect(emails).toEqual([MOD3_EMAIL]);
  expect(recipientsFor(db, topicId, allId).map((r) => r.email)).not.toContain(MOD2_EMAIL);
});

test("non-moderators cannot see or use the board", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId } = await createTopic(request, modSession, "Intern", "Nur für Mods");

  seedUser(TEST_USER_EMAIL);
  const userSession = await loginViaApi(TEST_USER_EMAIL);

  // 404, not 403: a 403 would confirm the thread exists.
  const list = await request.get("/diskussion", { headers: cookieHeader(userSession) });
  expect(list.status()).toBe(404);
  const thread = await request.get(`/diskussion/${topicId}`, {
    headers: cookieHeader(userSession),
  });
  expect(thread.status()).toBe(404);

  const write = await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(userSession),
    data: { body: "darf ich nicht" },
  });
  expect(write.status()).toBe(403);

  // Anonymous too (no Cookie header at all).
  const anon = await request.get("/diskussion");
  expect(anon.status()).toBe(404);
});

test("moderator hides a post", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId, postId } = await createTopic(request, session, "Thema", "Text");

  const hide = await request.post(`/api/topics/posts/${postId}/hide`, {
    headers: cookieHeader(session),
  });
  expect((await hide.json()).hidden).toBe(true);

  const row = getTestDb()
    .prepare("SELECT hidden_at, hidden_by FROM topic_posts WHERE id = ?")
    .get(postId) as { hidden_at: string | null; hidden_by: number | null };
  expect(row.hidden_at).not.toBeNull();
  expect(row.hidden_by).not.toBeNull();
  expect(topicId).toBeGreaterThan(0);
});

test("locked topics reject new posts", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId } = await createTopic(request, session, "Thema", "Text");

  await request.post(`/api/topics/${topicId}/lock`, { headers: cookieHeader(session) });
  const res = await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(session),
    data: { body: "zu spät" },
  });
  expect(res.status()).toBe(409);
});

// ── Inbound mail ───────────────────────────────────────────────────────────

function inboundForm(fields: Record<string, string>) {
  return { form: fields };
}

test("an email reply becomes a post in the right thread", async ({ request }) => {
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId, postId } = await createTopic(request, session, "Regeln", "Erster Beitrag");
  const messageId = posts(topicId)[0].message_id!;

  const res = await request.post(
    `/api/inbound/${SECRET}/diskussion`,
    inboundForm({
      from: `Panikpilz <${TEST_MOD_EMAIL}>`,
      subject: "Re: [Spielwörter] Regeln",
      "body-plain": "Meine Antwort\n\n> zitierter Text",
      "stripped-text": "Meine Antwort",
      "message-headers": JSON.stringify([["In-Reply-To", `<${messageId}>`]]),
    })
  );
  expect(res.ok()).toBeTruthy();

  const rows = posts(topicId);
  expect(rows).toHaveLength(2);
  expect(rows[1].body).toBe("Meine Antwort");
  expect(rows[1].source).toBe("email");
  expect(rows[1].parent_id).toBe(postId);
  expect(rows[1].user_id).toBe(modId);

  // The untouched body is kept so a bad strip is recoverable.
  const raw = getTestDb()
    .prepare("SELECT raw_body FROM topic_posts WHERE id = ?")
    .get(rows[1].id) as { raw_body: string | null };
  expect(raw.raw_body).toContain("zitierter Text");
});

test("mail with no matching thread starts a new topic", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });

  const res = await request.post(
    `/api/inbound/${SECRET}/diskussion`,
    inboundForm({
      from: TEST_MOD_EMAIL,
      subject: "Frage zur Deklination",
      "body-plain": "Wie handhaben wir das?",
    })
  );
  expect(res.ok()).toBeTruthy();

  const topic = getTestDb()
    .prepare("SELECT id, title FROM topics ORDER BY id DESC LIMIT 1")
    .get() as { id: number; title: string } | undefined;
  expect(topic?.title).toBe("Frage zur Deklination");
});

test("inbound rejects a wrong secret, unknown senders and non-moderators", async ({
  request,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(TEST_USER_EMAIL); // exists, but not a moderator
  const db = getTestDb();
  const count = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM topic_posts").get() as { n: number }).n;

  const bad = await request.post(
    "/api/inbound/wrong-secret/diskussion",
    inboundForm({ from: TEST_MOD_EMAIL, subject: "X", "body-plain": "Y" })
  );
  expect(bad.status()).toBe(404);
  expect(count()).toBe(0);

  // Unknown sender and non-moderator: accepted with 200 (so Mailgun does not
  // retry) but silently dropped.
  for (const from of ["fremder@example.test", TEST_USER_EMAIL]) {
    const res = await request.post(
      `/api/inbound/${SECRET}/diskussion`,
      inboundForm({ from, subject: "X", "body-plain": "Y" })
    );
    expect(res.ok()).toBeTruthy();
  }
  expect(count()).toBe(0);
});

test("inbound refuses to ingest our own notification mail", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const db = getTestDb();
  const count = () =>
    (db.prepare("SELECT COUNT(*) AS n FROM topic_posts").get() as { n: number }).n;

  // Our own list address as sender.
  await request.post(
    `/api/inbound/${SECRET}/diskussion`,
    inboundForm({
      from: "moderatoren-test@mail.test",
      subject: "Schleife",
      "body-plain": "…",
    })
  );
  // Auto-Submitted, as our own mail sets.
  await request.post(
    `/api/inbound/${SECRET}/diskussion`,
    inboundForm({
      from: TEST_MOD_EMAIL,
      subject: "Schleife",
      "body-plain": "…",
      "message-headers": JSON.stringify([["Auto-Submitted", "auto-generated"]]),
    })
  );
  // Spam-flagged by Mailgun (the domain runs spam_action=tag).
  await request.post(
    `/api/inbound/${SECRET}/diskussion`,
    inboundForm({
      from: TEST_MOD_EMAIL,
      subject: "Spam",
      "body-plain": "…",
      "message-headers": JSON.stringify([["X-Mailgun-Sflag", "Yes"]]),
    })
  );

  expect(count()).toBe(0);
});

test("subject normalisation strips reply prefixes and our tag", () => {
  expect(normaliseSubject("Re: AW: [Spielwörter] Regeln")).toBe("Regeln");
  expect(normaliseSubject("[Spielwörter] Regeln")).toBe("Regeln");
  expect(normaliseSubject("Regeln")).toBe("Regeln");
});

test("the mail allowlist limits who is notified without hiding posts", async ({
  request,
}) => {
  const authorId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(MOD2_EMAIL, { isModerator: true });
  seedUser(MOD3_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId } = await createTopic(request, session, "Rollout", "Test");
  const db = getTestDb();

  expect(mailAllowlist()).toBeNull();
  expect(recipientsFor(db, topicId, authorId)).toHaveLength(2);

  process.env.DISKUSSION_MAIL_ALLOWLIST = ` ${MOD2_EMAIL.toUpperCase()} , `;
  try {
    expect(mailAllowlist()).toEqual([MOD2_EMAIL]);
    const kept = recipientsFor(db, topicId, authorId);
    expect(kept.map((r) => r.email)).toEqual([MOD2_EMAIL]);
  } finally {
    delete process.env.DISKUSSION_MAIL_ALLOWLIST;
  }

  // The posts themselves are untouched — this gates mail, not visibility.
  expect(posts(topicId)).toHaveLength(1);
});

test("admins can delete a thread; moderators cannot", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedUser(TEST_ADMIN_EMAIL, { isModerator: true, isAdmin: true });
  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  const { topicId } = await createTopic(request, modSession, "Wegwerf", "Test");
  await request.post(`/api/topics/${topicId}/posts`, {
    headers: cookieHeader(modSession),
    data: { body: "noch einer" },
  });

  const denied = await request.delete(`/api/topics/${topicId}`, {
    headers: cookieHeader(modSession),
  });
  expect(denied.status()).toBe(403);
  expect(posts(topicId)).toHaveLength(2);

  const adminSession = await loginViaApi(TEST_ADMIN_EMAIL);
  const ok = await request.delete(`/api/topics/${topicId}`, {
    headers: cookieHeader(adminSession),
  });
  expect(ok.ok()).toBeTruthy();

  // Gone, posts included — no orphaned rows.
  expect(posts(topicId)).toHaveLength(0);
  const topic = getTestDb()
    .prepare("SELECT id FROM topics WHERE id = ?")
    .get(topicId);
  expect(topic).toBeUndefined();

  const missing = await request.delete(`/api/topics/${topicId}`, {
    headers: cookieHeader(adminSession),
  });
  expect(missing.status()).toBe(404);
});
