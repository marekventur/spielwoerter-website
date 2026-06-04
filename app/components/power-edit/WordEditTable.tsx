import type { Changeset } from "~/hooks/useLocalStorageChangeset";
import { Checkbox } from "~/components/ui/checkbox";
import { WordEditRow } from "./WordEditRow";

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
  showOriginal?: boolean;
  selectedWords?: Set<string>;
  onSelectionChange?: (updater: (prev: Set<string>) => Set<string>) => void;
};

export function WordEditTable({
  rows,
  changeset,
  onChangesetChange,
  limitReached,
  showOriginal,
  selectedWords,
  onSelectionChange,
}: Props) {
  if (rows.length === 0) {
    return (
      <p className="text-sm text-gray-400 py-6 text-center">Keine Ergebnisse.</p>
    );
  }

  const anySelected = selectedWords ? rows.some((r) => selectedWords.has(r.word)) : false;
  const allSelected = selectedWords
    ? rows.length > 0 && rows.every((r) => selectedWords.has(r.word))
    : false;

  function handleHeaderToggle() {
    if (!onSelectionChange) return;
    if (anySelected) {
      onSelectionChange((prev) => {
        const next = new Set(prev);
        rows.forEach((r) => next.delete(r.word));
        return next;
      });
    } else {
      onSelectionChange((prev) => new Set([...prev, ...rows.map((r) => r.word)]));
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200 text-left text-xs text-gray-500 uppercase tracking-wide">
            {onSelectionChange && (
              <th className="py-2 pr-3 w-8">
                <Checkbox
                  checked={anySelected}
                  indeterminate={anySelected && !allSelected}
                  onChange={handleHeaderToggle}
                  label="Alle auswählen"
                />
              </th>
            )}
            <th className="py-2 pr-3 font-medium w-32">Wort</th>
            <th className="py-2 pr-3 font-medium w-36">Grundform</th>
            <th className="py-2 pr-3 font-medium">Beschreibung</th>
            <th className="py-2 font-medium w-10"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <WordEditRow
              key={row.word}
              row={row}
              changeset={changeset}
              onChangesetChange={onChangesetChange}
              limitReached={limitReached}
              showOriginal={showOriginal}
              selected={selectedWords?.has(row.word) ?? false}
              onToggleSelected={
                onSelectionChange
                  ? () =>
                      onSelectionChange((prev) => {
                        const next = new Set(prev);
                        if (next.has(row.word)) next.delete(row.word);
                        else next.add(row.word);
                        return next;
                      })
                  : undefined
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
