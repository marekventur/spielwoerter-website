import type Database from "better-sqlite3";

/**
 * Promote idle drafts: moderator-touched drafts → moderator_approved (no further approval);
 * all others → pending_review (AI / moderation pipeline).
 */
export function promoteEligibleDrafts(db: Database.Database): {
  toModeratorApproved: number;
  toPendingReview: number;
} {
  const fast = db
    .prepare(
      `UPDATE suggestions SET status = 'moderator_approved'
       WHERE status = 'draft' AND moderator_fast_track = 1
       AND last_modified_at <= datetime('now', '-60 minutes')`
    )
    .run();
  const rest = db
    .prepare(
      `UPDATE suggestions SET status = 'pending_review'
       WHERE status = 'draft' AND moderator_fast_track = 0
       AND last_modified_at <= datetime('now', '-60 minutes')`
    )
    .run();
  return {
    toModeratorApproved: fast.changes,
    toPendingReview: rest.changes,
  };
}
