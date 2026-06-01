import { Link } from "react-router";
import { Trash2, RotateCcw } from "lucide-react";
import type { Changeset, ChangesetEntry } from "~/hooks/useLocalStorageChangeset";

export type WordRow = {
  word: string;
  base: string | null;
  description: string | null;
};

type Props = {
  rows: WordRow[];
  changeset: Changeset;
  onChangesetChange: (updater: (prev: Changeset) => Changeset) => void;
  limitReached: boolean;
};

function getOrBuildEntry(changeset: Changeset, word: string, row: WordRow): ChangesetEntry | undefined {
  return changeset.get(word);
}

function updateField(
  changeset: Changeset,
  word: string,
  row: WordRow,
  field: "base" | "description",
  rawValue: string
): Changeset {
  const next = new Map(changeset);
  const entry = next.get(word);
  const original = entry?.original ?? { base: row.base, description: row.description };

  const value = field === "base" ? rawValue.toLowerCase() : rawValue;
  const originalValue = (original[field] ?? "").trim();
  const changed = value.trim() !== originalValue;

  const currentPending = entry?.pending ?? {};
  if (entry?.pending === null) return next; // row is deleted; ignore text edits

  const newPending: { base?: string; description?: string } = { ...currentPending };
  if (changed) {
    newPending[field] = value;
  } else {
    delete newPending[field];
  }

  if (Object.keys(newPending).length === 0) {
    next.delete(word);
  } else {
    next.set(word, { original, pending: newPending });
  }
  return next;
}

function toggleDelete(changeset: Changeset, word: string, row: WordRow): Changeset {
  const next = new Map(changeset);
  const entry = next.get(word);

  if (entry?.pending === null) {
    // Currently deleted → undelete (remove from changeset entirely)
    next.delete(word);
  } else {
    // Mark for deletion (any previous text edits are superseded)
    const original = entry?.original ?? { base: row.base, description: row.description };
    next.set(word, { original, pending: null });
  }
  return next;
}

export function WordEditTable({ rows, changeset, onChangesetChange, limitReached }: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">Keine Ergebnisse.</p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
            <th className="py-2 pr-3 font-medium w-32">Wort</th>
            <th className="py-2 pr-3 font-medium w-36">Grundform</th>
            <th className="py-2 pr-3 font-medium">Beschreibung</th>
            <th className="py-2 font-medium w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const entry = getOrBuildEntry(changeset, row.word, row);
            const isDeleted = entry !== undefined && entry.pending === null;
            const isInChangeset = entry !== undefined;
            const canAddNew = !limitReached;

            const displayBase =
              entry?.pending?.base !== undefined
                ? entry.pending.base
                : (row.base ?? "");
            const displayDescription =
              entry?.pending?.description !== undefined
                ? entry.pending.description
                : (row.description ?? "");

            const inputsDisabled = isDeleted || (!isInChangeset && !canAddNew);
            const deleteDisabled = !isDeleted && !isInChangeset && !canAddNew;

            return (
              <tr
                key={row.word}
                className={`border-b border-gray-100 ${isDeleted ? "opacity-40" : ""} ${isInChangeset && !isDeleted ? "bg-amber-50" : ""}`}
              >
                <td className="py-1.5 pr-3">
                  <Link
                    to={`/wort/${encodeURIComponent(row.word.toUpperCase())}`}
                    className="font-mono uppercase text-sky-700 hover:underline text-xs"
                  >
                    {row.word.toUpperCase()}
                  </Link>
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={displayBase}
                    disabled={inputsDisabled}
                    onChange={(e) =>
                      onChangesetChange((prev) =>
                        updateField(prev, row.word, row, "base", e.target.value)
                      )
                    }
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </td>
                <td className="py-1.5 pr-3">
                  <input
                    type="text"
                    value={displayDescription}
                    disabled={inputsDisabled}
                    onChange={(e) =>
                      onChangesetChange((prev) =>
                        updateField(prev, row.word, row, "description", e.target.value)
                      )
                    }
                    className="w-full rounded border border-gray-200 px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:bg-gray-50 disabled:text-gray-400"
                  />
                </td>
                <td className="py-1.5">
                  <button
                    type="button"
                    disabled={deleteDisabled}
                    onClick={() =>
                      onChangesetChange((prev) => toggleDelete(prev, row.word, row))
                    }
                    title={isDeleted ? "Wiederherstellen" : "Löschen"}
                    className={`rounded p-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
                      isDeleted
                        ? "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                        : "text-gray-400 hover:text-red-600 hover:bg-red-50"
                    }`}
                  >
                    {isDeleted ? <RotateCcw size={14} /> : <Trash2 size={14} />}
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
