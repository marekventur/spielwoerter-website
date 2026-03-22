import { getDb } from "../lib/db.js";
import { syncPull, syncPush } from "../lib/sync.js";
import { sendDigestEmails } from "./mailgun.js";

let promotionJobStarted = false;

export function startPromotionJob() {
  if (promotionJobStarted) return;
  promotionJobStarted = true;

  const run = () => {
    const result = getDb()
      .prepare(
        `UPDATE suggestions SET status = 'pending_review'
         WHERE status = 'draft'
         AND last_modified_at <= datetime('now', '-60 minutes')`
      )
      .run();
    if (result.changes > 0) {
      console.log(`[promotion] ${result.changes} draft(s) → pending_review`);
    }
  };

  run();
  setInterval(run, 10 * 60 * 1000);
}

let syncJobStarted = false;

export function startSyncJob() {
  if (syncJobStarted) return;
  syncJobStarted = true;

  const run = async () => {
    const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubRepo || !githubToken) return;

    try {
      const { pushed, digestUsers } = await syncPush(getDb(), githubRepo, githubToken);
      if (pushed > 0) await syncPull(getDb(), githubRepo);
      await sendDigestEmails(digestUsers);
    } catch (err) {
      console.error("[sync job] Error:", err instanceof Error ? err.message : err);
    }
  };

  setInterval(run, 60 * 60 * 1000);
}
