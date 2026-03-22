import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireModerator } from "../http-auth.js";

type SuggRow = { id: number; word: string; action: string; status: string };

function moderateOne(
  db: ReturnType<typeof getDb>,
  id: number,
  decision: "moderator_approved" | "moderator_rejected"
): boolean {
  const suggestion = db
    .prepare("SELECT id, word, action, status FROM suggestions WHERE id = ?")
    .get(id) as SuggRow | undefined;

  if (!suggestion) return false;
  if (!["pending_review", "needs_moderator"].includes(suggestion.status))
    return false;

  db.transaction(() => {
    db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(
      decision,
      id
    );
    if (decision === "moderator_rejected") {
      db.prepare(
        "INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, ?)"
      ).run(suggestion.word, suggestion.action);
    }
  })();

  return true;
}

export const moderationRouter = Router();

moderationRouter.post("/:id/approve", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const ok = moderateOne(getDb(), Number(req.params.id), "moderator_approved");
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "Ungültig" });
});

moderationRouter.post("/:id/reject", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const ok = moderateOne(getDb(), Number(req.params.id), "moderator_rejected");
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "Ungültig" });
});

moderationRouter.post("/batch", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { ids, action } = req.body as {
    ids?: number[];
    action?: "approve" | "reject";
  };
  if (!ids?.length || !action) {
    res.status(400).json({ error: "Fehlende Felder" });
    return;
  }

  const decision =
    action === "approve" ? "moderator_approved" : "moderator_rejected";
  const db = getDb();
  let count = 0;
  for (const id of ids) {
    if (moderateOne(db, id, decision)) count++;
  }
  res.json({ ok: true, count });
});
