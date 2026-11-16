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

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c]);

const LINK_ATTRS = 'target="_blank" rel="noopener noreferrer nofollow ugc" referrerpolicy="no-referrer"';

/** The href if it is safe to link, else null. Entities are decoded first so "&#106;avascript:" can't slip by. */
function safeHref(href: string): string | null {
  const decoded = href
    .replace(/&#x([0-9a-f]+);?/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&#(\d+);?/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, "&")
    .trim();
  return /^(https?:\/\/|mailto:)/i.test(decoded) ? decoded : null;
}

function anchor(href: string | null, innerHtml: string, title?: string | null): string {
  if (!href) return innerHtml;
  const t = title ? ` title="${escapeHtml(title)}"` : "";
  return `<a href="${escapeHtml(href)}"${t} ${LINK_ATTRS}>${innerHtml}</a>`;
}

const md = new Marked({ gfm: true, breaks: true, async: false });
md.use({
  // No underlined (setext) headings: a "--" signature line under "Viele Grüße"
  // would turn the greeting into a heading. "# Überschrift" still works.
  // Returning undefined (not false, which falls back) skips the tokenizer.
  tokenizer: {
    lheading() {
      return undefined;
    },
  },
  renderer: {
    html(token: Tokens.HTML | Tokens.Tag) {
      return escapeHtml(token.text);
    },
    link(token: Tokens.Link) {
      return anchor(safeHref(token.href), this.parser.parseInline(token.tokens), token.title);
    },
    image(token: Tokens.Image) {
      const label = escapeHtml(token.text || token.href);
      return anchor(safeHref(token.href), `🖼 ${label}`, token.title);
    },
  },
});

export function markdownToHtml(body: string): string {
  return md.parse(body) as string;
}

// Bare URL; trailing punctuation that usually ends a sentence is not part of it.
const URL_RE = /\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]'»“]/gi;

/** Plain text with its URLs linked; newlines are kept by the caller's CSS. */
export function plainTextToHtml(body: string): string {
  let out = "";
  let last = 0;
  for (const m of body.matchAll(URL_RE)) {
    out += escapeHtml(body.slice(last, m.index));
    out += anchor(safeHref(m[0]), escapeHtml(m[0]));
    last = m.index! + m[0].length;
  }
  return out + escapeHtml(body.slice(last));
}

export function postToHtml(body: string, source: string): string {
  return source === "email" ? plainTextToHtml(body) : markdownToHtml(body);
}
