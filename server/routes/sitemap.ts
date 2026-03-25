import { Router } from "express";
import { getDb } from "../../lib/db.js";

export const sitemapRouter = Router();

const STATIC_PATHS = ["/", "/regeln", "/warum", "/entstehung", "/mitmachen"];

function siteUrl() {
  return (process.env.SITE_URL ?? "https://spielwoerter.de").replace(/\/$/, "");
}

function todayW3C() {
  return new Date().toISOString().slice(0, 10);
}

function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// GET /sitemap.xml — index referencing one sitemap per starting letter
sitemapRouter.get("/sitemap.xml", (_req, res) => {
  const db = getDb();
  const letters = (
    db
      .prepare(
        `SELECT DISTINCT SUBSTR(word, 1, 1) AS letter
         FROM words WHERE in_list IN ('accepted', 'uncertain')
         ORDER BY letter`
      )
      .all() as { letter: string }[]
  ).map((r) => r.letter);

  const base = siteUrl();
  const today = todayW3C();

  const entries = [
    // Static pages sitemap
    `  <sitemap>\n    <loc>${xmlEscape(base)}/sitemap-static.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`,
    // One sitemap per letter
    ...letters.map((l) => {
      const encoded = encodeURIComponent(l);
      return `  <sitemap>\n    <loc>${xmlEscape(base)}/sitemap-${encoded}.xml</loc>\n    <lastmod>${today}</lastmod>\n  </sitemap>`;
    }),
  ].join("\n");

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</sitemapindex>\n`
  );
});

// GET /sitemap-static.xml — static pages
sitemapRouter.get("/sitemap-static.xml", (_req, res) => {
  const base = siteUrl();
  const today = todayW3C();

  const urls = STATIC_PATHS.map(
    (p) =>
      `  <url>\n    <loc>${xmlEscape(base + p)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>weekly</changefreq>\n    <priority>${p === "/" ? "1.0" : "0.5"}</priority>\n  </url>`
  ).join("\n");

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});

// GET /sitemap-:letter.xml — words starting with that letter
sitemapRouter.get("/sitemap-:letter.xml", (req, res) => {
  const letter = decodeURIComponent(req.params.letter);

  // Validate: single character
  if ([...letter].length !== 1) {
    res.status(404).send("Not found");
    return;
  }

  const db = getDb();
  const words = (
    db
      .prepare(
        `SELECT word FROM words
         WHERE in_list IN ('accepted', 'uncertain')
         AND SUBSTR(word, 1, 1) = ?
         ORDER BY word`
      )
      .all(letter) as { word: string }[]
  ).map((r) => r.word);

  if (words.length === 0) {
    res.status(404).send("Not found");
    return;
  }

  const base = siteUrl();
  const today = todayW3C();

  const urls = words
    .map((w) => {
      const loc = `${base}/wort/${encodeURIComponent(w.toUpperCase())}`;
      return `  <url>\n    <loc>${xmlEscape(loc)}</loc>\n    <lastmod>${today}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
    })
    .join("\n");

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`
  );
});
