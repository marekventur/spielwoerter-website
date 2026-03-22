import { getTestDb } from "./db";
import { initSchema } from "../../lib/schema";

export function seedWords(): void {
  const db = getTestDb();
  const insert = db.prepare(
    "INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list) VALUES (?, ?, ?, ?, ?, ?)"
  );
  db.transaction(() => {
    insert.run("hund", "ein Haustier", "hund", "duden", "admin", "accepted");
    insert.run("hunde", "Plural von Hund", "hund", "duden", "admin", "accepted");
    insert.run("hundes", "Genitiv von Hund", "hund", "duden", "admin", "accepted");
    insert.run("katze", "ein Haustier", "katze", "duden", "admin", "accepted");
    insert.run("xyz", "status unsicher", null, "community", null, "uncertain");
    insert.run("falsch", "abgelehnt", null, "test", null, "rejected");
  })();
}

export function seedUser(
  email: string,
  opts?: {
    isModerator?: boolean;
    isAdmin?: boolean;
  }
): number {
  const db = getTestDb();
  db.prepare(
    "INSERT OR IGNORE INTO users (email, is_moderator, is_admin) VALUES (?, ?, ?)"
  ).run(
    email,
    opts?.isModerator ? 1 : 0,
    opts?.isAdmin ? 1 : 0
  );
  const row = db
    .prepare("SELECT id FROM users WHERE email = ?")
    .get(email) as { id: number };
  return row.id;
}

export function seedSuggestion(
  userId: number,
  word: string,
  action: string,
  status = "draft"
): number {
  const db = getTestDb();
  // Backdate pending_review items so they look like they were promoted naturally
  const lastModified =
    status === "pending_review" || status === "moderator_approved" || status === "moderator_rejected"
      ? new Date(Date.now() - 70 * 60 * 1000).toISOString()
      : new Date().toISOString();
  db.prepare(
    "INSERT INTO suggestions (user_id, word, action, status, last_modified_at) VALUES (?, ?, ?, ?, ?)"
  ).run(userId, word, action, status, lastModified);
  const row = db
    .prepare("SELECT last_insert_rowid() as id")
    .get() as { id: number };
  return row.id;
}

/**
 * Backdate a draft's last_modified_at and immediately run the promotion SQL,
 * so it appears as pending_review without waiting 60 minutes.
 */
export function promoteDraft(suggestionId: number): void {
  const db = getTestDb();
  const past = new Date(Date.now() - 70 * 60 * 1000).toISOString();
  db.prepare(
    "UPDATE suggestions SET last_modified_at = ? WHERE id = ?"
  ).run(past, suggestionId);
  db.prepare(
    `UPDATE suggestions SET status = 'pending_review'
     WHERE status = 'draft'
     AND last_modified_at <= datetime('now', '-60 minutes')`
  ).run();
}

export function cleanDb(): void {
  const db = getTestDb();
  // Ensure schema exists (server initializes lazily; tests may run before first request)
  initSchema(db);
  db.exec("DELETE FROM suggestions");
  db.exec("DELETE FROM rejected_words");
  db.exec("DELETE FROM otp_codes");
  db.exec("DELETE FROM sessions");
  db.exec("DELETE FROM users");
  db.exec("DELETE FROM words");
}
