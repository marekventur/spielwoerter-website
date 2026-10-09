import { useState } from "react";
import { useNavigate } from "react-router";
import { Mail } from "lucide-react";
import { MessageForm } from "~/components/WordHistoryList";
import { openWordThread } from "~/components/word-thread-api";

/**
 * Moderation queue: start (or continue) the private word thread with a
 * suggestion's author, then go to it. Rules and limits: lib/conversations.ts.
 */
export function MessageToSubmitter({ suggestionId, toName }: { suggestionId: number; toName: string }) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  const send = async (body: string): Promise<string | null> => {
    const result = await openWordThread({ suggestionId, body });
    if ("error" in result) return result.error;
    void navigate(`/diskussion/${result.topicId}`);
    return null;
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 text-xs text-gray-400 hover:text-orange-600"
      >
        <Mail className="w-3 h-3" />
        Nachricht an {toName}
      </button>
      {open && <MessageForm toName={toName} onSubmit={send} onCancel={() => setOpen(false)} />}
    </div>
  );
}
