import type { Changeset } from "~/hooks/useLocalStorageChangeset";
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
};

export function WordEditTable({ rows, changeset, onChangesetChange, limitReached, showOriginal }: Props) {
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
          {rows.map((row) => (
            <WordEditRow
              key={row.word}
              row={row}
              changeset={changeset}
              onChangesetChange={onChangesetChange}
              limitReached={limitReached}
              showOriginal={showOriginal}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
