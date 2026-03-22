import type express from "express";
import { getDb } from "../lib/db.js";
import { getUserFromSession, type User } from "../lib/auth.js";

export function requireUser(
  req: express.Request,
  res: express.Response
): User | null {
  const sessionId = req.cookies?.session as string | undefined;
  if (!sessionId) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return null;
  }
  const user = getUserFromSession(getDb(), sessionId);
  if (!user) {
    res.status(401).json({ error: "Nicht angemeldet" });
    return null;
  }
  return user;
}

export function requireModerator(
  req: express.Request,
  res: express.Response
): User | null {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isModerator) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return null;
  }
  return user;
}

export function requireAdmin(
  req: express.Request,
  res: express.Response
): User | null {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return null;
  }
  return user;
}
