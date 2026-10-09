import express, { Router } from "express";
import { timingSafeEqual } from "node:crypto";
import rateLimit from "express-rate-limit";
import { getDb } from "../../lib/db.js";
import {
  createTopic,
  insertPost,
  normaliseSubject,
  parseMessageIds,
} from "../../lib/topics.js";
import { participantByToken, postToWordThread } from "../../lib/conversations.js";
import { diskussionAddress, tokenFromReplyAddress } from "../mailgun.js";
import { mailTopicPostInBackground } from "../topic-mail.js";

/**
 * Inbound mail from Mailgun: replies to the moderator discussion list become
 * posts on /diskussion (/:secret/diskussion), and replies to a word thread's
 * private address gespraech+<token>@ become posts in that thread
 * (/:secret/gespraech). The two paths never cross: the list address only ever
 * reaches board topics, a token only its own word thread.
 *
 * This endpoint is public and unauthenticated in the browser sense, so it has
 * three independent gates:
 *
 *  1. A secret in the URL path (INBOUND_SECRET) that only Mailgun's route
 *     knows. Without it the endpoint 404s — it does not even admit to existing.
 *  2. The From: address must belong to a moderator. From: is trivially
 *     spoofable, so this is an allowlist, not authentication.
 *  3. Loop and spam guards, below.
 *
 * Attachments are deliberately ignored in v1; the notification mail says so.
 */

export const inboundRouter = Router();

const inboundLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

/** Mailgun posts urlencoded for stored messages, multipart when forwarding. */
const parsers = [
  express.urlencoded({ extended: true, limit: "10mb" }),
  express.text({ type: "multipart/*", limit: "25mb" }),
];

type Fields = Record<string, string>;

/**
 * Minimal multipart field extractor. Only text fields are read; file parts are
 * skipped, which is exactly the v1 attachment policy. Not a general parser —
 * it exists so a forwarded message is not silently dropped.
 */
function parseMultipartFields(body: string, contentType: string): Fields {
  const match = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
  if (!match) return {};
  const boundary = (match[1] ?? match[2]).trim();
  const fields: Fields = {};
  for (const part of body.split(`--${boundary}`)) {
    const split = part.indexOf("\r\n\r\n");
    if (split === -1) continue;
    const rawHeaders = part.slice(0, split);
    const name = /name="([^"]+)"/i.exec(rawHeaders)?.[1];
    if (!name) continue;
    if (/filename="/i.test(rawHeaders)) continue; // attachment — ignored
    fields[name] = part.slice(split + 4).replace(/\r\n$/, "");
  }
  return fields;
}

function fieldsFrom(req: express.Request): Fields {
  if (typeof req.body === "string") {
    return parseMultipartFields(req.body, req.get("content-type") ?? "");
  }
  const out: Fields = {};
  for (const [k, v] of Object.entries((req.body ?? {}) as Record<string, unknown>)) {
    if (typeof v === "string") out[k] = v;
  }
  return out;
}

/** `message-headers` is a JSON array of [name, value] pairs. */
function headerLookup(fields: Fields): (name: string) => string | null {
  let pairs: [string, string][] = [];
  try {
    const parsed: unknown = JSON.parse(fields["message-headers"] ?? "[]");
    if (Array.isArray(parsed)) pairs = parsed as [string, string][];
  } catch {
    pairs = [];
  }
  return (name: string) => {
    const hit = pairs.find(
      (p) => Array.isArray(p) && String(p[0]).toLowerCase() === name.toLowerCase()
    );
    if (hit) return String(hit[1]);
    return fields[name] ?? fields[name.toLowerCase()] ?? null;
  };
}

function extractAddress(from: string): string {
  const angled = /<([^>]+)>/.exec(from);
  return (angled ? angled[1] : from).trim().toLowerCase();
}

/**
 * Fetch a message Mailgun stored for us. Keeps the endpoint off the multipart
 * path and gives us Mailgun's parsed `stripped-text` for free.
 */
