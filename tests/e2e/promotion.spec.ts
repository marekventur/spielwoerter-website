/**
 * Draft promotion: regular users → pending_review; moderator-touched drafts → moderator_approved.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser, seedSuggestion } from "../helpers/seed";
import { loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { promoteEligibleDrafts } from "../../lib/promotion";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

function backdateAndPromote(suggestionId: number): void {
  const db = getTestDb();
  // Use SQLite datetime() so comparison matches the promotion job (not ISO strings).
  db.prepare(
    "UPDATE suggestions SET last_modified_at = datetime('now', '-70 minutes') WHERE id = ?"
  ).run(suggestionId);
  promoteEligibleDrafts(db);
}

test("regular user add-draft promotes to pending_review after idle", async ({
  request,
}) => {
  seedUser(TEST_USER_EMAIL);
  const session = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${session}` },
    data: {
      word: "promouserword",
      action: "add",
      payload: { description: "test" },
    },
  });
  expect(res.status()).toBe(200);

  const db = getTestDb();
  const row = db
    .prepare(
      "SELECT id, status, moderator_fast_track FROM suggestions WHERE word = 'promouserword'"
    )
    .get() as { id: number; status: string; moderator_fast_track: number };
  expect(row.moderator_fast_track).toBe(0);

  backdateAndPromote(row.id);
  const after = db
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(row.id) as { status: string };
  expect(after.status).toBe("pending_review");
});

test("moderator add-draft promotes to moderator_approved after idle", async ({
  request,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${session}` },
    data: {
      word: "promomodword",
      action: "add",
      payload: { description: "mod entry" },
    },
  });
  expect(res.status()).toBe(200);

  const db = getTestDb();
  const row = db
    .prepare(
      "SELECT id, moderator_fast_track FROM suggestions WHERE word = 'promomodword'"
    )
    .get() as { id: number; moderator_fast_track: number };
  expect(row.moderator_fast_track).toBe(1);

  backdateAndPromote(row.id);
  const after = db
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(row.id) as { status: string };
  expect(after.status).toBe("moderator_approved");
});

test("moderator PATCH on another user's draft → moderator_approved after idle", async ({
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const suggId = seedSuggestion(userId, "modpatched", "add", "draft");

  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  const patch = await request.patch(`/api/suggestions/${suggId}`, {
    headers: {
      Cookie: `session=${modSession}`,
      "Content-Type": "application/json",
    },
    data: { payload: { description: "corrected by moderator" } },
  });
  expect(patch.status()).toBe(200);

  const db = getTestDb();
  const ft = db
    .prepare("SELECT moderator_fast_track FROM suggestions WHERE id = ?")
    .get(suggId) as { moderator_fast_track: number };
  expect(ft.moderator_fast_track).toBe(1);

  backdateAndPromote(suggId);
  const after = db
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string };
  expect(after.status).toBe("moderator_approved");
});

test("user PATCH after moderator edit clears fast track → pending_review", async ({
  request,
}) => {
  const userId = seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const suggId = seedSuggestion(userId, "mixedtrack", "add", "draft");

  const modSession = await loginViaApi(TEST_MOD_EMAIL);
  await request.patch(`/api/suggestions/${suggId}`, {
    headers: {
      Cookie: `session=${modSession}`,
      "Content-Type": "application/json",
    },
    data: { payload: { description: "mod first" } },
  });

  const userSession = await loginViaApi(TEST_USER_EMAIL);
  const userPatch = await request.patch(`/api/suggestions/${suggId}`, {
    headers: {
      Cookie: `session=${userSession}`,
      "Content-Type": "application/json",
    },
    data: { payload: { description: "user tweak" } },
  });
  expect(userPatch.status()).toBe(200);

  const db = getTestDb();
  const ft = db
    .prepare("SELECT moderator_fast_track FROM suggestions WHERE id = ?")
    .get(suggId) as { moderator_fast_track: number };
  expect(ft.moderator_fast_track).toBe(0);

  backdateAndPromote(suggId);
  const after = db
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string };
  expect(after.status).toBe("pending_review");
});
