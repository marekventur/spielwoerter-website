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

export function markdownToHtml(body: string): string {
  return md.parse(body) as string;
}

const URL_RE = /\bhttps?:\/\/[^\s<>"]+/gi;

/**
 * A matched URL without the sentence punctuation after it. A closing bracket
 * stays when the URL opened one (…/wiki/Bank_(Möbel)), otherwise it ends the URL.
 */
function trimUrl(url: string): string {
  for (;;) {
    const last = url.at(-1)!;
    const count = (c: string) => url.split(c).length - 1;
    if (/[.,;:!?'"»“]/.test(last)) url = url.slice(0, -1);
    else if (last === ")" && count(")") > count("(")) url = url.slice(0, -1);
    else if (last === "]" && count("]") > count("[")) url = url.slice(0, -1);
    else return url;
  }
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

export function postToHtml(body: string, source: string): string {
  return source === "email" ? plainTextToHtml(body) : markdownToHtml(body);
}
