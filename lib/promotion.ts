import type Database from "better-sqlite3";

/**
 * How long a moderator's fast-track draft rests before it auto-approves.
 * Removals wait 72h so other moderators get a real chance to confirm or
 * object (see "Geplante Löschungen" on the moderation page); adds and
 * description changes are low-risk and stay quick.
 */
export const FAST_TRACK_REMOVE_HOURS = 72;
export const DRAFT_IDLE_MINUTES = 60;

/**
 * Promote idle drafts: moderator-touched drafts → moderator_approved (no further approval);
 * all others → pending_review (AI / moderation pipeline).
 */
export function promoteEligibleDrafts(db: Database.Database): {
  toModeratorApproved: number;
  toPendingReview: number;
} {
  const fastQuick = db
    .prepare(
      `UPDATE suggestions SET status = 'moderator_approved'
       WHERE status = 'draft' AND moderator_fast_track = 1 AND action != 'remove'
       AND last_modified_at <= datetime('now', '-${DRAFT_IDLE_MINUTES} minutes')`
    )
    .run();
  const fastRemove = db
    .prepare(
      `UPDATE suggestions SET status = 'moderator_approved'
       WHERE status = 'draft' AND moderator_fast_track = 1 AND action = 'remove'
       AND last_modified_at <= datetime('now', '-${FAST_TRACK_REMOVE_HOURS} hours')`
    )
    .run();
  const rest = db
    .prepare(
      `UPDATE suggestions SET status = 'pending_review'
       WHERE status = 'draft' AND moderator_fast_track = 0
       AND last_modified_at <= datetime('now', '-${DRAFT_IDLE_MINUTES} minutes')`
    )
    .run();
  return {
    toModeratorApproved: fastQuick.changes + fastRemove.changes,
    toPendingReview: rest.changes,
  };
}
