import type Database from "better-sqlite3";

/**
 * The moderator discussion board (`/diskussion`).
 *
 * Deliberately mirrors `word_comments`: same hide semantics, same screen-name
 * identity rule. The difference is that every post is also mailed to the other
 * moderators, and they can answer by replying to that mail — see
 * server/routes/inbound.ts.
 *
 * Read and write are moderators-only. Nothing here may be exposed on a public
 * surface (no sitemap, no /aenderungen) without revisiting that decision.
 */

export const MAX_TOPIC_TITLE_LENGTH = 150;
/** Web posts only. Inbound mail is deliberately not truncated. */
export const MAX_POST_LENGTH = 10_000;

export type PostSource = "web" | "email";

export type TopicSummary = {
  id: number;
  title: string;
  created_at: string;
  last_activity_at: string;
  pinned: number;
  locked: number;
  author_id: number;
  author_name: string | null;
  post_count: number;
  last_author_id: number | null;
  last_author_name: string | null;
};

export type PostRow = {
  id: number;
  topic_id: number;
  parent_id: number | null;
  user_id: number;
  body: string;
  source: string;
  created_at: string;
  hidden_at: string | null;
  author_name: string | null;
};

/** RFC Message-Id value (without angle brackets) for one of our posts. */
export function messageIdFor(postId: number, domain: string): string {
  return `post-${postId}@${domain}`;
}

/** `<a@b>, <c@d>` → `["a@b", "c@d"]`. Tolerates whitespace-separated lists. */
export function parseMessageIds(header: string | null | undefined): string[] {
  if (!header) return [];
  return [...header.matchAll(/<([^>]+)>/g)].map((m) => m[1].trim()).filter(Boolean);
}

/**
 * Strip reply prefixes and our own subject tag so a mail whose headers lost the
 * thread can still be matched against an existing title.
 */
export function normaliseSubject(subject: string): string {
  let s = subject.trim();
  // Repeated prefixes: "Re: AW: Re: …"
  for (;;) {
    const next = s.replace(/^\s*(re|aw|fwd|wg)\s*(\[\d+\])?\s*:\s*/i, "");
    if (next === s) break;
    s = next;
  }
  s = s.replace(/^\s*\[Spielwörter\]\s*/i, "");
  return s.trim();
}

export function createTopic(
  db: Database.Database,
  opts: {
    userId: number;
    title: string;
    body: string;
    source?: PostSource;
    rawBody?: string | null;
  }
): { topicId: number; postId: number } {
  const run = db.transaction(() => {
    const t = db
      .prepare("INSERT INTO topics (user_id, title) VALUES (?, ?)")
      .run(opts.userId, opts.title);
    const topicId = Number(t.lastInsertRowid);
    const postId = insertPost(db, {
      topicId,
      userId: opts.userId,
      body: opts.body,
      parentId: null,
      source: opts.source ?? "web",
      rawBody: opts.rawBody ?? null,
    });
    return { topicId, postId };
  });
  return run();
}

export function insertPost(
  db: Database.Database,
  opts: {
    topicId: number;
    userId: number;
    body: string;
    parentId: number | null;
    source?: PostSource;
    rawBody?: string | null;
  }
): number {
  const domain = process.env.MAILGUN_DOMAIN || "mail.spielwoerter.de";
  const res = db
    .prepare(
      `INSERT INTO topic_posts (topic_id, parent_id, user_id, body, raw_body, source)
       VALUES (?, ?, ?, ?, ?, ?)`
    )
    .run(
      opts.topicId,
      opts.parentId,
      opts.userId,
      opts.body,
      opts.rawBody ?? null,
      opts.source ?? "web"
    );
  const postId = Number(res.lastInsertRowid);
  db.prepare("UPDATE topic_posts SET message_id = ? WHERE id = ?").run(
    messageIdFor(postId, domain),
    postId
  );
  db.prepare(
    "UPDATE topics SET last_activity_at = datetime('now') WHERE id = ?"
  ).run(opts.topicId);
  return postId;
}

export type Recipient = { id: number; email: string };

/**
 * Rollout gate: when DISKUSSION_MAIL_ALLOWLIST is set, only those addresses are
 * mailed. Posts are still created and still visible to everyone — this limits
 * who is *disturbed* while the channel is being tested end to end.
 *
 * Deliberately env-driven rather than done by setting other moderators'
 * email_diskussion to 'none': that would look like their own preference and
 * make "why did nobody get mail?" a question with a buried answer.
 */
export function mailAllowlist(): string[] | null {
  const raw = process.env.DISKUSSION_MAIL_ALLOWLIST;
  if (!raw) return null;
  const list = raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return list.length > 0 ? list : null;
}

/**
 * Who gets mailed about a new post: every other moderator, filtered by their
 * `email_diskussion` preference.
 *
 * 'mine' means "only threads I'm in" — they started it or have posted in it.
 */
