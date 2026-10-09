import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";
import { readFileSync } from "node:fs";

const entries = JSON.parse(
  readFileSync(new URL("../../lib/pruefliste-2026-10.json", import.meta.url), "utf8")
) as { w: string }[];
const first = entries.find((e) => e.w.startsWith("b"))!.w;

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("non-moderators cannot see or use the Prüfliste", async ({ page, request }) => {
  seedUser(TEST_USER_EMAIL);
  const session = await loginViaApi(TEST_USER_EMAIL);
  const res = await request.post(`/api/pruefliste/${first}`, {
    headers: { Cookie: `session=${session}` },
    data: { decision: "streichen" },
  });
  expect(res.status()).toBe(403);

  await loginAs(page, TEST_USER_EMAIL, "/pruefliste");
  await page.goto("/pruefliste");
  await expect(page).not.toHaveURL(/pruefliste/);
});

test("moderator decisions are saved, exported and can be undone", async ({ page, request }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const headers = { Cookie: `session=${session}` };

  await loginAs(page, TEST_MOD_EMAIL, "/pruefliste?b=b");
  const row = page.locator("li", { hasText: first.toUpperCase() }).first();
  await row.getByRole("button", { name: "Streichen" }).click();
  await expect(page.locator("p", { hasText: "entschieden" }).locator("strong")).toHaveText("1");

  const exported = await (await request.get("/api/pruefliste/export", { headers })).text();
  expect(exported).toContain(`${first}\tstreichen`);

  // Clicking the active decision again undoes it.
  await row.getByRole("button", { name: "Streichen" }).click();
  await expect(async () => {
    const again = await (await request.get("/api/pruefliste/export", { headers })).text();
    expect(again).not.toContain(`${first}\t`);
  }).toPass();

  const unknown = await request.post("/api/pruefliste/hund", { headers, data: { decision: "behalten" } });
  expect(unknown.status()).toBe(404);
});
