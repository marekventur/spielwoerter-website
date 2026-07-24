import { Form, Link, useRevalidator, useSearchParams } from "react-router";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { Input } from "~/components/ui/input";
import { WordHistoryList } from "~/components/WordHistoryList";
import { changelog } from "../../lib/history.js";
import { screenName } from "../../lib/screen-name.js";
import type { Route } from "./+types/aenderungen";

const PAGE_SIZE = 50;

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Änderungen – Spielwoerter.de" },
    {
      name: "description",
      content:
        "Alle Änderungen an der Wortliste: Neuaufnahmen, Löschungen, Beschreibungen und Diskussionen.",
    },
  ];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("seite")) || 1);
  const filter = {
    kind: url.searchParams.get("art") || undefined,
    status: url.searchParams.get("status") || undefined,
    word: url.searchParams.get("wort")?.trim().toLowerCase() || undefined,
  };

  const isModerator = context.user?.isModerator ?? false;
  const { items, hasMore } = changelog(context.db, {
    filter,
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
    forModerator: isModerator,
  });

  return {
    items,
    hasMore,
    page,
    isModerator,
    viewerName: context.user ? screenName(context.user.displayName, context.user.id) : null,
  };
}

const KIND_OPTIONS = [
  { value: "", label: "Alle Arten" },
  { value: "add", label: "Neuaufnahmen" },
  { value: "remove", label: "Löschungen" },
  { value: "change_description", label: "Beschreibungen" },
  { value: "comment", label: "Kommentare" },
];

const STATUS_OPTIONS = [
  { value: "", label: "Alle Status" },
  { value: "approved", label: "Übernommen" },
  { value: "rejected", label: "Abgelehnt" },
  { value: "scheduled", label: "Geplant" },
  { value: "pending", label: "In Prüfung" },
];

export default function AenderungenPage({ loaderData }: Route.ComponentProps) {
  const { items, hasMore, page, isModerator, viewerName } = loaderData;
  const [searchParams] = useSearchParams();
  const revalidator = useRevalidator();

  const scheduledAction = async (id: number, kind: "approve" | "object") => {
    let body: Record<string, string> = {};
    if (kind === "object") {
      const comment = window.prompt(
        "Einspruch: Warum sollte dieses Wort in der Liste bleiben?\n(Die Begründung erscheint in der Wort-Historie.)"
      );
      if (!comment?.trim()) return;
      body = { comment: comment.trim() };
    }
    const res = await fetch(`/api/moderation/scheduled/${id}/${kind}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      window.alert(data.error ?? "Aktion fehlgeschlagen.");
      return;
    }
    revalidator.revalidate();
  };

  const pageLink = (p: number) => {
    const params = new URLSearchParams(searchParams);
    if (p <= 1) params.delete("seite");
    else params.set("seite", String(p));
    const qs = params.toString();
    return `/aenderungen${qs ? `?${qs}` : ""}`;
  };

  const selectClass =
    "h-9 rounded-lg border border-gray-200 bg-white px-2 text-sm text-gray-700 focus:border-orange-300 focus:outline-none focus:ring-2 focus:ring-orange-200";

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Änderungen</h1>
      <p className="text-gray-500 mt-1 mb-6">
        Alle Neuaufnahmen, Löschungen, Beschreibungsänderungen und Diskussionen – transparent und
        nachvollziehbar.
      </p>

      <Form method="get" className="flex flex-wrap items-center gap-2 mb-6">
        <select name="art" defaultValue={searchParams.get("art") ?? ""} className={selectClass}>
          {KIND_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          name="status"
          defaultValue={searchParams.get("status") ?? ""}
          className={selectClass}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <Input
          name="wort"
          defaultValue={searchParams.get("wort") ?? ""}
          placeholder="Wort"
          className="h-9 w-36 text-sm"
        />
        <Button
          type="submit"
          variant="outline"
          className="h-9 border-orange-400 text-orange-600 hover:bg-orange-50"
        >
          Filtern
        </Button>
      </Form>

      <Card className="px-5 py-2">
        <WordHistoryList
          items={items}
          showWord
          isModerator={isModerator}
          viewerName={viewerName}
          onScheduledAction={(id, kind) => void scheduledAction(id, kind)}
        />
      </Card>

      <div className="flex items-center justify-between mt-6">
        {page > 1 ? (
          <Link to={pageLink(page - 1)} className="text-sm text-orange-600 hover:underline">
            ← Neuere
          </Link>
        ) : (
          <span />
        )}
        <span className="text-sm text-gray-400">Seite {page}</span>
        {hasMore ? (
          <Link to={pageLink(page + 1)} className="text-sm text-orange-600 hover:underline">
            Ältere →
          </Link>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}
