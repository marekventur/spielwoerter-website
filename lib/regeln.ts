import { marked } from "marked";

/**
 * /regeln renders REGELN.md from the wordlist repo — one source of truth for
 * the rules. Fetched on demand with a 24h in-memory cache; on fetch failure
 * the stale copy keeps serving (null only before the first successful fetch).
 * The markdown is trusted (our own repo), so no sanitizer is needed.
 */
const TTL_MS = 24 * 60 * 60 * 1000;

export type RegelnContent = { html: string; fetchedAt: number };

let cache: RegelnContent | null = null;

export async function getRegelnHtml(): Promise<RegelnContent | null> {
  if (cache && Date.now() - cache.fetchedAt < TTL_MS) return cache;
  try {
    const repo = process.env.SPIELWOERTER_GITHUB_REPO || "marekventur/spielwoerter";
    // Query param busts the raw.githubusercontent CDN cache (see lib/sync.ts).
    const res = await fetch(
      `https://raw.githubusercontent.com/${repo}/main/REGELN.md?${Date.now()}`
    );
    if (!res.ok) throw new Error(`REGELN.md fetch failed: ${res.status}`);
    const markdown = await res.text();
    const html = await marked.parse(markdown);
    cache = { html, fetchedAt: Date.now() };
    return cache;
  } catch (err) {
    console.error("[regeln]", err);
    return cache;
  }
}
