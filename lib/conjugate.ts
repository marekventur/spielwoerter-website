/**
 * Deterministic conjugation of regular (weak) German verbs.
 *
 * Own implementation from grammar rules — deliberately no external morphology
 * data, so generated forms carry no license obligations and stay CC0-clean for
 * the spielwoerter wordlist. Irregular verbs are detected via a hand-authored
 * stem list and refused (returns null) — the LLM/moderators handle those.
 */

// Strong / irregular / preterite-present verbs (base forms). A candidate whose
// infinitive ends in one of these is refused. False positives (e.g. "heiraten"
// matching "raten") are acceptable: refusing only means we don't generate.
const IRREGULAR_VERBS = [
  "backen", "befehlen", "beginnen", "beißen", "bergen", "bersten", "bewegen",
  "biegen", "bieten", "binden", "bitten", "blasen", "bleiben", "braten",
  "brechen", "brennen", "bringen", "denken", "dingen", "dreschen", "dringen",
  "dürfen", "empfehlen", "erlöschen", "essen", "fahren", "fallen", "fangen",
  "fechten", "finden", "flechten", "fliegen", "fliehen", "fließen", "fressen",
  "frieren", "gären", "gebären", "geben", "gedeihen", "gehen", "gelingen",
  "gelten", "genesen", "genießen", "geschehen", "gewinnen", "gießen",
  "gleichen", "gleiten", "glimmen", "graben", "greifen", "haben", "halten",
  "hängen", "hauen", "heben", "heißen", "helfen", "kennen", "klimmen",
  "klingen", "kneifen", "kommen", "können", "kriechen", "küren", "laden",
  "lassen", "laufen", "leiden", "leihen", "lesen", "liegen", "lügen",
  "mahlen", "meiden", "melken", "messen", "mögen", "müssen", "nehmen",
  "nennen", "pfeifen", "preisen", "quellen", "raten", "reiben", "reißen",
  "reiten", "rennen", "riechen", "ringen", "rinnen", "rufen", "salzen",
  "saufen", "saugen", "schaffen", "scheiden", "scheinen", "scheißen",
  "schelten", "scheren", "schieben", "schießen", "schinden", "schlafen",
  "schlagen", "schleichen", "schleifen", "schließen", "schlingen",
  "schmeißen", "schmelzen", "schnauben", "schneiden", "schrecken",
  "schreiben", "schreien", "schreiten", "schweigen", "schwellen",
  "schwimmen", "schwinden", "schwingen", "schwören", "sehen", "sein",
  "senden", "sieden", "singen", "sinken", "sinnen", "sitzen", "sollen",
  "spalten", "speien", "spinnen", "spleißen", "sprechen", "sprießen",
  "springen", "stechen", "stecken", "stehen", "stehlen", "steigen",
  "sterben", "stieben", "stinken", "stoßen", "streichen", "streiten",
  "tragen", "treffen", "treiben", "treten", "triefen", "trinken", "trügen",
  "tun", "verderben", "vergessen", "verlieren", "wachsen", "waschen",
  "weben", "weichen", "weisen", "wenden", "werben", "werden", "werfen",
  "wiegen", "winden", "wissen", "wollen", "wringen", "ziehen", "zwingen",
  // Not strong, but refused for other reasons: weak/strong doublets
  // (wägen → wog, bleichen → blich) and end-stressed verbs whose Partizip II
  // drops ge- (posaunen → posaunt).
  "wägen", "bleichen", "posaunen", "prophezeien", "frohlocken", "willfahren",
  "baldowern", "klamüsern", "trompeten", "stibitzen", "schmarotzen",
];

// Unambiguously separable prefixes (Partizip II keeps ge- after the prefix,
// zu-infinitive splices "zu" in). Ambiguous ones (um-, durch-, über-, unter-,
// wieder-, wider-) are omitted on purpose: their verbs are refused rather than
// risk generating the wrong reading.
const SEPARABLE_PREFIXES = [
  "zusammen", "zurück", "gegenüber", "entgegen", "herunter", "herüber",
  "hinunter", "hinüber", "herauf", "heraus", "herein", "hinauf", "hinaus",
  "hinein", "herbei", "voraus", "vorbei", "weiter", "nieder", "empor",
  "herab", "heran", "hinab", "hinzu", "davon", "daher", "dahin", "daneben",
  "dazwischen", "dagegen", "darunter", "darüber", "darauf", "daran", "davor",
  "dazu", "dar", "hin", "her", "einher", "hintenüber", "aneinander",
  "aufeinander", "auseinander", "beieinander", "durcheinander", "gegeneinander",
  "ineinander", "miteinander", "nebeneinander", "übereinander", "zueinander",
  "fort", "heim", "hoch", "los", "mit", "nach", "vor", "weg",
  "ab", "an", "auf", "aus", "bei", "ein", "zu",
  // adjective/adverb particles that conjugate like separable prefixes
  "bloß", "dicht", "dran", "drauf", "drin", "fest", "frei", "gut", "kalt",
  "klein", "krank", "kaputt", "tot", "wach", "wett",
];

