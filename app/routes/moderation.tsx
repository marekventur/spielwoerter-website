import { useState } from "react";
import { Link, redirect, useRevalidator } from "react-router";
import { ExternalLink, Pencil } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import type { Route } from "./+types/moderation";

type ModerationItem = {
  id: number;
  word: string;
  action: string;
  payload: string | null;
  status: string;
  created_at: string;
  current_description: string | null;
  in_list: string | null;
  base: string | null;
  requester_email: string | null;
};

type RecentItem = {
  id: number;
  word: string;
  action: string;
  status: string;
  decided_at: string;
  synced_at: string | null;
  decided_by_email: string | null;
};

type Group = {
  base: string;
  items: ModerationItem[];
};

type ActionMeta = {
  label: string;
  pillClass: string;
  approveLabel: string;
  approveAllLabel: string;
  rejectTitle: string;
  rowClass?: string;
  hint?: string;
};

const ACTION_META: Record<string, ActionMeta> = {
  add: {
    label: "Neues Wort",
    pillClass: "bg-green-100 text-green-700",
    approveLabel: "Wort aufnehmen",
    approveAllLabel: "Alle aufnehmen",
    rejectTitle: "Ablehnen – Wort wird nicht aufgenommen",
  },
  remove: {
    label: "Wort entfernen",
    pillClass: "bg-red-100 text-red-700",
    approveLabel: "Wort entfernen",
    approveAllLabel: "Alle entfernen",
    rejectTitle: "Ablehnen – Wort bleibt in der Liste",
    rowClass: "border-l-4 border-red-300 bg-red-50/40",
    hint: "Genehmigen entfernt das Wort aus der Wortliste.",
  },
  change_description: {
    label: "Beschreibung ändern",
    pillClass: "bg-amber-100 text-amber-700",
    approveLabel: "Änderung übernehmen",
    approveAllLabel: "Alle übernehmen",
    rejectTitle: "Ablehnen – Beschreibung bleibt unverändert",
  },
};

const FALLBACK_META: ActionMeta = {
  label: "",
  pillClass: "bg-blue-100 text-blue-700",
  approveLabel: "Genehmigen",
  approveAllLabel: "Alle genehmigen",
  rejectTitle: "Ablehnen",
};

function metaFor(action: string): ActionMeta {
  return ACTION_META[action] ?? { ...FALLBACK_META, label: action };
}

