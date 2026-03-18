import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser, seedSuggestion } from "../helpers/seed";
import { loginAs, loginViaApi, setSessionCookie } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import {
  TEST_USER_EMAIL,
  TEST_USER2_EMAIL,
  BASE_URL,
} from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("license gate appears on first suggestion and submits after accept", async ({
  page,
}) => {
  // New user — no license yet
  seedUser(TEST_USER_EMAIL, { licenseApproved: false });
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/wort/ZZZNEU");
  await page.getByRole("button", { name: "Hinzufügen vorschlagen" }).click();

  // CC0 consent dialog
  await expect(page.getByText("CC0-Lizenz bestätigen")).toBeVisible();
  await page.getByRole("button", { name: "Ich stimme zu" }).click();

  // Success message
  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();

  // Verify DB state
  const db = getTestDb();
  const user = db
    .prepare("SELECT id, license_approved FROM users WHERE email = ?")
    .get(TEST_USER_EMAIL) as { id: number; license_approved: number };
  expect(user.license_approved).toBe(1);
  const sugg = db
    .prepare("SELECT status FROM suggestions WHERE user_id = ? AND word = 'zzzneu'")
    .get(user.id) as { status: string } | undefined;
  expect(sugg?.status).toBe("draft");
});

test("create add-suggestion for word not in list", async ({ page }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/wort/NEUESWORT");
  await page.getByRole("button", { name: "Hinzufügen vorschlagen" }).click();
  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
});

test("create remove-suggestion for accepted word", async ({ page }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/wort/HUND");
  await page
    .getByRole("button", { name: "Melde dieses Wort als fehlerhaft" })
    .click();
  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
});

test("my suggestions page shows draft with Löschen button", async ({
  page,
}) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  seedSuggestion(userId, "testword", "add", "draft");
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/meine-vorschlaege");
  await expect(page.getByRole("heading", { name: /Entwürfe/ })).toBeVisible();
  await expect(page.getByText("TESTWORD")).toBeVisible();
  await expect(page.getByRole("button", { name: "Löschen" })).toBeVisible();
});

test("delete draft removes it from my suggestions", async ({ page }) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  seedSuggestion(userId, "delword", "add", "draft");
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/meine-vorschlaege");
  await expect(page.getByText("DELWORD")).toBeVisible();

  await page.getByRole("button", { name: "Löschen" }).click();

  await expect(page.getByText("DELWORD")).not.toBeVisible();
  await expect(page.getByText("Keine Entwürfe")).toBeVisible();
});

test("pending_review suggestion shows in In Prüfung / Entschieden section", async ({
  page,
}) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  seedSuggestion(userId, "pruefen", "add", "pending_review");
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/meine-vorschlaege");
  await expect(page.getByText("In Prüfung / Entschieden")).toBeVisible();
  await expect(page.getByText("PRUEFEN")).toBeVisible();
  // Should NOT have a delete button (not a draft)
  await expect(page.getByRole("button", { name: "Löschen" })).not.toBeVisible();
});

test("duplicate suggestion shows already-exists message", async ({ page }) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  seedSuggestion(userId, "hund", "remove", "draft");
  await loginAs(page, TEST_USER_EMAIL);

  await page.goto("/wort/HUND");
  // anyActive check hides the suggest button
  await expect(
    page.getByText("Du hast bereits einen Vorschlag für dieses Wort")
  ).toBeVisible();
});

test("morphology suggestions appear after draft creation", async ({ page }) => {
  seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  await loginAs(page, TEST_USER_EMAIL);

  // HUND is accepted; removing it should show HUNDE and HUNDES as morph candidates
  await page.goto("/wort/HUND");
  await page
    .getByRole("button", { name: "Melde dieses Wort als fehlerhaft" })
    .click();

  await expect(page.getByText("Entwurf gespeichert")).toBeVisible();
  await expect(
    page.getByText("Weitere Formen mit gleichem Stichwort")
  ).toBeVisible();

  // Both related words should be checkboxes (exact match — HUNDE/HUNDES differ)
  await expect(page.getByRole("checkbox", { name: "HUNDE", exact: true })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "HUNDES", exact: true })).toBeVisible();

  // Select one and submit
  await page.getByRole("checkbox", { name: "HUNDE", exact: true }).check();
  await page.getByRole("button", { name: /Entwurf/ }).click();

  await expect(page.getByText("Weitere Entwürfe gespeichert")).toBeVisible();
});

test("cannot delete non-draft suggestion via API", async ({ request }) => {
  const userId = seedUser(TEST_USER_EMAIL, { licenseApproved: true });
  const suggId = seedSuggestion(userId, "lockedword", "add", "pending_review");

  const sessionId = await loginViaApi(TEST_USER_EMAIL);
  const res = await request.delete(`/api/suggestions/${suggId}`, {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toContain("Entwürfe");
});

test("unauthenticated user redirected from /meine-vorschlaege", async ({
  page,
}) => {
  await page.goto("/meine-vorschlaege");
  await expect(page).toHaveURL(/\/login/);
});

test("POST /api/suggestions without license returns 403 license_required", async ({
  request,
}) => {
  // Seed user with no license
  seedUser(TEST_USER2_EMAIL, { licenseApproved: false });
  const sessionId = await loginViaApi(TEST_USER2_EMAIL);

  const res = await request.post("/api/suggestions", {
    headers: { Cookie: `session=${sessionId}` },
    data: { word: "testword", action: "add" },
  });
  expect(res.status()).toBe(403);
  const body = await res.json();
  expect(body.error).toBe("license_required");
});
