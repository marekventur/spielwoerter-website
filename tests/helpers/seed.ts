import { getTestDb } from "./db";
import { initSchema } from "../../lib/schema";
import { promoteEligibleDrafts } from "../../lib/promotion";

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
  // Use SQLite datetime() so promotion / idle checks match server SQL.
  const backdated =
    status === "pending_review" ||
    status === "moderator_approved" ||
    status === "moderator_rejected";
  if (backdated) {
    db.prepare(
      `INSERT INTO suggestions (user_id, word, action, status, last_modified_at)
       VALUES (?, ?, ?, ?, datetime('now', '-70 minutes'))`
    ).run(userId, word, action, status);
  } else {
    db.prepare(
      `INSERT INTO suggestions (user_id, word, action, status, last_modified_at)
       VALUES (?, ?, ?, ?, datetime('now'))`
    ).run(userId, word, action, status);
  }
  const row = db
    .prepare("SELECT last_insert_rowid() as id")
    .get() as { id: number };
  return row.id;
}

/**
 * Backdate a draft's last_modified_at and run promotion (pending_review or moderator_approved
 * depending on moderator_fast_track).
 */
export function promoteDraft(suggestionId: number): void {
  const db = getTestDb();
  db.prepare(
    "UPDATE suggestions SET last_modified_at = datetime('now', '-70 minutes') WHERE id = ?"
  ).run(suggestionId);
  promoteEligibleDrafts(db);
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
