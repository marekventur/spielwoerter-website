/**
 * /pruefliste/ss is a front end to PowerEdit: removals and edits are queued
 * in PowerEdit's changeset and only written when submitted there.
 */
import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";
import { getTestDb } from "../helpers/db";
import { initSchema } from "../../lib/schema";
import { normalise, upper } from "../../lib/normalise";

const entries = JSON.parse(
  readFileSync(new URL("../../lib/pruefliste-ss-2026-10.json", import.meta.url), "utf8")
) as { s: string; b: string; g: string }[];
const swiss = entries.filter((e) => e.g === "schweiz");
const own = entries.find((e) => e.g === "eigen")!;
const umlaut = entries.find((e) => e.g === "umlaut")!;

/** Puts the given spellings into the test list as accepted words. */
function seedPairs(pairs: { s: string; b: string }[]) {
  const stmt = getTestDb().prepare(
    `INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list, normalised)
     VALUES (?, ?, NULL, 'test', NULL, 'accepted', ?)`
  );
  for (const { s, b } of pairs) {
    stmt.run(s, `Beschreibung ${s}`, normalise(s));
    stmt.run(b, `Beschreibung ${b}`, normalise(b));
  }
}

const removals = (word: string) =>
  (getTestDb()
    .prepare("SELECT count(*) AS n FROM suggestions WHERE word = ? AND action = 'remove' AND status = 'draft'")
    .get(word) as { n: number }).n;
const decision = (word: string) =>
  (getTestDb().prepare("SELECT decision FROM ss_decisions WHERE word = ?").get(word) as { decision: string } | undefined)
    ?.decision ?? null;

const rowOf = (page: Page, word: string) => page.locator("li", { hasText: word.toUpperCase() }).first();

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("non-moderators cannot use the ss list", async ({ request }) => {
  seedUser(TEST_USER_EMAIL);
  const headers = { Cookie: `session=${await loginViaApi(TEST_USER_EMAIL)}` };
  expect((await request.post(`/api/pruefliste-ss/${swiss[0].s}`, { headers, data: { decision: "streichen" } })).status()).toBe(403);
  expect((await request.post("/api/pruefliste-ss/gruppe/schweiz", { headers })).status()).toBe(403);
});

const changesetOf = (page: Page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("power-edit-changeset-v1") ?? "[]") as [string, { pending: unknown }][]);

test("decisions are queued in the PowerEdit changeset and only written on submit", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs([own]);
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=eigen");
  await page.waitForLoadState("networkidle");
  const row = rowOf(page, own.s);

  await row.getByRole("button", { name: "ss-Form streichen", exact: true }).click();
  await expect(row.getByText("zum Löschen vorgemerkt")).toBeVisible();
  expect(await changesetOf(page)).toEqual([[own.s, expect.objectContaining({ pending: null })]]);
  expect(removals(own.s)).toBe(0); // nothing written yet

  // Switching moves the queued removal to the other spelling.
  await row.getByRole("button", { name: "ß-Form streichen", exact: true }).click();
  await expect(row.getByRole("link", { name: upper(own.b), exact: true })).toHaveClass(/line-through/);
  expect((await changesetOf(page)).map(([w]) => w)).toEqual([own.b]);

  // Submitting in PowerEdit files it as an ordinary removal.
  await page.getByRole("link", { name: "In PowerEdit prüfen und einreichen" }).click();
  await expect(page).toHaveURL(/power-edit\?tab=checkout/);
  await page.getByRole("button", { name: "Einreichen" }).click();
  await expect(page.getByText("Änderungen erfolgreich eingereicht.")).toBeVisible();
  expect(removals(own.b)).toBe(1);

  await page.goto("/pruefliste/ss?g=eigen&alle=1");
  await expect(rowOf(page, own.s).getByText("Löschung geplant")).toBeVisible();

  // Undoing a submitted removal withdraws the moderator's own draft.
  await rowOf(page, own.s).getByRole("button", { name: "ß-Form streichen", exact: true }).click();
  await expect.poll(() => removals(own.b)).toBe(0);
});

test("umlaut rows say ae/oe/ue; edits are queued like PowerEdit edits; Behalten is recorded", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs([umlaut]);
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=umlaut");
  await page.waitForLoadState("networkidle");
  const row = rowOf(page, umlaut.s);
  await expect(row.getByRole("button", { name: "ae/oe/ue-Form streichen", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "ss-Form streichen", exact: true })).toHaveCount(0);

  await row.getByRole("button", { name: "Bearbeiten" }).last().click();
  await row.getByLabel(`Beschreibung von ${upper(umlaut.b)}`).fill("Neue Beschreibung");
  await row.getByRole("button", { name: "Vormerken" }).click();
  await expect(row.getByText("Änderung vorgemerkt")).toBeVisible();
  expect(await changesetOf(page)).toEqual([
    [umlaut.b, expect.objectContaining({ pending: { description: "Neue Beschreibung" } })],
  ]);

  await row.getByRole("button", { name: "Behalten", exact: true }).click();
  await expect.poll(() => decision(umlaut.s)).toBe("behalten");
});

test("a removal group's suggestion is queued, a keep group's is recorded", async ({ page, request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs(swiss.slice(0, 2));
  const headers = { Cookie: `session=${await loginViaApi(TEST_MOD_EMAIL)}` };
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=schweiz");
  await page.waitForLoadState("networkidle");
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /Vorschlag für alle/ }).click();
  await expect(page.getByText("2 Änderungen vorgemerkt")).toBeVisible();
  expect((await changesetOf(page)).map(([w]) => w).sort()).toEqual([swiss[0].s, swiss[1].s].sort());
  expect(removals(swiss[0].s)).toBe(0);

  expect((await request.post("/api/pruefliste-ss/gruppe/schweiz", { headers })).status()).toBe(404);
  const kept = await request.post("/api/pruefliste-ss/gruppe/eigen", { headers });
  expect((await kept.json()).count).toBe(entries.filter((e) => e.g === "eigen").length);
});

test("the first ss_decisions schema is widened without losing decisions", () => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const db = getTestDb();
  const modId = (db.prepare("SELECT id FROM users WHERE email = ?").get(TEST_MOD_EMAIL) as { id: number }).id;
  db.exec(`DROP TABLE ss_decisions;
    CREATE TABLE ss_decisions (
      word TEXT PRIMARY KEY,
      decision TEXT NOT NULL CHECK (decision IN ('behalten', 'streichen')),
      user_id INTEGER NOT NULL REFERENCES users(id),
      decided_at TEXT NOT NULL DEFAULT (datetime('now'))
    );`);
  db.prepare("INSERT INTO ss_decisions (word, decision, user_id) VALUES (?, 'streichen', ?)").run(swiss[0].s, modId);

  initSchema(db);
  expect(db.prepare("SELECT decision FROM ss_decisions WHERE word = ?").get(swiss[0].s)).toEqual({ decision: "streichen" });
  db.prepare("INSERT INTO ss_decisions (word, decision, user_id) VALUES (?, 'b_streichen', ?)").run(own.s, modId);
  initSchema(db); // idempotent
  expect((db.prepare("SELECT count(*) AS n FROM ss_decisions").get() as { n: number }).n).toBe(2);
});
