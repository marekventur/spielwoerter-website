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
