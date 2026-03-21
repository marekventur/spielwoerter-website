import "react-router";
import { createRequestHandler } from "@react-router/express";
import express from "express";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { getDb } from "../lib/db.js";
import { getUserFromSession, type User } from "../lib/auth.js";
import { syncPull, syncPush, type DigestUser } from "../lib/sync.js";

declare module "react-router" {
  interface AppLoadContext {
    db: ReturnType<typeof getDb>;
    user: User | null;
  }
}

export const app = express();

app.use(cookieParser());
app.use(express.json());

// ── Auth API ────────────────────────────────────────────────────────────────

app.post("/api/auth/request-code", async (req, res) => {
  const { email } = (req.body ?? {}) as { email?: string };
  if (!email || !email.includes("@")) {
    res.status(400).json({ error: "Ungültige E-Mail-Adresse" });
    return;
  }

  const db = getDb();
  const code = String(Math.floor(100000 + Math.random() * 900000));
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

app.post("/api/auth/verify-code", (req, res) => {
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
    res.status(401).json({ error: "Ungültiger oder abgelaufener Code" });
    return;
  }

  db.prepare("DELETE FROM otp_codes WHERE email = ?").run(email);

  let user = db
    .prepare(
      "SELECT id, email, is_moderator, license_approved FROM users WHERE email = ?"
    )
    .get(email) as
    | {
        id: number;
        email: string;
        is_moderator: number;
        license_approved: number;
      }
    | undefined;

  if (!user) {
    db.prepare("INSERT INTO users (email) VALUES (?)").run(email);
    user = db
      .prepare(
        "SELECT id, email, is_moderator, license_approved FROM users WHERE email = ?"
      )
      .get(email) as {
      id: number;
      email: string;
      is_moderator: number;
      license_approved: number;
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
    sameSite: "lax",
    expires: new Date(expiresAt),
  });

  res.json({ ok: true });
});

app.post("/api/auth/accept-license", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  getDb()
    .prepare("UPDATE users SET license_approved = 1 WHERE id = ?")
    .run(user.id);
  res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
  const sessionId = req.cookies?.session as string | undefined;
  if (sessionId) {
    getDb().prepare("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }
  res.clearCookie("session");
  res.json({ ok: true });
});

// ── Suggestions API ──────────────────────────────────────────────────────────

function requireUser(req: express.Request, res: express.Response) {
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

app.get("/api/suggestions", (req, res) => {
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

app.post("/api/suggestions", (req, res) => {
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
  if (!["add", "remove", "change_description"].includes(action)) {
    res.status(400).json({ error: "Ungültige Aktion" });
    return;
  }

  const db = getDb();

  // License gate
  if (!user.licenseApproved) {
    res.status(403).json({ error: "license_required" });
    return;
  }

  const wordLower = word.toLowerCase();

  const blocked = db
    .prepare("SELECT 1 FROM rejected_words WHERE word = ? AND action = ?")
    .get(wordLower, action);
  if (blocked) {
    res.status(409).json({ error: "Dieser Vorschlag wurde bereits abgelehnt." });
    return;
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

  db.prepare(
    "INSERT INTO suggestions (user_id, word, action, payload) VALUES (?, ?, ?, ?)"
  ).run(user.id, wordLower, action, payload ? JSON.stringify(payload) : null);

  res.json({ ok: true });
});

app.delete("/api/suggestions/:id", (req, res) => {
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

app.patch("/api/suggestions/:id", (req, res) => {
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
      "SELECT id, payload, status FROM suggestions WHERE id = ? AND user_id = ?"
    )
    .get(id, user.id) as
    | { id: number; payload: string | null; status: string }
    | undefined;

  if (!row) {
    res.status(404).json({ error: "Nicht gefunden" });
    return;
  }
  if (row.status !== "draft") {
    res.status(403).json({ error: "Nur Entwürfe können bearbeitet werden" });
    return;
  }

  const existing = row.payload
    ? (JSON.parse(row.payload) as Record<string, string>)
    : {};
  const merged = { ...existing, ...patchPayload };
  db.prepare(
    `UPDATE suggestions SET payload = ?, last_modified_at = datetime('now') WHERE id = ?`
  ).run(JSON.stringify(merged), id);

  res.json({ ok: true });
});

// ── Moderation API ───────────────────────────────────────────────────────────

type SuggRow = { id: number; word: string; action: string; status: string };

function requireModerator(req: express.Request, res: express.Response) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isModerator) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return null;
  }
  return user;
}

function moderateOne(
  db: ReturnType<typeof getDb>,
  id: number,
  decision: "moderator_approved" | "moderator_rejected"
): boolean {
  const suggestion = db
    .prepare("SELECT id, word, action, status FROM suggestions WHERE id = ?")
    .get(id) as SuggRow | undefined;

  if (!suggestion) return false;
  if (!["pending_review", "needs_moderator"].includes(suggestion.status))
    return false;

  db.transaction(() => {
    db.prepare("UPDATE suggestions SET status = ? WHERE id = ?").run(
      decision,
      id
    );
    if (decision === "moderator_rejected") {
      db.prepare(
        "INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, ?)"
      ).run(suggestion.word, suggestion.action);
    }
  })();

  return true;
}

app.post("/api/moderation/:id/approve", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const ok = moderateOne(getDb(), Number(req.params.id), "moderator_approved");
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "Ungültig" });
});

app.post("/api/moderation/:id/reject", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;
  const ok = moderateOne(getDb(), Number(req.params.id), "moderator_rejected");
  ok ? res.json({ ok: true }) : res.status(400).json({ error: "Ungültig" });
});

