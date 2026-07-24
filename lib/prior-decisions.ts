import type Database from "better-sqlite3";
import { screenName } from "./screen-name.js";

/**
 * "Settled decisions stick": before a moderator re-litigates a word, surface
 * the earlier deliberate decision so reverts happen knowingly (with a comment)
 * instead of silently — the anti-edit-war check.
 */
export type PriorDecision = {
  kind: "same_rejected" | "reverses_approval";
  action: string;
  decidedAt: string;
  deciderName: string | null;
  comment: string | null;
  message: string;
};

const OPPOSITE: Record<string, string> = { add: "remove", remove: "add" };

// A months-old approval is normal history, not a live dispute.
const REVERSAL_WINDOW_DAYS = 90;

type Row = {
  action: string;
  decided_at: string | null;
  created_at: string;
  moderation_comment: string | null;
  d_id: number | null;
  d_name: string | null;
};

export function priorDecision(
  db: Database.Database,
  wordLower: string,
  action: string
): PriorDecision | null {
  const rejected = db
    .prepare(
      `SELECT s.action, s.decided_at, s.created_at, s.moderation_comment,
              d.id AS d_id, d.display_name AS d_name
       FROM suggestions s LEFT JOIN users d ON d.id = s.decided_by
       WHERE s.word = ? AND s.action = ? AND s.status = 'moderator_rejected'
       ORDER BY COALESCE(s.decided_at, s.created_at) DESC LIMIT 1`
    )
    .get(wordLower, action) as Row | undefined;

  if (rejected) {
    const decidedAt = rejected.decided_at ?? rejected.created_at;
    const decider = rejected.d_id !== null ? screenName(rejected.d_name, rejected.d_id) : null;
    return {
      kind: "same_rejected",
      action,
      decidedAt,
      deciderName: decider,
      comment: rejected.moderation_comment,
      message:
        `Dieser Vorschlag wurde bereits abgelehnt` +
        (decider ? ` (von ${decider})` : "") +
        (rejected.moderation_comment ? `: „${rejected.moderation_comment}"` : "."),
    };
  }

  const opposite = OPPOSITE[action];
  if (!opposite) return null;

  const reversal = db
    .prepare(
      `SELECT s.action, s.decided_at, s.created_at, s.moderation_comment,
              d.id AS d_id, d.display_name AS d_name
       FROM suggestions s LEFT JOIN users d ON d.id = s.decided_by
       WHERE s.word = ? AND s.action = ? AND s.status = 'moderator_approved'
         AND COALESCE(s.decided_at, s.created_at) >= datetime('now', '-${REVERSAL_WINDOW_DAYS} days')
       ORDER BY COALESCE(s.decided_at, s.created_at) DESC LIMIT 1`
    )
    .get(wordLower, opposite) as Row | undefined;

  if (reversal) {
    const decidedAt = reversal.decided_at ?? reversal.created_at;
    const decider = reversal.d_id !== null ? screenName(reversal.d_name, reversal.d_id) : null;
    const what = opposite === "add" ? "aufgenommen" : "entfernt";
    return {
      kind: "reverses_approval",
      action,
      decidedAt,
      deciderName: decider,
      comment: reversal.moderation_comment,
      message: `Dieses Wort wurde kürzlich bewusst ${what} — dein Vorschlag würde das rückgängig machen.`,
    };
  }

  return null;
}
