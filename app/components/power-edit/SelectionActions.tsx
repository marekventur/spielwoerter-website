import { Trash2, RotateCcw, Pencil } from "lucide-react";
import type { Changeset } from "~/hooks/useLocalStorageChangeset";
import type { WordRow } from "./WordEditTable";

type Props = {
  selectedWords: Set<string>;
  rows: WordRow[];
  changeset: Changeset;
  onChangesetChange: (updater: (prev: Changeset) => Changeset) => void;
};

export function SelectionActions({ selectedWords, rows, changeset, onChangesetChange }: Props) {
  if (selectedWords.size === 0) return null;

  const rowByWord = new Map(rows.map((r) => [r.word, r]));

  function getOriginal(word: string) {
    const entry = changeset.get(word);
    const row = rowByWord.get(word);
    return entry?.original ?? { base: row?.base ?? null, description: row?.description ?? null };
  }

  function handleDeleteAll() {
    onChangesetChange((prev) => {
      const next = new Map(prev);
      for (const word of selectedWords) {
        const entry = next.get(word);
        if (entry?.pending === null) continue;
        next.set(word, { original: getOriginal(word), pending: null });
      }
      return next;
    });
  }

  function handleRestoreAll() {
    onChangesetChange((prev) => {
      const next = new Map(prev);
      for (const word of selectedWords) next.delete(word);
      return next;
    });
  }

  function handleChangeBaseAll() {
    const input = window.prompt(`Neue Grundform für ${selectedWords.size} Wörter:`);
    if (input === null) return;
    const value = input.toLowerCase();

    onChangesetChange((prev) => {
      const next = new Map(prev);
      for (const word of selectedWords) {
        const entry = next.get(word);
        if (entry?.pending === null) continue; // skip deleted rows
        const original = getOriginal(word);
        const originalValue = (original.base ?? "").trim();
        const changed = value.trim() !== originalValue;
        const currentPending = entry?.pending ?? {};
        const newPending: { base?: string; description?: string } = { ...currentPending };
        if (changed) {
          newPending.base = value;
        } else {
          delete newPending.base;
        }
        if (Object.keys(newPending).length === 0) {
          next.delete(word);
        } else {
          next.set(word, { original, pending: newPending });
        }
      }
      return next;
    });
  }

  return (
    <div className="sticky bottom-4 z-10 mt-4 bg-white rounded-lg border border-gray-200 px-4 py-3 shadow-[2px_3px_6px_rgba(0,0,0,0.07)] flex items-center gap-3">
      <span className="text-xs text-gray-500 mr-1">
        {selectedWords.size} ausgewählt
      </span>
      <ActionButton icon={<Trash2 size={14} />} onClick={handleDeleteAll}>
        Alle löschen
      </ActionButton>
      <ActionButton icon={<RotateCcw size={14} />} onClick={handleRestoreAll}>
        Alle wiederherstellen
      </ActionButton>
      <ActionButton icon={<Pencil size={14} />} onClick={handleChangeBaseAll}>
        Alle Grundformen ändern
      </ActionButton>
    </div>
  );
}

function ActionButton({
  icon,
  onClick,
  children,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50 hover:border-gray-300 transition-colors"
    >
      {icon}
      {children}
    </button>
  );
}
