type SearchMode = "partial" | "start" | "end" | "exact";
type SearchField = "word" | "base" | "description";

const MODE_LABELS: Record<SearchMode, string> = {
  partial: "Teilweise",
  start: "Wortanfang",
  end: "Wortende",
  exact: "Ganzes Wort",
};

const FIELD_LABELS: Record<SearchField, string> = {
  word: "Wort",
  base: "Grundform",
  description: "Beschreibung",
};

export const ALL_FIELDS: SearchField[] = ["word", "base", "description"];
export type { SearchMode, SearchField };

type Props = {
  query: string;
  onQueryChange: (v: string) => void;
  mode: SearchMode;
  onModeChange: (v: SearchMode) => void;
  fields: SearchField[];
  onFieldsChange: (v: SearchField[]) => void;
  regex: boolean;
  onRegexChange: (v: boolean) => void;
  hasMore?: boolean;
};

export function SearchControls({
  query,
  onQueryChange,
  mode,
  onModeChange,
  fields,
  onFieldsChange,
  regex,
  onRegexChange,
  hasMore = false,
}: Props) {
  function toggleField(f: SearchField) {
    onFieldsChange(
      fields.includes(f)
        ? fields.length > 1 ? fields.filter((x) => x !== f) : fields
        : [...fields, f]
    );
  }

  return (
    <div className="sticky top-[70px] z-10 bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3 shadow-[2px_3px_6px_rgba(0,0,0,0.07)]">
      <div className="flex">
        <input
          type="text"
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Suchbegriff eingeben…"
          className="min-w-0 flex-1 rounded-l-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:z-10 focus:ring-2 focus:ring-sky-400"
        />
        <div className="relative">
          <select
            value={mode}
            onChange={(e) => onModeChange(e.target.value as SearchMode)}
            className="appearance-none rounded-r-lg border border-l-0 border-gray-300 pl-3 pr-8 py-2 text-sm focus:outline-none focus:z-10 focus:ring-2 focus:ring-sky-400 bg-gray-50"
          >
            {(Object.entries(MODE_LABELS) as [SearchMode, string][]).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
          <svg
            className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400"
            width="12" height="12" viewBox="0 0 12 12" fill="none"
          >
            <path d="M2.5 4.5L6 8l3.5-3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
      </div>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex">
            {ALL_FIELDS.map((f, i) => (
              <button
                key={f}
                type="button"
                onClick={() => toggleField(f)}
                className={`px-2 py-1 text-xs font-medium border-y border-r transition-colors
                  ${i === 0 ? "rounded-l border-l" : ""}
                  ${i === ALL_FIELDS.length - 1 ? "rounded-r" : ""}
                  ${fields.includes(f)
                    ? "bg-sky-100 text-sky-800 border-sky-400"
                    : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
                  }`}
              >
                {FIELD_LABELS[f]}
              </button>
            ))}
          </div>

          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={regex}
              onChange={(e) => onRegexChange(e.target.checked)}
              className="rounded border-gray-300"
            />
            Regex
          </label>
        </div>

        {hasMore && (
          <span className="text-xs text-amber-600 whitespace-nowrap">
            Zu viele Ergebnisse – bitte Suche verfeinern.
          </span>
        )}
      </div>
    </div>
  );
}
