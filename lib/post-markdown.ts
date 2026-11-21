/**
 * Discussion posts (/diskussion/:id) as safe HTML.
 *
 * Posts written on the site are Markdown (GFM, single newlines kept as line
 * breaks, bare URLs linked). Posts that came in by email are plain text: only
 * their URLs are linked, since Markdown would mangle them (a "--" signature
 * line turns the line above into a heading).
 *
 * Unlike lib/regeln.ts this is user content, so:
 * - raw HTML is never passed through, it is shown as text;
 * - links must be http(s) or mailto, open in a new tab and send no referrer;
 * - images are not loaded (that would tell their server who reads the
 *   thread), they become a link to the image.
 */
import { Marked, type Tokens } from "marked";
import { MAX_POST_LENGTH } from "./topics.js";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer"';

/**
 * Whether an href may be linked: http(s) or mailto. Entities are decoded for
 * the check only, so "&#106;avascript:" can't slip by; the link itself keeps
 * the address exactly as written.
 */
function isSafeHref(href: string): boolean {
  const decoded = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
  return /^(https?:\/\/|mailto:)/i.test(decoded);
}

function anchor(href: string, innerHtml: string, title?: string | null): string {
  if (!isSafeHref(href)) return innerHtml;
  const t = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href.trim())}"${t} ${LINK_ATTRS}>${innerHtml}</a>`;
}

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({
  tokenizer: {
    // No underlined (setext) headings: a "--" signature line under "Viele Grüße"
    // would turn the greeting into a heading. "# Überschrift" still works.
    // Returning undefined (not false, which falls back) skips the tokenizer.
    lheading() {
      return undefined;
    },
    // No indented code blocks: people indent rules and sub-points with tabs or
    // spaces, and a whole indented section turned into one unwrapped monospace
    // block. Code needs a ``` fence; indented text stays ordinary text.
    code() {
      return undefined;
    },
    // A single "*" is always literal: posts here use it for footnotes "(*)",
    // gender stars "Moderator*innen" and wildcards "ge*t", which Markdown would
    // turn into italics. Italics are "_kursiv_"; "**fett**" still works.
    emStrong(src: string) {
      // A plain text token is what marked would emit for a literal "*"; its
      // types only allow Em/Strong from this tokenizer, hence the cast.
      if (src[0] === "*" && src[1] !== "*") return { type: "text", raw: "*", text: "*" } as unknown as Tokens.Em;
      return false;
    },
  },
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      // An image inside a link is itself a link here: keep one, not nested <a>s.
      const inner = this.parser.parseInline(token.tokens).replace(/<\/?a\b[^>]*>/g, "");
      return anchor(token.href, inner, token.title);
    },
    image(token: Tokens.Image) {
      return anchor(token.href, `🖼 ${escapeHtml(token.text || token.href)}`, token.title);
    },
  },
});

// marked recurses once per quote level; thousands of "> > > …" overflow the
// stack. Nobody quotes more than a few levels deep, so cap the run at 10.
const DEEP_QUOTE = /^((?:[ \t]*>){10})(?:[ \t]*>)+/gm;

export function markdownToHtml(body: string): string {
  try {
    return md.parse(body.replace(DEEP_QUOTE, "$1")) as string;
  } catch (e) {
    // Any other input marked can't handle must not take the thread page down.
    console.warn("[post-markdown] falling back to plain text:", e instanceof Error ? e.message : e);
    return plainTextToHtml(body);
  }
}

// Bounded, so a crafted mail can't make one "URL" arbitrarily long.
const URL_RE = /\bhttps?:\/\/[^\s<>"]{1,2000}/gi;

/**
 * A matched URL without the sentence punctuation after it. A closing bracket
 * stays when the URL opened one (…/wiki/Bank_(Möbel)), otherwise it ends the
 * URL. Brackets are counted once and adjusted while trimming, so this stays
 * linear however many brackets trail the URL.
 */
function trimUrl(url: string): string {
  let open = 0, closeParen = 0, openSq = 0, closeSq = 0;
  for (const c of url) {
    if (c === "(") open++;
    else if (c === ")") closeParen++;
    else if (c === "[") openSq++;
    else if (c === "]") closeSq++;
  }
  let end = url.length;
  while (end > 0) {
    const last = url[end - 1];
    if (/[.,;:!?'"»“]/.test(last)) end--;
    else if (last === ")" && closeParen > open) { end--; closeParen--; }
    else if (last === "]" && closeSq > openSq) { end--; closeSq--; }
    else break;
  }
  return url.slice(0, end);
}

/** Plain text with its URLs linked; newlines are kept by the caller's CSS. */
export function plainTextToHtml(body: string): string {
  let out = "";
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    const url = trimUrl(m[0]);
    out += escapeHtml(body.slice(last, m.index));
    out += anchor(url, escapeHtml(url));
    last = m.index! + url.length;
  }
  return out + escapeHtml(body.slice(last));
}

/**
 * Rendering bound: posts are capped at MAX_POST_LENGTH on the way in (web and
 * mail); this is the backstop for anything already stored longer, so no
 * single row can make a thread page slow to render.
 */
const RENDER_LIMIT = 2 * MAX_POST_LENGTH;

export function postToHtml(body: string, source: string): string {
  const text = body.length > RENDER_LIMIT ? body.slice(0, RENDER_LIMIT) + " …" : body;
  return source === "email" ? plainTextToHtml(text) : markdownToHtml(text);
}
