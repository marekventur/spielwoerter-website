import { useState } from "react";
import { Link, useRevalidator } from "react-router";
import { History } from "lucide-react";
import { Button } from "~/components/ui/button";
import { WordHistoryList } from "~/components/WordHistoryList";
import { screenName } from "../../lib/screen-name";
import type { HistoryItem } from "../../lib/history";
import type { User } from "../../lib/auth";

type WordHistorySectionProps = {
  word: string;
  wordLower: string;
  user: User | null;
  history: HistoryItem[];
};

/**
 * Collapsed "Änderungshistorie & Diskussion" at the bottom of a word page:
 * the word's public event stream plus a comment form for logged-in users.
 */
export function WordHistorySection({ word, wordLower, user, history }: WordHistorySectionProps) {
  const [comment, setComment] = useState("");
  const [state, setState] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const revalidator = useRevalidator();

  const submitComment = async () => {
    const body = comment.trim();
    if (!body) return;
    setState("loading");
    setError(null);
    const res = await fetch("/api/word-comments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: wordLower, body }),
    });
    if (!res.ok) {
      const d = (await res.json().catch(() => ({}))) as { error?: string };
      setState("error");
      setError(d.error ?? "Fehler");
      return;
    }
    setComment("");
    setState("idle");
    revalidator.revalidate();
  };

  const toggleHide = async (commentId: number) => {
    const res = await fetch(`/api/word-comments/${commentId}/hide`, { method: "POST" });
    if (res.ok) revalidator.revalidate();
  };

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

  return (
    <details className="mt-10 border-t border-gray-100 pt-4 group">
      <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700 inline-flex items-center gap-1.5 select-none">
        <History className="w-4 h-4" />
        Änderungshistorie &amp; Diskussion
        {history.length > 0 && <span className="text-gray-400">({history.length})</span>}
      </summary>

      <div className="mt-4">
        <WordHistoryList
          items={history}
          canHideComments={user?.isModerator ?? false}
          onToggleHide={(id) => void toggleHide(id)}
          isModerator={user?.isModerator ?? false}
          viewerName={user ? screenName(user.displayName, user.id) : null}
          onScheduledAction={(id, kind) => void scheduledAction(id, kind)}
        />

        {user ? (
          <div className="mt-4 max-w-lg">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
              maxLength={1000}
              placeholder={`Kommentar zu ${word} – z. B. eine Regel-Frage oder ein Hinweis`}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
            />
            {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
            <div className="mt-2">
              <Button
                variant="outline"
                className="border-orange-400 text-orange-600 hover:bg-orange-50"
                disabled={state === "loading" || comment.trim() === ""}
                onClick={() => void submitComment()}
              >
                {state === "loading" ? "Wird gespeichert…" : "Kommentieren"}
              </Button>
            </div>
          </div>
        ) : (
          <p className="mt-4 text-sm text-gray-400">
            <Link
              to={`/login?from=/wort/${encodeURIComponent(word)}`}
              rel="nofollow"
              className="underline hover:text-orange-600"
            >
              Anmelden
            </Link>
            , um zu kommentieren.
          </p>
        )}
      </div>
    </details>
  );
}
