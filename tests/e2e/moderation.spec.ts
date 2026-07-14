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
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  seedSuggestion(userId, "neuword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await expect(
    page.getByRole("heading", { name: "Moderation" })
  ).toBeVisible();
  // The word appears in both the group header and the item row — check the item row link
  await expect(page.getByRole("link", { name: "NEUWORD", exact: true }).first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Wort aufnehmen", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Ablehnen", exact: true })).toBeVisible();
});

test("approve single suggestion collapses it in the queue and updates DB", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "approveword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Wort aufnehmen" }).first().click();

  // The item collapses to a decided row with an undo button
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Rückgängig" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Wort aufnehmen" })).toHaveCount(0);

  // Verify DB state
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const row = getTestDb()
    .prepare("SELECT status, decided_by, decided_at FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string; decided_by: number | null; decided_at: string | null };
  expect(row.status).toBe("moderator_approved");
  expect(row.decided_by).toBe(modId);
  expect(row.decided_at).not.toBeNull();
});

test("reject single suggestion updates DB and adds to rejected_words", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "rejectword", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  // Two-step: first click opens the comment prompt, second confirms
  await page.getByRole("button", { name: "Ablehnen", exact: true }).first().click();
  await expect(page.getByText("Grund der Ablehnung")).toBeVisible();
  await page.getByRole("button", { name: "Ablehnen", exact: true }).last().click();

  await expect(page.getByText("Abgelehnt", { exact: true })).toBeVisible();

  const db = getTestDb();
  const row = db
    .prepare("SELECT status, moderation_comment FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string; moderation_comment: string | null };
  expect(row.status).toBe("moderator_rejected");
  expect(row.moderation_comment).toBeNull();

  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
    .get("rejectword", "add");
  expect(blocked).toBeTruthy();
});

test("reject with comment stores reason and shows it to the submitter", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "kommentarwort", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Ablehnen", exact: true }).first().click();
  await page
    .getByPlaceholder("z. B. Eigenname, kein Duden-Eintrag …")
    .fill("Kein Duden-Eintrag gefunden");
  await page.getByRole("button", { name: "Ablehnen", exact: true }).last().click();

  await expect(page.getByText("Abgelehnt", { exact: true })).toBeVisible();

  const row = getTestDb()
    .prepare("SELECT status, moderation_comment FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string; moderation_comment: string | null };
  expect(row.status).toBe("moderator_rejected");
  expect(row.moderation_comment).toBe("Kein Duden-Eintrag gefunden");

  // Submitter sees the comment on their suggestions page
  await loginAs(page, TEST_USER_EMAIL);
  await page.goto("/meine-vorschlaege");
  await expect(page.getByText("Kommentar der Moderation:")).toBeVisible();
  await expect(page.getByText("Kein Duden-Eintrag gefunden")).toBeVisible();
});

test("approve with changes corrects the suggestion and records the original", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "tippfeler", "add", "pending_review", {
    description: "ein Fehler beim Tippen",
  });

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Bearbeiten und genehmigen" }).click();
  await page.locator(`#mod-word-${suggId}`).fill("tippfehler");
  await page.locator(`#mod-desc-${suggId}`).fill("ein Fehler beim Tippen, korrigiert");
  await page.getByRole("button", { name: "Mit Änderungen genehmigen" }).click();

  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();

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
  expect(JSON.parse(row.payload).description).toBe(
    "ein Fehler beim Tippen, korrigiert"
  );
  const original = JSON.parse(row.original_payload);
  expect(original.word).toBe("tippfeler");
  expect(original.payload.description).toBe("ein Fehler beim Tippen");

  // Submitter sees the corrections
  await loginAs(page, TEST_USER_EMAIL);
  await page.goto("/meine-vorschlaege");
  await expect(page.getByText("Mit Anpassungen angenommen:")).toBeVisible();
  await expect(page.getByText("tippfeler", { exact: false }).first()).toBeVisible();
});

test("batch approve entire group", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  // Two words with the same base (hund group)
  const id1 = seedSuggestion(userId, "hund", "remove", "pending_review");
  const id2 = seedSuggestion(userId, "hunde", "remove", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  // Homogeneous remove group → action-specific batch button
  await page.getByRole("button", { name: "Alle entfernen" }).first().click();

  // Both items collapse to decided rows; nothing left pending
  await expect(page.getByText("Genehmigt", { exact: true })).toHaveCount(2);
  await expect(page.getByText("0 Vorschläge ausstehend")).toBeVisible();

  const db = getTestDb();
  for (const id of [id1, id2]) {
    const row = db
      .prepare("SELECT status FROM suggestions WHERE id = ?")
      .get(id) as { status: string };
    expect(row.status).toBe("moderator_approved");
  }
});


test("batch reject entire group", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
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
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");
  await expect(page.getByText("Nichts zu prüfen")).toBeVisible();
});

