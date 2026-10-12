/**
 * ß in uppercase display and /wort/ URLs. Plain toUpperCase() turns ß into
 * "SS", which lowercases to a different word; upper() uses the capital ẞ.
 */
import { test, expect } from "@playwright/test";
import { getTestDb } from "../helpers/db";
import { cleanDb, seedWords } from "../helpers/seed";
import { normalise, upper } from "../../lib/normalise";

test.beforeAll(() => {
  cleanDb();
  seedWords();
  getTestDb()
    .prepare(
      `INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list, normalised)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run("zzzgießend", "Part. I von zzzgießen", null, "test", null, "accepted", normalise("zzzgießend"));
});

test("upper() keeps ß recoverable, umlauts unchanged", () => {
  expect(upper("angießend")).toBe("ANGIEẞEND");
  expect(upper("angießend").toLowerCase()).toBe("angießend");
  expect(upper("ärger")).toBe("ÄRGER");
  expect(normalise(upper("angießend"))).toBe("angiessend");
});

test("word page for a ß word shows it with ẞ", async ({ page }) => {
  await page.goto(`/wort/${encodeURIComponent("ZZZGIEẞEND")}`);
  await expect(page.getByText("ZZZGIEẞEND", { exact: true }).first()).toBeVisible();
});

test("old SS URL redirects to the ẞ spelling", async ({ page }) => {
  await page.goto("/wort/ZZZGIESSEND");
  await expect(page).toHaveURL(new RegExp(`/wort/${encodeURIComponent("ZZZGIEẞEND")}`));
  await expect(page.getByText("ZZZGIEẞEND", { exact: true }).first()).toBeVisible();
});

test("typing ß in the search box keeps it", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("networkidle"); // typing before hydration skips onChange
  const box = page.getByPlaceholder("Wort nachschlagen...");
  await box.fill("zzzgießend");
  await expect(box).toHaveValue("ZZZGIEẞEND");
  await box.press("Enter");
  await expect(page.getByText("ZZZGIEẞEND", { exact: true }).first()).toBeVisible();
});
