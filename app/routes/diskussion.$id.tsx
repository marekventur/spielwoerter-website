import { useState } from "react";
import { Link, useNavigate, useRevalidator } from "react-router";
import { Mail, Pin, Lock, EyeOff, Eye, CornerUpLeft, Trash2 } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Button } from "~/components/ui/button";
import { formatTimestamp } from "~/components/WordHistoryList";
import {
  backlinks,
  getPosts,
  getTopic,
  MAX_POST_LENGTH,
  type PostRow,
} from "../../lib/topics";
import { screenName } from "../../lib/screen-name";
import type { Route } from "./+types/diskussion.$id";

export function meta({ data }: Route.MetaArgs) {
  return [
    { title: `${data?.topic.title ?? "Diskussion"} – Spielwoerter.de` },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ context, params }: Route.LoaderArgs) {
  if (!context.user?.isModerator) throw new Response("Not Found", { status: 404 });
  const topic = getTopic(context.db, Number(params.id));
  if (!topic) throw new Response("Not Found", { status: 404 });
  return {
    topic,
    posts: getPosts(context.db, topic.id),
    isAdmin: context.user.isAdmin,
  };
}

function Post({
  post,
  repliesTo,
  onHide,
}: {
  post: PostRow;
  repliesTo?: PostRow;
  onHide: (id: number) => void;
}) {
  const hidden = !!post.hidden_at;
  return (
    <div className="py-3">
      <p className="text-xs text-gray-500 flex items-center gap-2 flex-wrap">
        <span className="font-medium text-gray-700">
          {screenName(post.author_name, post.user_id)}
        </span>
        <span>{formatTimestamp(post.created_at)}</span>
        {post.source === "email" && (
          <span
            className="inline-flex items-center gap-1 text-gray-400"
            title="Per E-Mail geschrieben"
          >
            <Mail className="w-3 h-3" />
            per E-Mail
          </span>
        )}
        {hidden && <span className="text-amber-600">ausgeblendet</span>}
      </p>
      {repliesTo && (
        <p className="text-xs text-gray-400 mt-0.5 inline-flex items-center gap-1">
          <CornerUpLeft className="w-3 h-3" />
          Antwort auf {screenName(repliesTo.author_name, repliesTo.user_id)},{" "}
          {formatTimestamp(repliesTo.created_at)}
        </p>
      )}
      <p
        className={`mt-1 text-sm whitespace-pre-wrap ${
          hidden ? "text-gray-400 italic" : "text-gray-800"
        }`}
      >
        {post.body}
      </p>
      <button
        className="mt-1 text-xs text-gray-400 hover:text-orange-600 inline-flex items-center gap-1"
        onClick={() => onHide(post.id)}
      >
        {hidden ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
        {hidden ? "Einblenden" : "Ausblenden"}
      </button>
    </div>
  );
}

export default function TopicPage({ loaderData }: Route.ComponentProps) {
  const { topic, posts, isAdmin } = loaderData;
  const revalidator = useRevalidator();
  const navigate = useNavigate();
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "loading">("idle");
  const [error, setError] = useState<string | null>(null);

  const repliesTo = backlinks(posts);

  const post = async () => {
    setState("loading");
    setError(null);
    const res = await fetch(`/api/topics/${topic.id}/posts`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: body.trim() }),
    });
    const data = (await res.json().catch(() => ({}))) as { error?: string };
    setState("idle");
    if (!res.ok) {
      setError(data.error ?? "Fehler");
      return;
    }
    setBody("");
    void revalidator.revalidate();
  };

  const toggle = async (path: string) => {
    await fetch(path, { method: "POST" });
    void revalidator.revalidate();
  };

  const remove = async () => {
    if (
      !confirm(
        `„${topic.title}" endgültig löschen? Alle Beiträge werden dabei gelöscht und lassen sich nicht wiederherstellen.`
      )
    )
      return;
    const res = await fetch(`/api/topics/${topic.id}`, { method: "DELETE" });
    if (res.ok) void navigate("/diskussion");
  };

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 w-full">
      <Link to="/diskussion" className="text-sm text-gray-400 hover:text-orange-600">
        ← Alle Themen
      </Link>

      <div className="flex items-start justify-between gap-4 mt-2 mb-1">
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
          {!!topic.pinned && <Pin className="w-4 h-4 text-orange-500 shrink-0" />}
          {!!topic.locked && <Lock className="w-4 h-4 text-gray-400 shrink-0" />}
          {topic.title}
        </h1>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => void toggle(`/api/topics/${topic.id}/pin`)}
          >
            {topic.pinned ? "Loslösen" : "Anheften"}
          </Button>
          <Button
            variant="secondary"
            className="text-xs"
            onClick={() => void toggle(`/api/topics/${topic.id}/lock`)}
          >
            {topic.locked ? "Öffnen" : "Schließen"}
          </Button>
          {isAdmin && (
            <Button
              variant="secondary"
              className="text-xs text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
              onClick={() => void remove()}
            >
              <Trash2 className="w-3 h-3" />
              Löschen
            </Button>
          )}
        </div>
      </div>
      <p className="text-xs text-gray-500 mb-6">
        gestartet von {screenName(topic.author_name, topic.author_id)} am{" "}
        {formatTimestamp(topic.created_at)}
      </p>

      <Card className="p-4 divide-y divide-gray-100">
        {posts.map((p) => (
          <Post
            key={p.id}
            post={p}
            repliesTo={repliesTo.get(p.id)}
            onHide={(id) => void toggle(`/api/topics/posts/${id}/hide`)}
          />
        ))}
      </Card>

      {topic.locked ? (
        <p className="mt-6 text-sm text-gray-400">
          Dieses Thema ist geschlossen.
        </p>
      ) : (
        <div className="mt-6">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={8}
            maxLength={MAX_POST_LENGTH}
            placeholder="Deine Antwort"
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
          />
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
          <div className="mt-2">
            <Button
              variant="outline"
              className="border-orange-400 text-orange-600 hover:bg-orange-50"
              disabled={state === "loading" || body.trim() === ""}
              onClick={() => void post()}
            >
              {state === "loading" ? "Wird gesendet…" : "Antworten"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
