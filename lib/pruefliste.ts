import type Database from "better-sqlite3";
import rows from "./pruefliste-2026-10.json";
import { screenName } from "./screen-name.js";

/**
 * One-off review (2026-10): base words that the long-forms expansion in the
 * spielwoerter repo (scripts/expand_long_forms.py --review) held back because
 * they occur only in dictionaries, never in running text. Moderators decide
 * per word; the export is the repo's scripts/data/pruefliste_entscheidungen.tsv
 * format, so decisions go back into the wordlist with one re-run.
 *
 * The list is a fixed snapshot (letter A was reviewed by hand before). Delete
 * this module, its JSON, the route and the review_decisions table once done.
 */
export type ReviewEntry = { w: string; d: string | null; f: string[] };
export type Decision = "behalten" | "streichen";

export const REVIEW_ENTRIES = rows as ReviewEntry[];
const WORDS = new Set(REVIEW_ENTRIES.map((r) => r.w));

export function isReviewWord(word: string): boolean {
  return WORDS.has(word);
}

/** Tab letter: umlauts file under their base vowel, ß never starts a word. */
export function reviewLetter(word: string): string {
  const c = word[0];
  return ({ ä: "a", ö: "o", ü: "u" } as Record<string, string>)[c] ?? c;
}

export type DecisionRow = { word: string; decision: Decision; decided_by: string; decided_at: string };

export function reviewDecisions(db: Database.Database): Map<string, DecisionRow> {
  const list = db
    .prepare(
      `SELECT r.word, r.decision, r.decided_at, u.id AS u_id, u.display_name AS u_name
       FROM review_decisions r JOIN users u ON u.id = r.user_id`
    )
    .all() as { word: string; decision: Decision; decided_at: string; u_id: number; u_name: string | null }[];
  return new Map(
    list.map((r) => [
      r.word,
      { word: r.word, decision: r.decision, decided_at: r.decided_at, decided_by: screenName(r.u_name, r.u_id) },
    ])
  );
}

export function exportDecisionsTsv(db: Database.Database): string {
  const decisions = reviewDecisions(db);
  const lines = [
    "# Export von spielwoerter.de/pruefliste: Entscheidungen der Moderation zu den nur aus Wörterbüchern bekannten Grundformen.",
    "# behalten = lange Formen werden ergänzt, streichen = Wort samt aller Formen auf die Sperrliste.",
  ];
  for (const e of REVIEW_ENTRIES) {
    const d = decisions.get(e.w);
    if (d) lines.push(`${e.w}\t${d.decision}`);
  }
  return lines.join("\n") + "\n";
}
