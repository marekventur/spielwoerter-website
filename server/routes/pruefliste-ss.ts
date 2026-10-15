import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireModerator } from "../http-auth.js";
import { acceptGroupSuggestion, exportSsDecisionsTsv, setSsDecision, ssEntry, SS_DECISIONS, SS_GROUPS, type SsDecision, type SsGroup } from "../../lib/pruefliste-ss.js";

/** One-off review of ASCII duplicates (abgiessen/abgießen); see lib/pruefliste-ss.ts. */
export const ssPrueflisteRouter = Router();

ssPrueflisteRouter.get("/export", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  res
    .type("text/tab-separated-values; charset=utf-8")
    .attachment("ss_pruefliste_entscheidungen.tsv")
    .send(exportSsDecisionsTsv(getDb()));
});

// Apply the group's suggested decision to all of its undecided words.
ssPrueflisteRouter.post("/gruppe/:group", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const group = String(req.params.group) as SsGroup;
  if (!SS_GROUPS.some((g) => g.id === group && g.suggest)) {
    res.status(404).json({ error: "Gruppe ohne Vorschlag" });
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
