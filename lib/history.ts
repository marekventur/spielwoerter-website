import type Database from "better-sqlite3";
import { screenName } from "./screen-name.js";
import { FAST_TRACK_REMOVE_HOURS } from "./promotion.js";

/**
 * The public "Änderungshistorie": one item per suggestion (submission +
 * decision collapsed) plus free-text comments, newest first. Identities are
 * screen names only — emails are never part of history items, for any viewer.
 * `forModerator` only reveals hidden comments.
 */
export type HistoryActor = {
  name: string;
  isModerator: boolean;
};

export type HistoryItem = {
  kind: "suggestion" | "comment";
  id: number;
  word: string;
  /** Sort key: latest activity (decision, else submission / comment time). */
  at: string;
  /** suggestion items */
  action: string | null;
  status: string | null;
  submitter: HistoryActor | null;
  decider: HistoryActor | null;
  /** Decision without decided_by = auto-approved after the fast-track delay. */
  autoDecided: boolean;
  decidedAt: string | null;
  decisionComment: string | null;
  syncedAt: string | null;
  /** Fast-track removal still waiting: when it will auto-publish. */
  publishAt: string | null;
  /** comment items */
  body: string | null;
  hidden: boolean;
};

type SuggestionRow = {
  id: number;
  word: string;
  action: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  synced_at: string | null;
  moderation_comment: string | null;
  publish_at: string | null;
  u_id: number;
  u_name: string | null;
  u_mod: number;
  d_id: number | null;
  d_name: string | null;
  d_mod: number | null;
};

type CommentRow = {
  id: number;
  word: string;
  body: string;
  created_at: string;
  hidden_at: string | null;
  u_id: number;
  u_name: string | null;
  u_mod: number;
};

function actor(id: number, name: string | null, isMod: number | null): HistoryActor {
  return { name: screenName(name, id), isModerator: !!isMod };
}

function suggestionItem(r: SuggestionRow): HistoryItem {
  const decided = r.status === "moderator_approved" || r.status === "moderator_rejected";
  return {
    kind: "suggestion",
    id: r.id,
    word: r.word,
    at: (decided ? r.decided_at : null) ?? r.created_at,
    action: r.action,
    status: r.status,
    submitter: actor(r.u_id, r.u_name, r.u_mod),
    decider: decided && r.d_id !== null ? actor(r.d_id, r.d_name, r.d_mod) : null,
    autoDecided: decided && r.d_id === null,
    decidedAt: decided ? r.decided_at : null,
    decisionComment: r.moderation_comment,
    syncedAt: r.synced_at,
    publishAt: r.publish_at,
    body: null,
    hidden: false,
  };
}

function commentItem(r: CommentRow): HistoryItem {
  return {
    kind: "comment",
    id: r.id,
    word: r.word,
    at: r.created_at,
    action: null,
    status: null,
    submitter: actor(r.u_id, r.u_name, r.u_mod),
    decider: null,
    autoDecided: false,
    decidedAt: null,
    decisionComment: null,
    syncedAt: null,
    publishAt: null,
    body: r.body,
    hidden: r.hidden_at !== null,
  };
}

// Visible to the public: decided suggestions, suggestions in review, and
// fast-track removals waiting out their delay. Other drafts stay private.
const VISIBLE_SUGGESTIONS = `(
  s.status IN ('pending_review', 'ai_approved', 'needs_moderator', 'moderator_approved', 'moderator_rejected')
  OR (s.status = 'draft' AND s.moderator_fast_track = 1 AND s.action = 'remove')
)`;

const SUGGESTION_SELECT = `
  SELECT s.id, s.word, s.action, s.status, s.created_at, s.decided_at, s.synced_at,
         s.moderation_comment,
         CASE WHEN s.status = 'draft' AND s.moderator_fast_track = 1 AND s.action = 'remove'
              THEN datetime(s.last_modified_at, '+${FAST_TRACK_REMOVE_HOURS} hours') END AS publish_at,
         u.id AS u_id, u.display_name AS u_name, u.is_moderator AS u_mod,
         d.id AS d_id, d.display_name AS d_name, d.is_moderator AS d_mod
  FROM suggestions s
  JOIN users u ON u.id = s.user_id
  LEFT JOIN users d ON d.id = s.decided_by`;

