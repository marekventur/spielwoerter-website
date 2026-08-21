import type Database from "better-sqlite3";
import { screenName } from "../lib/screen-name.js";
import { recipientsFor } from "../lib/topics.js";
import { diskussionAddress, sendTopicPostEmails } from "./mailgun.js";
import {
  renderTopicPostHtml,
  renderTopicPostText,
} from "./email-templates/topic-post.js";

type PostContext = {
  id: number;
  topic_id: number;
  parent_id: number | null;
  user_id: number;
  body: string;
  message_id: string | null;
  title: string;
  display_name: string | null;
  is_first: number;
};

function loadPost(db: Database.Database, postId: number): PostContext | undefined {
  return db
    .prepare(
      `SELECT p.id, p.topic_id, p.parent_id, p.user_id, p.body, p.message_id,
              t.title, u.display_name,
              (SELECT MIN(p2.id) FROM topic_posts p2 WHERE p2.topic_id = p.topic_id) = p.id
                AS is_first
         FROM topic_posts p
         JOIN topics t ON t.id = p.topic_id
         JOIN users u ON u.id = p.user_id
        WHERE p.id = ?`
    )
    .get(postId) as PostContext | undefined;
}

/** Root-first chain of Message-Ids from the thread root down to `parentId`. */
function referencesChain(db: Database.Database, parentId: number | null): string[] {
  const chain: string[] = [];
  const seen = new Set<number>();
  let cur = parentId;
  const stmt = db.prepare(
    "SELECT parent_id, message_id FROM topic_posts WHERE id = ?"
  );
  while (cur != null && !seen.has(cur)) {
    seen.add(cur);
    const row = stmt.get(cur) as
      | { parent_id: number | null; message_id: string | null }
      | undefined;
    if (!row) break;
    if (row.message_id) chain.unshift(row.message_id);
    cur = row.parent_id;
  }
  return chain;
}

/**
 * Mail one post to the other moderators and stamp `emailed_at`.
 *
 * Best-effort by design: a Mailgun outage must never lose someone's post, so
 * failures are logged and left unstamped for `sweepUnmailedPosts` to retry.
 */
export async function mailTopicPost(
  db: Database.Database,
  postId: number
): Promise<void> {
  const post = loadPost(db, postId);
  if (!post) return;

  const recipients = recipientsFor(db, post.topic_id, post.user_id).map((r) => r.email);
  if (recipients.length === 0) {
    // Nothing to send is a success: don't let the sweeper retry it forever.
    db.prepare("UPDATE topic_posts SET emailed_at = datetime('now') WHERE id = ?").run(postId);
    return;
  }

  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";
  const domain = process.env.MAILGUN_DOMAIN || "mail.spielwoerter.de";
  const isNewTopic = !!post.is_first;
  const data = {
    topicId: post.topic_id,
    title: post.title,
    authorName: screenName(post.display_name, post.user_id),
    body: post.body,
    isNewTopic,
  };

  const parentChain = referencesChain(db, post.parent_id);
  const headers: Record<string, string> = {
    "Message-Id": `<${post.message_id ?? `post-${post.id}@${domain}`}>`,
    "Reply-To": diskussionAddress(),
    "List-Id": `Spielwörter Diskussion <diskussion.spielwoerter.de>`,
    // Marks our own mail so the inbound handler can refuse to ingest it.
    "Auto-Submitted": "auto-generated",
  };
  if (parentChain.length > 0) {
    headers["In-Reply-To"] = `<${parentChain[parentChain.length - 1]}>`;
    headers["References"] = parentChain.map((m) => `<${m}>`).join(" ");
  }

  const { failed } = await sendTopicPostEmails(recipients, {
    subject: isNewTopic
      ? `[Spielwörter] ${post.title}`
      : `Re: [Spielwörter] ${post.title}`,
    html: renderTopicPostHtml(data, siteUrl),
    text: renderTopicPostText(data, siteUrl),
    headers,
  });

  if (failed === 0) {
    db.prepare("UPDATE topic_posts SET emailed_at = datetime('now') WHERE id = ?").run(postId);
  }
}

/** Fire-and-forget wrapper: a failing mail must not fail the HTTP request. */
export function mailTopicPostInBackground(db: Database.Database, postId: number): void {
  void mailTopicPost(db, postId).catch((err) => {
    console.error(`[diskussion] mailTopicPost(${postId}) failed:`, err);
  });
}

/**
 * Retry anything the immediate send missed. Runs on the hourly sync job, which
 * already exists — a self-healing outbox without an outbox table.
 */
export async function sweepUnmailedPosts(db: Database.Database): Promise<void> {
  const stale = db
    .prepare(
      `SELECT id FROM topic_posts
        WHERE emailed_at IS NULL
          AND created_at < datetime('now', '-5 minutes')
        ORDER BY id ASC LIMIT 50`
    )
    .all() as { id: number }[];
  if (stale.length === 0) return;
  console.log(`[diskussion] Retrying ${stale.length} unsent post(s)…`);
  for (const { id } of stale) await mailTopicPost(db, id);
}
