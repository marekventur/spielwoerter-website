/**
 * /pruefliste/ss is a front end to PowerEdit: decisions become ordinary
 * suggestions via /api/batch right away; ss_decisions only tracks review.
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

test("a decision files the removal right away; switching and undoing withdraw it", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs([own]);
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=eigen");
  const row = rowOf(page, own.s);

  await row.getByRole("button", { name: "ss-Form streichen", exact: true }).click();
  await expect(row.getByText("Löschung geplant")).toBeVisible();
  expect(removals(own.s)).toBe(1);
  expect(decision(own.s)).toBe("streichen");
  await expect(row.getByRole("link", { name: own.s.toUpperCase(), exact: true })).toHaveClass(/line-through/);

  // Switching withdraws the ss removal and files the ß one instead.
  await row.getByRole("button", { name: "ß-Form streichen", exact: true }).click();
  await expect(row.getByRole("link", { name: upper(own.b), exact: true })).toHaveClass(/line-through/);
  await expect.poll(() => removals(own.s)).toBe(0);
  expect(removals(own.b)).toBe(1);

  // Clicking the active decision again undoes it entirely.
  await row.getByRole("button", { name: "ß-Form streichen", exact: true }).click();
  await expect.poll(() => removals(own.b)).toBe(0);
  await expect.poll(() => decision(own.s)).toBe(null);
});

test("umlaut rows say ae/oe/ue; description and base can be edited in place", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs([umlaut]);
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=umlaut");
  const row = rowOf(page, umlaut.s);
  await expect(row.getByRole("button", { name: "ae/oe/ue-Form streichen", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "ss-Form streichen", exact: true })).toHaveCount(0);

  await row.getByRole("button", { name: "Bearbeiten" }).last().click();
  await row.getByLabel(`Beschreibung von ${upper(umlaut.b)}`).fill("Neue Beschreibung");
  await row.getByRole("button", { name: "Speichern" }).click();
  await expect
    .poll(() => getTestDb().prepare("SELECT payload FROM suggestions WHERE word = ? AND action = 'change_description'").get(umlaut.b))
    .toEqual({ payload: JSON.stringify({ description: "Neue Beschreibung" }) });
});

test("accepting a group's suggestion files the removals and records the review", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  seedPairs(swiss.slice(0, 2));
  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=schweiz");
  page.on("dialog", (d) => void d.accept());
  await page.getByRole("button", { name: /Vorschlag für alle/ }).click();
  await expect(page.locator("p", { hasText: "entschieden" }).locator("strong")).toHaveText(String(swiss.length));
  expect(removals(swiss[0].s)).toBe(1);
  expect(removals(swiss[1].s)).toBe(1);
  expect(removals(swiss[0].b)).toBe(0);
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
