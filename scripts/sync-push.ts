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

const branch = process.argv[2] ?? "main";
console.log(`Target branch: ${branch}`);

// Deliberate manual invocation, so it opts out of syncPush's production guard.
// Say so loudly — this writes to the real repo from wherever it is run.
if (process.env.NODE_ENV !== "production") {
  console.warn(
    `\u26a0\ufe0f  NODE_ENV ist nicht "production" \u2014 pushe trotzdem nach ${githubRepo}#${branch}.`
  );
}

const db = getDb();
const { pushed, digestUsers } = await syncPush(db, githubRepo, githubToken, branch, {
  allowNonProduction: true,
});
console.log(`Pushed: ${pushed}`);
if (digestUsers.length > 0) {
  console.log("Digest users:", JSON.stringify(digestUsers, null, 2));
}
if (pushed > 0 && branch === "main") {
  console.log("Pulling back to sync local DB…");
  await syncPull(db, githubRepo);
}
