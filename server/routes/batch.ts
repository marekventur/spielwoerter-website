import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { normalise } from "../../lib/normalise.js";
import { priorDecision } from "../../lib/prior-decisions.js";
import { requireUser } from "../http-auth.js";

const LIMIT_USER = 100;
const LIMIT_MODERATOR = 500;

type BatchChange = {
  word: string;
  type: "add" | "change_description" | "remove";
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
    if (type !== "add" && type !== "change_description" && type !== "remove") {
      res.status(400).json({ error: "Ungültiger Typ in Batch" });
      return;
    }
    const payload = type !== "remove" ? (c.payload as BatchChange["payload"]) : undefined;
    if (type === "change_description" || type === "add") {
      const base = payload?.base?.trim() ?? "";
      const desc = payload?.description?.trim() ?? "";
      if (type === "change_description" && !base && !desc) {
        res.status(400).json({ error: `Leere Änderung für Wort "${word}"` });
        return;
      }
      if (base.length > 100 || desc.length > 500) {
        res.status(400).json({ error: `Wert zu lang für Wort "${word}"` });
        return;
      }
    }
    if (type === "add" && !/^[a-zäöüß]+$/.test(word)) {
      res.status(400).json({ error: `Ungültiges Wort: "${word}"` });
      return;
    }
    validated.push({ word, type, payload });
  }

  const db = getDb();

  // change_description needs the word in the list; add needs it absent.
  for (const { word, type } of validated) {
    if (type === "change_description") {
      const exists = db.prepare("SELECT 1 FROM words WHERE word = ?").get(word);
      if (!exists) {
        res.status(400).json({ error: `Wort nicht gefunden: "${word}"` });
        return;
      }
    } else if (type === "add") {
      const exists = db.prepare("SELECT 1 FROM words WHERE word = ?").get(word);
      if (exists) {
        res.status(400).json({ error: `Wort bereits in der Liste: "${word}"` });
        return;
      }
    }
  }

  const batchMessage = typeof message === "string" ? message.trim().slice(0, 200) || null : null;

  // Settled decisions stick: earlier rejections or recent deliberate opposite
  // decisions must be overridden knowingly, with a comment — same policy as
  // single suggestions. Adds also hit the umlaut guard (ae/oe/ue/ss spellings
  // of existing umlaut entries).
  const { force, confirmComment } = req.body as { force?: boolean; confirmComment?: string };
  const confirmText = typeof confirmComment === "string" ? confirmComment.trim() : "";
  const conflicts: { word: string; message: string }[] = [];
  {
    const isBlocked = db.prepare(
      "SELECT 1 FROM rejected_words WHERE word = ? AND action = ?"
    );
    const umlautSibling = db.prepare(
      `SELECT word FROM words WHERE normalised = ? AND word != ?
       AND in_list IN ('accepted', 'uncertain') LIMIT 1`
    );
    for (const { word, type } of validated) {
      if (type === "change_description") continue;
      const prior = user.isModerator ? priorDecision(db, word, type) : null;
      if (prior) {
        conflicts.push({ word, message: prior.message });
        continue;
      }
      if (isBlocked.get(word, type)) {
        conflicts.push({
          word,
          message:
            type === "remove"
              ? "Diese Löschung wurde bereits abgelehnt."
              : "Dieser Vorschlag wurde bereits abgelehnt.",
        });
        continue;
      }
      if (type === "add" && word === normalise(word)) {
        const sibling = umlautSibling.get(normalise(word), word) as { word: string } | undefined;
        if (sibling) {
          conflicts.push({
            word,
            message: `Sieht wie eine Ersatzschreibweise von „${sibling.word.toUpperCase()}" aus — Wörter werden immer mit Umlauten und ß aufgenommen.`,
          });
        }
      }
    }
    if (conflicts.length > 0 && !(force === true && confirmText)) {
      res.status(409).json({
        requiresConfirmation: true,
        error: "Einige Änderungen widersprechen früheren Entscheidungen.",
        conflicts,
      });
      return;
    }
  }

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
    const conflictWords = new Set(conflicts.map((c) => c.word));
    const insertComment = db.prepare(
      "INSERT INTO word_comments (word, user_id, body) VALUES (?, ?, ?)"
    );

    for (const { word, type, payload } of validated) {
      let payloadToStore = type !== "remove" ? payload : undefined;
      if (type === "add" && payloadToStore) {
        // Lemma convention: base equal to the word is omitted (as in suggestions.ts).
        const p = { ...payloadToStore };
        if (p.base && p.base.trim().toLowerCase() === word) delete p.base;
        payloadToStore = Object.keys(p).length > 0 ? p : undefined;
      }
      const payloadJson = payloadToStore && Object.keys(payloadToStore).length > 0
        ? JSON.stringify(payloadToStore)
        : null;

      const updated = upsertDraft.run(payloadJson, batchId, fastTrack, user.id, word, type);
      if (updated.changes === 0) {
        insertSugg.run(user.id, word, type, payloadJson, batchId, fastTrack);
      }
      if (conflictWords.has(word)) {
        insertComment.run(word, user.id, confirmText);
      }
    }
  })();

  res.json({ ok: true, count: validated.length });
});
