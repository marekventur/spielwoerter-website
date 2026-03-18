import fs from "fs";
import { TEST_DB_PATH } from "./helpers/test-config";
import { closeTestDb } from "./helpers/db";

export default async function globalTeardown() {
  closeTestDb();
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB_PATH + suffix);
    } catch {
      // Already gone — fine
    }
  }
}
