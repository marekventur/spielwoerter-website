import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { validateDisplayName } from "../../lib/screen-name.js";
import { requireUser } from "../http-auth.js";

export const profileRouter = Router();

profileRouter.post("/", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { displayName } = req.body as { displayName?: string };
  const trimmed = typeof displayName === "string" ? displayName.trim() : "";
  const db = getDb();

  // Empty resets to the automatic user-<id> name.
  if (trimmed === "") {
    db.prepare("UPDATE users SET display_name = NULL WHERE id = ?").run(user.id);
    res.json({ ok: true, displayName: null });
    return;
  }

  const error = validateDisplayName(trimmed);
  if (error) {
    res.status(400).json({ error });
    return;
  }

  const taken = db
    .prepare("SELECT 1 FROM users WHERE lower(display_name) = lower(?) AND id != ?")
    .get(trimmed, user.id);
  if (taken) {
    res.status(409).json({ error: "Dieser Anzeigename ist bereits vergeben" });
    return;
  }

  db.prepare("UPDATE users SET display_name = ? WHERE id = ?").run(trimmed, user.id);
  res.json({ ok: true, displayName: trimmed });
});

/** Per-channel mail preferences. See lib/topics.ts for how they are applied. */
profileRouter.post("/email", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { emailDiskussion, emailDigest } = req.body as {
    emailDiskussion?: string;
    emailDigest?: boolean;
  };
  const db = getDb();

  if (emailDiskussion !== undefined) {
    if (!["all", "mine", "none"].includes(emailDiskussion)) {
      res.status(400).json({ error: "Ungültige Einstellung" });
      return;
    }
    db.prepare("UPDATE users SET email_diskussion = ? WHERE id = ?").run(
      emailDiskussion,
      user.id
    );
  }
  if (emailDigest !== undefined) {
    db.prepare("UPDATE users SET email_digest = ? WHERE id = ?").run(
      emailDigest ? 1 : 0,
      user.id
    );
  }

  const row = db
    .prepare("SELECT email_diskussion, email_digest FROM users WHERE id = ?")
    .get(user.id) as { email_diskussion: string; email_digest: number };
  res.json({
    ok: true,
    emailDiskussion: row.email_diskussion,
    emailDigest: !!row.email_digest,
  });
});
