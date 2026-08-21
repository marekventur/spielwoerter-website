import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { MessageSquare, Pin, Lock } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { formatTimestamp } from "~/components/WordHistoryList";
import { listTopics, MAX_POST_LENGTH, MAX_TOPIC_TITLE_LENGTH } from "../../lib/topics";
import { screenName } from "../../lib/screen-name";
import type { Route } from "./+types/diskussion";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Diskussion – Spielwoerter.de" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  // Moderators only, reads included. 404 rather than 403: a 403 would confirm
  // that the board exists.
  if (!context.user?.isModerator) throw new Response("Not Found", { status: 404 });
  return { topics: listTopics(context.db) };
}

export default function DiskussionPage({ loaderData }: Route.ComponentProps) {
  const { topics } = loaderData;
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setState("loading");
    setError(null);
    const res = await fetch("/api/topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: title.trim(), body: body.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      topicId?: number;
    };
    setState("idle");
    if (!res.ok) {
      setError(data.error ?? "Fehler");
      return;
    }
    void navigate(`/diskussion/${data.topicId}`);
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Diskussion</h1>
      <p className="text-gray-500 mb-8 text-sm">
        Interner Austausch der Moderator:innen. Jeder Beitrag geht per E-Mail an alle
        anderen — ihr könnt direkt auf diese E-Mail antworten, die Antwort landet dann
        hier im Thema.{" "}
        <Link to="/konto" className="underline hover:text-orange-600">
          E-Mail-Einstellungen
        </Link>
        .
      </p>

      <div className="mb-8">
        {open ? (
          <Card className="p-4">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Worum geht es?"
              maxLength={MAX_TOPIC_TITLE_LENGTH}
              className="mb-2"
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              maxLength={MAX_POST_LENGTH}
              placeholder="Deine Nachricht"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
            />
            {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
            <div className="mt-2 flex gap-2">
              <Button
                variant="outline"
                className="border-orange-400 text-orange-600 hover:bg-orange-50"
                disabled={state === "loading" || !title.trim() || !body.trim()}
                onClick={() => void submit()}
              >
                {state === "loading" ? "Wird gesendet…" : "Thema starten"}
              </Button>
              <Button variant="secondary" onClick={() => setOpen(false)}>
                Abbrechen
              </Button>
            </div>
          </Card>
        ) : (
          <Button
            variant="outline"
            className="border-orange-400 text-orange-600 hover:bg-orange-50"
            onClick={() => setOpen(true)}
          >
            Neues Thema
          </Button>
        )}
      </div>

      {topics.length === 0 ? (
        <p className="text-sm text-gray-400">Noch keine Themen.</p>
      ) : (
        <ul className="space-y-2">
          {topics.map((t) => (
            <li key={t.id}>
              <Card className="p-4 hover:border-orange-300 transition-colors">
                <Link to={`/diskussion/${t.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 flex items-center gap-2">
                        {!!t.pinned && <Pin className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
                        {!!t.locked && <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                        <span className="truncate">{t.title}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        von {screenName(t.author_name, t.author_id)} · letzte Aktivität{" "}
                        {formatTimestamp(t.last_activity_at)}
                        {t.last_author_id != null &&
                          ` von ${screenName(t.last_author_name, t.last_author_id)}`}
                      </p>
                    </div>
                    <span className="flex items-center gap-1 text-xs text-gray-400 shrink-0">
                      <MessageSquare className="w-3.5 h-3.5" />
                      {t.post_count}
                    </span>
                  </div>
                </Link>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
