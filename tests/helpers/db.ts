import Database from "better-sqlite3";
import { TEST_DB_PATH } from "./test-config";

let db: Database.Database | null = null;

export function getTestDb(): Database.Database {
  if (!db) {
    db = new Database(TEST_DB_PATH);
    db.pragma("journal_mode = WAL");
  }
  return db;
}

export function closeTestDb(): void {
  db?.close();
  db = null;
}
