import { Link } from "react-router";
import { WordBadge, type WordBadgeStatus } from "~/components/WordBadge";

export type WordLemmaDescriptionRow = {
  word: string;
  description: string | null;
  /** When set, the lemma is shown as a linked WordBadge; otherwise as a text link. */
  badgeStatus?: WordBadgeStatus;
};

export function WordLemmaDescriptionTable({ rows }: { rows: WordLemmaDescriptionRow[] }) {
  if (rows.length === 0) return null;

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-100 bg-white/60 px-4 py-1 shadow-sm">
      {rows.map(({ word, description, badgeStatus }) => (
        <li
          key={word}
          className="flex flex-col gap-1 py-3 sm:flex-row sm:items-baseline sm:gap-x-6 sm:gap-y-0"
        >
          <Link
            to={`/wort/${encodeURIComponent(word.toUpperCase())}`}
            className={
              badgeStatus
                ? "w-fit max-w-full shrink-0 transition-opacity hover:opacity-80"
                : "w-fit shrink-0 text-sm font-semibold text-orange-600 hover:underline"
            }
          >
            {badgeStatus ? (
              <WordBadge word={word.toUpperCase()} status={badgeStatus} size="sm" />
            ) : (
              word.toUpperCase()
            )}
          </Link>
          <span className="min-w-0 flex-1 text-sm text-gray-600 whitespace-pre-wrap break-words">
            {description?.trim() ? description : ""}
          </span>
        </li>
      ))}
    </ul>
  );
}
