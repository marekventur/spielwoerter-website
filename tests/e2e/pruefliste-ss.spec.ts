import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";

const entries = JSON.parse(
  readFileSync(new URL("../../lib/pruefliste-ss-2026-10.json", import.meta.url), "utf8")
) as { s: string; b: string; g: string }[];
const swiss = entries.filter((e) => e.g === "schweiz");
const own = entries.find((e) => e.g === "eigen")!;

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
