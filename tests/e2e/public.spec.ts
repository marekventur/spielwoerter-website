import { test, expect } from "@playwright/test";
import { cleanDb, seedWords } from "../helpers/seed";

test.beforeAll(() => {
  cleanDb();
  seedWords();
});

test("homepage loads with search box", async ({ page }) => {
  await page.goto("/");
  await expect(
    page.getByRole("heading", {
      name: "Das offene deutsche Scrabble-Wörterbuch",
    })
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Wort nachschlagen...")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Anmelden" })).toBeVisible();
});

test("search navigates to word page", async ({ page }) => {
  await page.goto("/");
  await page.getByPlaceholder("Wort nachschlagen...").fill("HUND");
  await page.getByPlaceholder("Wort nachschlagen...").press("Enter");
  await expect(page).toHaveURL(/\/wort\/HUND/);
  await expect(page.getByText("HUND", { exact: true })).toBeVisible();
});

test("word page shows accepted word with description and badge", async ({
  page,
}) => {
  await page.goto("/wort/HUND");
  // HeroWordBadge renders the word (exact match to avoid HUNDE/HUNDES)
  await expect(page.getByText("HUND", { exact: true })).toBeVisible();
  // Description from seed
  await expect(page.getByText("ein Haustier")).toBeVisible();
  // External links
  await expect(page.getByRole("link", { name: "Duden" }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Wiktionary" })).toBeVisible();
  await expect(page.getByRole("link", { name: "DWDS" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Wahrig" })).toBeVisible();
});

test("word page shows related words", async ({ page }) => {
  await page.goto("/wort/HUND");
  await expect(page.getByText("Verwandte Wörter")).toBeVisible();
  await expect(page.getByRole("link", { name: "HUNDE", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "HUNDES", exact: true })).toBeVisible();
});

test("unknown word shows not-accepted state", async ({ page }) => {
  await page.goto("/wort/ZZZNICHTDRIN");
  await expect(page.getByText("ZZZNICHTDRIN")).toBeVisible();
  // HeroWordBadge message for not-accepted
  await expect(page.getByText("Noch nicht im Wörterbuch")).toBeVisible();
});

test("unauthenticated user sees login prompt on word page", async ({
  page,
}) => {
  await page.goto("/wort/ZZZNEU");
  const loginBtn = page.getByRole("button", {
    name: "Anmelden zum Vorschlagen",
  });
  await expect(loginBtn).toBeVisible();
  await loginBtn.click();
  await expect(page).toHaveURL(/\/login/);
});

test("public API returns word data", async ({ request }) => {
  const res = await request.get("/api/words/hund");
  expect(res.status()).toBe(200);
  const body = await res.json();
  expect(body.word).toBe("hund");
  expect(body.in_list).toBe("accepted");
});

test("public API returns 404 for unknown word", async ({ request }) => {
  const res = await request.get("/api/words/zzznichtdrin");
  expect(res.status()).toBe(404);
});