const COMMENT_SELECT = `
  SELECT c.id, c.word, c.body, c.created_at, c.hidden_at,
         u.id AS u_id, u.display_name AS u_name, u.is_moderator AS u_mod
  FROM word_comments c
  JOIN users u ON u.id = c.user_id`;

export function wordHistory(
  db: Database.Database,
  wordLower: string,
  opts: { forModerator: boolean }
): HistoryItem[] {
  const suggestions = db
    .prepare(`${SUGGESTION_SELECT} WHERE s.word = ? AND ${VISIBLE_SUGGESTIONS}`)
    .all(wordLower) as SuggestionRow[];
  const comments = db
    .prepare(
      `${COMMENT_SELECT} WHERE c.word = ?${opts.forModerator ? "" : " AND c.hidden_at IS NULL"}`
    )
    .all(wordLower) as CommentRow[];

  const items = [
    ...suggestions.map((r) => suggestionItem(r)),
    ...comments.map((r) => commentItem(r)),
  ];
  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
  return items;
}

export type ChangelogFilter = {
  /** "add" | "remove" | "change_description" | "comment" */
  kind?: string;
  /** "approved" | "rejected" | "scheduled" | "pending" */
  status?: string;
  /** Exact word (lowercased). */
  word?: string;
};

const STATUS_SQL: Record<string, string> = {
  approved: "s.status = 'moderator_approved'",
  rejected: "s.status = 'moderator_rejected'",
  scheduled: "s.status = 'draft'",
  pending: "s.status IN ('pending_review', 'ai_approved', 'needs_moderator')",
};

export function changelog(
  db: Database.Database,
  opts: { filter: ChangelogFilter; limit: number; offset: number; forModerator: boolean }
): { items: HistoryItem[]; hasMore: boolean } {
  const { filter, limit, offset, forModerator } = opts;
  const fetch = offset + limit + 1;

  const includeComments = (!filter.kind || filter.kind === "comment") && !filter.status;
  const includeSuggestions = filter.kind !== "comment";

  const items: HistoryItem[] = [];

  if (includeSuggestions) {
    const where: string[] = [VISIBLE_SUGGESTIONS];
    const params: unknown[] = [];
    if (filter.kind) {
      where.push("s.action = ?");
      params.push(filter.kind);
    }
    if (filter.status && STATUS_SQL[filter.status]) where.push(STATUS_SQL[filter.status]);
    if (filter.word) {
      where.push("s.word = ?");
      params.push(filter.word);
    }
    const rows = db
      .prepare(
        `${SUGGESTION_SELECT} WHERE ${where.join(" AND ")}
         ORDER BY COALESCE(s.decided_at, s.created_at) DESC, s.id DESC LIMIT ?`
      )
      .all(...params, fetch) as SuggestionRow[];
    items.push(...rows.map((r) => suggestionItem(r)));
  }

  if (includeComments) {
    const where: string[] = [];
    const params: unknown[] = [];
    if (!forModerator) where.push("c.hidden_at IS NULL");
    if (filter.word) {
      where.push("c.word = ?");
      params.push(filter.word);
    }
    const rows = db
      .prepare(
        `${COMMENT_SELECT}${where.length ? ` WHERE ${where.join(" AND ")}` : ""}
         ORDER BY c.created_at DESC, c.id DESC LIMIT ?`
      )
      .all(...params, fetch) as CommentRow[];
    items.push(...rows.map((r) => commentItem(r)));
  }

  items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : b.id - a.id));
  const page = items.slice(offset, offset + limit);
  return { items: page, hasMore: items.length > offset + limit };
}
