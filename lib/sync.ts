import Database from "better-sqlite3";
import { normalise } from "./normalise.js";

const GITHUB_RAW = "https://raw.githubusercontent.com";
const GITHUB_API = "https://api.github.com";

// ── Types ────────────────────────────────────────────────────────────────────

type JsonlWord = {
  word: string;
  description: string | null;
  base: string | null;
  source: string | null;
  verified_by: string | null;
  [key: string]: unknown;
};

type PushSuggestion = {
  id: number;
  word: string;
  action: string;
  payload: string | null;
  user_id: number;
  user_email: string;
};

export type DigestUser = {
  email: string;
  approved: { word: string; action: string }[];
  rejected: { word: string; action: string }[];
};

// ── Helpers ──────────────────────────────────────────────────────────────────

async function fetchJsonl(url: string): Promise<JsonlWord[]> {
  const res = await fetch(url);
  if (res.status === 404) return [];
  if (!res.ok) throw new Error(`Failed to fetch ${url}: ${res.status}`);
  const text = await res.text();
  return text
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as JsonlWord);
}

function toJsonl(words: JsonlWord[]): string {
  return words.map((w) => JSON.stringify(w)).join("\n") + "\n";
}

function insertSorted(list: JsonlWord[], entry: JsonlWord): JsonlWord[] {
  const result = [...list];
  const idx = result.findIndex((w) => w.word > entry.word);
  if (idx === -1) result.push(entry);
  else result.splice(idx, 0, entry);
  return result;
}

async function ghApi(
  method: string,
  path: string,
  token: string,
  body?: unknown
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any> {
  const res = await fetch(`${GITHUB_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GitHub ${method} ${path}: ${res.status} ${text}`);
  }
  return res.json();
}

// ── syncPull ─────────────────────────────────────────────────────────────────

export async function syncPull(
  db: Database.Database,
  githubRepo: string
): Promise<void> {
  const base = `${GITHUB_RAW}/${githubRepo}/main`;

  console.log(`Fetching wordlists from github.com/${githubRepo}…`);

  const [accepted, uncertain, rejected] = await Promise.all([
    fetchJsonl(`${base}/wordlist_accepted.jsonl`),
    fetchJsonl(`${base}/wordlist_uncertain.jsonl`),
    fetchJsonl(`${base}/wordlist_rejected.jsonl`),
  ]);

  console.log(
    `  accepted: ${accepted.length}, uncertain: ${uncertain.length}, rejected: ${rejected.length}`
  );

  const insert = db.prepare(
    `INSERT OR REPLACE INTO words (word, description, base, source, verified_by, in_list, normalised)
     VALUES (@word, @description, @base, @source, @verified_by, @in_list, @normalised)`
  );

  const insertRejectedWord = db.prepare(
    `INSERT OR IGNORE INTO rejected_words (word, action) VALUES (?, 'remove')`
  );

  db.transaction(() => {
    db.prepare("DELETE FROM words").run();
    db.prepare("DELETE FROM rejected_words").run();

    for (const w of accepted) insert.run({ ...w, in_list: "accepted", normalised: normalise(w.word) });
    for (const w of uncertain) insert.run({ ...w, in_list: "uncertain", normalised: normalise(w.word) });
    for (const w of rejected) {
      insert.run({ ...w, in_list: "rejected", normalised: normalise(w.word) });
      insertRejectedWord.run(w.word);
    }
  })();

  console.log(
    `Done. ${accepted.length + uncertain.length + rejected.length} words loaded.`
  );
}

// ── syncPush ─────────────────────────────────────────────────────────────────

