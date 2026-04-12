import { getDb } from "./db.js";

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

export async function enrichWord(word: string): Promise<EnrichResult> {
  const algorithmicBase = detectAlgorithmicBase(word);
  const fallback: EnrichResult = { base: algorithmicBase, description: null, variants: [], variantNotices: [] };

  const apiKey = process.env.DEEPSEEK_API_KEY_SUGGESTIONS;
  if (!apiKey) return fallback;

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.2,
        max_tokens: 400,
        messages: [
          { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
          { role: "user", content: word },
        ],
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) return fallback;

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    type LLMResult = { base: string; descriptions: Record<string, string> };
    const parsed: LLMResult | null = jsonMatch ? JSON.parse(jsonMatch[0]) as LLMResult : null;

    if (!parsed?.descriptions) return fallback;

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

    return { base, description, variants, variantNotices };
  } catch {
    return fallback;
  }
}
