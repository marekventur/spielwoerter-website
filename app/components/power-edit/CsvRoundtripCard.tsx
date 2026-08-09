import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import type { Changeset, ChangesetEntry } from "~/hooks/useLocalStorageChangeset";
import type { WordRow } from "~/components/power-edit/WordEditTable";
import { loadDictionary } from "~/hooks/usePowerSearch";

function csvEscape(v: string | null): string {
  const s = v ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function buildCsv(rows: WordRow[]): string {
  return (
    "word,base,description\n" +
    rows.map((r) => [r.word, r.base, r.description].map(csvEscape).join(",")).join("\n") +
    "\n"
  );
}

/** RFC-4180-ish parser; delimiter is "," or ";" (Excel with deutschem Gebietsschema). */
function parseDelimited(text: string, delim: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.length > 1 || (r[0] ?? "").trim() !== "");
}

export type CsvDiff = {
  changeset: Changeset;
  added: number;
  removed: number;
  changed: number;
  skipped: number;
};

/**
 * Diff an uploaded CSV against the full dictionary. The upload is treated as
 * the complete intended list: missing words become removals, unknown words
 * become additions, differing base/description become edits.
 */
export function diffCsvAgainstDictionary(text: string, dictionary: WordRow[]): CsvDiff | { error: string } {
  const clean = text.replace(/^\uFEFF/, "");
  const headerLine = clean.slice(0, clean.indexOf("\n") === -1 ? clean.length : clean.indexOf("\n"));
  const delim = headerLine.includes(";") ? ";" : ",";
  const records = parseDelimited(clean, delim);
  if (records.length === 0) return { error: "Die Datei ist leer." };

  const header = records[0].map((h) => h.trim().toLowerCase());
  const wordIdx = header.indexOf("word");
  const baseIdx = header.indexOf("base");
  const descIdx = header.indexOf("description");
  if (wordIdx === -1) {
    return { error: 'Kopfzeile nicht erkannt — erwartet werden Spalten "word", "base", "description".' };
  }

  const dictMap = new Map(dictionary.map((r) => [r.word, r]));
  const norm = (v: string | null | undefined) => (v ?? "").trim();
  // Comparison ignores whitespace details: some stored descriptions contain
  // embedded newlines, which spreadsheet apps flatten to spaces on save —
  // that round-trip must not read as a change.
  const flat = (v: string | null | undefined) => norm(v).replace(/\s+/g, " ");

  const uploaded = new Map<string, { base: string; description: string }>();
  let skipped = 0;
  for (const rec of records.slice(1)) {
    const word = norm(rec[wordIdx]).toLowerCase();
    if (!word) continue;
    // New words must be plain letters; words already in the list are accepted
    // as-is so an odd legacy entry can't turn into a phantom removal.
    if (!dictMap.has(word) && !/^[a-zäöüß]+$/.test(word)) {
      skipped++;
      continue;
    }
    uploaded.set(word, {
      base: baseIdx === -1 ? norm(dictMap.get(word)?.base) : norm(rec[baseIdx]),
      description: descIdx === -1 ? norm(dictMap.get(word)?.description) : norm(rec[descIdx]),
    });
  }
  if (uploaded.size === 0) return { error: "Keine gültigen Zeilen gefunden." };

  const changeset: Changeset = new Map();
  let added = 0;
  let removed = 0;
  let changed = 0;

  for (const [word, up] of uploaded) {
    const dict = dictMap.get(word);
    if (!dict) {
      const pending: NonNullable<ChangesetEntry["pending"]> = {};
      if (up.base && up.base.toLowerCase() !== word) pending.base = up.base.toLowerCase();
      if (up.description) pending.description = up.description;
      changeset.set(word, { original: { base: null, description: null }, pending, isNew: true });
      added++;
      continue;
    }
    if (flat(dict.base) !== flat(up.base) || flat(dict.description) !== flat(up.description)) {
      const pending: NonNullable<ChangesetEntry["pending"]> = {};
      if (up.base) pending.base = up.base;
      if (up.description) pending.description = up.description;
      // A row emptied of both values can't be expressed as a change — skip it.
      if (Object.keys(pending).length === 0) {
        skipped++;
        continue;
      }
      changeset.set(word, {
        original: { base: dict.base, description: dict.description },
        pending,
      });
      changed++;
    }
  }

  for (const dict of dictionary) {
    if (!uploaded.has(dict.word)) {
      changeset.set(dict.word, {
        original: { base: dict.base, description: dict.description },
        pending: null,
      });
      removed++;
    }
  }

  return { changeset, added, removed, changed, skipped };
}

type Props = {
  changesetSize: number;
  onChangesetChange: (updater: (prev: Changeset) => Changeset) => void;
  limit: number;
};

export function CsvRoundtripCard({ changesetSize, onChangesetChange, limit }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    try {
      const rows = await loadDictionary();
      const blob = new Blob([buildCsv(rows)], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "spielwoerter.csv";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      setError("Wörterbuch konnte nicht geladen werden.");
    }
  }

  async function handleUpload() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setBusy(true);
    setError(null);
    setSummary(null);
    try {
      const [text, dictionary] = await Promise.all([file.text(), loadDictionary()]);
      const result = diffCsvAgainstDictionary(text, dictionary);
      if ("error" in result) {
        setError(result.error);
        return;
      }
      const total = result.changeset.size;
      if (total === 0) {
        setSummary("Keine Unterschiede zur aktuellen Liste gefunden.");
        return;
      }
      if (total > limit) {
        setError(
          `Der Vergleich ergibt ${total} Änderungen — mehr als die ${limit} pro Batch. ` +
            "Bitte in kleineren Schritten hochladen (oder prüfen, ob versehentlich Zeilen fehlen)."
        );
        return;
      }
      if (
        changesetSize > 0 &&
        !window.confirm(`Dein aktueller Änderungsstand (${changesetSize} Einträge) wird ersetzt. Fortfahren?`)
      ) {
        return;
      }
      onChangesetChange(() => result.changeset);
      setSummary(
        `Übernommen: ${result.added} neu, ${result.removed} gelöscht, ${result.changed} geändert.` +
          (result.skipped > 0 ? ` ${result.skipped} Zeile(n) übersprungen.` : "")
      );
    } catch {
      setError("Datei konnte nicht gelesen werden.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <h3 className="text-sm font-semibold text-gray-800">Komplette Liste als CSV</h3>
      <p className="text-sm text-gray-500">
        Lade die komplette Wortliste herunter, bearbeite sie in Excel oder LibreOffice — Wörter
        löschen, ändern oder neue Zeilen anfügen — und lade die Datei wieder hoch. Die Unterschiede
        werden zu deinem Änderungsstand. Beim Speichern bitte das Format „CSV UTF-8" wählen.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void handleDownload()}
          className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          <Download size={14} />
          CSV herunterladen
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          onChange={(e) => {
            setFileName(e.target.files?.[0]?.name ?? null);
            setError(null);
            setSummary(null);
          }}
          className="text-sm text-gray-600 file:mr-2 file:rounded-md file:border-0 file:bg-gray-100 file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-gray-700 hover:file:bg-gray-200"
        />
        <button
          type="button"
          onClick={() => void handleUpload()}
          disabled={busy || !fileName}
          className="inline-flex items-center gap-1.5 rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors disabled:opacity-50"
        >
          <Upload size={14} />
          {busy ? "Vergleiche…" : "Hochladen & vergleichen"}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {summary && <p className="text-sm text-green-700">{summary}</p>}
    </div>
  );
}
