import type Database from "better-sqlite3";

export type ModerationChanges = {
  word?: string;
  description?: string;
  base?: string;
};

export type ModerationResult =
  | { ok: true }
  | { ok: false; error: string };

type SuggRow = {
  id: number;
  word: string;
  action: string;
  payload: string | null;
  status: string;
};

const MODERATABLE_STATUSES = ["pending_review", "needs_moderator"];

function validateChanges(changes: ModerationChanges): string | null {
  if (changes.word !== undefined && changes.word.trim().length === 0)
    return "Wort darf nicht leer sein";
  if (changes.word !== undefined && changes.word.length > 100)
    return "Wort zu lang";
  if (changes.description !== undefined && changes.description.length > 500)
    return "Beschreibung zu lang";
  if (changes.base !== undefined && changes.base.length > 100)
    return "Grundform zu lang";
  return null;
}

/**
 * Decide a pending suggestion. On approval, optional `changes` let the
 * moderator correct the word, description, or base before it is applied;
 * the submitted values are preserved in `original_payload`. An optional
 * `comment` (typically a rejection reason) is stored on the row and is only
 * ever shown to the submitting user.
 */
export function moderateOne(
  db: Database.Database,
  id: number,
  decision: "moderator_approved" | "moderator_rejected",
  opts: { changes?: ModerationChanges; comment?: string; override?: boolean } = {}
): ModerationResult {
  const suggestion = db
    .prepare("SELECT id, word, action, payload, status FROM suggestions WHERE id = ?")
    .get(id) as SuggRow | undefined;

  if (!suggestion) return { ok: false, error: "Nicht gefunden" };
  if (!opts.override && !MODERATABLE_STATUSES.includes(suggestion.status))
    return { ok: false, error: "Vorschlag ist nicht in Prüfung" };

  const comment = opts.comment?.trim() || null;

  let newWord = suggestion.word;
  let newPayload = suggestion.payload;
  let originalPayload: string | null = null;

  if (decision === "moderator_approved" && opts.changes) {
    const changes = opts.changes;
    const validationError = validateChanges(changes);
    if (validationError) return { ok: false, error: validationError };

    const payload = suggestion.payload
      ? (JSON.parse(suggestion.payload) as Record<string, string>)
      : {};

    if (changes.word !== undefined) newWord = changes.word.trim().toLowerCase();
    if (changes.description !== undefined)
      payload.description = changes.description.trim();
    if (changes.base !== undefined) {
      const base = changes.base.trim().toLowerCase();
      // Lemma convention: base equal to the word itself is stored as absent
      if (base === "" || (suggestion.action === "add" && base === newWord)) {
        delete payload.base;
      } else {
        payload.base = base;
      }
    }

    const payloadJson = Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
    const changed = newWord !== suggestion.word || payloadJson !== suggestion.payload;
    if (changed) {
      newPayload = payloadJson;
      originalPayload = JSON.stringify({
        word: suggestion.word,
        payload: suggestion.payload ? JSON.parse(suggestion.payload) : null,
      });
    }
  }

  db.transaction(() => {
    db.prepare(
      `UPDATE suggestions
       SET status = ?, word = ?, payload = ?, moderation_comment = ?,
           original_payload = COALESCE(?, original_payload)
       WHERE id = ?`
    ).run(decision, newWord, newPayload, comment, originalPayload, id);
    if (decision === "moderator_rejected") {
      db.prepare(
        "INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, ?)"
      ).run(suggestion.word, suggestion.action);
    }
  })();

  return { ok: true };
}
