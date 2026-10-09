import { Link, redirect } from "react-router";
import { MessageSquare, Lock } from "lucide-react";
import { Card } from "~/components/ui/card";
import { formatTimestamp } from "~/components/WordHistoryList";
import { listWordThreads } from "../../lib/conversations";
import type { Route } from "./+types/gespraeche";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Meine Gespräche – Spielwoerter.de" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/gespraeche");
  return { threads: listWordThreads(context.db, context.user, { mine: true }) };
}

export default function GespraechePage({ loaderData }: Route.ComponentProps) {
  const { threads } = loaderData;
  return (
    <div className="max-w-3xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Meine Gespräche</h1>
      <p className="text-gray-500 mb-8 text-sm">
        Private Gespräche mit der Moderation zu einzelnen Wörtern. Sie sind nur für dich und die
        Moderation sichtbar. Du kannst hier oder direkt auf die E-Mail antworten.{" "}
        <Link to="/konto" className="underline hover:text-orange-600">
          E-Mail-Einstellungen
        </Link>
        .
      </p>
      {threads.length === 0 ? (
        <p className="text-sm text-gray-400">Noch keine Gespräche.</p>
      ) : (
        <ul className="space-y-2">
          {threads.map((t) => (
            <li key={t.id}>
              <Card className="p-4 hover:border-orange-300 transition-colors">
                <Link to={`/diskussion/${t.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 flex items-center gap-2">
                        {!!t.locked && <Lock className="w-3.5 h-3.5 text-gray-400 shrink-0" />}
                        <span className="truncate">{t.title}</span>
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        letzte Aktivität {formatTimestamp(t.last_activity_at)}
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
