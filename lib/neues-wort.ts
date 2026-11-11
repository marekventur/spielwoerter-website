/**
 * Server side of /neues-wort, the moderators' structured entry of new words
 * (forum thread 8): an AI suggestion for word class and key forms, which the
 * moderator corrects before lib/verb-forms.ts generates the inflections.
 */
import { llmComplete, llmOptionsFromEnv } from "./enrich.js";
import { regularParts, type VerbParts } from "./verb-forms.js";
import { WORTARTEN, type Wortart } from "./wortarten.js";

export type Prefill = {
  wortart: Wortart | null;
  bedeutung: string;
  verb: VerbParts | null;
  /** "ki" when the model answered, "regel" for the regular-verb fallback. */
  quelle: "ki" | "regel";
};

export const PREFILL_PROMPT = `\
Du hilfst Moderatoren einer deutschen Scrabble-Wortliste, ein neues Wort zu erfassen.
Eingabe: ein deutsches Wort in Kleinbuchstaben, normalerweise die Grundform.

Antworte NUR mit einem JSON-Objekt:
{"wortart": "...", "bedeutung": "...", "verb": {...} oder null}

- "wortart": eine von ${WORTARTEN.map((w) => `"${w.key}"`).join(", ")}. Bei mehreren möglichen Wortarten die häufigste.
  "adv" nur für echte, unveränderliche Adverbien (gestern, herein), nicht für adverbial gebrauchte Adjektive.
- "bedeutung": kurze Bedeutungsangabe (höchstens 8 Wörter), ohne Wortart.
- "verb": nur bei Verben, sonst null. Alle Formen in Kleinbuchstaben:
  - "prefix": abtrennbare Vorsilbe ("auf" bei aufgeben), sonst "". Untrennbare Vorsilben (be-, ver-, er-, ...) gehören zum Verb.
  - "praesens1", "praesens2", "praesens3": ich/du/er Präsens OHNE abgetrennte Vorsilbe (gebe, gibst, gibt)
  - "praeteritum": ich/er Präteritum ohne Vorsilbe (gab)
  - "konjunktiv2": Liste der Konjunktiv-II-Formen ich/er ohne Vorsilbe; mehrere, wenn das Wörterbuch Nebenformen kennt (["sänne", "sönne"])
  - "partizip2": vollständiges Partizip II mit Vorsilbe (aufgegeben)
  - "imperativ": Liste der Imperativ-Singular-Formen ohne Vorsilbe (["gib"], ["sieh", "siehe"])
  - "akkusativ": true, wenn "Wen oder was ...?" mit dem Verb einen Sinn ergibt (Akkusativobjekt)
  - "passiv": true, wenn "Ich werde <Partizip II>" einen Sinn ergibt
  - "partizip2_adjektivisch": true bei transitiven Verben und bei Verben mit Perfekt auf "sein"

Beispiele:
aufgeben → {"wortart":"verb","bedeutung":"auf etwas verzichten, nicht weitermachen","verb":{"prefix":"auf","praesens1":"gebe","praesens2":"gibst","praesens3":"gibt","praeteritum":"gab","konjunktiv2":["gäbe"],"partizip2":"aufgegeben","imperativ":["gib"],"akkusativ":true,"passiv":true,"partizip2_adjektivisch":true}}
aussinnen → {"wortart":"verb","bedeutung":"sich etwas ausdenken","verb":{"prefix":"aus","praesens1":"sinne","praesens2":"sinnst","praesens3":"sinnt","praeteritum":"sann","konjunktiv2":["sänne","sönne"],"partizip2":"ausgesonnen","imperativ":["sinn","sinne"],"akkusativ":true,"passiv":true,"partizip2_adjektivisch":true}}
einschlafen → {"wortart":"verb","bedeutung":"in Schlaf sinken","verb":{"prefix":"ein","praesens1":"schlafe","praesens2":"schläfst","praesens3":"schläft","praeteritum":"schlief","konjunktiv2":["schliefe"],"partizip2":"eingeschlafen","imperativ":["schlaf","schlafe"],"akkusativ":false,"passiv":false,"partizip2_adjektivisch":true}}
anhaben → {"wortart":"verb","bedeutung":"ein Kleidungsstück tragen","verb":{"prefix":"an","praesens1":"habe","praesens2":"hast","praesens3":"hat","praeteritum":"hatte","konjunktiv2":["hätte"],"partizip2":"angehabt","imperativ":["hab","habe"],"akkusativ":true,"passiv":false,"partizip2_adjektivisch":false}}
schule → {"wortart":"subst","bedeutung":"Lehranstalt","verb":null}`;

const WORD = /^[a-zäöüß]*$/;
const str = (v: unknown) => (typeof v === "string" && WORD.test(v.trim().toLowerCase()) ? v.trim().toLowerCase() : null);
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : [v]).map(str).filter((x): x is string => Boolean(x));

/**
 * Turns the model's JSON into a Prefill, filling anything missing or
 * malformed from the regular-verb rules so the form is always complete.
 */
export function parsePrefill(word: string, text: string): Prefill | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(m[0]);
  } catch {
    return null;
  }
  const wortart = WORTARTEN.find((w) => w.key === raw.wortart)?.key ?? null;
  const bedeutung = typeof raw.bedeutung === "string" ? raw.bedeutung.trim().slice(0, 200) : "";
  let verb: VerbParts | null = null;
  if (wortart === "verb") {
    const v = (raw.verb ?? {}) as Record<string, unknown>;
    const prefix = str(v.prefix) ?? "";
    const fallback = regularParts(word, word.startsWith(prefix) ? prefix : "");
    const konj = strList(v.konjunktiv2);
    const imp = strList(v.imperativ);
    verb = {
      infinitive: word,
      prefix: fallback.prefix,
      praesens1: str(v.praesens1) || fallback.praesens1,
      praesens2: str(v.praesens2) || fallback.praesens2,
      praesens3: str(v.praesens3) || fallback.praesens3,
      praeteritum: str(v.praeteritum) || fallback.praeteritum,
      konjunktiv2: konj.length ? konj : fallback.konjunktiv2,
      partizip2: str(v.partizip2) || fallback.partizip2,
      imperativ: imp.length ? imp : fallback.imperativ,
      akkusativ: v.akkusativ === true,
      passiv: v.passiv === true,
      partizip2Adjektivisch: v.partizip2_adjektivisch !== false,
    };
  }
  return { wortart, bedeutung, verb, quelle: "ki" };
}

/** Rule-only suggestion: treat words in -en/-ern/-eln as regular verbs. */
export function rulePrefill(word: string): Prefill {
  const looksVerb = /(en|ern|eln)$/.test(word);
  return {
    wortart: looksVerb ? "verb" : null,
    bedeutung: "",
    verb: looksVerb ? regularParts(word) : null,
    quelle: "regel",
  };
}

export async function prefill(word: string): Promise<Prefill> {
  const opts = llmOptionsFromEnv();
  if (!opts) return rulePrefill(word);
  try {
    const { text } = await llmComplete(PREFILL_PROMPT, word, opts, { anthropic: 2048, openai: 800 });
    return parsePrefill(word, text) ?? rulePrefill(word);
  } catch (e) {
    console.error("[neues-wort] prefill failed:", e);
    return rulePrefill(word);
  }
}
