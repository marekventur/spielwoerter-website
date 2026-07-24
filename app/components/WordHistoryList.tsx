import { Link } from "react-router";
import { EyeOff } from "lucide-react";
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
};

export function WordHistoryList({
  items,
  showWord = false,
  canHideComments = false,
  onToggleHide,
  isModerator = false,
  viewerName = null,
  onScheduledAction,
}: WordHistoryListProps) {
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
