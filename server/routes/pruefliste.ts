import { Router } from "express";
import { getDb } from "../../lib/db.js";
import { requireModerator } from "../http-auth.js";
import { exportDecisionsTsv, isReviewWord } from "../../lib/pruefliste.js";

/** One-off review of dictionary-only base words; see lib/pruefliste.ts. */
export const prueflisteRouter = Router();

prueflisteRouter.get("/export", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  res
    .type("text/tab-separated-values; charset=utf-8")
    .attachment("pruefliste_entscheidungen.tsv")
    .send(exportDecisionsTsv(getDb()));
});

// { decision: "behalten" | "streichen" | null } — null undoes a decision.
prueflisteRouter.post("/:word", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const word = String(req.params.word).toLowerCase();
  if (!isReviewWord(word)) {
    res.status(404).json({ error: "Wort steht nicht auf der Prüfliste" });
    return;
  }
  const decision = (req.body as { decision?: unknown })?.decision;
  const db = getDb();
  if (decision === null) {
    db.prepare("DELETE FROM review_decisions WHERE word = ?").run(word);
  } else if (decision === "behalten" || decision === "streichen") {
    db.prepare(
      `INSERT INTO review_decisions (word, decision, user_id) VALUES (?, ?, ?)
       ON CONFLICT(word) DO UPDATE SET decision = excluded.decision,
         user_id = excluded.user_id, decided_at = datetime('now')`
    ).run(word, decision, user.id);
  } else {
    res.status(400).json({ error: "Ungültige Entscheidung" });
    return;
  }
  res.json({ ok: true });
});
