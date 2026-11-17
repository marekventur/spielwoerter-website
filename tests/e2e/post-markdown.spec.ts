/**
 * Discussion posts render Markdown (web posts) or linked plain text (email
 * posts) through lib/post-markdown.ts. User content: no raw HTML, only
 * http(s)/mailto links, no referrer, no remote images.
 */
import { test, expect } from "@playwright/test";
import { cleanDb, seedWords, seedUser } from "../helpers/seed";
import { loginAs, loginViaApi } from "../helpers/auth";
import { getTestDb } from "../helpers/db";
import { TEST_MOD_EMAIL } from "../helpers/test-config";
import { postToHtml } from "../../lib/post-markdown";
import { clampMailBody, MAX_MESSAGE_LENGTH, MAX_POST_LENGTH } from "../../lib/topics";

const REL = 'rel="noopener noreferrer nofollow ugc"';

test("web posts: Markdown, autolinks without referrer, no raw HTML or unsafe links", () => {
  const html = postToHtml(
    "**fett** und _kursiv_\nzweite Zeile\n\n- eins\n\nSiehe https://www.dwds.de/wb/backen. Und [Duden](https://www.duden.de/x)!",
    "web"
  );
  expect(html).toContain("<strong>fett</strong>");
  expect(html).toContain("<em>kursiv</em><br>zweite Zeile");
  expect(html).toContain("<li>eins</li>");
  expect(html).toContain(`<a href="https://www.dwds.de/wb/backen" target="_blank" ${REL} referrerpolicy="no-referrer">`);
  expect(html).toContain(">Duden</a>!");

  const hostile = postToHtml(
    '<script>alert(1)</script><img src=x onerror=alert(1)> [a](javascript:alert(1)) [b](&#106;avascript:x) [c](data:text/html,x)',
    "web"
  );
  expect(hostile).not.toMatch(/<script|<img|href="(javascript|data|&#)/i);
  expect(hostile).toContain("&lt;script&gt;");

  // images become a link, so nothing is fetched from their server
  const img = postToHtml("![Foto](https://example.com/a.png)", "web");
  expect(img).not.toContain("<img");
  expect(img).toContain('href="https://example.com/a.png"');
  // alt text is escaped exactly once
  expect(postToHtml("![Tom & Jerry](https://example.com/a.png)", "web")).toContain("🖼 Tom &amp; Jerry<");

  // single asterisks stay literal: footnotes, gender stars, wildcards
  for (const s of ["söge (*)\nsögest (*)", "Moderator*innen und Leser*innen", "ge*t und ver*t"])
    expect(postToHtml(s, "web"), s).not.toContain("<em>");
  expect(postToHtml("auf_hören", "web")).not.toContain("<em>");

  // an image inside a link is one link, not nested anchors
  expect(postToHtml("[![Bild](https://e.x/a.png)](https://e.x/)", "web").match(/<a /g)).toHaveLength(1);

  // a "--" signature line does not turn the greeting into a heading
  expect(postToHtml("Viele Grüße\n--\nJojo", "web")).not.toContain("<h2>");
});

test("email posts stay plain text with linked URLs", () => {
  // a URL may end in a bracket it opened, but not in one around it
  const wiki = postToHtml("(siehe https://de.wikipedia.org/wiki/Bank_(Möbel)).", "email");
  expect(wiki).toContain('href="https://de.wikipedia.org/wiki/Bank_(Möbel)"');
  expect(wiki).toContain("</a>).");
  // the link is the address as written, not an entity-decoded variant
  expect(postToHtml("https://x.de/?a=1&amp;b=2", "email")).toContain('href="https://x.de/?a=1&amp;amp;b=2"');

  const html = postToHtml("Hallo *alle*,\n> zitiert\nsiehe https://dwds.de/wb/x. <b>", "email");
  expect(html).toContain("Hallo *alle*,\n&gt; zitiert");
  expect(html).toContain(`<a href="https://dwds.de/wb/x" target="_blank" ${REL}`);
  expect(html).toContain("</a>. &lt;b&gt;");
});

test("hostile sizes stay cheap: trailing brackets, deep quotes, overlong mail", () => {
  // trailing brackets were quadratic in the URL trimmer
  let t = performance.now();
  const html = postToHtml("https://x.de/a" + ")".repeat(200_000), "email");
  expect(performance.now() - t).toBeLessThan(500);
  expect(html).toContain('href="https://x.de/a"');

  // thousands of nested quotes overflowed marked's stack; now capped, never thrown
  t = performance.now();
  expect(() => postToHtml("> ".repeat(5_000) + "x", "web")).not.toThrow();
  expect(performance.now() - t).toBeLessThan(1_000);

  // mail replies are cut to the web limit, marked as shortened
  const long = clampMailBody("a".repeat(MAX_POST_LENGTH * 3), MAX_POST_LENGTH);
  expect(long.length).toBe(MAX_POST_LENGTH);
  expect(long.endsWith("[… gekürzt]")).toBe(true);
  expect(clampMailBody("kurz", MAX_POST_LENGTH)).toBe("kurz");
  // word threads have the smaller limit their web form enforces
  expect(clampMailBody("a".repeat(MAX_POST_LENGTH), MAX_MESSAGE_LENGTH).length).toBe(MAX_MESSAGE_LENGTH);
});

test("the thread page renders a Markdown post", async ({ page, request }) => {
  cleanDb();
  seedWords();
  seedUser(TEST_MOD_EMAIL, { isModerator: true });
  const session = await loginViaApi(TEST_MOD_EMAIL);
  const res = await request.post("/api/topics", {
    headers: { Cookie: `session=${session}` },
    data: { title: "Formatierung", body: "**Wichtig:** siehe https://www.dwds.de/wb/backen\n\n<b>roh</b>" },
  });
  const { topicId } = (await res.json()) as { topicId: number };
  expect(getTestDb().prepare("SELECT source FROM topic_posts WHERE topic_id = ?").get(topicId)).toEqual({ source: "web" });

  await loginAs(page, TEST_MOD_EMAIL, `/diskussion/${topicId}`);
  const post = page.locator(".post-body").first();
  await expect(post.locator("strong")).toHaveText("Wichtig:");
  const link = post.getByRole("link", { name: "https://www.dwds.de/wb/backen" });
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow ugc");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(post).toContainText("<b>roh</b>");
  await expect(page.getByText(/Formatierung mit Markdown/)).toBeVisible();
});
