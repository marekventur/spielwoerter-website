import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requirePartnerKey } from "../partner-auth.js";
import { enrichWord } from "../../lib/enrich.js";

export const partnerRouter = Router();

// CORS: allow cross-origin requests from any partner site that holds a valid key.
partnerRouter.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

// GET /api/partner/enrich/:word
// Returns LLM-generated base, description, and inflected variants for a word.
// Same data as the internal /api/word-enrich/:word endpoint, exposed with CORS for partner frontends.
partnerRouter.get("/enrich/:word", async (req, res) => {
  const keyLabel = requirePartnerKey(req, res);
  if (!keyLabel) return;

  const word = req.params.word.toLowerCase();
  if (!word || word.length > 100) {
    res.status(400).json({ error: "word must be 1–100 characters" });
    return;
  }

  const result = await enrichWord(word);
  res.json(result);
});

const PIPELINE_STATUSES =
  "('draft', 'pending_review', 'ai_approved', 'needs_moderator', 'moderator_approved')";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function findOrCreateUser(
  db: ReturnType<typeof getDb>,
  email: string
): { id: number; isModerator: boolean } {
  db.prepare("INSERT OR IGNORE INTO users (email) VALUES (?)").run(email);
  const row = db
    .prepare("SELECT id, is_moderator FROM users WHERE email = ?")
    .get(email) as { id: number; is_moderator: number };
  return { id: row.id, isModerator: row.is_moderator === 1 };
}

type PartnerSuggestion = {
  word?: unknown;
  action?: unknown;
  author_email?: unknown;
  supporters?: unknown;
  opposers?: unknown;
  payload?: unknown;
};

type ResultEntry = {
  word: string;
  action: string;
  status: "moderator_approved" | "pending_review" | "skipped" | "error";
  id?: number;
  reason?: string;
};

