import { useEffect, useRef, useState } from "react";
import type { WordRow } from "~/components/power-edit/WordEditTable";
import type { SearchMode, SearchField } from "~/components/power-edit/SearchControls";

const LIMIT = 200;

// Module-level singleton — survives re-renders and remounts, never re-fetched
let dictCache: WordRow[] | null = null;
let dictPromise: Promise<WordRow[]> | null = null;

export function loadDictionary(): Promise<WordRow[]> {
  if (dictCache) return Promise.resolve(dictCache);
  if (!dictPromise) {
    dictPromise = fetch("/api/words/all")
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json() as Promise<{ words: WordRow[] }>;
      })
      .then(({ words }) => {
        dictCache = words;
        return words;
      })
      .catch((err) => {
        dictPromise = null; // allow retry on next mount
        throw err;
      });
  }
  return dictPromise;
}

function filterLocally(
  dictionary: WordRow[],
  query: string,
  mode: SearchMode,
  fields: SearchField[],
  regex: boolean,
): { words: WordRow[]; hasMore: boolean } {
  let matched: WordRow[];

  if (regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, "i");
    } catch {
      return { words: [], hasMore: false };
    }
    matched = dictionary.filter((row) =>
      fields.some((f) => re.test(row[f] ?? ""))
    );
  } else {
    const terms = query.split(/[,\s]+/).filter(Boolean).slice(0, 20);
    matched = dictionary.filter((row) =>
      terms.some((term) => {
        const t = term.toLowerCase();
        return fields.some((f) => {
          const v = (row[f] ?? "").toLowerCase();
          switch (mode) {
            case "start": return v.startsWith(t);
            case "end":   return v.endsWith(t);
            case "exact": return v === t;
            default:      return v.includes(t); // partial
          }
        });
      })
    );
  }

  return { words: matched.slice(0, LIMIT), hasMore: matched.length > LIMIT };
}

type UsePowerSearchResult = {
  results: WordRow[] | null;
  hasMore: boolean;
  isLoading: boolean;
  error: string | null;
  isLocalSearch: boolean; // useful for showing a status indicator
};

export function usePowerSearch(
  query: string,
  mode: SearchMode,
  fields: SearchField[],
): UsePowerSearchResult {
  const regex = mode === "regex";
  const [dictionary, setDictionary] = useState<WordRow[] | null>(dictCache);
  const [results, setResults] = useState<WordRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Kick off dictionary load immediately; fall back silently on failure
  useEffect(() => {
    if (dictCache) return;
    loadDictionary()
      .then((words) => setDictionary(words))
      .catch(() => {}); // server-side search remains active as fallback
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      setResults(null);
      setHasMore(false);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (dictionary) {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      abortRef.current?.abort();
      const { words, hasMore } = filterLocally(dictionary, query, mode, fields, regex);
      setResults(words);
      setHasMore(hasMore);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      abortRef.current?.abort();
      abortRef.current = new AbortController();
      const signal = abortRef.current.signal;

      setIsLoading(true);
      setError(null);

      const params = new URLSearchParams({
        q: query,
        mode,
        fields: fields.join(","),
        regex: regex ? "1" : "0",
      });

      fetch(`/api/words/search?${params.toString()}`, { signal })
        .then((res) => {
          if (!res.ok) return res.json().then((d: { error?: string }) => Promise.reject(d.error ?? "Fehler bei der Suche"));
          return res.json() as Promise<{ words: WordRow[]; hasMore: boolean }>;
        })
        .then(({ words, hasMore }) => {
          setResults(words);
          setHasMore(hasMore);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") return;
          setError(typeof err === "string" ? err : "Netzwerkfehler");
        })
        .finally(() => setIsLoading(false));
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, mode, fields, dictionary]);

  return { results, hasMore, isLoading, error, isLocalSearch: dictionary !== null };
}
