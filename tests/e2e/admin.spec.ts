import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import {
  TEST_ADMIN_EMAIL,
  TEST_MOD_EMAIL,
  TEST_USER_EMAIL,
} from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("admin page lists all users", async ({ page }) => {
  seedUser(TEST_ADMIN_EMAIL, { isAdmin: true, isModerator: true });
  seedUser(TEST_USER_EMAIL);
  seedUser(TEST_MOD_EMAIL, { isModerator: true });

  await loginAs(page, TEST_ADMIN_EMAIL);
  await page.goto("/admin");

  await expect(page.getByRole("heading", { name: "Admin" })).toBeVisible();
  await expect(page.getByText(TEST_USER_EMAIL)).toBeVisible();
  await expect(page.getByText(TEST_MOD_EMAIL)).toBeVisible();
  await expect(page.getByText(TEST_ADMIN_EMAIL)).toBeVisible();
});

test("moderator badge shown for moderator user", async ({ page }) => {
  seedUser(TEST_ADMIN_EMAIL, { isAdmin: true, isModerator: true });
  seedUser(TEST_MOD_EMAIL, { isModerator: true });

  await loginAs(page, TEST_ADMIN_EMAIL);
  await page.goto("/admin");

  await expect(page.getByText("Moderator").first()).toBeVisible();
});

test("toggle moderator: promote then demote a user", async ({ page }) => {
  seedUser(TEST_ADMIN_EMAIL, { isAdmin: true, isModerator: true });
  const targetId = seedUser(TEST_USER_EMAIL);

  await loginAs(page, TEST_ADMIN_EMAIL);
  await page.goto("/admin");

  // Promote
  const promoteBtn = page
    .getByRole("button", { name: "Zum Moderator machen" })
    .first();
  await promoteBtn.click();

  // Badge appears
  await expect(page.getByText("Moderator").first()).toBeVisible();

  // Verify DB
  const db = getTestDb();
  let row = db
    .prepare("SELECT is_moderator FROM users WHERE id = ?")
    .get(targetId) as { is_moderator: number };
  expect(row.is_moderator).toBe(1);

  // Demote
  await page.getByRole("button", { name: "Moderator entfernen" }).first().click();

  // Badge gone
  await expect(page.getByText("Zum Moderator machen")).toBeVisible();

  row = db
    .prepare("SELECT is_moderator FROM users WHERE id = ?")
    .get(targetId) as { is_moderator: number };
  expect(row.is_moderator).toBe(0);
});

test("admin user has no toggle button for themselves", async ({ page }) => {
  seedUser(TEST_ADMIN_EMAIL, { isAdmin: true, isModerator: true });

  await loginAs(page, TEST_ADMIN_EMAIL);
  await page.goto("/admin");

  // The admin row should not have a toggle button (is_admin check in UI)
  const adminRow = page.locator("div").filter({ hasText: TEST_ADMIN_EMAIL }).first();
  await expect(
    adminRow.getByRole("button", { name: /Moderator/ })
  ).not.toBeVisible();
});

test("non-admin user is redirected from /admin", async ({ page }) => {
  seedUser(TEST_USER_EMAIL);
  await loginAs(page, TEST_USER_EMAIL);
  await page.goto("/admin");
  await expect(page).toHaveURL("/");
});

test("moderator cannot access admin API", async ({ request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const sessionId = await loginViaApi(TEST_MOD_EMAIL);

  const res = await request.get("/api/admin/users", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});