// Inseparable prefixes: no ge- in Partizip II, no split, no spliced zu.
const INSEPARABLE_PREFIXES = ["be", "emp", "ent", "er", "ge", "miss", "ver", "zer", "hinter"];

const AMBIGUOUS_PREFIXES = ["um", "durch", "über", "unter", "wieder", "wider"];

export type ConjugatedForm = { word: string; description: string };

type PrefixSplit = { prefix: string; kind: "separable" | "inseparable"; rest: string } | null;

/**
 * Split off a verb prefix, but only when the remainder is a known verb
 * according to `isKnownVerb` — this is what keeps "beichten" (≠ be+ichten)
 * from being treated as prefixed. Longest prefix wins ("herunter" before "her").
 */
function splitPrefix(infinitive: string, isKnownVerb: (w: string) => boolean): PrefixSplit {
  const candidates: Array<{ prefix: string; kind: "separable" | "inseparable" }> = [
    ...SEPARABLE_PREFIXES.map((p) => ({ prefix: p, kind: "separable" as const })),
    ...INSEPARABLE_PREFIXES.map((p) => ({ prefix: p, kind: "inseparable" as const })),
  ].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, kind } of candidates) {
    if (!infinitive.startsWith(prefix)) continue;
    const rest = infinitive.slice(prefix.length);
    if (rest.length >= 4 && isKnownVerb(rest)) return { prefix, kind, rest };
  }
  return null;
}

function isIrregular(infinitive: string): boolean {
  return IRREGULAR_VERBS.some((v) => infinitive === v || infinitive.endsWith(v));
}

/** Stems ending in d/t or consonant+m/n take an epenthetic e (arbeite-st → arbeitest). */
function needsEpentheticE(stem: string): boolean {
  if (/[dt]$/.test(stem)) return true;
  // vowel(+h) before m/n needs no e (wohnen → wohnst), nor do mm/nn stems
  // (kämmen → kämmst); other consonants except l/r do (atmen → atmest,
  // rechnen → rechnest).
  if (/[aeiouäöü]h[mn]$/.test(stem)) return false;
  return /[^aeiouäöülrmn][mn]$/.test(stem);
}

/**
 * A remainder that looks like it could be a verb (…en/…eln/…ern with a vowel
 * in the stem). Used to refuse words we can't confidently segment.
 */
function verbShaped(rest: string): boolean {
  if (rest.length < 4 || !/(en|eln|ern)$/.test(rest)) return false;
  const stem = /(eln|ern)$/.test(rest) ? rest.slice(0, -1) : rest.slice(0, -2);
  return /[aeiouäöü]/.test(stem);
}

/**
 * Conjugate a regular weak verb. Returns null when the word is not a plausible
 * regular infinitive (wrong ending, irregular, or ambiguous prefix).
 *
 * `isKnownVerb` gates prefix detection; pass a words-table lookup in the app
 * and a fixture set in tests.
 */
