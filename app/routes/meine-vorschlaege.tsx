import { useState } from "react";
import { Link, redirect } from "react-router";
import { Pencil, X } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
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
  word_base: string | null;
  moderation_comment: string | null;
  original_payload: string | null;
};

type OriginalPayload = {
  word: string;
  payload: Record<string, string> | null;
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  pending_review: "In Prüfung",
  needs_moderator: "In Prüfung",
  ai_approved: "KI-genehmigt",
  ai_rejected: "Abgelehnt (KI)",
  moderator_approved: "Genehmigt",
  moderator_rejected: "Abgelehnt",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-gray-100 text-gray-700",
  pending_review: "bg-blue-100 text-blue-700",
  needs_moderator: "bg-blue-100 text-blue-700",
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
    const oldDesc = (s.word_description ?? "").trim();
    const newDesc = (payload?.description ?? "").trim();
    const descChanged = oldDesc !== newDesc;

    const oldBase = (s.word_base ?? "").trim().toLowerCase();
    const newBase = (payload?.base ?? "").trim().toLowerCase();
    const baseChanged = oldBase !== newBase;

    const displayDesc = (payload?.description ?? s.word_description ?? "").trim();
    const displayBase = payload?.base ?? s.word_base;

    return (
      <div className="min-w-0 space-y-0.5">
        <div className="text-gray-700 text-sm font-medium">Beschreibung / Grundform ändern</div>
        <Link
          to={wortHref(s.word)}
          className="font-bold text-gray-900 uppercase hover:text-orange-600"
        >
          {wordUpper}
        </Link>
        {descChanged ? (
          <>
            {oldDesc !== "" && (
              <p className="text-red-700 text-sm leading-snug whitespace-pre-wrap break-words">
                {s.word_description}
              </p>
            )}
            {newDesc !== "" && (
              <p className="text-green-700 text-sm leading-snug whitespace-pre-wrap break-words">
                {payload?.description}
              </p>
            )}
          </>
        ) : (
          displayDesc !== "" && (
            <p className="text-gray-900 text-sm leading-snug whitespace-pre-wrap break-words">
              {payload?.description ?? s.word_description}
            </p>
          )
        )}
        {(s.word_base || payload?.base) &&
          (baseChanged ? (
            <p className="text-xs space-y-0.5">
              {(s.word_base ?? "").trim() !== "" && (
                <span className="text-red-700 block">
                  Grundform bisher: <span className="font-mono">{s.word_base}</span>
                </span>
              )}
              {(payload?.base ?? "").trim() !== "" && (
                <span className="text-green-700 block">
                  Grundform neu: <span className="font-mono">{payload?.base}</span>
                </span>
              )}
            </p>
          ) : (
            (displayBase ?? "").trim() !== "" && (
              <p className="text-xs text-gray-700">
                Grundform: <span className="font-mono">{displayBase}</span>
              </p>
            )
          ))}
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

/** Moderator feedback: rejection reason and/or "approved with corrections" diff. */
function ModerationNotes({ s }: { s: Suggestion }) {
  let original: OriginalPayload | null = null;
  if (s.original_payload && s.status === "moderator_approved") {
    try {
      original = JSON.parse(s.original_payload) as OriginalPayload;
    } catch {
      /* ignore invalid JSON */
    }
  }

  const payload = parsePayload(s);
  const diffs: { label: string; from: string; to: string }[] = [];
  if (original) {
    if (original.word !== s.word) {
      diffs.push({ label: "Wort", from: original.word, to: s.word });
    }
    const origDesc = (original.payload?.description ?? "").trim();
    const newDesc = (payload?.description ?? "").trim();
    if (origDesc !== newDesc) {
      diffs.push({ label: "Beschreibung", from: origDesc || "–", to: newDesc || "–" });
    }
    const origBase = (original.payload?.base ?? "").trim();
    const newBase = (payload?.base ?? "").trim();
    if (origBase !== newBase) {
      diffs.push({ label: "Grundform", from: origBase || "–", to: newBase || "–" });
    }
  }

  if (!s.moderation_comment && diffs.length === 0) return null;

  return (
    <div className="mt-2 space-y-2">
      {diffs.length > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          <p className="font-medium mb-1">Mit Anpassungen angenommen:</p>
          <ul className="space-y-0.5">
            {diffs.map((d) => (
              <li key={d.label}>
                {d.label}:{" "}
                <span className="line-through text-amber-700/70">{d.from}</span>{" "}
                → <span className="font-medium">{d.to}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {s.moderation_comment && (
        <div className="rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-700">
          <span className="font-medium">Kommentar der Moderation:</span>{" "}
          {s.moderation_comment}
        </div>
      )}
    </div>
  );
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Meine Vorschläge – Spielwoerter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) {
    return redirect("/login?from=/meine-vorschlaege");
  }

  const suggestions = context.db
    .prepare(
      `SELECT s.id, s.word, s.action, s.payload, s.status,
              s.created_at, s.last_modified_at, w.description AS word_description,
              w.base AS word_base, s.moderation_comment, s.original_payload
       FROM suggestions s
       LEFT JOIN words w ON w.word = s.word
       WHERE s.user_id = ?
       ORDER BY s.last_modified_at DESC`
    )
    .all(context.user.id) as Suggestion[];

  return { user: context.user, suggestions };
}

export default function MeineVorschlaege({ loaderData }: Route.ComponentProps) {
  const { user, suggestions } = loaderData;
  const [deleting, setDeleting] = useState<number | null>(null);
  const [patching, setPatching] = useState<number | null>(null);
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set());
  const [payloadOverrides, setPayloadOverrides] = useState<
    Record<number, string | null>
  >({});
  const [editingDraftId, setEditingDraftId] = useState<number | null>(null);
  const [editDescription, setEditDescription] = useState("");
  const [editBase, setEditBase] = useState("");

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

  const openDraftEditor = (s: Suggestion) => {
    const effective = withPayload(s);
    const payload = parsePayload(effective) ?? {};
    setEditingDraftId(s.id);
    setEditDescription(
      s.action === "change_description"
        ? (payload.description ?? s.word_description ?? "")
        : (payload.description ?? "")
    );
    setEditBase(
      s.action === "change_description"
        ? (payload.base ?? s.word_base ?? "")
        : (payload.base ?? "")
    );
  };

  const cancelDraftEditor = () => {
    setEditingDraftId(null);
  };

  const confirmDraftEdit = async (s: Suggestion) => {
    const effective = withPayload(s);
    const payload = parsePayload(effective) ?? {};
    const nextDesc = editDescription;
    const nextBaseRaw = editBase;
    const baseNorm = nextBaseRaw.trim().toLowerCase();

    if (s.action === "change_description") {
      const origDesc = (s.word_description ?? "").trim();
      const origBase = (s.word_base ?? "").trim().toLowerCase();
      if (nextDesc.trim() === origDesc && baseNorm === origBase) {
        setPatching(s.id);
        const res = await fetch(`/api/suggestions/${s.id}`, {
          method: "DELETE",
        });
        setPatching(null);
        if (!res.ok) {
          const data = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          window.alert(data.error ?? "Löschen fehlgeschlagen.");
          return;
        }
        setLocalDeleted((prev) => new Set(prev).add(s.id));
        setPayloadOverrides((prev) => {
          const next = { ...prev };
          delete next[s.id];
          return next;
        });
        setEditingDraftId(null);
        return;
      }
    }

    const patch: Record<string, string> = { description: nextDesc };
    const prevBase = (
      s.action === "change_description"
        ? (payload.base ?? s.word_base ?? "")
        : (payload.base ?? "")
    )
      .trim()
      .toLowerCase();
    if (baseNorm !== prevBase) {
      patch.base = baseNorm;
    }

    setPatching(s.id);
    const res = await fetch(`/api/suggestions/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ payload: patch }),
    });
    setPatching(null);

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Speichern fehlgeschlagen.");
      return;
    }

    const merged = { ...payload, ...patch };
    setPayloadOverrides((prev) => ({
      ...prev,
      [s.id]: JSON.stringify(merged),
    }));
    setEditingDraftId(null);
  };

  return (
    <div>
      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Meine Vorschläge</h1>
        <p className="text-gray-500 mb-8 text-sm">
          Entwürfe gehen nach <strong>60 Minuten</strong> ohne Änderung automatisch in die Prüfung.
          {user.isModerator && (
            <>
              {" "}
              Löschungen von Moderator:innen werden erst nach <strong>72 Stunden</strong>{" "}
              übernommen, damit ein zweites Augenpaar draufschauen kann.
            </>
          )}
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
                          {editingDraftId === s.id && (
                            <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-2">
                              <div className="min-w-0 flex-1">
                                <label
                                  htmlFor={`draft-desc-${s.id}`}
                                  className="mb-1 block text-xs font-medium text-gray-600"
                                >
                                  Beschreibung
                                </label>
                                <Input
                                  id={`draft-desc-${s.id}`}
                                  value={editDescription}
                                  onChange={(e) => setEditDescription(e.target.value)}
                                  disabled={patching === s.id}
                                  className="w-full min-w-0 py-1.5 text-sm"
                                />
                              </div>
                              <div className="w-36 shrink-0">
                                <label
                                  htmlFor={`draft-base-${s.id}`}
                                  className="mb-1 block text-xs font-medium text-gray-600"
                                >
                                  Grundform
                                </label>
                                <Input
                                  id={`draft-base-${s.id}`}
                                  value={editBase}
                                  onChange={(e) => setEditBase(e.target.value)}
                                  disabled={patching === s.id}
                                  className="w-full min-w-0 py-1.5 font-mono text-sm"
                                />
                              </div>
                              <div className="flex shrink-0 gap-2 pb-0.5 max-sm:w-full max-sm:justify-end">
                                <button
                                  type="button"
                                  className="rounded-lg bg-orange-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-orange-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  disabled={patching === s.id}
                                  onClick={() => void confirmDraftEdit(s)}
                                >
                                  {patching === s.id ? "…" : "Bestätigen"}
                                </button>
                                <button
                                  type="button"
                                  className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                  disabled={patching === s.id}
                                  onClick={cancelDraftEditor}
                                >
                                  Abbrechen
                                </button>
                              </div>
                            </div>
                          )}
                        </td>
                        <td className="py-2.5 px-2 align-top w-px">
                          <div className="flex items-start gap-1 justify-end">
                            {s.action !== "remove" && (
                              <button
                                type="button"
                                aria-label="Entwurf bearbeiten"
                                disabled={
                                  patching === s.id ||
                                  deleting === s.id ||
                                  editingDraftId === s.id
                                }
                                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-gray-600 hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => openDraftEditor(s)}
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
                        <ModerationNotes s={s} />
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
