import { Link } from "react-router";
import { Trash2, RotateCcw } from "lucide-react";
import type { Changeset } from "~/hooks/useLocalStorageChangeset";
import { Checkbox } from "~/components/ui/checkbox";
import type { WordRow } from "./WordEditTable";

type RowProps = {
  row: WordRow;
  changeset: Changeset;
  onChangesetChange: (updater: (prev: Changeset) => Changeset) => void;
  limitReached: boolean;
  showOriginal?: boolean;
  selected?: boolean;
  onToggleSelected?: () => void;
};

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

export function WordEditRow({ row, changeset, onChangesetChange, limitReached, showOriginal, selected, onToggleSelected }: RowProps) {
  const entry = changeset.get(row.word);
  const isDeleted = entry !== undefined && entry.pending === null;
  const isInChangeset = entry !== undefined;
  const canAddNew = !limitReached;

  const displayBase =
    entry?.pending?.base !== undefined ? entry.pending.base : (row.base ?? "");
  const displayDescription =
    entry?.pending?.description !== undefined ? entry.pending.description : (row.description ?? "");

  const originalBase = entry?.original?.base ?? row.base ?? "";
  const originalDescription = entry?.original?.description ?? row.description ?? "";
  const showOriginalBase = showOriginal && entry?.pending?.base !== undefined && originalBase !== "";
  const showOriginalDescription = showOriginal && entry?.pending?.description !== undefined && originalDescription !== "";

  const baseChanged = entry?.pending?.base !== undefined;
  const descriptionChanged = entry?.pending?.description !== undefined;
  const inputsDisabled = isDeleted || (!isInChangeset && !canAddNew);
  const actionButtonDisabled = !isInChangeset && !canAddNew;

  return (
    <tr
      className={`border-b border-gray-100 ${isDeleted ? "bg-red-50" : ""} ${isInChangeset && !isDeleted ? "bg-amber-50" : ""}`}
    >
      {onToggleSelected && (
        <td className="py-1.5 pr-3 w-8">
          <Checkbox checked={selected ?? false} onChange={onToggleSelected} label={`${row.word} auswählen`} />
        </td>
      )}
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
            onChangesetChange((prev) => updateField(prev, row.word, row, "base", e.target.value))
          }
          className={`w-full rounded border px-2 py-1 text-xs font-mono uppercase focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:bg-gray-50 disabled:text-gray-400 ${baseChanged ? "border-green-300 bg-green-50" : "border-gray-200"}`}
        />
        {showOriginalBase && (
          <p className="mt-0.5 px-2 text-xs font-mono uppercase text-gray-400 line-through">
            {originalBase}
          </p>
        )}
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
          className={`w-full rounded border px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-sky-400 disabled:bg-gray-50 disabled:text-gray-400 ${descriptionChanged ? "border-green-300 bg-green-50" : "border-gray-200"}`}
        />
        {showOriginalDescription && (
          <p className="mt-0.5 px-2 text-xs text-gray-400 line-through">
            {originalDescription}
          </p>
        )}
      </td>
      <td className="py-1.5">
        <button
          type="button"
          disabled={actionButtonDisabled}
          onClick={() =>
            onChangesetChange((prev) => {
              const next = new Map(prev);
              if (isInChangeset) {
                next.delete(row.word);
              } else {
                const original = { base: row.base, description: row.description };
                next.set(row.word, { original, pending: null });
              }
              return next;
            })
          }
          title={isInChangeset ? "Zurücksetzen" : "Löschen"}
          className={`rounded p-1 transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${
            isInChangeset
              ? "text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              : "text-gray-400 hover:text-red-600 hover:bg-red-50"
          }`}
        >
          {isInChangeset ? <RotateCcw size={14} /> : <Trash2 size={14} />}
        </button>
      </td>
    </tr>
  );
}
