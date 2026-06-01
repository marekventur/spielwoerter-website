import { useEffect, useRef, useState } from "react";
import { redirect } from "react-router";
import { AlertTriangle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { WordEditTable, type WordRow } from "~/components/power-edit/WordEditTable";
import { SearchControls, ALL_FIELDS, type SearchMode, type SearchField } from "~/components/power-edit/SearchControls";
import { useLocalStorageChangeset } from "~/hooks/useLocalStorageChangeset";
import type { Route } from "./+types/power-edit";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Wörterbuch bearbeiten – Spielwoerter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/power-edit");
  return { user: { isModerator: context.user.isModerator } };
}

export default function PowerEditPage({ loaderData }: Route.ComponentProps) {
  const { user } = loaderData;
  const limit = user.isModerator ? 500 : 100;

  const [changeset, setChangeset, clearChangeset] = useLocalStorageChangeset();
  const [activeTab, setActiveTab] = useState<"search" | "checkout">("search");

  // Search state
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("partial");
  const [fields, setFields] = useState<SearchField[]>(["word", "base"]);
  const [regex, setRegex] = useState(false);
  const [results, setResults] = useState<WordRow[] | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Checkout state
  const [batchMessage, setBatchMessage] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitSuccess, setSubmitSuccess] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-switch away from checkout if changeset becomes empty
  useEffect(() => {
    if (activeTab === "checkout" && changeset.size === 0) {
      setActiveTab("search");
    }
  }, [activeTab, changeset.size]);

  // Debounced search
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (!query.trim()) {
      setResults(null);
      setHasMore(false);
      return;
    }
    debounceRef.current = setTimeout(() => {
      void runSearch();
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, mode, fields, regex]);

  async function runSearch() {
    setSearching(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({
        q: query,
        mode,
        fields: fields.join(","),
        regex: regex ? "1" : "0",
      });
      const res = await fetch(`/api/words/search?${params.toString()}`);
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setSearchError(data.error ?? "Fehler bei der Suche");
        return;
      }
      const data = (await res.json()) as { words: WordRow[]; hasMore: boolean };
      setResults(data.words);
      setHasMore(data.hasMore);
    } catch {
      setSearchError("Netzwerkfehler");
    } finally {
      setSearching(false);
    }
  }

  async function submitBatch() {
    if (changeset.size === 0) return;
    setSubmitting(true);
    setSubmitError(null);

    const changes = Array.from(changeset.entries()).map(([word, entry]) => {
      if (entry.pending === null) {
        return { word, type: "remove" as const };
      }
      return {
        word,
        type: "change_description" as const,
        payload: entry.pending,
      };
    });

    try {
      const res = await fetch("/api/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: batchMessage || undefined, changes }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) {
        setSubmitError(data.error ?? "Fehler beim Einreichen");
        return;
      }
      clearChangeset();
      setBatchMessage("");
      setSubmitSuccess(true);
      setActiveTab("search");
    } catch {
      setSubmitError("Netzwerkfehler");
    } finally {
      setSubmitting(false);
    }
  }

  const limitReached = changeset.size >= limit;

  // Rows for checkout tab derived from changeset
  const checkoutRows: WordRow[] = Array.from(changeset.entries()).map(([word, entry]) => ({
    word,
    base: entry.original.base,
    description: entry.original.description,
  }));

  const changeCount = changeset.size;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-5xl mx-auto px-4 py-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-6">Wörterbuch bearbeiten</h1>

        {/* Limit warning banner */}
        {limitReached && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
            <AlertTriangle size={16} className="shrink-0" />
            <span>
              Du hast {changeCount} Änderungen gesammelt – bitte reiche sie zuerst ein.
            </span>
            <button
              className="ml-auto underline hover:no-underline"
              onClick={() => setActiveTab("checkout")}
            >
              Zu den Änderungen
            </button>
          </div>
        )}

        {/* Success banner */}
        {submitSuccess && (
          <div className="mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-3 text-sm text-green-800">
            Änderungen erfolgreich eingereicht.{" "}
            <button className="underline" onClick={() => setSubmitSuccess(false)}>
              Schließen
            </button>
          </div>
        )}

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-gray-200">
          <TabButton active={activeTab === "search"} onClick={() => setActiveTab("search")}>
            Textsuche
          </TabButton>
          {changeCount > 0 && (
            <TabButton active={activeTab === "checkout"} onClick={() => setActiveTab("checkout")}>
              Änderung bestätigen{" "}
              <span className="ml-1 rounded-full bg-amber-500 text-white text-xs px-1.5 py-0.5">
                {changeCount}
              </span>
            </TabButton>
          )}
        </div>

        {/* Search tab */}
        {activeTab === "search" && (
          <div>
            <SearchControls
              query={query}
              onQueryChange={setQuery}
              mode={mode}
              onModeChange={setMode}
              fields={fields}
              onFieldsChange={setFields}
              regex={regex}
              onRegexChange={setRegex}
            />

            {/* Results */}
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              {searching && (
                <p className="text-sm text-gray-400 py-4 text-center">Suche läuft…</p>
              )}
              {searchError && (
                <p className="text-sm text-red-600 py-4 text-center">{searchError}</p>
              )}
              {!searching && results !== null && (
                <>
                  {hasMore && (
                    <p className="text-xs text-amber-700 mb-3">
                      Zu viele Ergebnisse – bitte Suche verfeinern.
                    </p>
                  )}
                  <WordEditTable
                    rows={results}
                    changeset={changeset}
                    onChangesetChange={setChangeset}
                    limitReached={limitReached}
                  />
                </>
              )}
              {!searching && results === null && !searchError && (
                <p className="text-sm text-gray-400 py-4 text-center">
                  Suchbegriff eingeben, um Wörter zu suchen.
                </p>
              )}
            </div>
          </div>
        )}

        {/* Checkout tab */}
        {activeTab === "checkout" && (
          <div>
            <div className="bg-white rounded-lg border border-gray-200 p-4 mb-4 space-y-3">
              <p className="text-sm text-gray-600">
                {changeCount} Änderung{changeCount !== 1 ? "en" : ""} bereit zum Einreichen.
                {!user.isModerator && (
                  <span className="text-gray-400"> Diese gehen zur Prüfung.</span>
                )}
                {user.isModerator && (
                  <span className="text-gray-400"> Als Moderator werden sie direkt übernommen.</span>
                )}
              </p>
              <textarea
                value={batchMessage}
                onChange={(e) => setBatchMessage(e.target.value)}
                maxLength={200}
                rows={2}
                placeholder="Kurze Zusammenfassung (optional) – z. B. »Pluralformen von Tierbezeichnungen korrigiert«"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
              />
              {submitError && (
                <p className="text-sm text-red-600">{submitError}</p>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={() => void submitBatch()}
                  disabled={submitting || changeset.size === 0}
                  className="bg-sky-600 hover:bg-sky-700 text-white"
                >
                  {submitting ? "Wird eingereicht…" : "Einreichen"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => {
                    if (confirm(`Alle ${changeCount} Änderungen verwerfen?`)) {
                      clearChangeset();
                    }
                  }}
                >
                  Alle verwerfen
                </Button>
              </div>
            </div>

            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <WordEditTable
                rows={checkoutRows}
                changeset={changeset}
                onChangesetChange={setChangeset}
                limitReached={false}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1 px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
        active
          ? "border-sky-600 text-sky-700"
          : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
      }`}
    >
      {children}
    </button>
  );
}