app.post("/api/moderation/batch", (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const { ids, action } = req.body as {
    ids?: number[];
    action?: "approve" | "reject";
  };
  if (!ids?.length || !action) {
    res.status(400).json({ error: "Fehlende Felder" });
    return;
  }

  const decision =
    action === "approve" ? "moderator_approved" : "moderator_rejected";
  const db = getDb();
  let count = 0;
  for (const id of ids) {
    if (moderateOne(db, id, decision)) count++;
  }
  res.json({ ok: true, count });
});

// ── Admin API ────────────────────────────────────────────────────────────────

function requireAdmin(req: express.Request, res: express.Response) {
  const user = requireUser(req, res);
  if (!user) return null;
  if (!user.isAdmin) {
    res.status(403).json({ error: "Keine Berechtigung" });
    return null;
  }
  return user;
}

app.get("/api/admin/users", (req, res) => {
  const user = requireAdmin(req, res);
  if (!user) return;

  const users = getDb()
    .prepare(
      "SELECT id, email, is_moderator, is_admin, created_at FROM users ORDER BY created_at DESC"
    )
    .all();
  res.json({ users });
});

app.post("/api/admin/users/:id/set-moderator", (req, res) => {
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

// ── Sync push API (moderator) ────────────────────────────────────────────────

app.post("/api/sync/push", async (req, res) => {
  const user = requireModerator(req, res);
  if (!user) return;

  const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
  const githubToken = process.env.GITHUB_TOKEN;
  if (!githubRepo || !githubToken) {
    res.status(500).json({ error: "SPIELWOERTER_GITHUB_REPO or GITHUB_TOKEN not set" });
    return;
  }

  try {
    const { pushed, digestUsers } = await syncPush(getDb(), githubRepo, githubToken);
    if (pushed > 0) await syncPull(getDb(), githubRepo);
    await sendDigestEmails(digestUsers);
    res.json({ ok: true, pushed });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync push] Error:", msg);
    res.status(500).json({ error: msg });
  }
});

// ── Public word API ──────────────────────────────────────────────────────────

// ── Word enrichment helpers ────────────────────────────────────────────────────

const GERMAN_SUFFIXES = ["nen", "ern", "ste", "en", "es", "em", "er", "e", "s", "n"];

function deUmlaut(s: string) {
  return s.replace(/ä/g, "a").replace(/ö/g, "o").replace(/ü/g, "u");
}

function detectAlgorithmicBase(word: string): string | null {
  const db = getDb();
  for (const suffix of GERMAN_SUFFIXES) {
    if (word.endsWith(suffix) && word.length - suffix.length >= 2) {
      const stem = word.slice(0, word.length - suffix.length);
      if (db.prepare("SELECT 1 FROM words WHERE word = ?").get(stem)) return stem;
      const plain = deUmlaut(stem);
      if (plain !== stem && db.prepare("SELECT 1 FROM words WHERE word = ?").get(plain)) return plain;
    }
  }
  return null;
}

const DEEPSEEK_SYSTEM_PROMPT = `\
Du bist ein Lexikograf für das Spielwörter.de-Projekt – eine gemeinschaftliche Scrabble-Wortliste für das Deutsche.

Deine Aufgabe: Gib für ein gegebenes deutsches Wort (immer in Kleinbuchstaben) eine Kurzbeschreibung im Hausstil zurück, sowie die Grundform (Lemma) — aber NUR wenn das Wort wirklich eine flektierte Form ist.

Antworte NUR mit einem JSON-Objekt: {"description": "...", "base": "..." oder null}

WICHTIG – zwei verschiedene Fälle:

Fall 1 – Grundform (Lemma): Infinitiv, Nominativ Singular, Positiv eines Adjektivs
→ "base": null, Beschreibung = vollständige Kurzdefinition

Fall 2 – Flektierte Form: Plural, Genitiv, Dativ, Akkusativ, konjugiertes Verb, Partizip, dekliniertes Adjektiv, Komparativ, Superlativ
→ "base": die Grundform (Kleinbuchstaben), Beschreibung = knapper grammatischer Hinweis ("Pl. von X.", "Genitiv Singular von X." usw.)

Beispiele:
- aal → {"description": "Subst., m. — schlangenförmiger Knochenfisch.", "base": null}
- aale → {"description": "Pl. von Aal.", "base": "aal"}
- aalen → {"description": "Verb — sich träge ausstrecken; (Fischfang) Aale fangen.", "base": null}
- aalend → {"description": "Partizip I von aalen.", "base": "aalen"}
- aalartig → {"description": "Adj. — einem Aal ähnlich.", "base": null}
- aalartiger → {"description": "Deklinierte Form von aalartig.", "base": "aalartig"}
- aacheners → {"description": "Genitiv Singular von Aachener (Einwohner von Aachen).", "base": "aachener"}
- aaargh → {"description": "Interjektion — Ausdruck von Schmerz, Wut oder Frustration.", "base": null}
- hunde → {"description": "Pl. von Hund.", "base": "hund"}
- hundes → {"description": "Genitiv Singular von Hund.", "base": "hund"}
- aalbude → {"description": "Subst., f. — Verkaufsstand für Aale.", "base": null}
- spielwörter → {"description": "Pl. von Spielwort (Wort, das beim Wortspiel verwendet wird).", "base": "spielwort"}

Regeln:
- Verben im Infinitiv sind Grundformen → "base": null
- "base" enthält KEIN Großbuchstabe, NUR Kleinbuchstaben
- Beschreibungen enden mit einem Punkt
- Bei unbekannten Wörtern: beste Schätzung basierend auf Wortform und -endung`;

// Algorithmic base-word detection (fast, no AI)
app.get("/api/word-base/:word", (req, res) => {
  res.json({ base: detectAlgorithmicBase(req.params.word.toLowerCase()) });
});

// Full word enrichment: DeepSeek description + base (falls back gracefully)
app.get("/api/word-enrich/:word", async (req, res) => {
  const word = req.params.word.toLowerCase();
  const algorithmicBase = detectAlgorithmicBase(word);
  const apiKey = process.env.DEEPSEEK_API_KEY_SUGGESTIONS;

  if (!apiKey) {
    res.json({ base: algorithmicBase, description: null });
    return;
  }

  try {
    const response = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "deepseek-chat",
        temperature: 0.2,
        max_tokens: 120,
        messages: [
          { role: "system", content: DEEPSEEK_SYSTEM_PROMPT },
          { role: "user", content: word },
        ],
      }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      res.json({ base: algorithmicBase, description: null });
      return;
    }

    const data = await response.json() as { choices?: { message?: { content?: string } }[] };
    const text = data.choices?.[0]?.message?.content ?? "";
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) as { description?: string; base?: string | null } : null;

    // Trust DeepSeek's base (including explicit null = it's a lemma).
    // Only fall back to the algorithm when DeepSeek failed entirely.
    const base = parsed !== null ? (parsed.base ?? null) : algorithmicBase;

    res.json({
      base: base || null,
      description: parsed?.description ?? null,
    });
  } catch {
    res.json({ base: algorithmicBase, description: null });
  }
});

