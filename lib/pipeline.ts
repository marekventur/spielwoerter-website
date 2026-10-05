/**
 * SQL condition for a suggestion that is still in the pipeline: undecided, or
 * approved but not yet published to the wordlist repo. Approved suggestions
 * keep their status forever, so without the synced_at check an approval from
 * months ago would block every new suggestion for the word.
 */
export const IN_PIPELINE_SQL = `(status IN ('draft', 'pending_review', 'ai_approved', 'needs_moderator')
  OR (status = 'moderator_approved' AND synced_at IS NULL))`;
