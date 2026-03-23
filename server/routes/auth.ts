import { Router } from "express";
import crypto from "crypto";
import rateLimit from "express-rate-limit";
import { getDb } from "../../lib/db.js";
import { sendOtpEmail } from "../mailgun.js";

export const authRouter = Router();

const requestCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Zu viele Anfragen, bitte später versuchen" },
});

const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Zu viele Anfragen, bitte später versuchen" },
});

authRouter.post("/request-code", requestCodeLimiter, async (req, res) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.warn("[auth] invalid email in request-code", { ip: req.ip, email });
    res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
    return;
  }

  const db = getDb();
  const code = String(crypto.randomInt(100000, 1000000));
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();

  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);
  db.prepare(
    "INSERT INTO otp_codes (email, code, expires_at) VALUES (?, ?, ?)"
  ).run(email, code, expiresAt);

  try {
    await sendOtpEmail(email, code);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("Mailgun error:", msg);
    res.status(500).json({
      error: process.env.NODE_ENV === "development"
        ? `Mailgun: ${msg}`
        : "E-Mail konnte nicht gesendet werden",
    });
    return;
  }

  res.json({ ok: true });
});

authRouter.post("/verify-code", verifyCodeLimiter, (req, res) => {
  const { email, code } = (req.body ?? {}) as { email?: string; code?: string };
  if (!email || !code) {
    res.status(400).json({ error: "Fehlende Felder" });
    return;
  }

  const db = getDb();
  const otpRow = db
    .prepare(
      "SELECT id FROM otp_codes WHERE email = ? AND code = ? AND expires_at > datetime('now')"
    )
    .get(email, code) as { id: number } | undefined;

  if (!otpRow) {
    console.warn("[auth] failed OTP verification", { ip: req.ip, email });
    res.status(401).json({ error: "Ungültiger oder abgelaufener Code" });
    return;
  }

  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);

  let user = db
    .prepare("SELECT id, email, is_moderator FROM users WHERE email = ?")
    .get(email) as
    | {
        id: number;
        email: string;
        is_moderator: number;
      }
    | undefined;

  if (!user) {
    db.prepare("INSERT INTO users (email) VALUES (?)").run(email);
    user = db
      .prepare("SELECT id, email, is_moderator FROM users WHERE email = ?")
      .get(email) as {
      id: number;
      email: string;
      is_moderator: number;
    };
  }

  const sessionId = crypto.randomUUID();
  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();
  db.prepare(
    "INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)"
  ).run(sessionId, user.id, expiresAt);

  res.cookie("session", sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    expires: new Date(expiresAt),
  });

  res.json({ ok: true });
});

authRouter.post("/logout", (req, res) => {
  const sessionId = req.cookies?.session as string | undefined;
  if (sessionId) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  res.clearCookie("session");
  res.json({ ok: true });
});
