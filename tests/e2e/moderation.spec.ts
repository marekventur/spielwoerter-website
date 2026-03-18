import { test, expect } from "@playwright/test";
import {
  cleanDb,
  seedWords,
  seedUser,
  seedSuggestion,
} from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { TEST_MOD_EMAIL, TEST_USER_EMAIL } from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("moderation page shows pending suggestions", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  seedSuggestion(userId, "neuword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await expect(
    page.getByRole("heading", { name: "Moderation" })
  ).toBeVisible();
  // The word appears in both the group header and the item row — check the item row link
  await expect(page.getByRole("link", { name: "NEUWORD", exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Genehmigen", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ablehnen", exact: true })).toBeVisible();
});

test("approve single suggestion removes it from queue and updates DB", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const suggId = seedSuggestion(userId, "approveword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Genehmigen" }).first().click();

  // All links to APPROVEWORD disappear from the list
  await expect(page.getByRole("link", { name: "APPROVEWORD" })).toHaveCount(0);

  // Verify DB state
  const row = getTestDb()
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string };
  expect(row.status).toBe("moderator_approved");
});

test("reject single suggestion updates DB and adds to rejected_words", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const suggId = seedSuggestion(userId, "rejectword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Ablehnen" }).first().click();

  await expect(page.getByRole("link", { name: "REJECTWORD" })).toHaveCount(0);

  const db = getTestDb();
  const row = db
    .prepare("SELECT status FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string };
  expect(row.status).toBe("moderator_rejected");

  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
    .get("rejectword", "add");
  expect(blocked).toBeTruthy();
});

test("batch approve entire group", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  // Two words with the same base (hund group)
  const id1 = seedSuggestion(userId, "hund", "remove", "pending_review");
  const id2 = seedSuggestion(userId, "hunde", "remove", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  // Click "Alle genehmigen" on the group header
  await page.getByRole("button", { name: "Alle genehmigen" }).first().click();

  // After batch approve, the entire group card disappears
  // Check that the approve/reject buttons for these words are gone
  await expect(page.getByText("Nichts zu prüfen")).toBeVisible();

  const db = getTestDb();
  for (const id of [id1, id2]) {
    const row = db
      .prepare("SELECT status FROM suggestions WHERE id = ?")
      .get(id) as { status: string };
    expect(row.status).toBe("moderator_approved");
  }
});


test("batch reject entire group", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const id1 = seedSuggestion(userId, "katze", "remove", "pending_review");
  const id2 = seedSuggestion(userId, "hund", "remove", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  // Reject the katze group (single item)
  await page.getByRole("button", { name: "Alle ablehnen" }).first().click();

  const db = getTestDb();
  // At least one of the groups got rejected
  const rejected = db
    .prepare(
      "SELECT COUNT(*) as c FROM suggestions WHERE status = 'moderator_rejected'"
    )
    .get() as { c: number };
  expect(rejected.c).toBeGreaterThanOrEqual(1);
});

test("empty moderation queue shows Nichts zu prüfen", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true, licenseApproved: true });
  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");
  await expect(page.getByText("Nichts zu prüfen")).toBeVisible();
});

test("non-moderator is redirected from /moderation", async ({ page }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  await loginAs(page, TEST_USER_EMAIL);
  await page.goto("/moderation");
  await expect(page).toHaveURL("/");
});

test("unauthenticated user redirected from /moderation to login", async ({
  page,
}) => {
  await page.goto("/moderation");
  await expect(page).toHaveURL(/\/login/);
});

test("regular user cannot call moderation API", async ({ request }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/moderation/1/approve", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});
