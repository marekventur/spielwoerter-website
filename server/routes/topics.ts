import { Router } from "express";
import { getDb } from "../../lib/db.js";
import {
  MAX_POST_LENGTH,
  MAX_TOPIC_TITLE_LENGTH,
  createTopic,
  deleteTopic,
  insertPost,
} from "../../lib/topics.js";
import { requireAdmin, requireModerator } from "../http-auth.js";
import { mailTopicPostInBackground } from "../topic-mail.js";

export const topicsRouter = Router();

/**
 * Moderators only — reads included. `/diskussion` is not a public surface, so
 * there is deliberately no `requireUser` endpoint in this file.
 */

topicsRouter.post("/", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { title, body } = req.body as { title?: string; body?: string };
  const t = typeof title === "string" ? title.trim() : "";
  const b = typeof body === "string" ? body.trim() : "";

  if (!t) return void res.status(400).json({ error: "Titel fehlt" });
  if (t.length > MAX_TOPIC_TITLE_LENGTH)
    return void res.status(400).json({ error: "Titel ist zu lang" });
  if (!b) return void res.status(400).json({ error: "Nachricht fehlt" });
  if (b.length > MAX_POST_LENGTH)
    return void res.status(400).json({ error: "Nachricht ist zu lang" });

  const db = getDb();
  const { topicId, postId } = createTopic(db, { userId: user.id, title: t, body: b });
  mailTopicPostInBackground(db, postId);
  res.json({ ok: true, topicId, postId });
});

topicsRouter.post("/:id/posts", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const topicId = Number(req.params.id);
  const { body, parentId } = req.body as { body?: string; parentId?: number };
  const b = typeof body === "string" ? body.trim() : "";

  if (!b) return void res.status(400).json({ error: "Nachricht fehlt" });
  if (b.length > MAX_POST_LENGTH)
    return void res.status(400).json({ error: "Nachricht ist zu lang" });

  const db = getDb();
  const topic = db
    .prepare("SELECT id, locked FROM topics WHERE id = ?")
    .get(topicId) as { id: number; locked: number } | undefined;
  if (!topic) return void res.status(404).json({ error: "Thema nicht gefunden" });
  if (topic.locked) return void res.status(409).json({ error: "Thema ist geschlossen" });

  let parent: number | null = null;
  if (parentId != null) {
    const row = db
      .prepare("SELECT id FROM topic_posts WHERE id = ? AND topic_id = ?")
      .get(parentId, topicId) as { id: number } | undefined;
    if (!row) return void res.status(400).json({ error: "Antwortziel nicht gefunden" });
    parent = row.id;
  }

  const postId = insertPost(db, {
    topicId,
    userId: user.id,
    body: b,
    parentId: parent,
  });
  mailTopicPostInBackground(db, postId);
  res.json({ ok: true, postId });
});

topicsRouter.post("/posts/:id/hide", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const db = getDb();
  const post = db
    .prepare("SELECT id, hidden_at FROM topic_posts WHERE id = ?")
    .get(Number(req.params.id)) as { id: number; hidden_at: string | null } | undefined;
  if (!post) return void res.status(404).json({ error: "Beitrag nicht gefunden" });

  if (post.hidden_at) {
    db.prepare(
      "UPDATE topic_posts SET hidden_at = NULL, hidden_by = NULL WHERE id = ?"
    ).run(post.id);
    res.json({ ok: true, hidden: false });
  } else {
    db.prepare(
      "UPDATE topic_posts SET hidden_at = datetime('now'), hidden_by = ? WHERE id = ?"
    ).run(user.id, post.id);
    res.json({ ok: true, hidden: true });
  }
});

function toggleFlag(column: "pinned" | "locked") {
  return (req: import("express").Request, res: import("express").Response) => {
    const user = requireModerator(req, res);
    if (!user) return;

    const db = getDb();
    const topic = db
      .prepare(`SELECT id, ${column} AS value FROM topics WHERE id = ?`)
      .get(Number(req.params.id)) as { id: number; value: number } | undefined;
    if (!topic) return void res.status(404).json({ error: "Thema nicht gefunden" });

    const next = topic.value ? 0 : 1;
    db.prepare(`UPDATE topics SET ${column} = ? WHERE id = ?`).run(next, topic.id);
    res.json({ ok: true, [column]: !!next });
  };
}

topicsRouter.post("/:id/pin", toggleFlag("pinned"));
topicsRouter.post("/:id/lock", toggleFlag("locked"));

/** Admins only: permanently delete a thread and all its posts. */
topicsRouter.delete("/:id", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const topicId = Number(req.params.id);
  if (!deleteTopic(getDb(), topicId)) {
    res.status(404).json({ error: "Thema nicht gefunden" });
    return;
  }
  console.log(`[diskussion] Topic ${topicId} deleted by user ${user.id}`);
  res.json({ ok: true });
});
