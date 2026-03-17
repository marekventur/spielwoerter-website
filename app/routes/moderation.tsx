import { useState } from "react";
import { Link, redirect } from "react-router";
import { ExternalLink } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
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
  return [{ title: "Moderation – Spielwörter.de" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/moderation");
  if (!context.user.isModerator) return redirect("/");

  const items = context.db
    .prepare(
      `SELECT s.id, s.word, s.action, s.payload, s.status, s.created_at,
              w.description AS current_description, w.in_list, w.base
       FROM suggestions s
       LEFT JOIN words w ON w.word = s.word
       WHERE s.status IN ('pending_review', 'needs_moderator')
       ORDER BY COALESCE(w.base, s.word), s.word, s.created_at`
    )
    .all() as ModerationItem[];

  return { user: context.user, items };
}

function groupByBase(items: ModerationItem[]): Group[] {
  const map = new Map<string, ModerationItem[]>();
  for (const item of items) {
    const key = item.base ?? item.word;
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(item);
  }
  return Array.from(map.entries()).map(([base, items]) => ({ base, items }));
}

export default function ModerationPage({ loaderData }: Route.ComponentProps) {
  const { user, items: initialItems } = loaderData;
  const [decided, setDecided] = useState<Map<number, "approved" | "rejected">>(
    new Map()
  );
  const [loading, setLoading] = useState<Set<number>>(new Set());

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const decide = async (ids: number[], action: "approve" | "reject") => {
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
        ? undefined
        : JSON.stringify({ ids, action });

    await fetch(endpoint, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body,
    });

    setDecided((prev) => {
      const next = new Map(prev);
      ids.forEach((id) =>
        next.set(id, action === "approve" ? "approved" : "rejected")
      );
      return next;
    });
    setLoading((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });
  };

  const pending = initialItems.filter((i) => !decided.has(i.id));
  const groups = groupByBase(pending);

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-orange-50">
      {/* Navigation */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm">S</div>
              <div className="w-8 h-8 bg-orange-400 rounded flex items-center justify-center text-white font-bold text-sm">W</div>
            </div>
            <span className="text-xl font-bold text-gray-800">Spielwörter.de</span>
          </Link>
          <div className="flex items-center gap-3">
            <Link to="/meine-vorschlaege" className="text-sm text-gray-600 hover:text-orange-600">
              Meine Vorschläge
            </Link>
            <Button variant="outline" className="border-gray-300 text-gray-600 hover:bg-gray-50" onClick={handleLogout}>
              Abmelden
            </Button>
          </div>
        </div>
      </nav>

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
                        <div key={item.id} className="px-5 py-4 flex gap-4">
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

                            {item.current_description && (
                              <p className="text-sm text-gray-500 mb-1">
                                <span className="font-medium text-gray-600">Aktuell:</span>{" "}
                                {item.current_description}
                              </p>
                            )}

                            {payload?.description && (
                              <p className="text-sm text-gray-700 mb-1">
                                <span className="font-medium">Vorgeschlagen:</span>{" "}
                                {payload.description}
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
                            <Button
                              size="default"
                              variant="outline"
                              className="text-red-600 border-red-200 hover:bg-red-50"
                              disabled={isLoading}
                              onClick={() => decide([item.id], "reject")}
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
