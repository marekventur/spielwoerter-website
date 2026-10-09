/**
 * Rule-based conjugation (lib/conjugate.ts): the 2026-10 additions requested in
 * the moderators' forum. Pure function tests, no browser.
 */
import { test, expect } from "@playwright/test";
import { conjugateRegular } from "../../lib/conjugate";

const VERBS = new Set([
  "freuen", "anfreuen", "drohen", "bauen", "säen", "machen", "atmen",
  "wandern", "häkeln", "aufmuntern", "muntern",
]);
const isVerb = (w: string) => VERBS.has(w);
const words = (infinitive: string) => (conjugateRegular(infinitive, isVerb) ?? []).map((f) => f.word);
const describe = (infinitive: string, word: string) =>
  conjugateRegular(infinitive, isVerb)?.find((f) => f.word === word)?.description;

test("genitive of the substantivised infinitive for every regular verb", () => {
  expect(words("machen")).toContain("machens");
  expect(words("wandern")).toContain("wanderns");
  expect(words("freuen")).toContain("freuens");
  expect(describe("machen", "machens")).toMatch(/Genitiv des substantivierten Infinitivs/);
});

test("-en after a stem vowel or vowel + h may drop its e", () => {
  expect(words("freuen")).toContain("freun");
  expect(words("drohen")).toContain("drohn");
  expect(words("bauen")).toContain("baun");
  expect(words("säen")).toContain("sän");
  // Separable: the zu-infinitive too.
  expect(words("anfreuen")).toEqual(expect.arrayContaining(["anfreun", "anzufreun", "anzufreuen"]));
});

test("no e-dropped forms after a consonant, for Partizip I or the genitive", () => {
  expect(words("machen")).not.toContain("machn");
  expect(words("atmen")).not.toContain("atmn");
  expect(words("freuen")).not.toContain("freund");
  expect(words("freuen")).not.toContain("freuns");
});

test("-ern/-eln verbs get the form without the final e", () => {
  expect(words("wandern")).toEqual(expect.arrayContaining(["wandere", "wandre", "wander"]));
  expect(words("häkeln")).toEqual(expect.arrayContaining(["häkele", "häkle", "häkel"]));
  expect(describe("häkeln", "häkel")).toMatch(/Imperativ/);
  // Separable: only the 1st person; the imperative splits ("munter auf!").
  expect(words("aufmuntern")).toContain("aufmunter");
  expect(describe("aufmuntern", "aufmunter")).not.toMatch(/Imperativ/);
});
