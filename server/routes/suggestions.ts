import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { priorDecision } from "../../lib/prior-decisions.js";
import { requireUser } from "../http-auth.js";

/** Lemma: if base equals the word, omit base (stored as null on sync). */
function normalizeAddPayloadBase(
  wordLower: string,
  payload: Record<string, string> | null | undefined
): Record<string, string> | null {
  if (!payload) return null;
  const p = { ...payload };
  if (p.base !== undefined) {
    const b = String(p.base).trim().toLowerCase();
    if (b === wordLower) delete p.base;
  }
  return Object.keys(p).length > 0 ? p : null;
}

export const suggestionsRouter = Router();

suggestionsRouter.get("/", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const suggestions = getDb()
    .prepare(
      `SELECT s.*, w.in_list AS word_in_list
       FROM suggestions s
       LEFT JOIN words w ON w.word = s.word
       WHERE s.user_id = ?
       ORDER BY s.last_modified_at DESC`
    )
    .all(user.id);

  res.json({ suggestions });
});

suggestionsRouter.post("/", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const { word, action, payload } = req.body as {
    word?: string;
    action?: string;
    payload?: Record<string, string>;
  };

  if (!word || !action) {
    res.status(400).json({ error: "Fehlende Felder" });
    return;
  }
  if (word.length > 100) {
    res.status(400).json({ error: "Wort zu lang" });
    return;
  }
  if (payload?.description && payload.description.length > 500) {
    res.status(400).json({ error: "Beschreibung zu lang" });
    return;
  }
  if (payload?.base && payload.base.length > 100) {
    res.status(400).json({ error: "Grundform zu lang" });
    return;
  }
  if (!["add", "remove", "change_description"].includes(action)) {
    res.status(400).json({ error: "Ungültige Aktion" });
    return;
  }

  const db = getDb();

  const wordLower = word.toLowerCase();

  if (action === "change_description") {
    const exists = db
      .prepare("SELECT 1 FROM words WHERE word = ?")
      .get(wordLower);
    if (!exists) {
      res.status(400).json({ error: "Wort nicht gefunden" });
      return;
    }
    const descTrim = (payload?.description ?? "").trim();
    const baseTrim = (payload?.base ?? "").trim();
    if (!descTrim && !baseTrim) {
      res.status(400).json({
        error: "Mindestens Beschreibung oder Grundform angeben",
      });
      return;
    }
  }

  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
    .get(wordLower, action);

  // Settled decisions stick: a moderator can override a rejection or revert a
  // recent deliberate decision, but only knowingly — with a comment that lands
  // in the word's history. Non-moderators stay hard-blocked on rejections.
  const { force, comment } = req.body as { force?: boolean; comment?: string };
  const confirmComment = typeof comment === "string" ? comment.trim() : "";
  let confirmedPrior = false;
  if (user.isModerator && (action === "add" || action === "remove")) {
    const prior = priorDecision(db, wordLower, action);
    if (blocked || prior) {
      if (!(force === true && confirmComment)) {
        res.status(409).json({
          requiresConfirmation: true,
          error: prior?.message ?? "Dieser Vorschlag wurde bereits abgelehnt.",
          prior,
        });
        return;
      }
      confirmedPrior = true;
    }
  } else if (blocked) {
    res.status(409).json({ error: "Dieser Vorschlag wurde bereits abgelehnt." });
    return;
  }

  const pipelineStatuses =
    "('draft', 'pending_review', 'ai_approved', 'needs_moderator', 'moderator_approved')";
  if (action === "add" || action === "remove") {
    const otherPipeline = db
      .prepare(
        `SELECT 1 FROM suggestions WHERE word = ? AND action = ? AND status IN ${pipelineStatuses}
         AND user_id != ?
         LIMIT 1`
      )
      .get(wordLower, action, user.id);
    if (otherPipeline) {
      res.status(409).json({
        error:
          action === "add"
            ? "Für dieses Wort liegt bereits ein Hinzufügen-Vorschlag in Prüfung."
            : "Für dieses Wort liegt bereits ein Entfernen-Vorschlag in Prüfung.",
      });
      return;
    }
  }

  const existing = db
    .prepare(
      "SELECT id FROM suggestions WHERE user_id = ? AND word = ? AND action = ? AND status = 'draft'"
    )
    .get(user.id, wordLower, action);
  if (existing) {
    res.status(409).json({ error: "Du hast bereits einen Entwurf für diesen Vorschlag." });
    return;
  }

  const payloadToStore =
    action === "add"
      ? normalizeAddPayloadBase(wordLower, payload ?? null)
      : payload ?? null;

  db.transaction(() => {
    const { lastInsertRowid } = db
      .prepare(
        `INSERT INTO suggestions (user_id, word, action, payload, moderator_fast_track)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(
        user.id,
        wordLower,
        action,
        payloadToStore ? JSON.stringify(payloadToStore) : null,
        user.isModerator ? 1 : 0
      );
    if (confirmedPrior) {
      db.prepare(
        "INSERT INTO word_comments (word, user_id, suggestion_id, body) VALUES (?, ?, ?, ?)"
      ).run(wordLower, user.id, Number(lastInsertRowid), confirmComment);
    }
  })();

  res.json({ ok: true });
});

suggestionsRouter.delete("/:id", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const db = getDb();
  const suggestion = db
    .prepare("SELECT * FROM suggestions WHERE id = ? AND user_id = ?")
    .get(Number(req.params.id), user.id) as { status: string } | undefined;

  if (!suggestion) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }
  if (suggestion.status !== "draft") {
    res.status(403).json({ error: "Nur Entwürfe können gelöscht werden" });
    return;
  }

  db.prepare("DELETE FROM suggestions WHERE id = ?").run(Number(req.params.id));
  res.json({ ok: true });
});

suggestionsRouter.patch("/:id", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Ungültige ID" });
    return;
  }

  const { payload: patchPayload } = req.body as {
    payload?: Record<string, string>;
  };
  if (!patchPayload || typeof patchPayload !== "object") {
    res.status(400).json({ error: "payload fehlt" });
    return;
  }

  const db = getDb();
  const row = db
    .prepare(
      "SELECT id, word, action, payload, status, user_id FROM suggestions WHERE id = ?"
    )
    .get(id) as
    | {
        id: number;
        word: string;
        action: string;
        payload: string | null;
        status: string;
        user_id: number;
      }
    | undefined;

  if (!row) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }
  if (row.user_id !== user.id && !user.isModerator) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }
  if (row.status !== "draft") {
    res.status(403).json({ error: "Nur Entwürfe können bearbeitet werden" });
    return;
  }

  const moderatorFastTrack = user.isModerator ? 1 : 0;

  const existing = row.payload
    ? (JSON.parse(row.payload) as Record<string, string>)
    : {};
  const merged = { ...existing, ...patchPayload };
  if (row.action === "add") {
    const normalized = normalizeAddPayloadBase(row.word.toLowerCase(), merged);
    db.prepare(
      `UPDATE suggestions SET payload = ?, last_modified_at = datetime('now'), moderator_fast_track = ?
       WHERE id = ?`
    ).run(
      normalized === null ? null : JSON.stringify(normalized),
      moderatorFastTrack,
      id
    );
  } else {
    db.prepare(
      `UPDATE suggestions SET payload = ?, last_modified_at = datetime('now'), moderator_fast_track = ?
       WHERE id = ?`
    ).run(JSON.stringify(merged), moderatorFastTrack, id);
  }

  res.json({ ok: true });
});
