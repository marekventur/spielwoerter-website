import { useState } from "react";
import { Link, redirect } from "react-router";
import { Button } from "~/components/ui/button";
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
  word_in_list: string | null;
};

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
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
              s.created_at, s.last_modified_at, w.in_list AS word_in_list
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
  const [localDeleted, setLocalDeleted] = useState<Set<number>>(new Set());

  const drafts = suggestions.filter(
    (s) => s.status === "draft" && !localDeleted.has(s.id)
  );
  const others = suggestions.filter(
    (s) => s.status !== "draft" && !localDeleted.has(s.id)
  );

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.href = "/";
  };

  const handleDelete = async (id: number) => {
    setDeleting(id);
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" });
    if (res.ok) {
      setLocalDeleted((prev) => new Set(prev).add(id));
    }
    setDeleting(null);
  };

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
            <span className="text-sm text-gray-600">{user.email}</span>
            <Button
              variant="outline"
              className="border-gray-300 text-gray-600 hover:bg-gray-50"
              onClick={handleLogout}
            >
              Abmelden
            </Button>
          </div>
        </div>
      </nav>

      <div className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Meine Vorschläge</h1>
        <p className="text-gray-500 mb-8 text-sm">
          Entwürfe gehen nach <strong>60 Minuten</strong> ohne Änderung automatisch in die Prüfung.
        </p>

        {/* Drafts */}
        <section className="mb-10">
          <h2 className="text-lg font-semibold text-gray-700 mb-4">
            Entwürfe
            {drafts.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">({drafts.length})</span>
            )}
          </h2>

          {drafts.length === 0 ? (
            <Card className="p-6 text-center text-gray-400">
              <p>Keine Entwürfe.</p>
              <p className="text-sm mt-1">
                <Link to="/" className="text-orange-600 hover:underline">Wort nachschlagen</Link> und einen Vorschlag erstellen.
              </p>
            </Card>
          ) : (
            <div className="space-y-3">
              {drafts.map((s) => (
                <Card key={s.id} className="p-4 flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3 min-w-0">
                    <Link
                      to={`/wort/${encodeURIComponent(s.word.toUpperCase())}`}
                      className="font-bold text-gray-900 hover:text-orange-600 uppercase"
                    >
                      {s.word.toUpperCase()}
                    </Link>
                    <span className="text-sm text-gray-500">
                      {ACTION_LABELS[s.action] ?? s.action}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS.draft}`}>
                      {STATUS_LABELS.draft}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    className="shrink-0 text-red-600 border-red-200 hover:bg-red-50"
                    disabled={deleting === s.id}
                    onClick={() => handleDelete(s.id)}
                  >
                    {deleting === s.id ? "…" : "Löschen"}
                  </Button>
                </Card>
              ))}
            </div>
          )}
        </section>

        {/* In review / decided */}
        {others.length > 0 && (
          <section>
            <h2 className="text-lg font-semibold text-gray-700 mb-4">In Prüfung / Entschieden</h2>
            <div className="space-y-3">
              {others.map((s) => (
                <Card key={s.id} className="p-4 flex items-center gap-3">
                  <Link
                    to={`/wort/${encodeURIComponent(s.word.toUpperCase())}`}
                    className="font-bold text-gray-900 hover:text-orange-600 uppercase"
                  >
                    {s.word.toUpperCase()}
                  </Link>
                  <span className="text-sm text-gray-500">
                    {ACTION_LABELS[s.action] ?? s.action}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[s.status] ?? "bg-gray-100 text-gray-600"}`}
                  >
                    {STATUS_LABELS[s.status] ?? s.status}
                  </span>
                </Card>
              ))}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
