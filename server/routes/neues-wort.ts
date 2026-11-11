import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireModerator } from "../http-auth.js";
import { classifyLlmVariant } from "../../lib/enrich.js";
import { prefill } from "../../lib/neues-wort.js";

/** Moderators' structured entry of new words (/neues-wort). Trial mode: nothing is written. */
export const neuesWortRouter = Router();

const WORD = /^[a-zäöüß]{2,40}$/;

// { word } → AI suggestion for word class and key forms, plus the word's current state.
neuesWortRouter.post("/vorschlag", async (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const word = String((req.body as { word?: unknown })?.word ?? "").trim().toLowerCase();
  if (!WORD.test(word)) {
    res.status(400).json({ error: "Bitte ein Wort aus Buchstaben eingeben." });
    return;
  }
  const existing = getDb()
    .prepare("SELECT in_list, description, base FROM words WHERE word = ?")
    .get(word) as { in_list: string; description: string | null; base: string | null } | undefined;
  res.json({ word, existing: existing ?? null, prefill: await prefill(word) });
});

// { words: [...] } → { [word]: "actionable" | "in_list" | "rejected" | "in_review" }
neuesWortRouter.post("/status", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const words = (req.body as { words?: unknown })?.words;
  if (!Array.isArray(words) || words.length > 300) {
    res.status(400).json({ error: "Ungültige Wortliste" });
    return;
  }
  const db = getDb();
  const out: Record<string, string> = {};
  for (const w of words) if (typeof w === "string" && WORD.test(w)) out[w] = classifyLlmVariant(db, w);
  res.json(out);
});
