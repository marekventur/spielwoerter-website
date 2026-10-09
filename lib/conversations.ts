import { randomBytes } from "node:crypto";
import type Database from "better-sqlite3";
import { createTopic, insertPost, mailAllowlist, MAX_MESSAGE_LENGTH, type Recipient } from "./topics.js";
import { screenName } from "./screen-name.js";

/**
 * Word threads ("Wortgespräche"): private threads between the moderation and
 * one user about a word, living in the same tables as the moderators' board
 * (topics.kind = 'word'). They differ from board topics in exactly these ways,
 * and every one of them is decided here:
 *
 * - Visibility: all moderators, plus the thread's participants. Board topics
 *   stay moderators-only. Anyone else gets a 404, never a 403.
 * - Opening: only moderators, always addressed to one user. At most one thread
 *   per suggestion (unique index); the button reopens it.
 * - Posting: moderators and participants. A moderator who posts becomes a
 *   participant (for mail). Users cannot add anyone.
 * - Mail: only participants other than the author: users unless they turned
 *   off "Nachrichten der Moderation" (users.email_messages), moderators unless
 *   their board setting is 'none'. Uninvolved moderators get no mail.
 * - Mail replies: each participant has a private address gespraech+<token>@,
 *   accepted only for that thread and only from that participant's own address
 *   (server/routes/inbound.ts). The board's list address never reaches a word
 *   thread.
 * - Rate limits (LIMITS) on posts and on new threads to the same person.
 */

export type Viewer = { id: number; isModerator: boolean } | null;

export const LIMITS = {
  moderator: { perHour: 30, perDay: 100 },
  user: { perHour: 5, perDay: 20 },
  /** New threads one moderator opens with the same user per day. */
  newThreadsPerRecipientPerDay: 3,
};


type TopicAccessRow = { id: number; kind: string; locked: number };

function topicRow(db: Database.Database, topicId: number): TopicAccessRow | undefined {
  return db
    .prepare("SELECT id, kind, locked FROM topics WHERE id = ?")
    .get(topicId) as TopicAccessRow | undefined;
}

export function isParticipant(db: Database.Database, topicId: number, userId: number): boolean {
  return !!db
    .prepare("SELECT 1 FROM topic_participants WHERE topic_id = ? AND user_id = ?")
    .get(topicId, userId);
}

/** The single visibility rule for every topic, board or word thread. */
export function canSeeTopic(db: Database.Database, viewer: Viewer, topicId: number): boolean {
  if (!viewer) return false;
  const t = topicRow(db, topicId);
  if (!t) return false;
  if (viewer.isModerator) return true;
  return t.kind === "word" && isParticipant(db, topicId, viewer.id);
}

export type Check = { ok: true } | { ok: false; status: number; error: string };

export function canPostTopic(db: Database.Database, viewer: Viewer, topicId: number): Check {
  if (!viewer || !canSeeTopic(db, viewer, topicId))
    return { ok: false, status: 404, error: "Thema nicht gefunden" };
  if (topicRow(db, topicId)!.locked)
    return { ok: false, status: 409, error: "Thema ist geschlossen" };
  return { ok: true };
}

export function topicKind(db: Database.Database, topicId: number): string | null {
  return topicRow(db, topicId)?.kind ?? null;
}

