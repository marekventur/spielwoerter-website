import { Router } from "express";
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
