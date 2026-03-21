import { useState } from "react";
import { Link, redirect } from "react-router";
import { Pencil, X } from "lucide-react";
import { Card } from "~/components/ui/card";
import type { Route } from "./+types/meine-vorschlaege";

type Suggestion = {
  id: number;
  word: string;
  action: string;
  payload: string | null;
  status: string;
  created_at: string;
  last_modified_at: string;
  word_description: string | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  pending_review: "In Prüfung",
  ai_approved: "KI-genehmigt",
  ai_rejected: "Abgelehnt (KI)",
  moderator_approved: "Genehmigt",
  moderator_rejected: "Abgelehnt",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-blue-100 text-blue-700",
  ai_approved: "bg-green-100 text-green-700",
  ai_rejected: "bg-red-100 text-red-700",
  moderator_approved: "bg-green-100 text-green-700",
  moderator_rejected: "bg-red-100 text-red-700",
};

function parsePayload(s: Suggestion): Record<string, string> | null {
  if (!s.payload) return null;
  try {
    return JSON.parse(s.payload) as Record<string, string>;
  } catch {
    return null;
  }
}

function wortHref(word: string) {
  return `/wort/${encodeURIComponent(word.toUpperCase())}`;
}

function SuggestionMainCell({ s }: { s: Suggestion }) {
  const payload = parsePayload(s);
  const wordUpper = s.word.toUpperCase();

  if (s.action === "add") {
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="text-green-700">
          <Link
            to={wortHref(s.word)}
            className="uppercase hover:text-orange-600 font-bold"
          >
            {wordUpper}
          </Link> (neu)
        </div>
        {payload?.description && (
          <p className="text-green-700 text-sm leading-snug whitespace-pre-wrap break-words">
            {payload.description}
          </p>
        )}
        {payload?.base && (
          <p className="text-green-600/90 text-xs">
            Grundform: <span className="font-mono">{payload.base}</span>
          </p>
        )}
      </div>
    );
  }

  if (s.action === "remove") {
    return (
      <div className="min-w-0 space-y-0.5">
        <div className="text-red-700">
          <Link
            to={wortHref(s.word)}
            className="uppercase hover:text-orange-600  font-bold"
          >
            {wordUpper}
          </Link> (entfernt)
        </div>
        {s.word_description && (
          <p className="text-red-700 text-sm leading-snug whitespace-pre-wrap break-words">
            {s.word_description}
          </p>
        )}
      </div>
    );
  }

  if (s.action === "change_description") {
    return (
      <div className="min-w-0 space-y-0.5">
        <Link
          to={wortHref(s.word)}
          className="font-bold text-gray-900 uppercase hover:text-orange-600"
        >
          {wordUpper}
        </Link>
        {s.word_description && (
          <p className="text-red-700 text-sm leading-snug whitespace-pre-wrap break-words">
            {s.word_description}
          </p>
        )}
        {payload?.description && (
          <p className="text-green-700 text-sm leading-snug whitespace-pre-wrap break-words">
            {payload.description}
          </p>
        )}
      </div>
    );
  }

  return (
    <Link
      to={wortHref(s.word)}
      className="font-bold text-gray-900 uppercase hover:text-orange-600"
    >
      {wordUpper}
    </Link>
  );
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Meine Vorschläge – Spielwörter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) {
    return redirect("/login?from=/meine-vorschlaege");
  }

  const suggestions = context.db
    .prepare(
      `SELECT s.id, s.word, s.action, s.payload, s.status,
              s.created_at, s.last_modified_at, w.description AS word_description
       FROM suggestions s
       LEFT JOIN words w ON w.word = s.word
       WHERE s.user_id = ?
       ORDER BY s.last_modified_at DESC`
    )
    .all(context.user.id) as Suggestion[];

  return { user: context.user, suggestions };
}

