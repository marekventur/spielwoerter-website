import type Database from "better-sqlite3";

const CACHE_TTL_MS = 5 * 60 * 1000;

export type RandomWordEntry = { word: string; description: string };

let cache: { entries: RandomWordEntry[]; expiresAt: number } | null = null;

export function getRandomWordsCached(db: Database.Database): RandomWordEntry[] {
  const now = Date.now();
  if (cache && now < cache.expiresAt) {
    return cache.entries;
  }
  const rows = db
    .prepare(
      `SELECT word, description FROM words
       WHERE in_list = 'accepted'
         AND description IS NOT NULL
         AND TRIM(description) != ''
       ORDER BY RANDOM() LIMIT 10`
    )
    .all() as { word: string; description: string }[];
  const entries: RandomWordEntry[] = rows.map((r) => ({
    word: r.word,
    description: r.description.trim(),
  }));
  cache = { entries, expiresAt: now + CACHE_TTL_MS };
  return entries;
}