export function recipientsFor(
  db: Database.Database,
  topicId: number,
  authorUserId: number
): Recipient[] {
  const all = db
    .prepare(
      `SELECT u.id, u.email
         FROM users u
        WHERE u.is_moderator = 1
          AND u.id != ?
          AND u.email_diskussion != 'none'
          AND (
            u.email_diskussion = 'all'
            OR EXISTS (SELECT 1 FROM topic_posts p
                        WHERE p.topic_id = ? AND p.user_id = u.id)
            OR EXISTS (SELECT 1 FROM topics t
                        WHERE t.id = ? AND t.user_id = u.id)
          )`
    )
    .all(authorUserId, topicId, topicId) as Recipient[];

  const allow = mailAllowlist();
  if (!allow) return all;

  const kept = all.filter((r) => allow.includes(r.email.toLowerCase()));
  if (kept.length !== all.length) {
    // Loud on purpose: a forgotten rollout gate is a channel that silently
    // stops working for everyone else.
    console.log(
      `[diskussion] Mail allowlist active — ${kept.length}/${all.length} recipient(s) mailed.`
    );
  }
  return kept;
}

export function listTopics(db: Database.Database): TopicSummary[] {
  return db
    .prepare(
      `SELECT t.id, t.title, t.created_at, t.last_activity_at, t.pinned, t.locked,
              t.user_id AS author_id, au.display_name AS author_name,
              (SELECT COUNT(*) FROM topic_posts p
                WHERE p.topic_id = t.id AND p.hidden_at IS NULL) AS post_count,
              lp.user_id AS last_author_id, lu.display_name AS last_author_name
         FROM topics t
         JOIN users au ON au.id = t.user_id
         LEFT JOIN topic_posts lp
                ON lp.id = (SELECT p2.id FROM topic_posts p2
                             WHERE p2.topic_id = t.id AND p2.hidden_at IS NULL
                             ORDER BY p2.created_at DESC, p2.id DESC LIMIT 1)
         LEFT JOIN users lu ON lu.id = lp.user_id
        ORDER BY t.pinned DESC, t.last_activity_at DESC`
    )
    .all() as TopicSummary[];
}

export function getTopic(db: Database.Database, id: number) {
  return db
    .prepare(
      `SELECT t.id, t.title, t.created_at, t.last_activity_at, t.pinned, t.locked,
              t.user_id AS author_id, u.display_name AS author_name
         FROM topics t JOIN users u ON u.id = t.user_id
        WHERE t.id = ?`
    )
    .get(id) as
    | {
        id: number;
        title: string;
        created_at: string;
        last_activity_at: string;
        pinned: number;
        locked: number;
        author_id: number;
        author_name: string | null;
      }
    | undefined;
}

export function getPosts(db: Database.Database, topicId: number): PostRow[] {
  return db
    .prepare(
      `SELECT p.id, p.topic_id, p.parent_id, p.user_id, p.body, p.source,
              p.created_at, p.hidden_at, u.display_name AS author_name
         FROM topic_posts p JOIN users u ON u.id = p.user_id
        WHERE p.topic_id = ?
        ORDER BY p.created_at ASC, p.id ASC`
    )
    .all(topicId) as PostRow[];
}

/**
 * The thread is one chronological stream — no indentation, no sub-trees.
 *
 * Nesting was tried and removed: collapsing a tree to a readable depth reorders
 * the stream (a late reply to the first post jumps above an earlier top-level
 * one), and for an inbound mail `In-Reply-To` records whichever message the
 * sender happened to have open, not a deliberate structural choice. Displaying
 * that as structure states an intent the author never had.
 *
 * `parent_id` is still recorded — it is free, the inbound handler derives it
 * reliably, and it drives the backlink below.
 */
export function backlinks(posts: PostRow[]): Map<number, PostRow> {
  const byId = new Map(posts.map((p) => [p.id, p]));
  const out = new Map<number, PostRow>();
  posts.forEach((p, i) => {
    if (p.parent_id == null) return;
    // A reply to the message directly above adds nothing worth showing.
    if (i > 0 && posts[i - 1].id === p.parent_id) return;
    const parent = byId.get(p.parent_id);
    if (parent) out.set(p.id, parent);
  });
  return out;
}

/**
 * Permanently remove a topic and everything in it. Admin-only, and genuinely
 * gone — this is the escape hatch for a test thread or a mistake, not
 * moderation. Hiding a post is the reversible tool.
 */
export function deleteTopic(db: Database.Database, topicId: number): boolean {
  const exists = db.prepare("SELECT 1 FROM topics WHERE id = ?").get(topicId);
  if (!exists) return false;
  db.transaction(() => {
    // FK order: children first.
    db.prepare("DELETE FROM topic_posts WHERE topic_id = ?").run(topicId);
    db.prepare("DELETE FROM topics WHERE id = ?").run(topicId);
  })();
  return true;
}
