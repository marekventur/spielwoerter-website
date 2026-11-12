/**
 * /neues-wort: moderators confirm a verb's key forms, every inflection is
 * generated from them. Trial mode, so nothing is written. The examples are
 * the ones from forum thread 8.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { TEST_USER_EMAIL, TEST_MOD_EMAIL } from "../helpers/test-config";
import { getTestDb } from "../helpers/db";
import { generateVerbForms, regularParts, type VerbParts } from "../../lib/verb-forms";
import { normalise } from "../../lib/normalise";

const words = (p: VerbParts) => new Set(generateVerbForms(p).map((f) => f.word));

const aufgeben: VerbParts = {
  infinitive: "aufgeben", prefix: "auf", praesens1: ["gebe"], praesens2: ["gibst"], praesens3: ["gibt"],
  praeteritum: ["gab"], konjunktiv2: ["gäbe"], partizip2: ["aufgegeben"], imperativ: ["gib"],
  partizip2Adjektivisch: true, akkusativ: true, passiv: true,
};

test("verb forms follow the thread-8 rules", () => {
  const g = words(aufgeben);
  for (const w of ["aufgibst", "aufgab", "aufgäbe", "aufgegebene", "aufzugeben", "aufgebens", "gibst", "gib"])
    expect(g, w).toContain(w);
  for (const w of ["aufzugebende", "aufzugebendem", "aufzugebenden", "aufzugebender", "aufzugebendes"])
    expect(g, w).toContain(w);
  expect(g).not.toContain("aufgib"); // separable imperative splits: "gib auf!"

  // anhaben: no passive → no gerundive; einschlafen: no accusative object
  expect(words({ ...aufgeben, infinitive: "anhaben", prefix: "an", praesens1: ["habe"], praesens2: ["hast"], praesens3: ["hat"],
    praeteritum: ["hatte"], konjunktiv2: ["hätte"], partizip2: ["angehabt"], imperativ: ["hab"], passiv: false })).not.toContain("anzuhabende");

  // e-Tilgung after a vowel (sehen → sehn, gesehn, angesehne, anzusehn)
  const ansehen = words({ ...aufgeben, infinitive: "ansehen", prefix: "an", praesens1: ["sehe"], praesens2: ["siehst"],
    praesens3: ["sieht"], praeteritum: ["sah"], konjunktiv2: ["sähe"], partizip2: ["angesehen"], imperativ: ["sieh"] });
  for (const w of ["ansehn", "angesehn", "angesehne", "anzusehn", "ansahn", "ansähn"]) expect(ansehen, w).toContain(w);

  // -ern verbs: e-Tilgung in the 1st person; separated parts valid on their own
  const muntern = words({ ...regularParts("aufmuntern", "auf"), akkusativ: true, passiv: true });
  for (const w of ["aufmuntre", "aufmunter", "muntre", "munter", "muntert", "munterte", "aufgemuntert", "aufzumunternde"])
    expect(muntern, w).toContain(w);

  // no e-Tilgung after consonant + n (rechne), nor inside -ie- (geschrien)
  expect(words(regularParts("rechnen"))).not.toContain("rechn");
  const schreien = words({ ...aufgeben, infinitive: "schreien", prefix: "", praesens1: ["schreie"], praesens2: ["schreist"],
    praesens3: ["schreit"], praeteritum: ["schrie"], konjunktiv2: ["schriee"], partizip2: ["geschrien"], imperativ: ["schrei"] });
  expect(schreien).toContain("schrien");
  expect(schreien).not.toContain("geschrin");
  expect(schreien).not.toContain("geschrine");
});

test("alternative key forms all generate their paradigm (fragst / frägst, fragte / frug)", () => {
  const fragen = words({ ...regularParts("fragen"), praesens2: ["fragst", "frägst"], praesens3: ["fragt", "frägt"],
    praeteritum: ["fragte", "frug"], konjunktiv2: ["fragte", "früge"], akkusativ: true, passiv: true });
  for (const w of ["fragst", "frägst", "fragt", "frägt", "fragte", "fragtest", "frug", "frugst", "frugen", "früge", "frügst"])
    expect(fragen, w).toContain(w);
  // a typo in one alternative must not take the others with it
  expect(words({ ...regularParts("fragen"), praesens2: ["fragst", "fräg st"] })).toContain("fragst");
});

test("non-moderators cannot use the new-word API", async ({ request }) => {
  cleanDb();
  seedUser(TEST_USER_EMAIL);
  const headers = { Cookie: `session=${await loginViaApi(TEST_USER_EMAIL)}` };
  expect((await request.post("/api/neues-wort/vorschlag", { headers, data: { word: "aussinnen" } })).status()).toBe(403);
  expect((await request.post("/api/neues-wort/status", { headers, data: { words: ["aussann"] } })).status()).toBe(403);
});

test("a moderator corrects the key forms and sees every generated form", async ({ page }) => {
  cleanDb();
  seedWords();
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  getTestDb()
    .prepare(`INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list, normalised)
              VALUES ('sann', 'Prät. von sinnen', 'sinnen', 'test', NULL, 'accepted', ?)`)
    .run(normalise("sann"));
  await loginAs(page, TEST_MOD_EMAIL, "/neues-wort");
  await expect(page.getByText("Probelauf:")).toBeVisible();

  await page.getByLabel("Neues Wort").fill("aussinnen");
  await page.getByRole("button", { name: "Vorschlag holen" }).click();
  // Tests run without an AI key: rule-based prefill for a regular verb.
  await expect(page.getByText("Kein KI-Vorschlag verfügbar")).toBeVisible();
  await expect(page.getByRole("button", { name: "Verb", exact: true })).toHaveAttribute("aria-pressed", "true");

  await page.getByLabel("Abtrennbare Vorsilbe").fill("aus");
  await page.getByLabel("ich (Präsens)").fill("sinne");
  await page.getByLabel("du (Präsens)").fill("sinnst, sännst");
  await page.getByLabel("er/sie/es (Präsens)").fill("sinnt");
  await page.getByLabel("ich/er (Präteritum)").fill("sann");
  await page.getByLabel("ich/er (Konjunktiv II)").fill("sänne, sönne");
  await page.getByLabel("Partizip II", { exact: true }).fill("ausgesonnen");
  await page.getByLabel("Imperativ Singular").fill("sinn");
  await page.getByRole("group", { name: "Akkusativobjekt" }).getByRole("button", { name: "Ja" }).click();
  await page.getByRole("group", { name: "Passiv" }).getByRole("button", { name: "Ja" }).click();
  await expect(page.getByText("„Wen oder was sinne ich aus?“")).toBeVisible();

  const row = (w: string) => page.locator("li", { has: page.getByText(w, { exact: true }) });
  for (const w of ["AUSSÖNNE", "AUSSÄNNE", "AUSGESONNEN", "AUSZUSINNENDE", "AUSSINNST", "AUSSÄNNST"]) await expect(row(w)).toBeVisible();
  await expect(page.getByText("AUSSÖHNEN", { exact: true })).toHaveCount(0);
  await expect(row("SANN")).toContainText("schon in der Liste");

  await row("AUSSÖNNE").getByRole("button", { name: "Unsicher" }).click();
  await expect(row("AUSSÖNNE").getByRole("button", { name: "Unsicher" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("button", { name: /Formen einreichen/ })).toBeDisabled();
});
