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

type ScheduledRow = {
  id: number;
  user_id: number;
  word: string;
  status: string;
  action: string;
  moderator_fast_track: number;
};

function getScheduledRemoval(id: number): ScheduledRow | undefined {
  return getDb()
    .prepare(
      `SELECT id, user_id, word, status, action, moderator_fast_track
       FROM suggestions WHERE id = ?`
    )
    .get(id) as ScheduledRow | undefined;
}

// Second pair of eyes on a scheduled fast-track removal: another moderator
// confirms it (publishes without waiting out the delay) …
moderationRouter.post("/scheduled/:id/approve", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const row = getScheduledRemoval(Number(req.params.id));
  if (!row || row.status !== "draft" || !row.moderator_fast_track || row.action !== "remove") {
    res.status(404).json({ error: "Keine geplante Löschung" });
    return;
  }
  if (row.user_id === user.id) {
    res.status(403).json({ error: "Eigene Löschungen kann nur ein anderer Moderator freigeben" });
    return;
  }

  const result = moderateOne(getDb(), row.id, "moderator_approved", {
    override: true,
    decidedBy: user.id,
  });
  result.ok ? res.json({ ok: true }) : res.status(400).json({ error: result.error });
});

// … or objects, which stops the clock and sends it to the review queue with
// the objection as a comment on the word.
moderationRouter.post("/scheduled/:id/object", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { comment } = (req.body ?? {}) as { comment?: string };
  const text = typeof comment === "string" ? comment.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Einspruch braucht eine Begründung" });
    return;
  }

  const row = getScheduledRemoval(Number(req.params.id));
  if (!row || row.status !== "draft" || !row.moderator_fast_track || row.action !== "remove") {
    res.status(404).json({ error: "Keine geplante Löschung" });
    return;
  }
  if (row.user_id === user.id) {
    res.status(403).json({ error: "Eigene Entwürfe kannst du direkt löschen" });
    return;
  }

  const db = getDb();
  db.transaction(() => {
    db.prepare(
      `UPDATE suggestions SET status = 'needs_moderator', last_modified_at = datetime('now')
       WHERE id = ? AND status = 'draft'`
    ).run(row.id);
    db.prepare(
      "INSERT INTO word_comments (word, user_id, suggestion_id, body) VALUES (?, ?, ?, ?)"
    ).run(row.word, user.id, row.id, text);
  })();
  res.json({ ok: true });
});
