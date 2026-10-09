import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireUser, requireModerator } from "../http-auth.js";
import { sendCommentReplyEmail } from "../mailgun.js";
import { screenName } from "../../lib/screen-name.js";

export const commentsRouter = Router();

const MAX_COMMENT_LENGTH = 1000;

commentsRouter.post("/", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { word, body } = req.body as { word?: string; body?: string };
  const wordLower = typeof word === "string" ? word.trim().toLowerCase() : "";
  const text = typeof body === "string" ? body.trim() : "";

  if (!wordLower || wordLower.length > 100) {
    res.status(400).json({ error: "Ungültiges Wort" });
    return;
  }
  if (!text) {
    res.status(400).json({ error: "Kommentar darf nicht leer sein" });
    return;
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `Kommentar darf höchstens ${MAX_COMMENT_LENGTH} Zeichen haben` });
    return;
  }

  const db = getDb();
  // Comments belong to words with a page worth discussing — known words or
  // words with suggestion history. Keeps arbitrary strings comment-free.
  const known =
    db.prepare("SELECT 1 FROM words WHERE word = ?").get(wordLower) ??
    db.prepare("SELECT 1 FROM suggestions WHERE word = ? LIMIT 1").get(wordLower);
  if (!known) {
    res.status(400).json({ error: "Zu diesem Wort gibt es noch keine Historie" });
    return;
  }

  db.prepare("INSERT INTO word_comments (word, user_id, body) VALUES (?, ?, ?)").run(
    wordLower,
    user.id,
    text
  );
  res.json({ ok: true });
});

// A moderator's answer to someone's comment: stored as a comment on the same
// word (so it shows in the word history) and mailed to the comment's author.
// Their address never leaves the server; the mail comes from no-reply.
commentsRouter.post("/:id/reply", async (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const text = typeof req.body?.body === "string" ? req.body.body.trim() : "";
  if (!text) {
    res.status(400).json({ error: "Antwort darf nicht leer sein" });
    return;
  }
  if (text.length > MAX_COMMENT_LENGTH) {
    res.status(400).json({ error: `Antwort darf höchstens ${MAX_COMMENT_LENGTH} Zeichen haben` });
    return;
  }

  const db = getDb();
  const parent = db
    .prepare(
      `SELECT c.id, c.word, c.body, c.user_id, u.email
       FROM word_comments c JOIN users u ON u.id = c.user_id
       WHERE c.id = ?`
    )
    .get(Number(req.params.id)) as
    | { id: number; word: string; body: string; user_id: number; email: string }
    | undefined;
  if (!parent) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }

  db.prepare(
    "INSERT INTO word_comments (word, user_id, body, reply_to) VALUES (?, ?, ?, ?)"
  ).run(parent.word, user.id, text, parent.id);

  let mailed = false;
  if (parent.user_id !== user.id) {
    try {
      await sendCommentReplyEmail(parent.email, {
        word: parent.word,
        moderatorName: screenName(user.displayName, user.id),
        originalComment: parent.body,
        reply: text,
      });
      mailed = true;
    } catch (err) {
      // The reply is saved and visible either way; a failed mail must not
      // turn into an error the moderator would retry (and duplicate).
      console.error(`[comments] Reply mail for comment ${parent.id} failed:`, err);
    }
  }
  res.json({ ok: true, mailed });
});

commentsRouter.post("/:id/hide", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const db = getDb();
  const row = db
    .prepare("SELECT id, hidden_at FROM word_comments WHERE id = ?")
    .get(Number(req.params.id)) as { id: number; hidden_at: string | null } | undefined;
  if (!row) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }

  if (row.hidden_at === null) {
    db.prepare(
      "UPDATE word_comments SET hidden_at = datetime('now'), hidden_by = ? WHERE id = ?"
    ).run(user.id, row.id);
  } else {
    db.prepare("UPDATE word_comments SET hidden_at = NULL, hidden_by = NULL WHERE id = ?").run(
      row.id
    );
  }
  res.json({ ok: true });
});
