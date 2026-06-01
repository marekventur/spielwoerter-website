import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireUser } from "../http-auth.js";

const LIMIT_USER = 100;
const LIMIT_MODERATOR = 500;

type BatchChange = {
  word: string;
  type: "change_description" | "remove";
  payload?: { base?: string; description?: string };
};

export const batchRouter = Router();

batchRouter.post("/", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { message, changes } = req.body as {
    message?: string;
    changes?: unknown[];
  };

  if (!Array.isArray(changes) || changes.length === 0) {
    res.status(400).json({ error: "Keine Änderungen angegeben" });
    return;
  }

  const limit = user.isModerator ? LIMIT_MODERATOR : LIMIT_USER;
  if (changes.length > limit) {
    res.status(400).json({ error: `Maximal ${limit} Änderungen pro Batch` });
    return;
  }

  // Validate each entry
  const validated: BatchChange[] = [];
  for (const raw of changes) {
    const c = raw as Record<string, unknown>;
    const word = typeof c.word === "string" ? c.word.trim().toLowerCase() : null;
    const type = c.type;
    if (!word || word.length > 100) {
      res.status(400).json({ error: "Ungültiges Wort in Batch" });
      return;
    }
    if (type !== "change_description" && type !== "remove") {
      res.status(400).json({ error: "Ungültiger Typ in Batch" });
      return;
    }
    const payload = type === "change_description" ? (c.payload as BatchChange["payload"]) : undefined;
    if (type === "change_description") {
      const base = payload?.base?.trim() ?? "";
      const desc = payload?.description?.trim() ?? "";
      if (!base && !desc) {
        res.status(400).json({ error: `Leere Änderung für Wort "${word}"` });
        return;
      }
      if (base.length > 100 || desc.length > 500) {
        res.status(400).json({ error: `Wert zu lang für Wort "${word}"` });
        return;
      }
    }
    validated.push({ word, type, payload });
  }

  const db = getDb();

  // Verify all words exist in the wordlist
  for (const { word, type } of validated) {
    if (type === "change_description") {
      const exists = db.prepare("SELECT 1 FROM words WHERE word = ?").get(word);
      if (!exists) {
        res.status(400).json({ error: `Wort nicht gefunden: "${word}"` });
        return;
      }
    }
  }

  const batchMessage = typeof message === "string" ? message.trim().slice(0, 200) || null : null;

  db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare("INSERT INTO batches (user_id, message) VALUES (?, ?)")
      .run(user.id, batchMessage);
    const batchId = Number(lastInsertRowid);

    const upsertDraft = db.prepare(`
      UPDATE suggestions
      SET payload = ?, batch_id = ?, last_modified_at = datetime('now'),
          moderator_fast_track = ?
      WHERE user_id = ? AND word = ? AND action = ? AND status = 'draft'
    `);
    const insertSugg = db.prepare(`
      INSERT INTO suggestions (user_id, word, action, payload, batch_id, moderator_fast_track)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const fastTrack = user.isModerator ? 1 : 0;

    for (const { word, type, payload } of validated) {
      const payloadJson = type === "change_description" && payload
        ? JSON.stringify(payload)
        : null;

      const updated = upsertDraft.run(payloadJson, batchId, fastTrack, user.id, word, type);
      if (updated.changes === 0) {
        insertSugg.run(user.id, word, type, payloadJson, batchId, fastTrack);
      }
    }
  })();

  res.json({ ok: true, count: validated.length });
});
