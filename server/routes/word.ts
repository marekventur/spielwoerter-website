import { Router, type Response } from "express";
import { getDb } from "../../lib/db.js";
import { detectAlgorithmicBase, enrichWord } from "../../lib/enrich.js";

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
