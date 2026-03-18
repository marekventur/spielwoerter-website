/**
 * Security tests — cover auth bypass, authorization escalation,
 * input validation, and session hygiene.
 *
 * These tests call the API directly (request fixture) where possible
 * to keep them fast and focused.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser, seedSuggestion } from "../helpers/seed";
import { loginViaApi, getOtpCode } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import {
  BASE_URL,
  TEST_USER_EMAIL,
  TEST_USER2_EMAIL,
  TEST_MOD_EMAIL,
  TEST_ADMIN_EMAIL,
} from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

// ── Authentication bypass ────────────────────────────────────────────────────

test("GET /api/suggestions without cookie returns 401", async ({ request }) => {
  const res = await request.get("/api/suggestions");
  expect(res.status()).toBe(401);
  const body = await res.json();
  expect(body.error).toBeTruthy();
});

test("POST /api/suggestions without cookie returns 401", async ({
  request,
}) => {
  const res = await request.post("/api/suggestions", {
    data: { word: "test", action: "add" },
  });
  expect(res.status()).toBe(401);
});

test("request with invalid session cookie returns 401", async ({ request }) => {
  const res = await request.get("/api/suggestions", {
    headers: { Cookie: "session=definitely-not-a-real-session-id" },
  });
  expect(res.status()).toBe(401);
});

test("request with expired session returns 401", async ({ request }) => {
  // Seed a user and manually create an expired session
  seedUser(TEST_USER_EMAIL);
  const db = getTestDb();
  const userId = (
    db
      .prepare("SELECT id FROM users WHERE email = ?")
      .get(TEST_USER_EMAIL) as { id: number }
  ).id;
  const expiredId = "expired-session-id-12345";
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, datetime('now', '-1 day'))"
  ).run(expiredId, userId);

  const res = await request.get("/api/suggestions", {
    headers: { Cookie: `session=${expiredId}` },
  });
  expect(res.status()).toBe(401);
});

// ── Authorization escalation ─────────────────────────────────────────────────

test("regular user cannot approve moderation", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/moderation/1/approve", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});

test("regular user cannot reject moderation", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/moderation/1/reject", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});

test("regular user cannot batch moderate", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/moderation/batch", {
    headers: { Cookie: `session=${sessionId}` },
    data: { ids: [1, 2], action: "approve" },
  });
  expect(res.status()).toBe(403);
});

test("regular user cannot read admin users list", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.get("/api/admin/users", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});

test("moderator cannot read admin users list", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const sessionId = await loginViaApi(TEST_MOD_EMAIL);

  const res = await request.get("/api/admin/users", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});

test("moderator cannot set-moderator on other users", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const targetId = seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_MOD_EMAIL);

  const res = await request.post(`/api/admin/users/${targetId}/set-moderator`, {
    headers: { Cookie: `session=${sessionId}` },
    data: { value: true },
  });
  expect(res.status()).toBe(403);
});

test("user cannot delete another user's suggestion", async ({ request }) => {
  // User A owns the suggestion
  const userAId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const suggId = seedSuggestion(userAId, "ownedword", "add", "draft");

  // User B tries to delete it
  seedUser(TEST_USER2_EMAIL, { licenseApproved: true });
  const sessionIdB = await loginViaApi(TEST_USER2_EMAIL);

  const res = await request.delete(`/api/suggestions/${suggId}`, {
    headers: { Cookie: `session=${sessionIdB}` },
  });
  // Should 404 — the query filters by user_id so it looks like "not found"
  expect(res.status()).toBe(404);

  // Suggestion should still exist
  const still = getTestDb()
    .prepare("SELECT id FROM suggestions WHERE id = ?")
    .get(suggId);
  expect(still).toBeTruthy();
});

// ── Input validation ─────────────────────────────────────────────────────────

test("request-code rejects email without @", async ({ request }) => {
  const res = await request.post("/api/auth/request-code", {
    data: { email: "notanemail" },
  });
  expect(res.status()).toBe(400);
});

test("suggestions rejects missing word field", async ({ request }) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${sessionId}` },
    data: { action: "add" }, // no word
  });
  expect(res.status()).toBe(400);
});

test("suggestions rejects invalid action", async ({ request }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${sessionId}` },
    data: { word: "test", action: "hack_the_planet" },
  });
  expect(res.status()).toBe(400);
});

test("SQL injection in word lookup does not crash the server", async ({
  request,
}) => {
  const res = await request.get(
    "/api/words/" + encodeURIComponent("'; DROP TABLE words; --")
  );
  // Either 404 (word not found) — parameterized queries handle this safely
  expect([200, 404]).toContain(res.status());

  // Words table must still exist and contain data
  const count = getTestDb()
    .prepare("SELECT COUNT(*) as c FROM words")
    .get() as { c: number };
  expect(count.c).toBeGreaterThan(0);
});

test("SQL injection in suggestion word stored literally", async ({
  request,
}) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const maliciousWord = "'; DROP TABLE suggestions;--";
  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${sessionId}` },
    data: { word: maliciousWord, action: "add" },
  });
  // Stored as literal string (lowercase)
  expect(res.status()).toBe(200);

  // suggestions table still exists and has a row
  const row = getTestDb()
    .prepare(
      "SELECT word FROM suggestions WHERE word = ? AND action = 'add'"
    )
    .get(maliciousWord.toLowerCase()) as { word: string } | undefined;
  expect(row?.word).toBe(maliciousWord.toLowerCase());
});

test("XSS in word URL parameter is escaped by React", async ({ page }) => {
  const xssPayload = "<script>window.__xss=1</script>";
  await page.goto(`/wort/${encodeURIComponent(xssPayload)}`);
  // Script should NOT have executed
  const xssExecuted = await page.evaluate(() => (window as any).__xss);
  expect(xssExecuted).toBeUndefined();
  // Page should still load (no crash)
  await expect(page.locator("body")).toBeVisible();
});

// ── Session hygiene ──────────────────────────────────────────────────────────

test("session cookie is not accessible via document.cookie (httpOnly)", async ({
  page,
}) => {
  // Use page.request so the browser context receives the Set-Cookie response header
  seedUser(TEST_USER_EMAIL);
  await page.request.post("/api/auth/request-code", {
    data: { email: TEST_USER_EMAIL },
  });
  const code = getOtpCode(TEST_USER_EMAIL);
  await page.request.post("/api/auth/verify-code", {
    data: { email: TEST_USER_EMAIL, code },
  });

  // Inspect the cookie flags in the browser context — httpOnly cookies are
  // not accessible via document.cookie but ARE returned by context.cookies()
  const cookies = await page.context().cookies("http://localhost");
  const sessionCookie = cookies.find((c) => c.name === "session");
  expect(sessionCookie).toBeTruthy();
  expect(sessionCookie?.httpOnly).toBe(true);
});

test("CSRF: form-encoded POST to auth endpoint is rejected (no JSON body)", async ({
  request,
}) => {
  // express.json() won't parse application/x-www-form-urlencoded
  // so req.body.email will be undefined → 400
  const res = await request.post("/api/auth/request-code", {
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    data: "email=test@example.com",
  });
  expect(res.status()).toBe(400);
});