export function meta({}: Route.MetaArgs) {
  return [{ title: "Moderation – Spielwoerter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/moderation");
  if (!context.user.isModerator) return redirect("/");

  const items = context.db
    .prepare(
      `SELECT s.id, s.word, s.action, s.payload, s.status, s.created_at,
              w.description AS current_description, w.in_list, w.base,
              u.email AS requester_email
       FROM suggestions s
       LEFT JOIN words w ON w.word = s.word
       LEFT JOIN users u ON u.id = s.user_id
       WHERE s.status IN ('pending_review', 'needs_moderator')
       ORDER BY COALESCE(w.base, s.word), s.word, s.created_at`
    )
    .all() as ModerationItem[];

  // decided_at is NULL for decisions made before the column existed —
  // fall back to last_modified_at so old mistakes remain correctable too.
  const recent = context.db
    .prepare(
      `SELECT s.id, s.word, s.action, s.status, s.synced_at,
              COALESCE(s.decided_at, s.last_modified_at) AS decided_at,
              d.email AS decided_by_email
       FROM suggestions s
       LEFT JOIN users d ON d.id = s.decided_by
       WHERE s.status IN ('moderator_approved', 'moderator_rejected')
       ORDER BY COALESCE(s.decided_at, s.last_modified_at) DESC
       LIMIT 50`
    )
    .all() as RecentItem[];

  return { user: context.user, items, recent };
}

/** Base form for grouping: DB join only fills `base` when the suggested word already exists in `words`. */
function parsePayloadBase(payload: string | null): string | null {
  if (!payload) return null;
  try {
    const p = JSON.parse(payload) as Record<string, unknown>;
    const b = p?.base;
    if (typeof b === "string" && b.trim()) return b.trim().toLowerCase();
  } catch {
    /* ignore invalid JSON */
  }
  return null;
}

function groupKeyForItem(item: ModerationItem): string {
  const fromWord = item.base?.trim().toLowerCase();
  if (fromWord) return fromWord;
  const fromPayload = parsePayloadBase(item.payload);
  if (fromPayload) return fromPayload;
  return item.word.toLowerCase();
}

function groupByBase(items: ModerationItem[]): Group[] {
  const map = new Map<string, ModerationItem[]>();
  for (const item of items) {
    const key = groupKeyForItem(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([base, items]) => ({ base, items }));
}

type ModerationChanges = {
  word?: string;
  description?: string;
  base?: string;
};

export default function ModerationPage({ loaderData }: Route.ComponentProps) {
  const { items: initialItems, recent } = loaderData;
  const [decided, setDecided] = useState<Map<number, "approved" | "rejected">>(
    new Map()
  );
  const [loading, setLoading] = useState<Set<number>>(new Set());
  const revalidator = useRevalidator();

  // Inline editor for "approve with changes"
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editWord, setEditWord] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editBase, setEditBase] = useState("");

  // Inline comment prompt for rejections
  const [rejectingId, setRejectingId] = useState<number | null>(null);
  const [rejectComment, setRejectComment] = useState("");

  const decide = async (
    ids: number[],
    action: "approve" | "reject",
    opts: { changes?: ModerationChanges; comment?: string } = {}
  ) => {
    setLoading((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.add(id));
      return next;
    });

    const endpoint =
      ids.length === 1
        ? `/api/moderation/${ids[0]}/${action}`
        : `/api/moderation/batch`;

    const body =
      ids.length === 1
        ? { changes: opts.changes, comment: opts.comment }
        : { ids, action, comment: opts.comment };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    setLoading((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Aktion fehlgeschlagen.");
      return;
    }

    setDecided((prev) => {
      const next = new Map(prev);
      ids.forEach((id) =>
        next.set(id, action === "approve" ? "approved" : "rejected")
      );
      return next;
    });
    if (ids.length === 1) {
      if (editingId === ids[0]) setEditingId(null);
      if (rejectingId === ids[0]) setRejectingId(null);
    }
  };

  const openEditor = (item: ModerationItem) => {
    const payload = item.payload
      ? (JSON.parse(item.payload) as Record<string, string>)
      : null;
    setRejectingId(null);
    setEditingId(item.id);
    setEditWord(item.word);
    setEditDescription(
      item.action === "change_description"
        ? (payload?.description ?? item.current_description ?? "")
        : (payload?.description ?? "")
    );
    setEditBase(payload?.base ?? item.base ?? "");
  };

  const approveWithChanges = (item: ModerationItem) => {
    void decide([item.id], "approve", {
      changes: {
        word: editWord,
        description: editDescription,
        base: editBase,
      },
    });
  };

  const openRejectPrompt = (id: number) => {
    setEditingId(null);
    setRejectingId(id);
    setRejectComment("");
  };

  const undo = async (id: number, source: "queue" | "recent") => {
    setLoading((prev) => new Set(prev).add(id));

    const res = await fetch(`/api/moderation/${id}/undo`, { method: "POST" });

    setLoading((prev) => {
      const next = new Set(prev);
      next.delete(id);
      return next;
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Aktion fehlgeschlagen.");
      return;
    }

    if (source === "queue") {
      setDecided((prev) => {
        const next = new Map(prev);
        next.delete(id);
        return next;
      });
    } else {
      revalidator.revalidate();
    }
  };

  const pending = initialItems.filter((i) => !decided.has(i.id));
  // Decided items stay visible in place (grayed, with undo) until reload
  const groups = groupByBase(initialItems);
  const recentVisible = recent.filter((r) => !decided.has(r.id));

  return (
    <div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Moderation</h1>
            <p className="text-gray-500 mt-1">
              {pending.length} {pending.length === 1 ? "Vorschlag" : "Vorschläge"} ausstehend
            </p>
          </div>
        </div>

        {groups.length === 0 ? (
          <Card className="p-10 text-center text-gray-400">
            <p className="text-lg font-medium">Nichts zu prüfen.</p>
            <p className="text-sm mt-1">Alle Vorschläge sind bearbeitet.</p>
          </Card>
        ) : (
          <div className="space-y-8">
            {groups.map((group) => {
              const undecidedItems = group.items.filter((i) => !decided.has(i.id));
              const groupIds = undecidedItems.map((i) => i.id);
              const anyLoading = group.items.some((i) => loading.has(i.id));
              const groupActions = [...new Set(undecidedItems.map((i) => i.action))];
              const isMixed = groupActions.length > 1;
              const actionCounts = groupActions.map((a) => {
                const n = undecidedItems.filter((i) => i.action === a).length;
                return `${n}× ${metaFor(a).label}`;
              });

              const approveAll = () => {
                if (
                  isMixed &&
                  !window.confirm(
                    `Gemischte Aktionen genehmigen (${actionCounts.join(", ")}). Fortfahren?`
                  )
                )
                  return;
                void decide(groupIds, "approve");
              };

              return (
                <Card key={group.base} className="overflow-hidden">
                  {/* Group header */}
                  <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Link
                        to={`/wort/${encodeURIComponent(group.base.toUpperCase())}`}
                        className="font-bold text-gray-700 uppercase tracking-wide hover:text-orange-600"
                      >
                        {group.base.toUpperCase()}
                      </Link>
                      {isMixed && (
                        <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
                          Gemischt: {actionCounts.join(", ")}
                        </span>
                      )}
                    </div>
                    {groupIds.length > 0 && (
                      <div className="flex gap-2 shrink-0">
                        <Button
                          size="default"
                          variant="outline"
                          className="text-red-600 border-red-200 hover:bg-red-50 text-xs"
                          disabled={anyLoading}
                          onClick={() => decide(groupIds, "reject")}
                        >
                          Alle ablehnen
                        </Button>
                        <Button
                          size="default"
                          className="bg-green-600 hover:bg-green-700 text-white text-xs"
                          disabled={anyLoading}
                          onClick={approveAll}
                        >
                          {isMixed
                            ? "Alle genehmigen"
                            : metaFor(groupActions[0]).approveAllLabel}
                        </Button>
                      </div>
                    )}
                  </div>

                  {/* Items */}
                  <div className="divide-y">
                    {group.items.map((item) => {
                      const isLoading = loading.has(item.id);
                      const meta = metaFor(item.action);
                      const decision = decided.get(item.id);
                      const payload = item.payload
                        ? (JSON.parse(item.payload) as Record<string, string>)
                        : null;

                      if (decision) {
                        return (
                          <div
                            key={item.id}
                            className="px-5 py-3 flex items-center gap-2 bg-gray-50"
                          >
                            <span className="font-bold text-gray-400 uppercase">
                              {item.word.toUpperCase()}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium opacity-60 ${meta.pillClass}`}
                            >
                              {meta.label}
                            </span>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                                decision === "approved"
                                  ? "bg-green-100 text-green-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              {decision === "approved" ? "Genehmigt" : "Abgelehnt"}
                            </span>
                            <div className="ml-auto shrink-0">
                              <Button
                                size="default"
                                variant="outline"
                                disabled={isLoading}
                                onClick={() => void undo(item.id, "queue")}
                              >
                                Rückgängig
                              </Button>
                            </div>
                          </div>
                        );
                      }

                      return (
                        <div key={item.id} className={`px-5 py-4 ${meta.rowClass ?? ""}`}>
                          <div className="flex gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Link
                                to={`/wort/${encodeURIComponent(item.word.toUpperCase())}`}
                                className="font-bold text-gray-900 uppercase hover:text-orange-600"
                              >
                                {item.word.toUpperCase()}
                              </Link>
                              <span
                                className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.pillClass}`}
                              >
                                {meta.label}
                              </span>
                              {item.in_list && (
                                <span className="text-xs text-gray-400">
                                  ({item.in_list === "accepted" ? "in Liste" : item.in_list === "uncertain" ? "unsicher" : "nicht in Liste"})
                                </span>
                              )}
                            </div>

                            {item.action === "change_description" ? (
                              <div className="text-sm mb-2 space-y-1">
                                <div className="flex gap-2">
                                  <span className="shrink-0 text-xs font-medium text-red-500 w-14 pt-0.5">Vorher:</span>
                                  <span className="text-gray-500 line-through">{item.current_description ?? "–"}</span>
                                </div>
                                <div className="flex gap-2">
                                  <span className="shrink-0 text-xs font-medium text-green-600 w-14 pt-0.5">Nachher:</span>
                                  <span className="text-gray-800">{payload?.description ?? "–"}</span>
                                </div>
                                {payload?.base && (
                                  <p className="text-gray-500 mt-1">
                                    <span className="font-medium text-gray-600">Grundform (neu):</span>{" "}
                                    <span className="font-mono">{payload.base}</span>
                                  </p>
                                )}
                              </div>
                            ) : (
                              <>
                                {item.current_description && (
                                  <p className="text-sm text-gray-500 mb-1">
                                    <span className="font-medium text-gray-600">Aktuell:</span>{" "}
                                    {item.current_description}
                                  </p>
                                )}
                                {payload?.description && (
                                  <p className="text-sm text-gray-700 mb-1">
                                    <span className="font-medium">Beschreibung:</span>{" "}
                                    {payload.description}
                                  </p>
                                )}
                                {payload?.base && (
                                  <p className="text-sm text-gray-500 mb-1">
                                    <span className="font-medium text-gray-600">Grundform:</span>{" "}
                                    <span className="font-mono">{payload.base}</span>
                                  </p>
                                )}
                              </>
                            )}

                            {item.requester_email && (
                              <p className="text-xs text-gray-400 mb-1">
                                {item.requester_email}
                              </p>
                            )}

                            <a
                              href={`https://www.duden.de/suchen/dudenonline/${item.word}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600"
                            >
                              <ExternalLink className="w-3 h-3" />
                              Duden
                            </a>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {item.action !== "remove" && (
                              <button
                                type="button"
                                aria-label="Bearbeiten und genehmigen"
                                title="Bearbeiten und genehmigen"
                                disabled={isLoading || editingId === item.id}
                                className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-gray-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-orange-500 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50"
                                onClick={() => openEditor(item)}
                              >
                                <Pencil className="h-4 w-4" strokeWidth={2} />
                              </button>
                            )}
                            <Button
                              size="default"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50"
                              title={meta.rejectTitle}
                              disabled={isLoading || rejectingId === item.id}
                              onClick={() => openRejectPrompt(item.id)}
                            >
                              Ablehnen
                            </Button>
                            <Button
                              size="default"
                              className="bg-green-600 hover:bg-green-700 text-white"
                              disabled={isLoading}
                              onClick={() => decide([item.id], "approve")}
                            >
                              {meta.approveLabel}
                            </Button>
                          </div>
                          </div>

                          {meta.hint && (
                            <p className="mt-2 text-xs text-red-600">{meta.hint}</p>
                          )}

                          {editingId === item.id && (
                            <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                              <div className="flex flex-wrap items-end gap-x-3 gap-y-2">
                                <div className="w-40 shrink-0">
                                  <label
                                    htmlFor={`mod-word-${item.id}`}
                                    className="mb-1 block text-xs font-medium text-gray-600"
                                  >
                                    Wort
                                  </label>
                                  <Input
                                    id={`mod-word-${item.id}`}
                                    value={editWord}
                                    onChange={(e) => setEditWord(e.target.value)}
                                    disabled={isLoading}
                                    className="w-full min-w-0 py-1.5 font-mono text-sm"
                                  />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <label
                                    htmlFor={`mod-desc-${item.id}`}
                                    className="mb-1 block text-xs font-medium text-gray-600"
                                  >
                                    Beschreibung
                                  </label>
                                  <Input
                                    id={`mod-desc-${item.id}`}
                                    value={editDescription}
                                    onChange={(e) => setEditDescription(e.target.value)}
                                    disabled={isLoading}
                                    className="w-full min-w-0 py-1.5 text-sm"
                                  />
                                </div>
                                <div className="w-36 shrink-0">
                                  <label
                                    htmlFor={`mod-base-${item.id}`}
                                    className="mb-1 block text-xs font-medium text-gray-600"
                                  >
                                    Grundform
                                  </label>
                                  <Input
                                    id={`mod-base-${item.id}`}
                                    value={editBase}
                                    onChange={(e) => setEditBase(e.target.value)}
                                    disabled={isLoading}
                                    className="w-full min-w-0 py-1.5 font-mono text-sm"
                                  />
                                </div>
                              </div>
                              <div className="mt-3 flex justify-end gap-2">
                                <Button
                                  size="default"
                                  variant="outline"
                                  disabled={isLoading}
                                  onClick={() => setEditingId(null)}
                                >
                                  Abbrechen
                                </Button>
                                <Button
                                  size="default"
                                  className="bg-green-600 hover:bg-green-700 text-white"
                                  disabled={isLoading}
                                  onClick={() => approveWithChanges(item)}
                                >
                                  Mit Änderungen genehmigen
                                </Button>
                              </div>
                            </div>
                          )}

                          {rejectingId === item.id && (
                            <div className="mt-3 rounded-lg border border-red-100 bg-red-50/50 p-3">
                              <label
                                htmlFor={`mod-reject-${item.id}`}
                                className="mb-1 block text-xs font-medium text-gray-600"
                              >
                                Grund der Ablehnung (optional, nur für die einreichende Person sichtbar)
                              </label>
                              <div className="flex flex-wrap items-center gap-2">
                                <Input
                                  id={`mod-reject-${item.id}`}
                                  value={rejectComment}
                                  onChange={(e) => setRejectComment(e.target.value)}
                                  disabled={isLoading}
                                  placeholder="z. B. Eigenname, kein Duden-Eintrag …"
                                  className="w-full min-w-0 flex-1 py-1.5 text-sm"
                                />
                                <div className="flex shrink-0 gap-2">
                                  <Button
                                    size="default"
                                    variant="outline"
                                    disabled={isLoading}
                                    onClick={() => setRejectingId(null)}
                                  >
                                    Abbrechen
                                  </Button>
                                  <Button
                                    size="default"
                                    className="bg-red-600 hover:bg-red-700 text-white"
                                    disabled={isLoading}
                                    onClick={() =>
                                      void decide([item.id], "reject", {
                                        comment: rejectComment,
                                      })
                                    }
                                  >
                                    Ablehnen
                                  </Button>
                                </div>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Card>
              );
            })}
          </div>
        )}

        {recentVisible.length > 0 && (
          <div className="mt-12">
            <h2 className="text-xl font-bold text-gray-900">Kürzlich entschieden</h2>
            <p className="text-sm text-gray-500 mt-1 mb-4">
              Die letzten 50 Entscheidungen. Noch nicht veröffentlichte
              Entscheidungen können rückgängig gemacht werden.
            </p>
            <Card className="overflow-hidden divide-y">
              {recentVisible.map((r) => {
                const meta = metaFor(r.action);
                const approved = r.status === "moderator_approved";
                const locked = approved && r.synced_at !== null;
                const isLoading = loading.has(r.id);

                return (
                  <div key={r.id} className="px-5 py-3 flex items-center gap-2">
                    <Link
                      to={`/wort/${encodeURIComponent(r.word.toUpperCase())}`}
                      className="font-bold text-gray-700 uppercase hover:text-orange-600"
                    >
                      {r.word.toUpperCase()}
                    </Link>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${meta.pillClass}`}
                    >
                      {meta.label}
                    </span>
                    <span
                      className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                        approved
                          ? "bg-green-100 text-green-700"
                          : "bg-red-100 text-red-700"
                      }`}
                    >
                      {approved ? "Genehmigt" : "Abgelehnt"}
                    </span>
                    <span className="text-xs text-gray-400 truncate">
                      {r.decided_by_email ?? "–"}
                      {" · "}
                      {new Date(r.decided_at).toLocaleDateString("de-DE")}
                    </span>
                    <div className="ml-auto shrink-0">
                      <Button
                        size="default"
                        variant="outline"
                        disabled={isLoading || locked}
                        title={
                          locked
                            ? "Bereits veröffentlicht – Rückgängig nicht mehr möglich. Bitte Gegenvorschlag einreichen."
                            : undefined
                        }
                        onClick={() => void undo(r.id, "recent")}
                      >
                        Rückgängig
                      </Button>
                    </div>
                  </div>
                );
              })}
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
