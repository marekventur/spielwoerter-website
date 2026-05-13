import { Router } from "express";
import { randomBytes } from "crypto";
import { getDb } from "../../lib/db.js";
import { requireAdmin } from "../http-auth.js";

export const adminRouter = Router();

adminRouter.get("/users", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const users = getDb()
    .prepare(
      "SELECT id, email, is_moderator, is_admin, created_at FROM users ORDER BY created_at DESC"
    )
    .all();
  res.json({ users });
});

adminRouter.post("/users/:id/set-moderator", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const { value } = req.body as { value?: boolean };
  if (value === undefined) {
    res.status(400).json({ error: "Missing value" });
    return;
  }
  getDb()
    .prepare("UPDATE users SET is_moderator = ? WHERE id = ?")
    .run(value ? 1 : 0, Number(req.params.id));
  res.json({ ok: true });
});

adminRouter.get("/mcp-tokens", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const tokens = getDb()
    .prepare(
      `SELECT id, token, label, created_at FROM mcp_tokens
       WHERE user_id = ? ORDER BY created_at DESC`
    )
    .all(user.id);
  res.json({ tokens });
});

adminRouter.post("/mcp-tokens", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const { label } = req.body as { label?: string };
  if (!label?.trim()) {
    res.status(400).json({ error: "Label is required" });
    return;
  }

  const token = randomBytes(32).toString("hex");
  const result = getDb()
    .prepare(
      "INSERT INTO mcp_tokens (user_id, token, label) VALUES (?, ?, ?)"
    )
    .run(user.id, token, label.trim());

  res.json({ id: result.lastInsertRowid, token, label: label.trim() });
});

adminRouter.delete("/mcp-tokens/:id", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  getDb()
    .prepare("DELETE FROM mcp_tokens WHERE id = ? AND user_id = ?")
    .run(Number(req.params.id), user.id);
  res.json({ ok: true });
});
