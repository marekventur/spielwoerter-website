/**
 * POST /api/suggestions with settled-decision handling: on a 409 that asks for
 * confirmation (prior rejection or recent deliberate opposite decision), show
 * the prior rationale and let moderators proceed with a mandatory comment.
 */
export async function postSuggestion(body: {
  word: string;
  action: string;
  payload?: Record<string, string>;
}): Promise<{ ok: boolean; error?: string }> {
  const send = (extra: Record<string, unknown> = {}) =>
    fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, ...extra }),
    });

  let res = await send();
  if (res.ok) return { ok: true };

  const data = (await res.json().catch(() => ({}))) as {
    error?: string;
    requiresConfirmation?: boolean;
  };

  if (data.requiresConfirmation) {
    const comment = window.prompt(
      `${data.error ?? "Dieser Vorschlag widerspricht einer früheren Entscheidung."}\n\n` +
        "Trotzdem einreichen? Begründung (erscheint in der Wort-Historie):"
    );
    if (!comment?.trim()) return { ok: false, error: "Abgebrochen" };
    res = await send({ force: true, comment: comment.trim() });
    if (res.ok) return { ok: true };
    const retry = (await res.json().catch(() => ({}))) as { error?: string };
    return { ok: false, error: retry.error ?? "Fehler" };
  }

  return { ok: false, error: data.error ?? "Fehler" };
}