test("non-moderator is redirected from /moderation", async ({ page }) => {
  seedUser(TEST_USER_EMAIL);
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
  seedUser(TEST_USER_EMAIL);
  const sessionId = await loginViaApi(TEST_USER_EMAIL);

  const res = await request.post("/api/moderation/1/approve", {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(403);
});

test("remove suggestion is clearly marked as removal", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  seedSuggestion(userId, "hund", "remove", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await expect(
    page.getByRole("button", { name: "Wort entfernen", exact: true })
  ).toBeVisible();
  await expect(
    page.getByText("Genehmigen entfernt das Wort aus der Wortliste.")
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Alle entfernen", exact: true })
  ).toBeVisible();
});

test("undo a rejection returns it to the queue and clears the blocklist", async ({
  page,
}) => {
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "irrtum", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  // Reject with a comment
  await page.getByRole("button", { name: "Ablehnen", exact: true }).first().click();
  await page
    .getByPlaceholder("z. B. Eigenname, kein Duden-Eintrag …")
    .fill("Versehen");
  await page.getByRole("button", { name: "Ablehnen", exact: true }).last().click();
  await expect(page.getByText("Abgelehnt", { exact: true })).toBeVisible();

  // Undo in place
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(
    page.getByRole("button", { name: "Wort aufnehmen", exact: true })
  ).toBeVisible();

  const db = getTestDb();
  const row = db
    .prepare(
      "SELECT status, moderation_comment, decided_by, decided_at FROM suggestions WHERE id = ?"
    )
    .get(suggId) as {
    status: string;
    moderation_comment: string | null;
    decided_by: number | null;
    decided_at: string | null;
  };
  expect(row.status).toBe("needs_moderator");
  expect(row.moderation_comment).toBeNull();
  expect(row.decided_by).toBeNull();
  expect(row.decided_at).toBeNull();

  // Blocklist entry is gone, so the word is no longer "bereits abgelehnt"
  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
    .get("irrtum", "add");
  expect(blocked).toBeFalsy();

  // The suggestion can now be approved normally
  await page.getByRole("button", { name: "Wort aufnehmen", exact: true }).click();
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();
  const after = db
    .prepare("SELECT status, decided_by FROM suggestions WHERE id = ?")
    .get(suggId) as { status: string; decided_by: number | null };
  expect(after.status).toBe("moderator_approved");
  expect(after.decided_by).toBe(modId);
});

test("undo an approve-with-changes restores the original submission", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "tippfeler", "add", "pending_review", {
    description: "ein Fehler beim Tippen",
  });

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await page.getByRole("button", { name: "Bearbeiten und genehmigen" }).click();
  await page.locator(`#mod-word-${suggId}`).fill("tippfehler");
  await page.locator(`#mod-desc-${suggId}`).fill("korrigierte Beschreibung");
  await page.getByRole("button", { name: "Mit Änderungen genehmigen" }).click();
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(
    page.getByRole("button", { name: "Wort aufnehmen", exact: true })
  ).toBeVisible();

  const row = getTestDb()
    .prepare(
      "SELECT status, word, payload, original_payload, notified_at FROM suggestions WHERE id = ?"
    )
    .get(suggId) as {
    status: string;
    word: string;
    payload: string;
    original_payload: string | null;
    notified_at: string | null;
  };
  expect(row.status).toBe("needs_moderator");
  expect(row.word).toBe("tippfeler");
  expect(JSON.parse(row.payload).description).toBe("ein Fehler beim Tippen");
  expect(row.original_payload).toBeNull();
  expect(row.notified_at).toBeNull();
});

test("recent decisions section shows decider and allows undo", async ({
  page,
}) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  seedSuggestion(userId, "undowort", "add", "pending_review");

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");
  await page.getByRole("button", { name: "Wort aufnehmen" }).first().click();
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();

  // After a reload the decision appears in the recent list with the decider
  await page.reload();
  await expect(page.getByText("Kürzlich entschieden")).toBeVisible();
  // "email · date" text in the recent row (plain email would also match the nav)
  await expect(page.getByText(`${TEST_MOD_EMAIL} ·`)).toBeVisible();
  await expect(page.getByText("Genehmigt", { exact: true })).toBeVisible();

  // Undo from the recent list puts it back into the queue
  await page.getByRole("button", { name: "Rückgängig" }).click();
  await expect(
    page.getByRole("button", { name: "Wort aufnehmen", exact: true })
  ).toBeVisible();
  await expect(page.getByText("Kürzlich entschieden")).toHaveCount(0);
});

test("already-synced approval cannot be undone", async ({ page, request }) => {
  const modId = seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const userId = seedUser(TEST_USER_EMAIL);
  const suggId = seedSuggestion(userId, "publiziert", "add", "moderator_approved");
  getTestDb()
    .prepare(
      `UPDATE suggestions
       SET synced_at = datetime('now'), decided_at = datetime('now'), decided_by = ?
       WHERE id = ?`
    )
    .run(modId, suggId);

  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/moderation");

  await expect(page.getByText("Kürzlich entschieden")).toBeVisible();
  await expect(
    page.getByRole("link", { name: "PUBLIZIERT", exact: true })
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Rückgängig" })).toBeDisabled();

  const sessionId = await loginViaApi(TEST_MOD_EMAIL);
  const res = await request.post(`/api/moderation/${suggId}/undo`, {
    headers: { Cookie: `session=${sessionId}` },
  });
  expect(res.status()).toBe(400);
  const body = (await res.json()) as { error: string };
  expect(body.error).toContain("Bereits veröffentlicht");
});
