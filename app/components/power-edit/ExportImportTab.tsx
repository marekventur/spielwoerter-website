import { useEffect, useState } from "react";
import type { Changeset } from "~/hooks/useLocalStorageChangeset";
import { loadDictionary } from "~/hooks/usePowerSearch";

type PendingValue = { base?: string; description?: string } | null;

type Props = {
  changeset: Changeset;
  onChangesetChange: (updater: (prev: Changeset) => Changeset) => void;
  active: boolean;
};

function serialize(changeset: Changeset): string {
  const obj: Record<string, PendingValue> = {};
  for (const [word, entry] of changeset) {
    obj[word] = entry.pending;
  }
  return JSON.stringify(obj, null, 2);
}

function parseText(s: string): Record<string, PendingValue> | null {
  try {
    const parsed = JSON.parse(s) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return parsed as Record<string, PendingValue>;
  } catch {
    return null;
  }
}

export function ExportImportTab({ changeset, onChangesetChange, active }: Props) {
  const [text, setText] = useState(() => serialize(changeset));
  const [error, setError] = useState<string | null>(null);
  const [imported, setImported] = useState(false);
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    if (active) {
      setText(serialize(changeset));
      setError(null);
      setImported(false);
    }
  }, [active]);

  async function handleImport() {
    const pendingMap = parseText(text);
    if (!pendingMap) {
      setError("Ungültiges JSON – bitte Format prüfen.");
      return;
    }

    setImporting(true);
    setError(null);
    try {
      const dictionary = await loadDictionary();
      const dictMap = new Map(dictionary.map((r) => [r.word, r]));

      const newChangeset: Changeset = new Map();
      for (const [word, pending] of Object.entries(pendingMap)) {
        const dictEntry = dictMap.get(word);
        const original = {
          base: dictEntry?.base ?? null,
          description: dictEntry?.description ?? null,
        };
        newChangeset.set(word, { original, pending });
      }

      onChangesetChange(() => newChangeset);
      setImported(true);
    } catch {
      setError("Wörterbuch konnte nicht geladen werden.");
    } finally {
      setImporting(false);
    }
  }

  async function handleCopy() {
    await navigator.clipboard.writeText(text);
  }

  return (
    <div className="bg-white rounded-lg border border-gray-200 p-4 space-y-3">
      <p className="text-sm text-gray-500">
        Hier kannst du deinen aktuellen Änderungsstand kopieren oder einen gespeicherten Stand einfügen.
      </p>
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setError(null); setImported(false); }}
        spellCheck={false}
        rows={20}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-xs font-mono focus:outline-none focus:ring-2 focus:ring-sky-400 resize-y"
      />
      {error && <p className="text-sm text-red-600">{error}</p>}
      {imported && <p className="text-sm text-green-700">Changeset erfolgreich importiert.</p>}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={importing}
          className="rounded-md bg-sky-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-sky-700 transition-colors disabled:opacity-50"
        >
          {importing ? "Lädt…" : "Importieren"}
        </button>
        <button
          type="button"
          onClick={() => void handleCopy()}
          className="rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          Kopieren
        </button>
      </div>
    </div>
  );
}
