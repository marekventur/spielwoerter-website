import fs from "fs";
import { TEST_DB_PATH, BASE_URL } from "./helpers/test-config";

export default async function globalSetup() {
  // Remove any stale test DB from a previous run
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(TEST_DB_PATH + suffix);
    } catch {
      // File doesn't exist — that's fine
    }
  }

  // Warmup: trigger Vite SSR compilation of key routes before tests start.
  // Without this, the first test to hit each route can time out waiting for
  // the cold Vite SSR bundle. Order matters: compile faster routes first.
  const routes = ["/", "/login", "/wort/HUND"];
  for (const route of routes) {
    try {
      await fetch(`${BASE_URL}${route}`);
    } catch {
      // Ignore errors — we just want to trigger compilation
    }
  }
}
