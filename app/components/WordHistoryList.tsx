import { useState } from "react";
import { Link } from "react-router";
import { EyeOff, Mail } from "lucide-react";
import type { HistoryItem, HistoryActor } from "../../lib/history";

// SQLite UTC timestamps, formatted by string slicing so server and client
// render identically (no timezone-dependent hydration mismatch).
export function formatTimestamp(sqliteUtc: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(sqliteUtc);
  if (!m) return sqliteUtc;
  return `${m[3]}.${m[2]}.${m[1]}, ${m[4]}:${m[5]}`;
}

const ACTION_LABEL: Record<string, string> = {
  add: "Neuaufnahme",
  remove: "Löschung",
  change_description: "Beschreibung",
};

const ACTION_PILL: Record<string, string> = {
  add: "bg-green-100 text-green-700",
  remove: "bg-red-100 text-red-700",
  change_description: "bg-amber-100 text-amber-700",
};

function ActorName({ actor }: { actor: HistoryActor }) {
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-medium text-gray-700">{actor.name}</span>
      {actor.isModerator && (
        <span className="text-[10px] uppercase tracking-wide bg-orange-100 text-orange-700 rounded-full px-1.5 py-px">
          Moderator
        </span>
      )}
    </span>
  );
}

function statusText(item: HistoryItem): React.ReactNode {
  switch (item.status) {
    case "draft":
      return (
        <span className="text-amber-700">
          geplant — wird am {item.publishAt ? formatTimestamp(item.publishAt) : "?"} übernommen,
          wenn kein Einspruch kommt
        </span>
      );
    case "pending_review":
    case "ai_approved":
    case "needs_moderator":
      return <span className="text-gray-500">in Prüfung</span>;
    case "moderator_approved":
      return (
        <span className="text-green-700">
          übernommen
          {item.autoDecided ? (
            " (automatisch)"
          ) : item.decider ? (
            <>
              {" von "}
              <ActorName actor={item.decider} />
            </>
          ) : null}
        </span>
      );
    case "moderator_rejected":
      return (
        <span className="text-red-700">
          abgelehnt
          {item.decider ? (
            <>
              {" von "}
              <ActorName actor={item.decider} />
            </>
          ) : null}
        </span>
      );
    default:
      return null;
  }
}

/**
 * Inline box for the first message of a private word thread (word history,
 * moderation queue). `onSubmit` resolves to an error message or null.
 */
