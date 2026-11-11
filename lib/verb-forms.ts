/**
 * Every inflected form of a German verb, generated from its key forms
 * ("Stammformen") as a moderator confirmed them on /neues-wort.
 *
 * Unlike lib/conjugate.ts, which guesses everything from the infinitive and
 * therefore refuses irregular verbs, this takes the irregular parts as input:
 * Präsens 2./3. Sg. (gibst, gibt), Präteritum (gab), Konjunktiv II (gäbe),
 * Partizip II (aufgegeben) and the imperative (gib). Everything else follows
 * from rules (REGELN.md, "Beugungsregeln / Verben"). Pure, no database, so the
 * page can run it in the browser as the moderator types.
 *
 * The three checks from the forum (thread 8) decide the gerundive: separable
 * prefix, accusative object, passive possible. Only then are
 * "aufzugebende, aufzugebendem, ..." generated.
 */

export type VerbParts = {
  /** Full infinitive, e.g. "aufgeben". */
  infinitive: string;
  /** Separable prefix ("auf"), or "" for none. Inseparable prefixes stay part of the verb. */
  prefix: string;
  /** Without the separable prefix: "gebe", "gibst", "gibt", "gab". */
  praesens1: string;
  praesens2: string;
  praesens3: string;
  praeteritum: string;
  /** Without prefix; several when the dictionary lists alternatives (sönne, sänne). */
  konjunktiv2: string[];
  /** Full form, with prefix: "aufgegeben". */
  partizip2: string;
  /** Without prefix; several allowed (sieh, siehe). */
  imperativ: string[];
  /** Partizip II can be used as an adjective (transitive, or perfect with "sein"). */
  partizip2Adjektivisch: boolean;
  /** "Wen oder was ...?" makes sense. */
  akkusativ: boolean;
  /** "Ich werde <Partizip II>" makes sense. */
  passiv: boolean;
};

export type GeneratedForm = { word: string; description: string };

const ADJ_ENDINGS = ["e", "em", "en", "er", "es"];
const VOWEL_END = /[aeiouäöüy]h?$/;

/** Stem of an infinitive and whether it is an -eln/-ern verb. */
export function verbStem(infinitive: string): { stem: string; el: boolean } {
  // wand-er-n, häk-el-n; the part before -el/-er needs a vowel of its own
  if (/(el|er)n$/.test(infinitive) && /[aeiouäöüy]/.test(infinitive.slice(0, -3)))
    return { stem: infinitive.slice(0, -1), el: true };
  if (infinitive.endsWith("en")) return { stem: infinitive.slice(0, -2), el: false };
  if (infinitive.endsWith("n")) return { stem: infinitive.slice(0, -1), el: false };
  return { stem: infinitive, el: false };
}

/** Stems ending in d/t or consonant+m/n take an epenthetic e (arbeit-e-t, atm-e-t). */
function needsE(stem: string): boolean {
  if (/[dt]$/.test(stem)) return true;
  if (/[aeiouäöüy]h[mn]$/.test(stem)) return false;
  return /[^aeiouäöüylrmn][mn]$/.test(stem);
}

/**
 * Whether a final e may be dropped (REGELN.md, e-Tilgung): not after c or a
 * consonant + m/n ("rechne" stays), not for -jen verbs or knien.
 */
function mayDropFinalE(withE: string, infinitive: string): boolean {
  if (!withE.endsWith("e") || withE.length < 3) return false;
  if (/jen$/.test(infinitive) || /knien$/.test(infinitive)) return false;
  const rest = withE.slice(0, -1);
  if (/c$/.test(rest)) return false;
  // consonant + m/n keeps its e (rechne), vowel + h + n does not (wohn)
  if (/[^aeiouäöüylrmn][mn]$/.test(rest) && !/[aeiouäöüy]h[mn]$/.test(rest)) return false;
  return true;
}

