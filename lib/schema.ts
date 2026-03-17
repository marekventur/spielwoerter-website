import type Database from "better-sqlite3";

export function initSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      email TEXT NOT NULL UNIQUE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      is_moderator INTEGER NOT NULL DEFAULT 0,
      license_approved INTEGER NOT NULL DEFAULT 0
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
      in_list TEXT NOT NULL
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
  `);

  // Migrations: add columns if missing
  const userCols = (
    db.prepare("SELECT name FROM pragma_table_info('users')").all() as { name: string }[]
  ).map((r) => r.name);
  if (!userCols.includes("is_admin")) {
    db.prepare("ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0").run();
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
}