function newToken(): string {
  return randomBytes(18).toString("base64url").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Add someone to a word thread (idempotent); returns their reply token. */
export function ensureParticipant(db: Database.Database, topicId: number, userId: number): string {
  const existing = db
    .prepare("SELECT reply_token FROM topic_participants WHERE topic_id = ? AND user_id = ?")
    .get(topicId, userId) as { reply_token: string } | undefined;
  if (existing) return existing.reply_token;
  const token = newToken();
  db.prepare("INSERT INTO topic_participants (topic_id, user_id, reply_token) VALUES (?, ?, ?)").run(
    topicId,
    userId,
    token
  );
  return token;
}

/** Token from a reply address → the one thread and person it belongs to. */
export function participantByToken(
  db: Database.Database,
  token: string
): { topic_id: number; user_id: number } | undefined {
  if (!/^[a-z0-9]{16,}$/.test(token)) return undefined;
  return db
    .prepare(
      `SELECT p.topic_id, p.user_id FROM topic_participants p
       JOIN topics t ON t.id = p.topic_id AND t.kind = 'word'
       WHERE p.reply_token = ?`
    )
    .get(token) as { topic_id: number; user_id: number } | undefined;
}

function countSince(db: Database.Database, sql: string, ...params: unknown[]): number {
  return (db.prepare(sql).get(...params) as { n: number }).n;
}

/** Null if `sender` may post (and, with `newThreadTo`, open a thread) now. */
export function rateLimitError(
  db: Database.Database,
  sender: { id: number; isModerator: boolean },
  opts: { newThreadTo?: number } = {}
): string | null {
  const limits = sender.isModerator ? LIMITS.moderator : LIMITS.user;
  const posts = (window: string) =>
    countSince(
      db,
      `SELECT COUNT(*) AS n FROM topic_posts p JOIN topics t ON t.id = p.topic_id
       WHERE t.kind = 'word' AND p.user_id = ? AND p.created_at > datetime('now', ?)`,
      sender.id,
      window
    );
  if (posts("-1 hour") >= limits.perHour)
    return `Du hast in der letzten Stunde schon ${limits.perHour} Nachrichten geschrieben. Bitte versuch es später noch einmal.`;
  if (posts("-1 day") >= limits.perDay)
    return `Du hast heute schon ${limits.perDay} Nachrichten geschrieben. Bitte versuch es morgen noch einmal.`;
  if (opts.newThreadTo !== undefined) {
    const threads = countSince(
      db,
      `SELECT COUNT(*) AS n FROM topics t
       JOIN topic_participants p ON p.topic_id = t.id AND p.user_id = ?
       WHERE t.kind = 'word' AND t.user_id = ? AND t.created_at > datetime('now', '-1 day')`,
      opts.newThreadTo,
      sender.id
    );
    if (threads >= LIMITS.newThreadsPerRecipientPerDay)
      return `Du hast heute schon ${LIMITS.newThreadsPerRecipientPerDay} Gespräche mit dieser Person begonnen.`;
  }
  return null;
}

export function validateMessage(raw: unknown): { body: string } | { error: string } {
  const body = typeof raw === "string" ? raw.trim() : "";
  if (!body) return { error: "Nachricht darf nicht leer sein" };
  if (body.length > MAX_MESSAGE_LENGTH)
    return { error: `Nachricht darf höchstens ${MAX_MESSAGE_LENGTH} Zeichen haben` };
  return { body };
}

const ACTION_LABEL: Record<string, string> = {
  add: "Neuaufnahme",
  remove: "Löschung",
  change_description: "Beschreibung",
};

export type OpenResult =
  | { ok: true; topicId: number; postId: number; created: boolean }
  | { ok: false; status: number; error: string };

/**
 * A moderator starts (or, for a suggestion that already has one, continues) a
 * word thread with one user. Either `suggestionId` or `word` + `recipientId`.
 */
export function openWordThread(
  db: Database.Database,
  moderator: { id: number; isModerator: boolean },
  opts: { suggestionId?: number; word?: string; recipientId?: number; body: string }
): OpenResult {
  if (!moderator.isModerator) return { ok: false, status: 403, error: "Keine Berechtigung" };

  let word: string;
  let recipientId: number;
  let title: string;
  if (opts.suggestionId !== undefined) {
    const s = db
      .prepare("SELECT id, word, action, user_id FROM suggestions WHERE id = ?")
      .get(opts.suggestionId) as
      | { id: number; word: string; action: string; user_id: number }
      | undefined;
    if (!s) return { ok: false, status: 404, error: "Vorschlag nicht gefunden" };
    word = s.word;
    recipientId = s.user_id;
    title = `${s.word.toUpperCase()}: ${ACTION_LABEL[s.action] ?? s.action}`;

    const existing = db
      .prepare("SELECT id FROM topics WHERE suggestion_id = ?")
      .get(s.id) as { id: number } | undefined;
    if (existing) {
      const check = canPostTopic(db, moderator, existing.id);
      if (!check.ok) return check;
      const limited = rateLimitError(db, moderator);
      if (limited) return { ok: false, status: 429, error: limited };
      ensureParticipant(db, existing.id, moderator.id);
      const postId = insertPost(db, { topicId: existing.id, userId: moderator.id, body: opts.body, parentId: null });
      return { ok: true, topicId: existing.id, postId, created: false };
    }
  } else {
    if (!opts.word || opts.recipientId === undefined)
      return { ok: false, status: 400, error: "Wort oder Empfänger fehlt" };
    const r = db
      .prepare("SELECT id, display_name FROM users WHERE id = ?")
      .get(opts.recipientId) as { id: number; display_name: string | null } | undefined;
    if (!r) return { ok: false, status: 404, error: "Nicht gefunden" };
    word = opts.word;
    recipientId = r.id;
    title = `${word.toUpperCase()}: Gespräch mit ${screenName(r.display_name, r.id)}`;
  }

  if (recipientId === moderator.id)
    return { ok: false, status: 400, error: "Du kannst dir nicht selbst schreiben" };
  const limited = rateLimitError(db, moderator, { newThreadTo: recipientId });
  if (limited) return { ok: false, status: 429, error: limited };

  const result = db.transaction(() => {
    const { topicId, postId } = createTopic(db, { userId: moderator.id, title, body: opts.body });
    db.prepare("UPDATE topics SET kind = 'word', word = ?, suggestion_id = ? WHERE id = ?").run(
      word,
      opts.suggestionId ?? null,
      topicId
    );
    ensureParticipant(db, topicId, moderator.id);
    ensureParticipant(db, topicId, recipientId);
    return { topicId, postId };
  })();
  return { ok: true, ...result, created: true };
}

/** A post in a word thread by a moderator or participant (web or mail). */
export function postToWordThread(
  db: Database.Database,
  author: { id: number; isModerator: boolean },
  topicId: number,
  body: string,
  opts: { parentId?: number | null; source?: "web" | "email"; rawBody?: string | null } = {}
): { ok: true; postId: number } | { ok: false; status: number; error: string } {
  if (topicKind(db, topicId) !== "word") return { ok: false, status: 404, error: "Thema nicht gefunden" };
  const check = canPostTopic(db, author, topicId);
  if (!check.ok) return check;
  const limited = rateLimitError(db, author);
  if (limited) return { ok: false, status: 429, error: limited };
  ensureParticipant(db, topicId, author.id);
  const postId = insertPost(db, {
    topicId,
    userId: author.id,
    body,
    parentId: opts.parentId ?? null,
    source: opts.source ?? "web",
    rawBody: opts.rawBody ?? null,
  });
  return { ok: true, postId };
}

export type WordRecipient = Recipient & { reply_token: string };

/** Who gets mail about a new word-thread post. See the module comment. */
export function wordThreadRecipients(
  db: Database.Database,
  topicId: number,
  authorId: number
): WordRecipient[] {
  const all = db
    .prepare(
      `SELECT u.id, u.email, p.reply_token
         FROM topic_participants p JOIN users u ON u.id = p.user_id
        WHERE p.topic_id = ? AND u.id != ?
          AND CASE WHEN u.is_moderator = 1 THEN u.email_diskussion != 'none'
                   ELSE u.email_messages = 1 END`
    )
    .all(topicId, authorId) as WordRecipient[];
  const allow = mailAllowlist();
  return allow ? all.filter((r) => allow.includes(r.email.toLowerCase())) : all;
}

export type ParticipantView = { id: number; name: string; isModerator: boolean };

/** Display only: screen names, never addresses or tokens. */
export function threadParticipants(db: Database.Database, topicId: number): ParticipantView[] {
  const rows = db
    .prepare(
      `SELECT u.id, u.display_name, u.is_moderator FROM topic_participants p
       JOIN users u ON u.id = p.user_id WHERE p.topic_id = ? ORDER BY p.created_at, u.id`
    )
    .all(topicId) as { id: number; display_name: string | null; is_moderator: number }[];
  return rows.map((r) => ({ id: r.id, name: screenName(r.display_name, r.id), isModerator: !!r.is_moderator }));
}

export type WordThreadSummary = {
  id: number;
  title: string;
  word: string;
  last_activity_at: string;
  locked: number;
  post_count: number;
};

/**
 * Word threads `viewer` may see, optionally for one word. `mine` limits a
 * moderator to threads they take part in (users only ever see those).
 */
export function listWordThreads(
  db: Database.Database,
  viewer: Viewer,
  opts: { word?: string; mine?: boolean } = {}
): WordThreadSummary[] {
  if (!viewer) return [];
  const where = ["t.kind = 'word'"];
  const params: unknown[] = [];
  if (!viewer.isModerator || opts.mine) {
    where.push("EXISTS (SELECT 1 FROM topic_participants p WHERE p.topic_id = t.id AND p.user_id = ?)");
    params.push(viewer.id);
  }
  if (opts.word) {
    where.push("t.word = ?");
    params.push(opts.word);
  }
  return db
    .prepare(
      `SELECT t.id, t.title, t.word, t.last_activity_at, t.locked,
              (SELECT COUNT(*) FROM topic_posts p WHERE p.topic_id = t.id AND p.hidden_at IS NULL) AS post_count
         FROM topics t WHERE ${where.join(" AND ")}
        ORDER BY t.last_activity_at DESC`
    )
    .all(...params) as WordThreadSummary[];
}
