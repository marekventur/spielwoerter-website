import { useState } from "react";
import { Link, redirect } from "react-router";
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

type Group = {
  base: string;
  items: ModerationItem[];
};

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
};

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

  return { user: context.user, items };
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
  const { items: initialItems } = loaderData;
  const [decided, setDecided] = useState<Map<number, "approved" | "rejected">>(
    new Map()
  );
  const [loading, setLoading] = useState<Set<number>>(new Set());

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

  const pending = initialItems.filter((i) => !decided.has(i.id));
  const groups = groupByBase(pending);

  return (
    <div>

      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-bold text-gray-900">Moderation</h1>
            <p className="text-gray-500 mt-1">
              {pending.length} Vorschlag{pending.length !== 1 ? "schläge" : ""} ausstehend
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
              const groupIds = group.items.map((i) => i.id);
              const anyLoading = group.items.some((i) => loading.has(i.id));

              return (
                <Card key={group.base} className="overflow-hidden">
                  {/* Group header */}
                  <div className="px-5 py-3 bg-gray-50 border-b flex items-center justify-between">
                    <Link
                      to={`/wort/${encodeURIComponent(group.base.toUpperCase())}`}
                      className="font-bold text-gray-700 uppercase tracking-wide hover:text-orange-600"
                    >
                      {group.base.toUpperCase()}
                    </Link>
                    <div className="flex gap-2">
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
                        onClick={() => decide(groupIds, "approve")}
                      >
                        Alle genehmigen
                      </Button>
                    </div>
                  </div>

                  {/* Items */}
                  <div className="divide-y">
                    {group.items.map((item) => {
                      const isLoading = loading.has(item.id);
                      const payload = item.payload
                        ? (JSON.parse(item.payload) as Record<string, string>)
                        : null;

                      return (
                        <div key={item.id} className="px-5 py-4">
                          <div className="flex gap-4">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Link
                                to={`/wort/${encodeURIComponent(item.word.toUpperCase())}`}
                                className="font-bold text-gray-900 uppercase hover:text-orange-600"
                              >
                                {item.word.toUpperCase()}
                              </Link>
                              <span className="text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700 font-medium">
                                {ACTION_LABELS[item.action] ?? item.action}
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
                              Genehmigen
                            </Button>
                          </div>
                          </div>

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
      </div>
    </div>
  );
}