partnerRouter.post("/suggestions", (req, res) => {
  const keyLabel = requirePartnerKey(req, res);
  if (!keyLabel) return;

  const { suggestions } = req.body as { suggestions?: unknown };

  if (!Array.isArray(suggestions) || suggestions.length === 0) {
    res.status(400).json({ error: "'suggestions' must be a non-empty array" });
    return;
  }
  if (suggestions.length > 100) {
    res.status(400).json({ error: "'suggestions' array exceeds maximum of 100 items" });
    return;
  }

  const db = getDb();
  const results: ResultEntry[] = [];

  for (const raw of suggestions) {
    const item = raw as PartnerSuggestion;

    // --- Per-item validation ---
    const word = typeof item.word === "string" ? item.word.trim().toLowerCase() : null;
    const action = typeof item.action === "string" ? item.action : null;
    const authorEmail = typeof item.author_email === "string" ? item.author_email.trim() : null;
    const supporters: string[] = Array.isArray(item.supporters) ? item.supporters : [];
    const opposers: string[] = Array.isArray(item.opposers) ? item.opposers : [];
    const payload =
      item.payload && typeof item.payload === "object"
        ? (item.payload as Record<string, unknown>)
        : null;

    if (!word || word.length === 0) {
      results.push({ word: String(item.word ?? ""), action: String(action ?? ""), status: "error", reason: "word is required" });
      continue;
    }
    if (word.length > 100) {
      results.push({ word, action: String(action ?? ""), status: "error", reason: "word exceeds 100 characters" });
      continue;
    }
    if (action !== "upsert" && action !== "remove") {
      results.push({ word, action: String(action ?? ""), status: "error", reason: "action must be 'upsert' or 'remove'" });
      continue;
    }
    if (!authorEmail || !EMAIL_RE.test(authorEmail)) {
      results.push({ word, action, status: "error", reason: "author_email is required and must be a valid email" });
      continue;
    }
    if (supporters.length > 50 || opposers.length > 50) {
      results.push({ word, action, status: "error", reason: "supporters/opposers may not exceed 50 entries each" });
      continue;
    }
    if (supporters.includes(authorEmail) || opposers.includes(authorEmail)) {
      results.push({ word, action, status: "error", reason: "author_email must not appear in supporters or opposers" });
      continue;
    }
    if (supporters.some((e) => opposers.includes(e))) {
      results.push({ word, action, status: "error", reason: "an email appears in both supporters and opposers" });
      continue;
    }
    const description = typeof payload?.description === "string" ? payload.description : undefined;
    const base = typeof payload?.base === "string" ? payload.base : undefined;
    if (description && description.length > 500) {
      results.push({ word, action, status: "error", reason: "description exceeds 500 characters" });
      continue;
    }
    if (base && base.length > 100) {
      results.push({ word, action, status: "error", reason: "base exceeds 100 characters" });
      continue;
    }

    // --- Resolve internal action ---
    const wordExists = db.prepare("SELECT 1 FROM words WHERE word = ?").get(word);
    let internalAction: "add" | "remove" | "change_description";
    if (action === "remove") {
      internalAction = "remove";
    } else {
      // upsert: add if not in list, change_description if already exists
      internalAction = wordExists ? "change_description" : "add";
    }

    // For change_description, word must exist
    if (internalAction === "change_description" && !wordExists) {
      results.push({ word, action, status: "error", reason: "word not found (required for change_description)" });
      continue;
    }

    // For add/change_description, validate payload
    if (internalAction === "add" || internalAction === "change_description") {
      const descTrim = (description ?? "").trim();
      const baseTrim = (base ?? "").trim();
      if (internalAction === "change_description" && !descTrim && !baseTrim) {
        results.push({ word, action, status: "error", reason: "payload must include description or base for upsert" });
        continue;
      }
    }

    // --- Check rejected_words ---
    const blocked = db
      .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
      .get(word, internalAction);
    if (blocked) {
      results.push({ word, action, status: "skipped", reason: "blocked" });
      continue;
    }

    // --- Find or create author user ---
    const { id: userId, isModerator } = findOrCreateUser(db, authorEmail);

    // --- Check for conflicting in-flight suggestion ---
    const conflict = db
      .prepare(
        `SELECT id FROM suggestions
         WHERE word = ? AND action = ? AND status IN ${PIPELINE_STATUSES} AND user_id != ?
         LIMIT 1`
      )
      .get(word, internalAction, userId) as { id: number } | undefined;

    const netSupport = supporters.length - opposers.length;
    // Auto-approve when the community vote clears the threshold, or when the
    // author is a moderator (their own bridge submissions need no further review).
    const autoApprove = netSupport >= 2 || isModerator;

    if (conflict && !autoApprove) {
      results.push({ word, action, status: "skipped", reason: "conflict" });
      continue;
    }

    if (conflict && autoApprove) {
      // High-confidence partner submission supersedes the existing in-flight suggestion
      db.prepare("DELETE FROM suggestions WHERE id = ?").run(conflict.id);
    }

    // --- Build payload to store ---
    let payloadToStore: string | null = null;
    if (internalAction === "add" || internalAction === "change_description") {
      const p: Record<string, string> = {};
      if (description?.trim()) p.description = description.trim();
      if (base?.trim() && base.trim() !== word) p.base = base.trim().toLowerCase();
      payloadToStore = Object.keys(p).length > 0 ? JSON.stringify(p) : null;
    }

    const status = autoApprove ? "moderator_approved" : "pending_review";

    const inserted = db
      .prepare(
        `INSERT INTO suggestions
           (user_id, word, action, payload, status, moderator_fast_track,
            supporters, opposers, partner_key_label)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?, ?)`
      )
      .run(
        userId,
        word,
        internalAction,
        payloadToStore,
        status,
        supporters.length > 0 ? JSON.stringify(supporters) : null,
        opposers.length > 0 ? JSON.stringify(opposers) : null,
        keyLabel
      );

    results.push({
      word,
      action,
      status,
      id: Number(inserted.lastInsertRowid),
    });
  }

  res.json({ results });
});
