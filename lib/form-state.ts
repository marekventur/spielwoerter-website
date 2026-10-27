import type Database from "better-sqlite3";
import { IN_PIPELINE_SQL } from "./pipeline.js";

/** Live list state of words shown on review pages (Prüfliste, ss/ß list). */
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
