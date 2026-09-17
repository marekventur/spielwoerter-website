import { getDb } from "./db.js";
import { conjugateRegular } from "./conjugate.js";

const GERMAN_SUFFIXES = ["nen", "ern", "ste", "en", "es", "em", "er", "e", "s", "n"];

function deUmlaut(s: string) {
  return s.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
}

export function detectAlgorithmicBase(word: string): string | null {
  const db = getDb();
  for (const suffix of GERMAN_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 2) {
      const stem = word.slice(0, word.length - suffix.length);
      if (db.prepare("SELECT 1 FROM words WHERE word = ?").get(stem)) return stem;
      const plain = deUmlaut(stem);
      if (plain !== stem && db.prepare("SELECT 1 FROM words WHERE word = ?").get(plain)) return plain;
    }
  }
  return null;
}

export function classifyLlmVariant(
  db: ReturnType<typeof getDb>,
  w: string
): "actionable" | "in_list" | "rejected" | "in_review" {
  const row = db
    .prepare("SELECT in_list FROM words WHERE word = ?")
    .get(w) as { in_list: string } | undefined;
  if (row?.in_list === "accepted" || row?.in_list === "uncertain") return "in_list";
  if (row?.in_list === "rejected") return "rejected";
  const communityRejected = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = 'add'")
    .get(w);
  if (communityRejected) return "rejected";
  const inReview = db
    .prepare(
      `SELECT 1 FROM suggestions WHERE word = ? AND action = 'add'
       AND status IN ('draft', 'pending_review', 'ai_approved', 'needs_moderator', 'moderator_approved')
       LIMIT 1`
    )
    .get(w);
  if (inReview) return "in_review";
  return "actionable";
}

export const DEEPSEEK_SYSTEM_PROMPT = `\
Du bist ein Lexikograf für eine gemeinschaftliche Scrabble-Wortliste in Deutsch.

Deine Aufgabe: Gib für ein gegebenes deutsches Wort (immer in Kleinbuchstaben) zurück:
1. "base" – Grundform (Lemma)
2. "descriptions" – Kurzbeschreibungen für die Grundform und alle wichtigen Flexionsformen

Antworte NUR mit einem JSON-Objekt oder null:
{"base": "...", "descriptions": {"wort1": "Beschreibung1", "wort2": "Beschreibung2", ...}}

─── Regeln ───────────────────────────────────────────
- "base" ist IMMER die Grundform, auch wenn das Eingabewort selbst die Grundform ist
- Alle Wörter in Kleinbuchstaben
- Das Eingabewort und die Grundform erscheinen IMMER in "descriptions"; sind sie identisch, erscheinen sie als ein einziger Eintrag
- Flexionsformen-Beschreibungen sind kurze grammatische Hinweise ("Pl. von X", "Gen. Sg. von X" usw.)
- Nur Scrabble-relevante Formen aufnehmen – keine orthographischen Varianten, keine Großschreibung
- Maximal 12 Einträge in "descriptions"
- Bei unbekannten oder bedeutungslosen Wörtern: Gib null zurück

─── Beispiele ────────────────────────────────────────
stadtmauer →
{"base": "stadtmauer", "descriptions": {"stadtmauer": "Subst., f. — Befestigungsmauer um eine mittelalterliche Stadt", "stadtmauern": "Pl. von Stadtmauer"}}

hund →
{"base": "hund", "descriptions": {"hund": "Subst., m. — domestiziertes Haustier aus der Familie der Wölfe", "hunde": "Pl. von Hund", "hundes": "Gen. Sg. von Hund", "hunden": "Dat. Pl. von Hund"}}

laufen →
{"base": "laufen", "descriptions": {"laufen": "Verb — sich schnell zu Fuß fortbewegen", "läuft": "3. Pers. Sg. Präs. von laufen", "lief": "Prät. von laufen", "liefen": "Prät. Pl. von laufen", "gelaufen": "Part. II von laufen", "laufend": "Part. I von laufen"}}

schöner →
{"base": "schön", "descriptions": {"schön": "Adj. — ästhetisch ansprechend, gefällig", "schöner": "Komp. von schön", "schönste": "Superl. von schön"}}

aale →
{"base": "aal", "descriptions": {"aal": "Subst., m. — schlangenförmiger Knochenfisch", "aale": "Pl. von Aal", "aales": "Gen. Sg. von Aal", "aalen": "Dat. Pl. von Aal"}}

xklqpf →
null`;

export type EnrichResult = {
  base: string | null;
  description: string | null;
  variants: Array<{ word: string; description: string; base: string | null }>;
  variantNotices: Array<{ word: string; reason: "in_list" | "rejected" | "in_review"; description: string }>;
};

const VOWELS = /[aeiouäöüy]/;

/**
 * Every string obtained by swapping one pair of adjacent letters in `w`,
 * restricted to pairs that are both vowels or both consonants. A vowel next
 * to a consonant is not a typo signal in German: e-Tilgung and its inverse
 * legitimately turn "dunkel" into "dunkle", "birken" into "birkne" and
 * "rumset" sits next to "rumste". "zuielten" vs "zueilten" (ie/ei) is caught.
 */
