import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { moderateOne, undoModeration, type ModerationChanges } from "../../lib/moderate.js";
import { requireModerator } from "../http-auth.js";

export const moderationRouter = Router();

moderationRouter.post("/:id/approve", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { changes, comment } = (req.body ?? {}) as {
    changes?: ModerationChanges;
    comment?: string;
  };

  const result = moderateOne(getDb(), Number(req.params.id), "moderator_approved", {
    changes,
    comment,
    decidedBy: user.id,
  });
  result.ok
    ? res.json({ ok: true })
    : res.status(400).json({ error: result.error });
});

moderationRouter.post("/:id/reject", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { comment } = (req.body ?? {}) as { comment?: string };

  const result = moderateOne(getDb(), Number(req.params.id), "moderator_rejected", {
    comment,
    decidedBy: user.id,
  });
  result.ok
    ? res.json({ ok: true })
    : res.status(400).json({ error: result.error });
});

moderationRouter.post("/batch", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { ids, action, comment } = req.body as {
    ids?: number[];
    action?: "approve" | "reject";
    comment?: string;
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
    if (moderateOne(db, id, decision, { comment, decidedBy: user.id }).ok) count++;
  }
  res.json({ ok: true, count });
});

moderationRouter.post("/:id/undo", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const result = undoModeration(getDb(), Number(req.params.id));
  result.ok
    ? res.json({ ok: true })
    : res.status(400).json({ error: result.error });
});
