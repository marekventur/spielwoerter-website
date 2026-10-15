import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";
import { getTestDb } from "../helpers/db";
import { initSchema } from "../../lib/schema";
import { upper } from "../../lib/normalise";

const entries = JSON.parse(
  readFileSync(new URL("../../lib/pruefliste-ss-2026-10.json", import.meta.url), "utf8")
) as { s: string; b: string; g: string }[];
const swiss = entries.filter((e) => e.g === "schweiz");
const own = entries.find((e) => e.g === "eigen")!;
const umlaut = entries.find((e) => e.g === "umlaut")!;

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

test("moderators decide per word, accept a group's suggestion and export", async ({ page, request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const headers = { Cookie: `session=${await loginViaApi(TEST_MOD_EMAIL)}` };

  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=eigen");
  const row = page.locator("li", { hasText: own.s.toUpperCase() }).first();
  await row.getByRole("button", { name: "Behalten" }).click();
  await expect(page.locator("p", { hasText: "entschieden" }).locator("strong")).toHaveText("1");

  const bulk = await request.post("/api/pruefliste-ss/gruppe/schweiz", { headers });
  expect((await bulk.json()).count).toBe(swiss.length);

  const tsv = await (await request.get("/api/pruefliste-ss/export", { headers })).text();
  expect(tsv).toContain(`${own.s}\tbehalten\t${own.b}\teigen`);
  expect(tsv).toContain(`${swiss[0].s}\tstreichen\t${swiss[0].b}\tschweiz`);

  // No suggestion for the unclear group; unknown words are refused.
  expect((await request.post("/api/pruefliste-ss/gruppe/unklar", { headers })).status()).toBe(404);
  expect((await request.post("/api/pruefliste-ss/hund", { headers, data: { decision: "streichen" } })).status()).toBe(404);
});

test("the ß form or both can be struck, umlaut rows say ae/oe/ue", async ({ page, request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const headers = { Cookie: `session=${await loginViaApi(TEST_MOD_EMAIL)}` };

  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste/ss?g=eigen");
  const ownRow = page.locator("li", { hasText: own.s.toUpperCase() }).first();
  await ownRow.getByRole("button", { name: "ß-Form streichen", exact: true }).click();
  await expect(page.locator("p", { hasText: "entschieden" }).locator("strong")).toHaveText("1");
  // Only the spelling that goes is struck through.
  await expect(ownRow.getByRole("link", { name: own.s.toUpperCase(), exact: true })).not.toHaveClass(/line-through/);
  await expect(ownRow.getByRole("link", { name: upper(own.b), exact: true })).toHaveClass(/line-through/);

  await page.goto("/pruefliste/ss?g=umlaut");
  const row = page.locator("li", { hasText: umlaut.s.toUpperCase() }).first();
  await expect(row.getByRole("button", { name: "ae/oe/ue-Form streichen", exact: true })).toBeVisible();
  await expect(row.getByRole("button", { name: "ss-Form streichen", exact: true })).toHaveCount(0);

  expect((await request.post(`/api/pruefliste-ss/${umlaut.s}`, { headers, data: { decision: "beide" } })).ok()).toBeTruthy();
  expect((await request.post(`/api/pruefliste-ss/${umlaut.s}`, { headers, data: { decision: "weg" } })).status()).toBe(400);

  const tsv = await (await request.get("/api/pruefliste-ss/export", { headers })).text();
  expect(tsv).toContain(`${own.s}\tb_streichen\t${own.b}`);
  expect(tsv).toContain(`${umlaut.s}\tbeide\t${umlaut.b}`);
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
