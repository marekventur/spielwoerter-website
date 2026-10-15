import type Database from "better-sqlite3";
import rows from "./pruefliste-ss-2026-10.json";
import { screenName } from "./screen-name.js";
import { IN_PIPELINE_SQL } from "./pipeline.js";
import type { Decision } from "./pruefliste.js";

/** streichen = ASCII form goes, b_streichen = the ß/umlaut form goes, beide = both go. */
export type SsDecision = Decision | "b_streichen" | "beide";
export const SS_DECISIONS: SsDecision[] = ["behalten", "streichen", "b_streichen", "beide"];

/**
 * One-off review (2026-10): ASCII spellings in the accepted list whose
 * umlaut/ß sibling is accepted too (abgiessen next to abgießen). Built by
 * scripts/ss-pruefliste/build.py from Wiktionary; each pair carries a group
 * with a suggested decision for the ASCII form.
 *
 * The page is a front end to PowerEdit: removals and edits become ordinary
 * suggestions via /api/batch (moderator removals wait 72 h like any other).
 * ss_decisions only records which pair a moderator has reviewed, so the page
 * can hide finished ones. Delete this module, its JSON, the route and the
 * table once done.
 */
export type SsEntry = { s: string; b: string; g: SsGroup; why: string; d: string };
export type SsGroup = "schweiz" | "diphthong" | "lang" | "umlaut" | "eigen" | "unklar";

export const SS_GROUPS: { id: SsGroup; label: string; hint: string; suggest: Decision | null }[] = [
  { id: "schweiz", label: "Schweizer Schreibweise", hint: "Wiktionary führt die ss-Form als Schweizer/Liechtensteiner Schreibung.", suggest: "streichen" },
  { id: "diphthong", label: "Nach Diphthong", hint: "ß nach ai, au, äu, ei, eu (ohne Hausse, Baisse und Co.).", suggest: "streichen" },
  { id: "lang", label: "Nach langem Vokal", hint: "Die Aussprache (IPA) hat einen langen Vokal vor dem ß.", suggest: "streichen" },
  { id: "umlaut", label: "Umlaut-Ersatz", hint: "ae/oe/ue statt ä/ö/ü, kein eigenes Wort.", suggest: "streichen" },
  { id: "eigen", label: "Eigenes Wort", hint: "Die ASCII-Form ist auch ein eigenes Wort oder die neue Schreibung (Masse/Maße, Ablass/Ablaß). Vorschlag: beide behalten.", suggest: "behalten" },
  { id: "unklar", label: "Unklar", hint: "Keine Angaben gefunden, bitte einzeln prüfen.", suggest: null },
];

export const SS_ENTRIES = rows as SsEntry[];
const BY_WORD = new Map(SS_ENTRIES.map((e) => [e.s, e]));

export function ssEntry(word: string): SsEntry | undefined {
  return BY_WORD.get(word);
}

export type SsDecisionRow = { decision: SsDecision; decided_by: string };

export function ssDecisions(db: Database.Database): Map<string, SsDecisionRow> {
  const list = db
    .prepare(
      `SELECT d.word, d.decision, u.id AS u_id, u.display_name AS u_name
       FROM ss_decisions d JOIN users u ON u.id = d.user_id`
    )
    .all() as { word: string; decision: SsDecision; u_id: number; u_name: string | null }[];
  return new Map(list.map((r) => [r.word, { decision: r.decision, decided_by: screenName(r.u_name, r.u_id) }]));
}

export function setSsDecision(db: Database.Database, word: string, decision: SsDecision | null, userId: number) {
  if (decision === null) {
    db.prepare("DELETE FROM ss_decisions WHERE word = ?").run(word);
    return;
  }
  db.prepare(
    `INSERT INTO ss_decisions (word, decision, user_id) VALUES (?, ?, ?)
     ON CONFLICT(word) DO UPDATE SET decision = excluded.decision,
       user_id = excluded.user_id, decided_at = datetime('now')`
  ).run(word, decision, userId);
}

/** Records the group's suggestion for its still-undecided words (the page sends the removals). */
export function acceptGroupSuggestion(db: Database.Database, group: SsGroup, userId: number): number {
  const suggest = SS_GROUPS.find((g) => g.id === group)?.suggest;
  if (!suggest) return 0;
  const decided = ssDecisions(db);
  const open = SS_ENTRIES.filter((e) => e.g === group && !decided.has(e.s));
  db.transaction(() => {
    for (const e of open) setSsDecision(db, e.s, suggest, userId);
  })();
  return open.length;
}

export type FormState = {
  /** words.in_list, or null when the word is not in the table at all */
  inList: string | null;
  description: string | null;
  base: string | null;
  /** a removal of this word is waiting in the pipeline (anyone's) */
  removalPending: boolean;
  /** the viewer's own removal drafts for this word, withdrawable */
  ownRemovalDrafts: number[];
};

/** Current list state of the given words, for showing them live on the page. */
export function formStates(db: Database.Database, words: string[], userId: number): Map<string, FormState> {
  const out = new Map<string, FormState>();
  if (words.length === 0) return out;
  const marks = words.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT word, in_list, description, base FROM words WHERE word IN (${marks})`)
    .all(...words) as { word: string; in_list: string; description: string | null; base: string | null }[];
  for (const w of words) out.set(w, { inList: null, description: null, base: null, removalPending: false, ownRemovalDrafts: [] });
  for (const r of rows) Object.assign(out.get(r.word)!, { inList: r.in_list, description: r.description, base: r.base });
  const pending = db
    .prepare(
      `SELECT id, word, user_id, status FROM suggestions
       WHERE action = 'remove' AND word IN (${marks}) AND ${IN_PIPELINE_SQL}`
    )
    .all(...words) as { id: number; word: string; user_id: number; status: string }[];
  for (const p of pending) {
    const f = out.get(p.word)!;
    f.removalPending = true;
    if (p.user_id === userId && p.status === "draft") f.ownRemovalDrafts.push(p.id);
  }
  return out;
}