async function fetchStoredMessage(url: string): Promise<Fields | null> {
  const apiKey = process.env.MAILGUN_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch(url, {
      headers: {
        Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      console.error(`[inbound] Stored message fetch failed: ${res.status}`);
      return null;
    }
    const json = (await res.json()) as Record<string, unknown>;
    const out: Fields = {};
    for (const [k, v] of Object.entries(json)) {
      if (typeof v === "string") out[k] = v;
      else if (k === "message-headers") out[k] = JSON.stringify(v);
    }
    return out;
  } catch (err) {
    console.error("[inbound] Stored message fetch error:", err);
    return null;
  }
}

/**
 * INBOUND_SECRET may list several comma-separated secrets, so a rotation can
 * accept the old and the new one until the Mailgun routes point at the new URL.
 */
function secretMatches(given: string | string[]): boolean {
  if (typeof given !== "string") return false;
  const secrets = (process.env.INBOUND_SECRET ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  const a = Buffer.from(given);
  return secrets.some((s) => {
    const b = Buffer.from(s);
    return a.length === b.length && timingSafeEqual(a, b);
  });
}

inboundRouter.post(
  "/:secret/diskussion",
  inboundLimit,
  ...parsers,
  async (req, res) => {
    if (!secretMatches(req.params.secret)) {
      // Do not confirm the endpoint exists.
      res.status(404).json({ error: "Not found" });
      return;
    }

    // Always 200 past this point: a non-2xx makes Mailgun retry for hours, and
    // every rejection below is permanent, not transient.
    try {
      await handleInbound(req);
    } catch (err) {
      console.error("[inbound] Handler error:", err);
    }
    res.json({ ok: true });
  }
);

inboundRouter.post(
  "/:secret/gespraech",
  inboundLimit,
  ...parsers,
  async (req, res) => {
    if (!secretMatches(req.params.secret)) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    try {
      await handleWordThreadInbound(req);
    } catch (err) {
      console.error("[inbound] Word-thread handler error:", err);
    }
    res.json({ ok: true });
  }
);

type Inbound = { fields: Fields; header: (name: string) => string | null; sender: string };

async function readInbound(req: express.Request): Promise<Inbound> {
  let fields = fieldsFrom(req);
  if (fields["message-url"] && !fields["body-plain"] && !fields["stripped-text"]) {
    const stored = await fetchStoredMessage(fields["message-url"]);
    if (stored) fields = { ...fields, ...stored };
  }
  const header = headerLookup(fields);
  const from = fields["from"] ?? fields["sender"] ?? header("From") ?? "";
  return { fields, header, sender: extractAddress(from) };
}

/** Loop and spam guards shared by both paths. Returns why to drop, or null. */
function dropReason({ header, sender }: Inbound): string | null {
  // Our own notification mail must never come back in as a post.
  const domain = (process.env.MAILGUN_DOMAIN || "mail.spielwoerter.de").toLowerCase();
  if (sender === diskussionAddress().toLowerCase()) return "mail from our own list address";
  if (sender === `noreply@${domain}`) return "mail from our own no-reply address";
  const autoSubmitted = header("Auto-Submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  if ((header("List-Id") ?? "").toLowerCase().includes("spielwoerter")) return "carries our own List-Id";
  // The domain runs spam_action=tag, so Mailgun flags rather than blocks.
  if ((header("X-Mailgun-Sflag") ?? "").toLowerCase() === "yes") return `flagged as spam (${sender})`;
  return null;
}

/**
 * A reply to gespraech+<token>@. Accepted only if the token belongs to a word
 * thread AND the mail comes from that participant's own address. From: alone
 * is spoofable and the token alone could leak with a forwarded mail; together
 * they mean "this person, about this thread". No subject fallback, no new
 * threads: anything that does not match exactly is dropped.
 */
async function handleWordThreadInbound(req: express.Request): Promise<void> {
  const inbound = await readInbound(req);
  const { fields, header, sender } = inbound;
  const reason = dropReason(inbound);
  if (reason) return void console.warn(`[inbound] Word thread: dropped, ${reason}`);

  const recipients = (fields["recipient"] ?? header("To") ?? "").split(",").map(extractAddress);
  const token = recipients.map(tokenFromReplyAddress).find((t) => t !== null);
  const db = getDb();
  const participant = token ? participantByToken(db, token) : undefined;
  if (!participant) return void console.warn("[inbound] Word thread: dropped, unknown token");

  const user = db
    .prepare("SELECT id, email, is_moderator FROM users WHERE id = ?")
    .get(participant.user_id) as { id: number; email: string; is_moderator: number } | undefined;
  if (!user || user.email.toLowerCase() !== sender) {
    // No bounce: never confirm what a token belongs to.
    return void console.warn(`[inbound] Word thread: dropped, sender does not own the token (${sender})`);
  }

  const rawBody = fields["body-plain"] ?? "";
  const body = (fields["stripped-text"] ?? rawBody).trim();
  if (!body) return void console.warn(`[inbound] Word thread: dropped, empty body from ${sender}`);

  // Parent only within the same thread; a foreign Message-Id is ignored.
  let parentId: number | null = null;
  const findInTopic = db.prepare("SELECT id FROM topic_posts WHERE message_id = ? AND topic_id = ?");
  for (const mid of [
    ...parseMessageIds(header("In-Reply-To")),
    ...parseMessageIds(header("References")).reverse(),
  ]) {
    const hit = findInTopic.get(mid, participant.topic_id) as { id: number } | undefined;
    if (hit) {
      parentId = hit.id;
      break;
    }
  }

  const result = postToWordThread(
    db,
    { id: user.id, isModerator: !!user.is_moderator },
    participant.topic_id,
    body,
    { parentId, source: "email", rawBody }
  );
  if (!result.ok) {
    return void console.warn(`[inbound] Word thread ${participant.topic_id}: dropped, ${result.error}`);
  }
  console.log(`[inbound] Post ${result.postId} added to word thread ${participant.topic_id} by user ${user.id}`);
  mailTopicPostInBackground(db, result.postId);
}

async function handleInbound(req: express.Request): Promise<void> {
  const inbound = await readInbound(req);
  const { fields, header, sender } = inbound;
  const reason = dropReason(inbound);
  if (reason) return void console.warn(`[inbound] Dropped: ${reason}`);

  // ── Sender must be a moderator ───────────────────────────────────────────
  const db = getDb();
  const user = db
    .prepare(
      "SELECT id, is_moderator FROM users WHERE lower(email) = ? COLLATE NOCASE"
    )
    .get(sender) as { id: number; is_moderator: number } | undefined;
  if (!user || !user.is_moderator) {
    // No bounce, no error: never confirm whether an address is a moderator.
    console.warn(`[inbound] Dropped: sender is not a moderator (${sender})`);
    return;
  }

  const rawBody = fields["body-plain"] ?? "";
  const body = (fields["stripped-text"] ?? rawBody).trim();
  if (!body) {
    console.warn(`[inbound] Dropped: empty body from ${sender}`);
    return;
  }

  const subject = fields["subject"] ?? header("Subject") ?? "(ohne Betreff)";

  // ── Where does it belong? ────────────────────────────────────────────────
  const candidates = [
    ...parseMessageIds(header("In-Reply-To")),
    ...parseMessageIds(header("References")).reverse(),
  ];
  // Board topics only: a word thread (visible to a user) must never be
  // reachable through the list address, whatever the headers say.
  const findByMessageId = db.prepare(
    `SELECT p.id, p.topic_id FROM topic_posts p
     JOIN topics t ON t.id = p.topic_id AND t.kind = 'moderation'
     WHERE p.message_id = ?`
  );
  let parentId: number | null = null;
  let topicId: number | null = null;
  for (const mid of candidates) {
    const hit = findByMessageId.get(mid) as
      | { id: number; topic_id: number }
      | undefined;
    if (hit) {
      parentId = hit.id;
      topicId = hit.topic_id;
      break;
    }
  }

  // Header threading lost: fall back to the subject line.
  if (topicId == null) {
    const title = normaliseSubject(subject);
    const bySubject = db
      .prepare(
        "SELECT id FROM topics WHERE kind = 'moderation' AND lower(title) = lower(?) ORDER BY last_activity_at DESC LIMIT 1"
      )
      .get(title) as { id: number } | undefined;
    if (bySubject) topicId = bySubject.id;
  }

  if (topicId != null) {
    const topic = db
      .prepare("SELECT id, locked FROM topics WHERE id = ?")
      .get(topicId) as { id: number; locked: number } | undefined;
    if (!topic) return;
    if (topic.locked) {
      console.warn(`[inbound] Dropped: topic ${topicId} is locked`);
      return;
    }
    const postId = insertPost(db, {
      topicId,
      userId: user.id,
      body,
      parentId,
      source: "email",
      rawBody,
    });
    console.log(`[inbound] Post ${postId} added to topic ${topicId} by ${sender}`);
    mailTopicPostInBackground(db, postId);
    return;
  }

  // Nothing matched: this is someone starting a thread by writing to the list.
  const title = normaliseSubject(subject) || "(ohne Betreff)";
  const { topicId: newTopicId, postId } = createTopic(db, {
    userId: user.id,
    title,
    body,
    source: "email",
    rawBody,
  });
  console.log(`[inbound] New topic ${newTopicId} started by ${sender}`);
  mailTopicPostInBackground(db, postId);
}