app.get("/api/words/:word", (req, res) => {
  const word = req.params.word.toLowerCase();
  const row = getDb()
    .prepare(
      "SELECT word, description, base, source, verified_by, in_list FROM words WHERE word = ?"
    )
    .get(word);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

// ── Promotion job ─────────────────────────────────────────────────────────────

let promotionJobStarted = false;

function startPromotionJob() {
  if (promotionJobStarted) return;
  promotionJobStarted = true;

  const run = () => {
    const result = getDb()
      .prepare(
        `UPDATE suggestions SET status = 'pending_review'
         WHERE status = 'draft'
         AND last_modified_at <= datetime('now', '-60 minutes')`
      )
      .run();
    if (result.changes > 0) {
      console.log(`[promotion] ${result.changes} draft(s) → pending_review`);
    }
  };

  run();
  setInterval(run, 10 * 60 * 1000);
}

startPromotionJob();

// ── Hourly sync job ──────────────────────────────────────────────────────────

let syncJobStarted = false;

function startSyncJob() {
  if (syncJobStarted) return;
  syncJobStarted = true;

  const run = async () => {
    const githubRepo = process.env.SPIELWOERTER_GITHUB_REPO;
    const githubToken = process.env.GITHUB_TOKEN;
    if (!githubRepo || !githubToken) return;

    try {
      const { pushed, digestUsers } = await syncPush(getDb(), githubRepo, githubToken);
      if (pushed > 0) await syncPull(getDb(), githubRepo);
      await sendDigestEmails(digestUsers);
    } catch (err) {
      console.error("[sync job] Error:", err instanceof Error ? err.message : err);
    }
  };

  setInterval(run, 60 * 60 * 1000); // hourly
}

startSyncJob();

// ── React Router handler ────────────────────────────────────────────────────

app.use(
  createRequestHandler({
    build: () => import("virtual:react-router/server-build"),
    getLoadContext(req) {
      const sessionId = req.cookies?.session as string | undefined;
      const db = getDb();
      const user = sessionId ? getUserFromSession(db, sessionId) : null;
      return { db, user };
    },
  })
);

// ── Mailgun ──────────────────────────────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
};

async function mailgunSend(
  to: string,
  subject: string,
  form: FormData
): Promise<void> {
  const apiUrl = process.env.MAILGUN_API_URL || "https://api.mailgun.net";
  const domain = process.env.MAILGUN_DOMAIN!;
  const apiKey = process.env.MAILGUN_API_KEY!;

  const response = await fetch(`${apiUrl}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailgun ${response.status}: ${text}`);
  }
}

