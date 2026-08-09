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
      name: "Das freie Wortspiel-Wörterbuch",
    })
  ).toBeVisible();
  await expect(
    page.getByPlaceholder("Wort nachschlagen...")
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Anmelden" })).toBeVisible();
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

test("umlaut spelling redirects and offers a way back to the original", async ({
  page,
}) => {
  await page.goto("/wort/ZZZ%C3%84");
  await expect(page).toHaveURL("/wort/ZZZAE?redirect_from=ZZZ%C3%84");
  await expect(page.getByText("Weitergeleitet von")).toBeVisible();

  await page.getByRole("link", { name: "Seite für ZZZÄ trotzdem anzeigen" }).click();
  await expect(page).toHaveURL("/wort/ZZZ%C3%84?no_redirect=1");
  await expect(page.getByText("Noch nicht im Wörterbuch")).toBeVisible();
  await expect(page.getByText("Weiterleitung deaktiviert")).toBeVisible();

  await page.getByRole("link", { name: "Zum Eintrag ZZZAE" }).click();
  await expect(page).toHaveURL("/wort/ZZZAE");
});

test("no_redirect survives the lowercase-to-uppercase redirect", async ({ page }) => {
  await page.goto("/wort/zzz%C3%A4?no_redirect=1");
  await expect(page).toHaveURL("/wort/ZZZ%C3%84?no_redirect=1");
  await expect(page.getByText("Weiterleitung deaktiviert")).toBeVisible();
});

test("bogus redirect_from is ignored", async ({ page }) => {
  await page.goto("/wort/ZZZAE?redirect_from=GANZWOANDERS");
  await expect(page.getByText("Weitergeleitet von")).toHaveCount(0);
});

test("unauthenticated user sees login prompt on word page", async ({
  page,
}) => {
  await page.goto("/wort/ZZZNEU");
  const loginBtn = page.getByRole("button", {
    name: "Fehler gefunden? Anmelden und beheben!",
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

test("words CSV streams accepted and uncertain rows, not rejected", async ({
  request,
}) => {
  const res = await request.get("/api/words.csv");
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toMatch(/text\/csv/);
  const text = await res.text();
  const lines = text.trim().split("\n");
  expect(lines[0]).toBe("word,base,description");
  expect(text).toContain("hund,");
  expect(text).toContain("xyz,");
  expect(text).not.toContain("falsch");
});

test("words CSV rejects unknown column", async ({ request }) => {
  const res = await request.get("/api/words.csv?columns=word,in_list");
  expect(res.status()).toBe(400);
});

test("latest-update returns a version that tracks wordlist changes", async ({ request }) => {
  const { getTestDb } = await import("../helpers/db");
  const { normalise } = await import("../../lib/normalise");

  const first = await request.get("/api/latest-update");
  expect(first.status()).toBe(200);
  const v1 = ((await first.json()) as { version: string }).version;
  expect(v1).toMatch(/^\d+-\d+$/);

  const db = getTestDb();
  db.prepare(
    "INSERT INTO words (word, description, base, source, verified_by, in_list, normalised) VALUES ('zzzversion', null, null, 'test', null, 'accepted', ?)"
  ).run(normalise("zzzversion"));
  const changed = await request.get("/api/latest-update");
  const v2 = ((await changed.json()) as { version: string }).version;
  expect(v2).not.toBe(v1);

  db.prepare("DELETE FROM words WHERE word = 'zzzversion'").run();
  const reverted = await request.get("/api/latest-update");
  expect(((await reverted.json()) as { version: string }).version).toBe(v1);
});
