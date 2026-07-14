import type Database from "better-sqlite3";
import { normalise } from "./normalise.js";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_moderator INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS otp_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL,
      code TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS words (
      word TEXT PRIMARY KEY,
      description TEXT,
      base TEXT,
      source TEXT,
      verified_by TEXT,
      in_list TEXT NOT NULL,
      normalised TEXT
    );

    CREATE TABLE IF NOT EXISTS suggestions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      word TEXT NOT NULL,
      action TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'draft',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_modified_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS rejected_words (
      word TEXT NOT NULL,
      action TEXT NOT NULL,
      PRIMARY KEY (word, action)
    );

    CREATE TABLE IF NOT EXISTS mcp_tokens (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      token TEXT NOT NULL UNIQUE,
      label TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS batches (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      message TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Migrations: add columns if missing
  const wordCols = (
    db.prepare("SELECT name FROM pragma_table_info('words')").all() as { name: string }[]
  ).map((r) => r.name);
  if (!wordCols.includes("normalised")) {
    db.prepare("ALTER TABLE words ADD COLUMN normalised TEXT").run();
    db.exec("CREATE INDEX IF NOT EXISTS idx_words_normalised ON words(normalised)");
    // Back-fill existing rows
    const rows = db.prepare("SELECT word FROM words").all() as { word: string }[];
    const update = db.prepare("UPDATE words SET normalised = ? WHERE word = ?");
    db.transaction(() => {
      for (const { word } of rows) update.run(normalise(word), word);
    })();
  }

  const userCols = (
    db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[]
  ).map((r) => r.name);
  if (!userCols.includes("is_admin")) {
    db.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run();
  }
  if (userCols.includes("license_approved")) {
    db.prepare("ALTER TABLE users DROP COLUMN license_approved").run();
  }

  const suggCols = (
    db.prepare("SELECT name FROM pragma_table_info('suggestions')").all() as { name: string }[]
  ).map((r) => r.name);
  if (!suggCols.includes("synced_at")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN synced_at TEXT").run();
  }
  if (!suggCols.includes("notified_at")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN notified_at TEXT").run();
  }
  if (!suggCols.includes("moderator_fast_track")) {
    db.prepare(
      "ALTER TABLE suggestions ADD COLUMN moderator_fast_track INTEGER NOT NULL DEFAULT 0"
    ).run();
  }
  if (!suggCols.includes("supporters")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN supporters TEXT").run();
  }
  if (!suggCols.includes("opposers")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN opposers TEXT").run();
  }
  if (!suggCols.includes("partner_key_label")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN partner_key_label TEXT").run();
  }
  if (!suggCols.includes("batch_id")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN batch_id INTEGER REFERENCES batches(id)").run();
  }
  if (!suggCols.includes("moderation_comment")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN moderation_comment TEXT").run();
  }
  if (!suggCols.includes("original_payload")) {
    // Set when a moderator approves with corrections; stores JSON {word, payload} as submitted.
    db.prepare("ALTER TABLE suggestions ADD COLUMN original_payload TEXT").run();
  }
  if (!suggCols.includes("decided_by")) {
    // Moderator who made the approve/reject decision (display/audit only).
    db.prepare("ALTER TABLE suggestions ADD COLUMN decided_by INTEGER REFERENCES users(id)").run();
  }
  if (!suggCols.includes("decided_at")) {
    db.prepare("ALTER TABLE suggestions ADD COLUMN decided_at TEXT").run();
  }

  // Ensure bootstrap admin always has full privileges
  db.prepare(
    `INSERT INTO users (email, is_moderator, is_admin)
     VALUES ('marekventur@gmail.com', 1, 1)
     ON CONFLICT(email) DO UPDATE SET is_moderator = 1, is_admin = 1`
  ).run();
}