async function sendDigestEmails(users: DigestUser[]): Promise<void> {
  if (users.length === 0) return;

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";

  if (!apiKey || !domain) {
    for (const u of users) {
      console.log(
        `[DEV] Digest für ${u.email}: +${u.approved.length} genehmigt, -${u.rejected.length} abgelehnt`
      );
    }
    return;
  }

  const from =
    process.env.MAILGUN_FROM || `Spielwörter <noreply@${domain}>`;

  for (const u of users) {
    const approved = u.approved.map(
      (s) => `${s.word.toUpperCase()} (${ACTION_LABELS[s.action] ?? s.action})`
    );
    const rejected = u.rejected.map(
      (s) => `${s.word.toUpperCase()} (${ACTION_LABELS[s.action] ?? s.action})`
    );

    const form = new FormData();
    form.append("from", from);
    form.append("to", u.email);
    form.append("subject", "Deine Spielwörter-Updates");
    form.append("template", "digest");
    form.append(
      "t:variables",
      JSON.stringify({
        approved: approved.map((w) => ({ word: w, action: "" })),
        rejected: rejected.map((w) => ({ word: w, action: "" })),
        site_url: siteUrl,
      })
    );

    try {
      await mailgunSend(u.email, "Deine Spielwörter-Updates", form);
    } catch (err) {
      console.error(`[digest] Failed to send to ${u.email}:`, err);
    }
  }
}

async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";

  if (!apiKey || !domain) {
    console.log(`[DEV] OTP-Code für ${email}: ${code}`);
    return;
  }

  const from =
    process.env.MAILGUN_FROM || `Spielwörter <noreply@${domain}>`;
  const form = new FormData();
  form.append("from", from);
  form.append("to", email);
  form.append("subject", "Dein Spielwörter-Code");
  form.append("template", "otp");
  form.append("t:variables", JSON.stringify({ code, site_url: siteUrl }));

  await mailgunSend(email, "Dein Spielwörter-Code", form);
}
