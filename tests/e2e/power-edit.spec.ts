import { test, expect } from "@playwright/test";
import fs from "fs";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { TEST_MOD_EMAIL } from "../helpers/test-config";

test.beforeEach(() => {
  cleanDb();
  seedWords();
});

test("CSV roundtrip: download from memory, re-upload diffs into a batch", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  // Legacy data quirk: some descriptions contain embedded newlines. Spreadsheet
  // apps flatten them to spaces — that must not read as a change.
  getTestDb()
    .prepare(
      `INSERT INTO words (word, description, base, source, verified_by, in_list, normalised)
       VALUES ('zzzumbruch', 'mit' || char(10) || 'Umbruch', null, 'test', null, 'accepted', 'zzzumbruch')`
    )
    .run();
  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/power-edit");
  await page.getByRole("button", { name: "Export / Import" }).click();

  // Download is built client-side from the in-memory dictionary.
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "CSV herunterladen" }).click(),
  ]);
  expect(download.suggestedFilename()).toBe("spielwoerter.csv");
  const csv = fs.readFileSync((await download.path())!, "utf8");
  expect(csv.startsWith("word,base,description\n")).toBe(true);
  expect(csv).toContain("hund,hund,ein Haustier");
  expect(csv).toContain("zzzbär");

  // Re-upload an edited copy, Excel-DE style: BOM, CRLF, semicolons, quotes.
  // xyz dropped (→ remove), katze description edited (→ change), zzzcsvneu new (→ add).
  const upload = [
    "word;base;description",
    "hund;hund;ein Haustier",
    "hunde;hund;Plural von Hund",
    "hundes;hund;Genitiv von Hund",
    'katze;katze;"eine; Samtpfote"',
    "zzzae;;Umlaut-Variante",
    "zzzbär;;Umlaut-Stichwort",
    "zzzumbruch;;mit Umbruch",
    "zzzcsvneu;;Testwort aus CSV",
  ].join("\r\n");
  await page.locator('input[type="file"]').setInputFiles({
    name: "spielwoerter-bearbeitet.csv",
    mimeType: "text/csv",
    buffer: Buffer.from("\uFEFF" + upload, "utf8"),
  });
  await page.getByRole("button", { name: "Hochladen & vergleichen" }).click();
  await expect(page.getByText("Übernommen: 1 neu, 1 gelöscht, 1 geändert.")).toBeVisible();

  await page.getByRole("button", { name: /Änderung bestätigen/ }).click();
  await page.getByRole("button", { name: "Einreichen" }).click();
  await expect(page.getByText("Änderungen erfolgreich eingereicht.")).toBeVisible();

  const db = getTestDb();
  const rows = db
    .prepare(
      "SELECT word, action, status, payload, moderator_fast_track FROM suggestions ORDER BY word"
    )
    .all() as {
    word: string;
    action: string;
    status: string;
    payload: string | null;
    moderator_fast_track: number;
  }[];
  expect(rows).toHaveLength(3);
  const byWord = Object.fromEntries(rows.map((r) => [r.word, r]));
  expect(byWord["zzzcsvneu"].action).toBe("add");
  expect(JSON.parse(byWord["zzzcsvneu"].payload!).description).toBe("Testwort aus CSV");
  expect(byWord["xyz"].action).toBe("remove");
  expect(byWord["katze"].action).toBe("change_description");
  expect(JSON.parse(byWord["katze"].payload!).description).toBe("eine; Samtpfote");
  for (const r of rows) {
    expect(r.status).toBe("draft");
    expect(r.moderator_fast_track).toBe(1);
  }
});

test("CSV upload refuses a diff larger than the batch limit", async ({ page }) => {
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  await loginAs(page, TEST_MOD_EMAIL);
  await page.goto("/power-edit");
  await page.getByRole("button", { name: "Export / Import" }).click();

  // 501 unknown words exceed the moderator limit of 500.
  const letters = (n: number) => String(n).split("").map((d) => "abcdefghij"[Number(d)]).join("");
  const lines = ["word,base,description"];
  for (let i = 0; i < 501; i++) lines.push(`zzzmass${letters(i)},,Testwort`);
  await page.locator('input[type="file"]').setInputFiles({
    name: "zuviel.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(lines.join("\n"), "utf8"),
  });
  await page.getByRole("button", { name: "Hochladen & vergleichen" }).click();
  await expect(page.getByText(/mehr als die 500 pro Batch/)).toBeVisible();

  const db = getTestDb();
  expect(db.prepare("SELECT COUNT(*) c FROM suggestions").get()).toEqual({ c: 0 });
});
