import express, { Router } from "express";
import rateLimit from "express-rate-limit";
import { getDb } from "../../lib/db.js";
import {
  createTopic,
  insertPost,
  normaliseSubject,
  parseMessageIds,
} from "../../lib/topics.js";
import { diskussionAddress } from "../mailgun.js";
import { mailTopicPostInBackground } from "../topic-mail.js";

/**
 * Inbound mail from Mailgun: replies to the moderator discussion list become
 * posts on /diskussion.
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

inboundRouter.post(
  "/:secret/diskussion",
  inboundLimit,
  ...parsers,
  async (req, res) => {
    const expected = process.env.INBOUND_SECRET;
    if (!expected || req.params.secret !== expected) {
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

async function handleInbound(req: express.Request): Promise<void> {
  let fields = fieldsFrom(req);
  if (fields["message-url"] && !fields["body-plain"] && !fields["stripped-text"]) {
    const stored = await fetchStoredMessage(fields["message-url"]);
    if (stored) fields = { ...fields, ...stored };
  }

  const header = headerLookup(fields);
  const from = fields["from"] ?? fields["sender"] ?? header("From") ?? "";
  const sender = extractAddress(from);

  // ── Loop prevention ──────────────────────────────────────────────────────
  // Our own notification mail must never come back in as a post.
  if (sender === diskussionAddress().toLowerCase()) {
    console.warn("[inbound] Dropped: mail from our own list address");
    return;
  }
  const autoSubmitted = header("Auto-Submitted");
  if (autoSubmitted && autoSubmitted.toLowerCase() !== "no") {
    console.warn(`[inbound] Dropped: Auto-Submitted: ${autoSubmitted}`);
    return;
  }
  if ((header("List-Id") ?? "").toLowerCase().includes("spielwoerter")) {
    console.warn("[inbound] Dropped: carries our own List-Id");
    return;
  }

  // ── Spam ─────────────────────────────────────────────────────────────────
  // The domain runs spam_action=tag, so Mailgun flags rather than blocks.
  if ((header("X-Mailgun-Sflag") ?? "").toLowerCase() === "yes") {
    console.warn(`[inbound] Dropped: flagged as spam (${sender})`);
    return;
  }

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
  const findByMessageId = db.prepare(
    "SELECT id, topic_id FROM topic_posts WHERE message_id = ?"
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
        "SELECT id FROM topics WHERE lower(title) = lower(?) ORDER BY last_activity_at DESC LIMIT 1"
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
