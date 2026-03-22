import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { syncPull, syncPush } from "../../lib/sync.js";
import { requireModerator } from "../http-auth.js";
import { sendDigestEmails } from "../mailgun.js";

export const syncPushRouter = Router();

syncPushRouter.post("/push", async (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubRepo || !githubToken) {
    res.status(500).json({ error: "SPIELWOERTER_GITHUB_REPO or GITHUB_TOKEN not set" });
    return;
  }

  try {
    const { pushed, digestUsers } = await syncPush(getDb(), githubRepo, githubToken);
    if (pushed > 0) await syncPull(getDb(), githubRepo);
    await sendDigestEmails(digestUsers);
    res.json({ ok: true, pushed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync push] Error:", msg);
    res.status(500).json({ error: msg });
  }
});
