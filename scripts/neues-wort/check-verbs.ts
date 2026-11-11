/**
 * Compares lib/verb-forms.ts against the published word list for a set of
 * hand-checked verbs: which generated forms the list lacks (candidate
 * additions or generator errors) and which listed forms the generator misses.
 *
 *   npx tsx scripts/neues-wort/check-verbs.ts ../spielwoerter/wordlist_accepted.jsonl
 */
import { readFileSync } from "node:fs";
import { generateVerbForms, type VerbParts } from "../../lib/verb-forms";

type Spec = [inf: string, prefix: string, p1: string, p2: string, p3: string, prt: string, k2: string, part2: string, imp: string, adj: 0 | 1, akk: 0 | 1, pass: 0 | 1];
const SPECS: Spec[] = [
  ["sehen", "", "sehe", "siehst", "sieht", "sah", "sähe", "gesehen", "sieh,siehe", 1, 1, 1],
  ["geben", "", "gebe", "gibst", "gibt", "gab", "gäbe", "gegeben", "gib", 1, 1, 1],
  ["aufgeben", "auf", "gebe", "gibst", "gibt", "gab", "gäbe", "aufgegeben", "gib", 1, 1, 1],
  ["ansehen", "an", "sehe", "siehst", "sieht", "sah", "sähe", "angesehen", "sieh,siehe", 1, 1, 1],
  ["laufen", "", "laufe", "läufst", "läuft", "lief", "liefe", "gelaufen", "lauf,laufe", 1, 0, 0],
  ["finden", "", "finde", "findest", "findet", "fand", "fände", "gefunden", "finde,find", 1, 1, 1],
  ["halten", "", "halte", "hältst", "hält", "hielt", "hielte", "gehalten", "halt,halte", 1, 1, 1],
  ["lesen", "", "lese", "liest", "liest", "las", "läse", "gelesen", "lies", 1, 1, 1],
  ["schreien", "", "schreie", "schreist", "schreit", "schrie", "schriee", "geschrien", "schrei,schreie", 1, 0, 0],
  ["bringen", "", "bringe", "bringst", "bringt", "brachte", "brächte", "gebracht", "bring,bringe", 1, 1, 1],
  ["denken", "", "denke", "denkst", "denkt", "dachte", "dächte", "gedacht", "denk,denke", 1, 1, 1],
  ["tun", "", "tue", "tust", "tut", "tat", "täte", "getan", "tu,tue", 1, 1, 1],
  ["fahren", "", "fahre", "fährst", "fährt", "fuhr", "führe", "gefahren", "fahr,fahre", 1, 1, 1],
  ["einschlafen", "ein", "schlafe", "schläfst", "schläft", "schlief", "schliefe", "eingeschlafen", "schlaf", 1, 0, 0],
  ["anhaben", "an", "habe", "hast", "hat", "hatte", "hätte", "angehabt", "hab", 0, 1, 0],
  ["aufmuntern", "auf", "muntere", "munterst", "muntert", "munterte", "munterte", "aufgemuntert", "muntre", 1, 1, 1],
  ["wandern", "", "wandere", "wanderst", "wandert", "wanderte", "wanderte", "gewandert", "wandre,wander,wandere", 1, 0, 0],
  ["verstehen", "", "verstehe", "verstehst", "versteht", "verstand", "verstände,verstünde", "verstanden", "versteh,verstehe", 1, 1, 1],
  ["aussinnen", "aus", "sinne", "sinnst", "sinnt", "sann", "sänne,sönne", "ausgesonnen", "sinn", 1, 1, 1],
  ["schwimmen", "", "schwimme", "schwimmst", "schwimmt", "schwamm", "schwämme,schwömme", "geschwommen", "schwimm,schwimme", 1, 0, 0],
  ["nehmen", "", "nehme", "nimmst", "nimmt", "nahm", "nähme", "genommen", "nimm", 1, 1, 1],
  ["aufnehmen", "auf", "nehme", "nimmst", "nimmt", "nahm", "nähme", "aufgenommen", "nimm", 1, 1, 1],
  ["gehen", "", "gehe", "gehst", "geht", "ging", "ginge", "gegangen", "geh,gehe", 1, 0, 0],
  ["rechnen", "", "rechne", "rechnest", "rechnet", "rechnete", "rechnete", "gerechnet", "rechne", 1, 1, 1],
  ["freuen", "", "freue", "freust", "freut", "freute", "freute", "gefreut", "freu,freue", 1, 1, 1],
  ["säen", "", "säe", "säst", "sät", "säte", "säte", "gesät", "sä,säe", 1, 1, 1],
];

const list = readFileSync(process.argv[2], "utf8").trim().split("\n").map((l) => JSON.parse(l) as { word: string; base?: string });
const byBase = new Map<string, Set<string>>();
const all = new Set<string>();
for (const r of list) {
  all.add(r.word);
  if (r.base) (byBase.get(r.base) ?? byBase.set(r.base, new Set()).get(r.base)!).add(r.word);
}

let totalGen = 0, totalHit = 0;
for (const [infinitive, prefix, p1, p2, p3, prt, k2, part2, imp, adj, akk, pass] of SPECS) {
  const parts: VerbParts = {
    infinitive, prefix, praesens1: p1, praesens2: p2, praesens3: p3, praeteritum: prt,
    konjunktiv2: k2.split(","), partizip2: part2, imperativ: imp.split(","),
    partizip2Adjektivisch: adj === 1, akkusativ: akk === 1, passiv: pass === 1,
  };
  const gen = generateVerbForms(parts);
  const genWords = new Set(gen.map((f) => f.word));
  const listed = byBase.get(infinitive) ?? new Set();
  const notInList = gen.filter((f) => !all.has(f.word));
  const missed = [...listed].filter((w) => !genWords.has(w) && w !== infinitive);
  totalGen += gen.length;
  totalHit += gen.length - notInList.length;
  console.log(`\n## ${infinitive}: ${gen.length} generated, ${gen.length - notInList.length} already listed, ${listed.size} listed with this base`);
  if (notInList.length) console.log("  new:    " + notInList.map((f) => f.word).join(" "));
  if (missed.length) console.log("  missed: " + missed.join(" "));
}
console.log(`\n${totalHit}/${totalGen} generated forms are already in the list`);