export function generateVerbForms(p: VerbParts): GeneratedForm[] {
  const inf = p.infinitive;
  const P = p.prefix;
  const kernelInf = P && inf.startsWith(P) ? inf.slice(P.length) : inf;
  const sep = Boolean(P) && kernelInf !== inf;
  const { stem, el } = verbStem(kernelInf);
  const of = `von ${inf}`;

  const forms = new Map<string, string[]>();
  const add = (kernel: string, description: string, joined = true) => {
    const word = (joined && sep ? P : "") + kernel;
    // Separable verbs: the finite parts are also valid on their own
    // ("ich muntere auf" → muntere), REGELN.md "Trennbare Verben". Mostly
    // these are forms of the simple verb and already listed; for bound
    // kernels like "muntern" they are not.
    if (joined && sep && finite) addWord(kernel, description.replace(/ von /, ` (abgetrennt) von `));
    addWord(word, description);
  };
  let finite = true;
  const addWord = (word: string, description: string) => {
    if (!word || word === inf || !/^[a-zäöüß]+$/.test(word)) return;
    const labels = forms.get(word) ?? [];
    if (!labels.includes(description)) labels.push(description);
    forms.set(word, labels);
  };
  // Separable verbs are written joined only in subordinate clauses
  // ("dass ich aufgebe"); that is what makes the joined finite forms valid.

  // Präsens
  add(p.praesens1, `1. Pers. Sg. Präs. ${of}`);
  if (el) {
    // wandere → wandre, wander (REGELN.md: -el/-er verbs)
    add(stem.slice(0, -2) + stem.slice(-1) + "e", `1. Pers. Sg. Präs. ${of} (e-Tilgung)`);
    add(stem, `1. Pers. Sg. Präs. ${of} (e-Tilgung)`);
  } else if (mayDropFinalE(p.praesens1, kernelInf)) {
    add(p.praesens1.slice(0, -1), `1. Pers. Sg. Präs. ${of} (e-Tilgung)`);
  }
  add(p.praesens2, `2. Pers. Sg. Präs. ${of}`);
  add(p.praesens3, `3. Pers. Sg. Präs. ${of}`);
  const pl2 = el ? stem + "t" : stem + (needsE(stem) ? "et" : "t");
  add(pl2, `2. Pers. Pl. Präs. / Imperativ Pl. ${of}`);

  // Konjunktiv I (rare for -el/-er verbs, as in lib/conjugate.ts)
  if (!el) {
    add(stem + "e", `Konj. I, 1./3. Pers. Sg. ${of}`);
    add(stem + "est", `Konj. I, 2. Pers. Sg. ${of}`);
    add(stem + "et", `Konj. I, 2. Pers. Pl. ${of}`);
    if (stem + "en" !== kernelInf) add(stem + "en", `Konj. I, Pl. ${of}`); // tuen
  }

  // Präteritum
  const t = p.praeteritum;
  if (t) {
    add(t, `Prät. 1./3. Pers. Sg. ${of}`);
    if (t.endsWith("e")) {
      // weak and mixed verbs: machte, brachte
      add(t + "st", `2. Pers. Sg. Prät. ${of}`);
      add(t + "n", `Prät. Pl. ${of}`);
      add(t + "t", `2. Pers. Pl. Prät. ${of}`);
    } else {
      const ie = t.endsWith("ie"); // schrie → schrien, schriet
      add(t + (/[sßzxdt]$/.test(t) ? "est" : "st"), `2. Pers. Sg. Prät. ${of}`);
      if (/[dt]$/.test(t)) add(t + "st", `2. Pers. Sg. Prät. ${of}`); // hieltst, fandst
      add(t + (ie ? "n" : "en"), `Prät. Pl. ${of}`);
      add(t + (/[dt]$/.test(t) ? "et" : "t"), `2. Pers. Pl. Prät. ${of}`);
      if (!ie && VOWEL_END.test(t)) add(t + "n", `Prät. Pl. ${of} (e-Tilgung nach Vokal)`);
    }
  }

  // Konjunktiv II
  for (const k of p.konjunktiv2) {
    if (!k) continue;
    add(k, `Konj. II, 1./3. Pers. Sg. ${of}`);
    const base = k.endsWith("e") ? k : k + "e";
    add(base + "st", `Konj. II, 2. Pers. Sg. ${of}`);
    add(base + "n", `Konj. II, Pl. ${of}`);
    add(base + "t", `Konj. II, 2. Pers. Pl. ${of}`);
    if (k.endsWith("e") && mayDropFinalE(k, kernelInf)) {
      add(k.slice(0, -1), `Konj. II, 1./3. Pers. Sg. ${of} (e-Tilgung)`);
      // sähst, gäbt, tätst — strong verbs only (weak and mixed ones have a
      // Präteritum in -te); no 2nd plural after d/t (fändst yes, fändt no)
      if (!t.endsWith("te")) {
        add(k.slice(0, -1) + "st", `Konj. II, 2. Pers. Sg. ${of} (e-Tilgung)`);
        if (!/[dt]e$/.test(k)) add(k.slice(0, -1) + "t", `Konj. II, 2. Pers. Pl. ${of} (e-Tilgung)`);
      }
    }
    if (VOWEL_END.test(base.slice(0, -1))) add(base.slice(0, -1) + "n", `Konj. II, Pl. ${of} (e-Tilgung nach Vokal)`);
  }

  // Imperativ Sg. — separable verbs split ("gib auf!"), so only the bare part.
  for (const i of p.imperativ) {
    if (!i) continue;
    if (sep) addWord(i, `Imperativ Sg. (abgetrennt) ${of}`);
    else add(i, `Imperativ Sg. ${of}`);
  }
  if (sep) addWord(kernelInf, `1./3. Pers. Pl. Präs. (abgetrennt) ${of}`);
  finite = false;

  // Partizip I, always declinable
  const p1Kernel = /(en|eln|ern)$/.test(kernelInf) ? kernelInf + "d" : stem + "end";
  add(p1Kernel, `Part. I ${of}`);
  for (const s of ADJ_ENDINGS) add(p1Kernel + s, `dekl. Part. I ${of}`);

  // Partizip II (given in full, with prefix)
  const p2 = p.partizip2;
  if (p2) {
    add(p2, `Part. II ${of}`, false);
    // geschrien is ge-schri-en: its e belongs to "ie" and cannot go
    const p2Vowel = /[aeiouäöüy]h?en$/.test(p2) && !p2.endsWith("ien");
    if (p2Vowel) add(p2.slice(0, -2) + "n", `Part. II ${of} (e-Tilgung nach Vokal)`, false);
    if (p.partizip2Adjektivisch) {
      for (const s of ADJ_ENDINGS) add(p2 + s, `dekl. Part. II ${of}`, false);
      // -en participles may drop the e when declined (gefrorne, gesehne),
      // never after -nen (gewonnene) — REGELN.md, e-Tilgung bei Adjektiven.
      if (p2.endsWith("en") && !p2.endsWith("nen") && !p2.endsWith("ien"))
        for (const s of ADJ_ENDINGS)
          add(p2.slice(0, -2) + "n" + s, `dekl. Part. II ${of} (e-Tilgung)`, false);
    }
  }

  // Genitive of the substantivised infinitive (des Aufgebens)
  add(inf + "s", `Genitiv des substantivierten Infinitivs ${of}`, false);

  // -en after a vowel: sehn, ansehn, anzusehn
  const vowelInf = !el && kernelInf.endsWith("en") && VOWEL_END.test(stem);
  if (vowelInf) add(stem + "n", `Infinitiv / 1. u. 3. Pers. Pl. Präs. ${of} (e-Tilgung nach Vokal)`);

  if (sep) {
    add(P + "zu" + kernelInf, `Inf. mit zu ${of}`, false);
    if (vowelInf) add(P + "zu" + stem + "n", `Inf. mit zu ${of} (e-Tilgung nach Vokal)`, false);
    // Gerundiv: only when all three forum checks pass
    if (p.akkusativ && p.passiv)
      for (const s of ADJ_ENDINGS) add(P + "zu" + p1Kernel + s, `Gerundiv ${of}`, false);
  }

  return Array.from(forms, ([word, labels]) => ({
    word,
    description: labels.length > 1 ? labels.slice(0, 2).join(" / ") : labels[0],
  }));
}