export default function MeineVorschlaege({ loaderData }: Route.ComponentProps) {
  const { suggestions } = loaderData;
  const [deleting, setDeleting] = useState<number | null>(null);
  const [patching, setPatching] = useState<number | null>(null);
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set());
  const [payloadOverrides, setPayloadOverrides] = useState<
    Record<number, string | null>
  >({});

  const withPayload = (s: Suggestion): Suggestion => ({
    ...s,
    payload: payloadOverrides[s.id] ?? s.payload,
  });

  const drafts = suggestions.filter(
    (s) => s.status === "draft" && !localDeleted.has(s.id)
  );
  const others = suggestions.filter(
    (s) => s.status !== "draft" && !localDeleted.has(s.id)
  );

  const handleDelete = async (id: number) => {
    setDeleting(id);
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setLocalDeleted((prev) => new Set(prev).add(id));
    }
    setDeleting(null);
  };

  const handleEditDescription = async (s: Suggestion) => {
    const effective = withPayload(s);
    const payload = parsePayload(effective);
    const current = payload?.description ?? "";
    const next = window.prompt("Beschreibung bearbeiten:", current);
    if (next === null) return;

    setPatching(s.id);
    const res = await fetch(`/api/suggestions/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: { description: next } }),
    });
    setPatching(null);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Speichern fehlgeschlagen.");
      return;
    }

    const merged = { ...(payload ?? {}), description: next };
    setPayloadOverrides((prev) => ({
      ...prev,
      [s.id]: JSON.stringify(merged),
    }));
  };

  return (
    <div>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Meine Vorschläge</h1>
        <p className="text-gray-500 mb-8 text-sm">
          Entwürfe gehen nach <strong>60 Minuten</strong> ohne Änderung automatisch in die Prüfung.
        </p>

        {/* Entwürfe */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-700 mb-3">
            Entwürfe
            {drafts.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">
                ({drafts.length})
              </span>
            )}
          </h2>

          {drafts.length === 0 ? (
            <Card className="p-6 text-center text-gray-400">
              <p>Keine Entwürfe.</p>
              <p className="text-sm mt-1">
                <Link to="/" className="text-orange-600 hover:underline">
                  Wort nachschlagen
                </Link>{" "}
                und einen Vorschlag erstellen.
              </p>
            </Card>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {drafts.map((s) => {
                    const row = withPayload(s);
                    return (
                      <tr
                        key={s.id}
                        className="border-b border-gray-100 last:border-0"
                      >
                        <td className="py-2.5 px-3 align-top">
                          <SuggestionMainCell s={row} />
                        </td>
                        <td className="py-2.5 px-2 align-top w-px">
                          <div className="flex items-start gap-1 justify-end">
                            {s.action !== "remove" && (
                              <button
                                type="button"
                                aria-label="Beschreibung bearbeiten"
                                disabled={patching === s.id || deleting === s.id}
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => handleEditDescription(s)}
                              >
                                {patching === s.id ? (
                                  <span className="text-xs text-gray-500">
                                    …
                                  </span>
                                ) : (
                                  <Pencil className="h-4 w-4" strokeWidth={2} />
                                )}
                              </button>
                            )}
                            <button
                              type="button"
                              aria-label="Löschen"
                              disabled={deleting === s.id || patching === s.id}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-red-600 hover:bg-red-50 hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:opacity-50"
                              onClick={() => handleDelete(s.id)}
                            >
                              {deleting === s.id ? (
                                <span className="text-xs text-gray-500">…</span>
                              ) : (
                                <X className="h-5 w-5" strokeWidth={2.5} />
                              )}
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {/* In review / decided */}
        {others.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-3">
              In Prüfung / Entschieden
            </h2>
            <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
              <table className="w-full text-sm border-collapse">
                <tbody>
                  {others.map((s) => (
                    <tr
                      key={s.id}
                      className="border-b border-gray-100 last:border-0"
                    >
                      <td className="py-2.5 px-3 align-top">
                        <SuggestionMainCell s={s} />
                        <p className="mt-1.5">
                          <span
                            className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}
                          >
                            {STATUS_LABELS[s.status] ?? s.status}
                          </span>
                        </p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