export async function syncPush(
  db: Database.Database,
  githubRepo: string,
  githubToken: string
): Promise<{ pushed: number; digestUsers: DigestUser[] }> {
  const unsynced = db
    .prepare(
      `SELECT s.id, s.word, s.action, s.payload, s.user_id, u.email AS user_email
       FROM suggestions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status = 'moderator_approved' AND s.synced_at IS NULL`
    )
    .all() as PushSuggestion[];

  if (unsynced.length > 0) {
    console.log(`[sync push] Pushing ${unsynced.length} suggestion(s)…`);

    const base = `${GITHUB_RAW}/${githubRepo}/main`;
    let [accepted, uncertain, rejected] = await Promise.all([
      fetchJsonl(`${base}/wordlist_accepted.jsonl`),
      fetchJsonl(`${base}/wordlist_uncertain.jsonl`),
      fetchJsonl(`${base}/wordlist_rejected.jsonl`),
    ]);

    // Apply changes
    for (const s of unsynced) {
      const payload = s.payload
        ? (JSON.parse(s.payload) as Record<string, string>)
        : null;

      if (s.action === "add") {
        if (!accepted.find((w) => w.word === s.word)) {
          accepted = insertSorted(accepted, {
            word: s.word,
            description: payload?.description ?? null,
            base: payload?.base ?? null,
            source: "community",
            verified_by: "moderator",
          });
        }
      } else if (s.action === "remove") {
        const entry = accepted.find((w) => w.word === s.word);
        accepted = accepted.filter((w) => w.word !== s.word);
        uncertain = uncertain.filter((w) => w.word !== s.word);
        if (!rejected.find((w) => w.word === s.word)) {
          rejected = insertSorted(rejected, entry ?? {
            word: s.word,
            description: null,
            base: null,
            source: "community",
            verified_by: "moderator",
          });
        }
      } else if (s.action === "change_description" && payload) {
        const hasDesc = payload.description !== undefined;
        const hasBase = payload.base !== undefined;
        if (!hasDesc && !hasBase) continue;
        const apply = (list: JsonlWord[]): JsonlWord[] => {
          const i = list.findIndex((w) => w.word === s.word);
          if (i === -1) return list;
          const cur = list[i];
          const next: JsonlWord = { ...cur };
          if (hasDesc) {
            next.description =
              String(payload.description).trim() === ""
                ? null
                : String(payload.description).trim();
          }
          if (hasBase) {
            next.base =
              String(payload.base).trim() === ""
                ? null
                : String(payload.base).trim().toLowerCase();
          }
          const copy = [...list];
          copy[i] = next;
          return copy;
        };
        accepted = apply(accepted);
        uncertain = apply(uncertain);
      }
    }

    // Commit changed files via GitHub Git Data API
    const [owner, repo] = githubRepo.split("/");
    const refData = await ghApi(
      "GET",
      `/repos/${owner}/${repo}/git/ref/heads/main`,
      githubToken
    );
    const latestSha: string = refData.object.sha;
    const commitData = await ghApi(
      "GET",
      `/repos/${owner}/${repo}/git/commits/${latestSha}`,
      githubToken
    );
    const baseTreeSha: string = commitData.tree.sha;

    const filesToUpdate = [
      { path: "wordlist_accepted.jsonl", content: toJsonl(accepted) },
      { path: "wordlist_uncertain.jsonl", content: toJsonl(uncertain) },
      { path: "wordlist_rejected.jsonl", content: toJsonl(rejected) },
    ];

    const treeItems = await Promise.all(
      filesToUpdate.map(async (f) => {
        const blob = await ghApi(
          "POST",
          `/repos/${owner}/${repo}/git/blobs`,
          githubToken,
          {
            content: Buffer.from(f.content).toString("base64"),
            encoding: "base64",
          }
        );
        return { path: f.path, mode: "100644", type: "blob", sha: blob.sha };
      })
    );

    const newTree = await ghApi(
      "POST",
      `/repos/${owner}/${repo}/git/trees`,
      githubToken,
      { base_tree: baseTreeSha, tree: treeItems }
    );

    const wordList = unsynced.map((s) => s.word).join(", ");
    const msg = `community: ${unsynced.length} suggestion(s) applied\n\n${wordList}`;
    const newCommit = await ghApi(
      "POST",
      `/repos/${owner}/${repo}/git/commits`,
      githubToken,
      { message: msg, tree: newTree.sha, parents: [latestSha] }
    );

    await ghApi(
      "PATCH",
      `/repos/${owner}/${repo}/git/refs/heads/main`,
      githubToken,
      { sha: newCommit.sha }
    );

    console.log(`[sync push] Committed ${unsynced.length} change(s).`);

    // Mark as synced
    const now = new Date().toISOString();
    const markSynced = db.prepare(
      "UPDATE suggestions SET synced_at = ? WHERE id = ?"
    );
    db.transaction(() => {
      for (const s of unsynced) markSynced.run(now, s.id);
    })();
  } else {
    console.log("[sync push] Nothing to push.");
  }

  // Collect unnotified decided suggestions for digest
  const unnotified = db
    .prepare(
      `SELECT s.id, s.word, s.action, s.status, u.email AS user_email
       FROM suggestions s
       JOIN users u ON u.id = s.user_id
       WHERE s.status IN ('moderator_approved', 'moderator_rejected')
         AND s.notified_at IS NULL`
    )
    .all() as {
    id: number;
    word: string;
    action: string;
    status: string;
    user_email: string;
  }[];

  const byUser = new Map<string, DigestUser>();
  for (const s of unnotified) {
    if (!byUser.has(s.user_email)) {
      byUser.set(s.user_email, { email: s.user_email, approved: [], rejected: [] });
    }
    const u = byUser.get(s.user_email)!;
    const entry = { word: s.word, action: s.action };
    if (s.status === "moderator_approved") u.approved.push(entry);
    else u.rejected.push(entry);
  }

  if (unnotified.length > 0) {
    const now = new Date().toISOString();
    const markNotified = db.prepare(
      "UPDATE suggestions SET notified_at = ? WHERE id = ?"
    );
    db.transaction(() => {
      for (const s of unnotified) markNotified.run(now, s.id);
    })();
  }

  return { pushed: unsynced.length, digestUsers: Array.from(byUser.values()) };
}
