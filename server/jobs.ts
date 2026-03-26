import path from "path";
import os from "os";
import fs from "fs";
import { Storage } from "@google-cloud/storage";
import { getDb } from "../lib/db.js";
import { promoteEligibleDrafts } from "../lib/promotion.js";
import { syncPull, syncPush } from "../lib/sync.js";
import { sendDigestEmails } from "./mailgun.js";

let promotionJobStarted = false;

export function startPromotionJob() {
  if (promotionJobStarted) return;
  promotionJobStarted = true;

  const run = () => {
    const { toModeratorApproved, toPendingReview } = promoteEligibleDrafts(getDb());
    if (toModeratorApproved > 0) {
      console.log(
        `[promotion] ${toModeratorApproved} draft(s) → moderator_approved (moderator edits)`
      );
    }
    if (toPendingReview > 0) {
      console.log(`[promotion] ${toPendingReview} draft(s) → pending_review`);
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

  run();
  setInterval(run, 60 * 60 * 1000);
}

let backupJobStarted = false;

export async function startBackupJob() {
  if (backupJobStarted) return;
  backupJobStarted = true;

  const run = async () => {
    const keyJson = process.env.GCP_SERVICE_ACCOUNT_KEY;
    const bucketName = process.env.GCP_BACKUP_BUCKET;
    if (!keyJson || !bucketName) return;

    try {
      const dbPath = process.env.DATABASE_PATH ?? path.join(process.cwd(), "data", "app.db");
      const tmpPath = path.join(os.tmpdir(), "spielwoerter-backup.db");

      // Safe snapshot of live WAL-mode DB
      await getDb().backup(tmpPath);

      const storage = new Storage({ credentials: JSON.parse(keyJson) });
      await storage.bucket(bucketName).upload(tmpPath, { destination: "app.db" });
      fs.unlinkSync(tmpPath);

      console.log(`[backup] Uploaded to gs://${bucketName}/app.db`);
    } catch (err) {
      console.error("[backup] Error:", err instanceof Error ? err.message : err);
    }
  };

  await run();
  setInterval(run, 24 * 60 * 60 * 1000);
}
