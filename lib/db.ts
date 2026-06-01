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

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}