export function MessageForm({
  toName,
  onSubmit,
  onCancel,
}: {
  toName: string;
  onSubmit: (body: string) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    if (!body.trim()) return;
    setSending(true);
    setError(await onSubmit(body.trim()));
    setSending(false);
  };

  return (
    <div className="mt-2 max-w-lg">
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={2}
        maxLength={1000}
        autoFocus
        placeholder={`Nachricht an ${toName}: startet ein Gespräch, das nur ${toName} und die Moderation sehen`}
        className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-300 resize-none"
      />
      {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
      <div className="mt-1 flex gap-2">
        <button
          type="button"
          disabled={sending || !body.trim()}
          onClick={() => void send()}
          className="text-xs text-orange-700 border border-orange-300 rounded px-2 py-1 hover:bg-orange-50 disabled:opacity-50"
        >
          {sending ? "Wird gesendet…" : "Nachricht senden"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="text-xs text-gray-500 hover:text-gray-700 px-2 py-1"
        >
          Abbrechen
        </button>
      </div>
    </div>
  );
}

type WordHistoryListProps = {
  items: HistoryItem[];
  /** Show the word per row and link it (changelog view). */
  showWord?: boolean;
  /** Moderator viewer: offer hide/unhide on comments. */
  canHideComments?: boolean;
  onToggleHide?: (commentId: number) => void;
  /** Moderator viewer: offer confirm/object on scheduled removals. */
  isModerator?: boolean;
  /** Viewer's own screen name — hides confirm/object on their own entries. */
  viewerName?: string | null;
  onScheduledAction?: (suggestionId: number, kind: "approve" | "object") => void;
  /**
   * Moderator viewer: start a private word thread with a comment's author.
   * Resolves to an error or null.
   */
  onMessage?: (commentId: number, body: string) => Promise<string | null>;
};

export function WordHistoryList({
  items,
  showWord = false,
  canHideComments = false,
  onToggleHide,
  isModerator = false,
  viewerName = null,
  onScheduledAction,
  onMessage,
}: WordHistoryListProps) {
  const [messaging, setMessaging] = useState<number | null>(null);

  if (items.length === 0) {
    return <p className="text-sm text-gray-400 py-3">Noch keine Einträge.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100">
      {items.map((item) => (
        <li key={`${item.kind}-${item.id}`} className="py-2.5 text-sm">
          <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
            <span className="text-xs text-gray-400 tabular-nums shrink-0">
              {formatTimestamp(item.at)}
            </span>
            {showWord && (
              <Link
                to={`/wort/${encodeURIComponent(item.word.toUpperCase())}`}
                className="font-mono font-semibold text-gray-800 hover:text-orange-600"
              >
                {item.word.toUpperCase()}
              </Link>
            )}
            {item.kind === "suggestion" ? (
              <>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full font-medium ${ACTION_PILL[item.action ?? ""] ?? "bg-gray-100 text-gray-600"}`}
                >
                  {ACTION_LABEL[item.action ?? ""] ?? item.action}
                </span>
                {item.submitter && (
                  <span className="text-gray-500">
                    von <ActorName actor={item.submitter} />
                  </span>
                )}
                <span>· {statusText(item)}</span>
                {isModerator &&
                  item.status === "draft" &&
                  onScheduledAction &&
                  item.submitter?.name !== viewerName && (
                    <span className="inline-flex gap-2">
                      <button
                        type="button"
                        onClick={() => onScheduledAction(item.id, "object")}
                        className="text-xs text-amber-700 border border-amber-300 rounded px-1.5 py-0.5 hover:bg-amber-50"
                      >
                        Einspruch
                      </button>
                      <button
                        type="button"
                        onClick={() => onScheduledAction(item.id, "approve")}
                        className="text-xs text-green-700 border border-green-300 rounded px-1.5 py-0.5 hover:bg-green-50"
                      >
                        Jetzt freigeben
                      </button>
                    </span>
                  )}
              </>
            ) : (
              <>
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-sky-100 text-sky-700">
                  Kommentar
                </span>
                {item.submitter && <ActorName actor={item.submitter} />}
                {item.hidden && (
                  <span className="text-xs text-gray-400 italic">ausgeblendet</span>
                )}
                {canHideComments && onToggleHide && (
                  <button
                    type="button"
                    onClick={() => onToggleHide(item.id)}
                    className="text-xs text-gray-400 hover:text-gray-600 inline-flex items-center gap-1"
                    title={item.hidden ? "Wieder einblenden" : "Ausblenden"}
                  >
                    <EyeOff className="w-3 h-3" />
                    {item.hidden ? "einblenden" : "ausblenden"}
                  </button>
                )}
                {onMessage &&
                  isModerator &&
                  !item.hidden &&
                  item.submitter &&
                  item.submitter.name !== viewerName && (
                    <button
                      type="button"
                      onClick={() => setMessaging(messaging === item.id ? null : item.id)}
                      className="text-xs text-gray-400 hover:text-orange-600 inline-flex items-center gap-1"
                    >
                      <Mail className="w-3 h-3" />
                      Nachricht an {item.submitter.name}
                    </button>
                  )}
              </>
            )}
          </div>
          {item.kind === "comment" && item.body && (
            <p
              className={`mt-1 whitespace-pre-wrap ${item.hidden ? "text-gray-400 italic" : "text-gray-700"}`}
            >
              {item.body}
            </p>
          )}
          {item.kind === "comment" && messaging === item.id && onMessage && (
            <MessageForm
              toName={item.submitter?.name ?? ""}
              onCancel={() => setMessaging(null)}
              onSubmit={async (body) => {
                const error = await onMessage(item.id, body);
                if (!error) setMessaging(null);
                return error;
              }}
            />
          )}
          {item.kind === "suggestion" && item.decisionComment && (
            <p className="mt-1 text-gray-600 border-l-2 border-gray-200 pl-2 italic">
              {item.decisionComment}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
