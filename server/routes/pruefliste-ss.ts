import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireModerator } from "../http-auth.js";
import { acceptGroupSuggestion, setSsDecision, ssEntry, SS_DECISIONS, SS_GROUPS, type SsDecision, type SsGroup } from "../../lib/pruefliste-ss.js";

/** One-off review of ASCII duplicates (abgiessen/abgießen); see lib/pruefliste-ss.ts. */
export const ssPrueflisteRouter = Router();

// Mark a "keep both" group's undecided pairs as kept.
ssPrueflisteRouter.post("/gruppe/:group", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const group = String(req.params.group) as SsGroup;
  if (!SS_GROUPS.some((g) => g.id === group && g.suggest === "behalten")) {
    res.status(404).json({ error: "Gruppe ohne Behalten-Vorschlag" });
    return;
  }
  res.json({ ok: true, count: acceptGroupSuggestion(getDb(), group, user.id) });
});

// { decision: "behalten" | "streichen" | "b_streichen" | "beide" | null } — null undoes a decision.
ssPrueflisteRouter.post("/:word", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const word = String(req.params.word).toLowerCase();
  if (!ssEntry(word)) {
    res.status(404).json({ error: "Wort steht nicht auf der Liste" });
    return;
  }
  const decision = (req.body as { decision?: unknown })?.decision;
  if (decision !== null && !SS_DECISIONS.includes(decision as SsDecision)) {
    res.status(400).json({ error: "Ungültige Entscheidung" });
    return;
  }
  setSsDecision(getDb(), word, decision as SsDecision | null, user.id);
  res.json({ ok: true });
});