export function conjugateRegular(
  infinitive: string,
  isKnownVerb: (w: string) => boolean
): ConjugatedForm[] | null {
  if (!/^[a-zäöüß]+$/.test(infinitive)) return null;
  if (isIrregular(infinitive)) return null;
  // Verbs in consonant+ien (knien) keep the e in the stem — not modeled here.
  if (/[^e]ien$/.test(infinitive)) return null;
  if (AMBIGUOUS_PREFIXES.some((p) => infinitive.startsWith(p) && verbShaped(infinitive.slice(p.length))))
    return null;
  // If the word starts with something prefix-like whose remainder looks like a
  // verb but is NOT a known one, we can't place ge-/zu- safely ("abdachen" with
  // unknown "dachen" would come out as "geabdacht"). Refuse and let the LLM
  // handle it. This also refuses false segmentations like be|ichten — the cost
  // is coverage, never correctness.
  for (const p of [...SEPARABLE_PREFIXES, ...INSEPARABLE_PREFIXES]) {
    if (infinitive.startsWith(p) && verbShaped(infinitive.slice(p.length)) && !isKnownVerb(infinitive.slice(p.length)))
      return null;
  }

  // Stem: -eln/-ern verbs drop only -n (sammeln → sammel), otherwise -en.
  let stem: string;
  if (/(eln|ern)$/.test(infinitive)) {
    stem = infinitive.slice(0, -1);
  } else if (infinitive.endsWith("en")) {
    stem = infinitive.slice(0, -2);
  } else {
    return null;
  }
  if (stem.length < 2 || !/[aeiouäöü]/.test(stem)) return null;

  const split = splitPrefix(infinitive, isKnownVerb);
  // Double prefixes (ab+bestellen → abbestellt, ab+gewöhnen → abgewöhnt) shift
  // or drop ge- in ways we don't model — refuse those too, including when the
  // inner prefix can't be confirmed (an+bequemen with unknown "quemen").
  if (
    split &&
    (splitPrefix(split.rest, isKnownVerb) !== null ||
      split.rest.startsWith("ge") ||
      INSEPARABLE_PREFIXES.some(
        (p) => split.rest.startsWith(p) && verbShaped(split.rest.slice(p.length))
      ))
  )
    return null;
  const elVerb = /(el|er)$/.test(stem) && /(eln|ern)$/.test(infinitive);
  const e = needsEpentheticE(stem) ? "e" : "";
  // Stems in s/ß/x/z merge the -st of the 2nd person: reis+st → reist.
  const sStem = /[sßxz]$/.test(stem) && !e;

  const forms = new Map<string, string[]>();
  const add = (word: string, description: string) => {
    if (word === infinitive) return;
    const labels = forms.get(word) ?? [];
    labels.push(description);
    forms.set(word, labels);
  };
  const of = `von ${infinitive}`;

  // Präsens: -eln/-ern verbs use the infinitive for wir/sie, plain -en otherwise.
  add(stem + "e", `1. Pers. Sg. Präs. ${of}`);
  if (elVerb) add(stem.slice(0, -2) + stem.slice(-1) + "e", `1. Pers. Sg. Präs. ${of} (e-Tilgung)`);
  add(sStem ? stem + "t" : stem + e + "st", `2. Pers. Sg. Präs. ${of}`);
  add(stem + e + "t", `3. Pers. Sg. / 2. Pers. Pl. Präs. ${of}`);

  // Präteritum & Konjunktiv II (identical for weak verbs).
  add(stem + e + "te", `Prät. / Konj. II ${of}`);
  add(stem + e + "test", `2. Pers. Sg. Prät. ${of}`);
  add(stem + e + "ten", `Prät. Pl. ${of}`);
  add(stem + e + "tet", `2. Pers. Pl. Prät. ${of}`);

  // Konjunktiv I — skipped for -eln/-ern verbs, whose distinct Konj.-I forms
  // (wanderest, sammelet) are vanishingly rare in practice.
  if (!elVerb) {
    add(stem + "est", `Konj. I, 2. Pers. Sg. ${of}`);
    add(stem + "et", `Konj. I, 2. Pers. Pl. ${of}`);
  }

  // Imperativ (for -eln/-ern verbs the -e forms above already cover it).
  if (!elVerb) add(stem + (e ? "e" : ""), `Imperativ Sg. ${of}`);

  // Partizip II: ge- only without prefix; after a separable prefix it moves inside.
  // Unlisted compounds (fertig+machen, fern+steuern, but also inseparable
  // lang+weilen → gelangweilt): ge- placement differs per verb and we can't
  // tell — refuse anything that decomposes into two known words.
  if (split === null) {
    for (let i = 3; i <= infinitive.length - 4; i++) {
      const pre = infinitive.slice(0, i);
      const rest = infinitive.slice(i);
      if (verbShaped(rest) && isKnownVerb(rest) && isKnownVerb(pre)) return null;
    }
  }

  const restStem = split ? stem.slice(split.prefix.length) : stem;
  // -ieren loanwords (studieren, kassieren) form the Partizip II without ge-,
  // but only when there is a syllable before -ieren — native "zieren" or
  // "schmieren" still take ge- (geziert, geschmiert).
  const ieren = /[aeiouäöü].*ieren$/.test(split ? split.rest : infinitive);
  const geStem = ieren ? restStem : "ge" + restStem;
  const p2 =
    split === null
      ? geStem + e + "t"
      : split.kind === "separable"
        ? split.prefix + geStem + e + "t"
        : stem + e + "t";
  add(p2, `Part. II ${of}`);

  // Partizip I + adjectival declension of both participles.
  const p1 = infinitive + "d";
  add(p1, `Part. I ${of}`);
  for (const suffix of ["e", "em", "en", "er", "es"]) {
    add(p1 + suffix, `dekl. Part. I ${of}`);
    add(p2 + suffix, `dekl. Part. II ${of}`);
  }

  // zu-Infinitiv, spliced only for separable prefixes.
  if (split?.kind === "separable") {
    add(split.prefix + "zu" + split.rest, `Inf. mit zu ${of}`);
  }

  return Array.from(forms, ([word, labels]) => ({
    word,
    description: labels.length > 1 ? labels.slice(0, 2).join(" / ") : labels[0],
  }));
}
