import "dotenv/config";
import { getDb } from "../lib/db.js";
import { syncPull } from "../lib/sync.js";

const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
if (!githubRepo) {
  console.error("SPIELWOERTER_GITHUB_REPO is not set");
  process.exit(1);
}

const db = getDb();
await syncPull(db, githubRepo);
