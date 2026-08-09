import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { initSchema } from "./schema.js";

const DB_PATH = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (!db) {
    fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.function("regexp", { deterministic: true }, (pattern: unknown, value: unknown) => {
      if (value == null || typeof pattern !== "string") return 0;
      try {
        return new RegExp(pattern, "i").test(String(value)) ? 1 : 0;
      } catch {
        return 0;
      }
    });
    initSchema(db);
  }
  return db;
}

/**
 * Private connection for long-lived streaming reads (CSV export).
 * better-sqlite3 is synchronous: holding an open iterator on the shared
 * getDb() connection across awaits makes every concurrent request throw
 * "This database connection is busy executing a query" (this broke login in
 * production while a slow CSV download was in flight). WAL mode makes a
 * second read-only connection safe. Callers must close() it.
 */
export function openReadonlyDb(): Database.Database {
  return new Database(DB_PATH, { readonly: true });
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
