import type Database from "better-sqlite3";
import rows from "./pruefliste-ss-2026-10.json";
import { screenName } from "./screen-name.js";
import type { Decision } from "./pruefliste.js";

/** streichen = ASCII form goes, b_streichen = the ß/umlaut form goes, beide = both go. */
export type SsDecision = Decision | "b_streichen" | "beide";
export const SS_DECISIONS: SsDecision[] = ["behalten", "streichen", "b_streichen", "beide"];

/**
 * One-off review (2026-10): ASCII spellings in the accepted list whose
 * umlaut/ß sibling is accepted too (abgiessen next to abgießen). Built by
 * scripts/ss-pruefliste/build.py from Wiktionary; each pair carries a group
 * with a suggested decision for the ASCII form. Moderators confirm per word
 * or per group; the export then drives the removals. Delete this module, its
 * JSON, the route and the ss_decisions table once done.
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

/** Applies the group's suggestion to its still-undecided words; returns how many. */
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

export function exportSsDecisionsTsv(db: Database.Database): string {
  const decisions = ssDecisions(db);
  const lines = [
    "# Export von spielwoerter.de/pruefliste/ss: Entscheidungen zu ASCII-Doppelungen.",
    "# Spalten: ASCII-Form, Entscheidung, Schreibung mit ß/Umlaut, Gruppe.",
    "# streichen = ASCII-Form entfernen, b_streichen = Form mit ß/Umlaut entfernen, beide = beide entfernen, behalten = beide bleiben.",
  ];
  for (const e of SS_ENTRIES) {
    const d = decisions.get(e.s);
    if (d) lines.push(`${e.s}\t${d.decision}\t${e.b}\t${e.g}`);
  }
  return lines.join("\n") + "\n";
}