function adjacentTranspositions(w: string): string[] {
  const out: string[] = [];
  for (let i = 0; i + 1 < w.length; i++) {
    const a = w[i], b = w[i + 1];
    if (a === b || VOWELS.test(a) !== VOWELS.test(b)) continue;
    out.push(w.slice(0, i) + b + a + w.slice(i + 2));
  }
  return out;
}

/**
 * Deterministic complement to the LLM variants: if the word (or its lemma) is
 * a regular weak verb, merge the full conjugation paradigm into the result.
 * LLM-provided variants keep priority; every added form goes through the same
 * blocklist/in-review filtering.
 *
 * Also drops LLM variants that are one adjacent-letter swap away from a form
 * we trust for the same lemma: the looked-up word, a rule-generated paradigm
 * form, or a listed word with the same base ("zuielten" next to "zueilten").
 * The same-lemma restriction keeps genuine neighbours apart (rief / reif).
 */
function mergeConjugation(result: EnrichResult, word: string): EnrichResult {
  const db = getDb();
  const knownStmt = db.prepare(
    "SELECT 1 FROM words WHERE word = ? AND in_list IN ('accepted', 'uncertain')"
  );
  const known = (w: string) => Boolean(knownStmt.get(w));
  // Verb-ness gate for prefix splitting: the remainder must be a listed VERB
  // ("ankern" must not split as an+kern just because the noun "kern" is listed).
  const verbStmt = db.prepare(
    `SELECT 1 FROM words WHERE word = ? AND in_list IN ('accepted', 'uncertain')
     AND description LIKE 'Verb%'`
  );
  const isVerb = (w: string) => Boolean(verbStmt.get(w));
  // The base may be a non-infinitive stem (algorithmic base detection), so
  // fall back to the word itself.
  let infinitive = "";
  let paradigm: ReturnType<typeof conjugateRegular> = null;
  for (const candidate of [result.base?.toLowerCase(), word.toLowerCase()]) {
    if (!candidate) continue;
    paradigm = conjugateRegular(candidate, isVerb, known);
    if (paradigm) {
      infinitive = candidate;
      break;
    }
  }
  const paradigmWords = new Set((paradigm ?? []).map((f) => f.word));
  const lemma = infinitive || result.base?.toLowerCase() || word.toLowerCase();
  const listedForLemmaStmt = db.prepare(
    `SELECT 1 FROM words WHERE word = ? AND in_list IN ('accepted', 'uncertain')
     AND (base = ? OR word = ?)`
  );
  const trusted = (w: string) =>
    w === word.toLowerCase() || paradigmWords.has(w) || Boolean(listedForLemmaStmt.get(w, lemma, lemma));
  result.variants = result.variants.filter((v) => {
    const twin = adjacentTranspositions(v.word).find(trusted);
    if (twin) console.log(`[enrich] dropped LLM variant "${v.word}" (letter swap of "${twin}")`);
    return !twin;
  });

  if (!paradigm) return result;

  const seen = new Set([
    word,
    ...result.variants.map((v) => v.word),
    ...result.variantNotices.map((v) => v.word),
  ]);
  for (const f of paradigm) {
    if (seen.has(f.word)) continue;
    seen.add(f.word);
    const kind = classifyLlmVariant(db, f.word);
    if (kind === "actionable") {
      result.variants.push({ word: f.word, description: f.description, base: infinitive });
    } else {
      result.variantNotices.push({ word: f.word, reason: kind, description: f.description });
    }
  }
  return result;
}

export async function enrichWord(word: string): Promise<EnrichResult> {
  const algorithmicBase = detectAlgorithmicBase(word);
  const fallback: EnrichResult = { base: algorithmicBase, description: null, variants: [], variantNotices: [] };

  const apiKey = process.env.DEEPSEEK_API_KEY_SUGGESTIONS;
  if (!apiKey) return mergeConjugation(fallback, word);

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        // "deepseek-chat" is a retired alias that currently resolves to deepseek-flash
        // in NON-thinking mode. Naming the model explicitly turns thinking on by
        // default, which spends the whole max_tokens budget on reasoning and returns
        // an empty message, so say so explicitly.
        model: process.env.DEEPSEEK_MODEL_SUGGESTIONS || "deepseek-flash",
        thinking: { type: "disabled" },
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
          { role: "user", content: word },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return mergeConjugation(fallback, word);

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    type LLMResult = { base: string; descriptions: Record<string, string> };
    const parsed: LLMResult | null = jsonMatch ? JSON.parse(jsonMatch[0]) as LLMResult : null;

    if (!parsed?.descriptions) return mergeConjugation(fallback, word);

    const llmBase = parsed.base?.toLowerCase() ?? word;
    const base: string | null = llmBase === word ? null : llmBase;
    const description: string | null = parsed.descriptions[word] ?? null;

    const db = getDb();
    const variants: EnrichResult["variants"] = [];
    const variantNotices: EnrichResult["variantNotices"] = [];

    for (const [w, desc] of Object.entries(parsed.descriptions)) {
      if (w === word) continue;
      if (!/^[a-zäöüß]+$/.test(w)) continue;
      const kind = classifyLlmVariant(db, w);
      if (kind === "actionable") {
        variants.push({ word: w, description: desc, base: llmBase === w ? null : llmBase });
      } else {
        variantNotices.push({ word: w, reason: kind, description: desc });
      }
    }

    return mergeConjugation({ base, description, variants, variantNotices }, word);
  } catch {
    return mergeConjugation(fallback, word);
  }
}
