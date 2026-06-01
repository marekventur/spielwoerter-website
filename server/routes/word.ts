import { Router, type Response } from "express";
import { getDb } from "../../lib/db.js";
import { detectAlgorithmicBase, enrichWord } from "../../lib/enrich.js";
import { requireUser } from "../http-auth.js";

const SEARCH_FIELDS = ["word", "base", "description"] as const;
type SearchField = (typeof SEARCH_FIELDS)[number];
const SEARCH_FIELD_SET = new Set<string>(SEARCH_FIELDS);
const SEARCH_LIMIT = 200;

const CSV_COLUMNS = ["word", "base", "description", "verified_by"] as const;
type CsvColumn = (typeof CSV_COLUMNS)[number];
const CSV_COLUMN_SET = new Set<string>(CSV_COLUMNS);

const DEFAULT_CSV_COLUMNS: CsvColumn[] = ["word", "base", "description"];

function escapeCsvField(value: unknown): string {
  const s = value == null ? "" : String(value);
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function parseColumnsQuery(raw: unknown): string[] | null {
  if (raw === undefined) return null;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (typeof s !== "string") return null;
  const cols = s.split(",").map((c) => c.trim()).filter(Boolean);
  return cols.length > 0 ? cols : null;
}

function writeChunk(res: Response, chunk: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ok = res.write(chunk, "utf8");
    if (ok) {
      resolve();
      return;
    }
    res.once("drain", resolve);
    res.once("error", reject);
  });
}


export const wordRouter = Router();

/**
 * GET /api/words/all
 * Full accepted wordlist for client-side search. 1hr private browser cache + ETag.
 * On refresh Chrome revalidates via If-None-Match; 304 avoids re-downloading the body.
 */
wordRouter.get("/words/all", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const db = getDb();

  // Cheap fingerprint: row count + total byte length of all content fields.
  // Changes whenever any word, base, or description is added/modified/removed.
  const { etag } = db
    .prepare(
      `SELECT COUNT(*) || '-' ||
              CAST(SUM(LENGTH(word) + LENGTH(COALESCE(base,'')) + LENGTH(COALESCE(description,''))) AS TEXT)
              AS etag
       FROM words WHERE in_list IN ('accepted', 'uncertain')`
    )
    .get() as { etag: string };

  const etagValue = `"${etag}"`;
  res.setHeader("Cache-Control", "private, max-age=3600");
  res.setHeader("ETag", etagValue);

  if (req.headers["if-none-match"] === etagValue) {
    res.status(304).end();
    return;
  }

  const words = db
    .prepare(
      `SELECT word, base, description
       FROM words
       WHERE in_list IN ('accepted', 'uncertain')
       ORDER BY word`
    )
    .all() as { word: string; base: string | null; description: string | null }[];

  res.json({ words });
});

/**
 * GET /api/words/search?q=...&mode=partial|start|end&fields=word,base,description&regex=0
 * Power-search the accepted wordlist. Returns up to 1000 rows + has_more flag.
 */
wordRouter.get("/words/search", (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;

  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  if (!q) {
    res.json({ words: [], hasMore: false });
    return;
  }

  const rawMode = typeof req.query.mode === "string" ? req.query.mode : "partial";
  const mode = ["partial", "start", "end", "exact"].includes(rawMode) ? rawMode : "partial";

  const rawFields = typeof req.query.fields === "string" ? req.query.fields : "";
  const fields: SearchField[] = rawFields
    ? (rawFields.split(",").filter((f) => SEARCH_FIELD_SET.has(f)) as SearchField[])
    : [...SEARCH_FIELDS];
  if (fields.length === 0) {
    res.status(400).json({ error: "Ungültige Felder" });
    return;
  }

  const isRegex = req.query.regex === "1";

  const db = getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (isRegex) {
    for (const field of fields) {
      conditions.push(`${field} REGEXP ?`);
      params.push(q);
    }
  } else {
    const terms = q.split(/[,\s]+/).filter(Boolean).slice(0, 20);
    for (const term of terms) {
      for (const field of fields) {
        if (mode === "exact") {
          conditions.push(`LOWER(${field}) = LOWER(?)`);
          params.push(term);
        } else {
          const pattern =
            mode === "start" ? `${term}%` : mode === "end" ? `%${term}` : `%${term}%`;
          conditions.push(`LOWER(${field}) LIKE LOWER(?)`);
          params.push(pattern);
        }
      }
    }
  }

  if (conditions.length === 0) {
    res.json({ words: [], hasMore: false });
    return;
  }

  const rows = db
    .prepare(
      `SELECT word, base, description
       FROM words
       WHERE in_list IN ('accepted', 'uncertain')
       AND (${conditions.join(" OR ")})
       ORDER BY word
       LIMIT ${SEARCH_LIMIT + 1}`
    )
    .all(...params) as { word: string; base: string | null; description: string | null }[];

  const hasMore = rows.length > SEARCH_LIMIT;
  res.json({ words: rows.slice(0, SEARCH_LIMIT), hasMore });
});

/**
 * GET /api/words.csv?columns=word,base,description
 * Streams approved wordlist rows (accepted + uncertain) as CSV. Columns are optional; default word,base,description.
 */
wordRouter.get("/words.csv", async (req, res) => {
  const requested = parseColumnsQuery(req.query.columns);
  const cols = (requested ?? DEFAULT_CSV_COLUMNS) as string[];
  for (const c of cols) {
    if (!CSV_COLUMN_SET.has(c)) {
      res.status(400).json({ error: `Unknown column: ${c}` });
      return;
    }
  }
  const db = getDb();
  const selectList = cols.join(", ");
  const stmt = db.prepare(
    `SELECT ${selectList} FROM words
     WHERE in_list IN ('accepted', 'uncertain')
     ORDER BY word`
  );

  res.setHeader("Content-Type", "text/csv; charset=utf-8");

  try {
    await writeChunk(res, cols.map(escapeCsvField).join(",") + "\n");
    for (const row of stmt.iterate()) {
      const rec = row as Record<string, unknown>;
      const line = cols.map((col) => escapeCsvField(rec[col])).join(",");
      await writeChunk(res, line + "\n");
    }
    res.end();
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to stream CSV" });
    } else {
      res.destroy(err instanceof Error ? err : undefined);
    }
  }
});

wordRouter.get("/word-base/:word", (req, res) => {
  res.json({ base: detectAlgorithmicBase(req.params.word.toLowerCase()) });
});

wordRouter.get("/word-enrich/:word", async (req, res) => {
  const result = await enrichWord(req.params.word.toLowerCase());
  res.json(result);
});

wordRouter.get("/words/:word", (req, res) => {
  const word = req.params.word.toLowerCase();
  const row = getDb()
    .prepare(
      "SELECT word, description, base, source, verified_by, in_list FROM words WHERE word = ?"
    )
    .get(word);

  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});