const INSEPARABLE = ["be", "emp", "ent", "er", "ge", "miss", "ver", "zer"];

/**
 * Key forms of a regular (weak) verb, as a starting point when no AI
 * suggestion is available. The moderator corrects them for irregular verbs.
 */
export function regularParts(infinitive: string, prefix = ""): VerbParts {
  const kernel = prefix && infinitive.startsWith(prefix) ? infinitive.slice(prefix.length) : infinitive;
  const { stem, el } = verbStem(kernel);
  const e = !el && needsE(stem) ? "e" : "";
  const s = !e && /[sßxz]$/.test(stem);
  const inseparable = INSEPARABLE.some((p) => kernel.startsWith(p) && kernel.length > p.length + 3);
  const ieren = /[aeiouäöüy].*ieren$/.test(kernel);
  const ge = inseparable || ieren ? "" : "ge";
  const prt = stem + e + "te";
  return {
    infinitive,
    prefix,
    praesens1: stem + "e",
    praesens2: s ? stem + "t" : stem + e + "st",
    praesens3: stem + e + "t",
    praeteritum: prt,
    konjunktiv2: [prt],
    partizip2: prefix + ge + stem + e + "t",
    imperativ: el ? [stem.slice(0, -2) + stem.slice(-1) + "e", stem] : e ? [stem + "e"] : [stem, stem + "e"],
    partizip2Adjektivisch: true,
    akkusativ: false,
    passiv: false,
  };
}
