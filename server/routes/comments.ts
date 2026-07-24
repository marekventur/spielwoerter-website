import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireUser, requireModerator } from "../http-auth.js";

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
