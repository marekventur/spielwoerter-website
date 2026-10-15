import { upper } from "../../lib/normalise.js";

/** One change as /api/batch (server/routes/batch.ts) takes it — PowerEdit's format. */
export type BatchChange =
  | { word: string; type: "remove" }
  | { word: string; type: "change_description"; payload: { description?: string; base?: string } };

/**
 * Submits changes as ordinary suggestions. When they contradict earlier
 * decisions the server answers 409; like PowerEdit, ask for a comment and
 * resend with force. Returns an error message, or null on success.
 */
export async function submitBatch(changes: BatchChange[], message: string): Promise<string | null> {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch("/api/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, changes, ...extra }),
    });
  try {
    let res = await send();
    let data = (await res.json().catch(() => ({}))) as {
      error?: string;
      requiresConfirmation?: boolean;
      conflicts?: { word: string; message: string }[];
    };
    if (!res.ok && data.requiresConfirmation && data.conflicts) {
      const list = data.conflicts.map((c) => `• ${upper(c.word)}: ${c.message}`).join("\n");
      const comment = window.prompt(
        `Einige Änderungen widersprechen früheren Entscheidungen:\n\n${list}\n\n` +
          "Trotzdem einreichen? Begründung (erscheint in der Wort-Historie):"
      );
      if (!comment?.trim()) return "Abgebrochen.";
      res = await send({ force: true, confirmComment: comment.trim() });
      data = (await res.json().catch(() => ({}))) as { error?: string };
    }
    return res.ok ? null : (data.error ?? "Fehler beim Einreichen");
  } catch {
    return "Netzwerkfehler";
  }
}

/** Withdraws the viewer's own draft suggestions. Returns an error message, or null. */
export async function withdrawDrafts(ids: number[]): Promise<string | null> {
  for (const id of ids) {
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return "Die Löschung ist schon freigegeben und lässt sich hier nicht mehr zurücknehmen.";
  }
  return null;
}
