import "dotenv/config";
import { getDb } from "../lib/db.js";
import { syncPull, syncPush } from "../lib/sync.js";

const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
const githubToken = process.env.GITHUB_TOKEN;

if (!githubRepo) {
  console.error("SPIELWOERTER_GITHUB_REPO is not set");
  process.exit(1);
}
if (!githubToken) {
  console.error("GITHUB_TOKEN is not set");
  process.exit(1);
}

const db = getDb();
const { pushed, digestUsers } = await syncPush(db, githubRepo, githubToken);
console.log(`Pushed: ${pushed}`);
if (digestUsers.length > 0) {
  console.log("Digest users:", JSON.stringify(digestUsers, null, 2));
}
if (pushed > 0) {
  console.log("Pulling back to sync local DB…");
  await syncPull(db, githubRepo);
}
