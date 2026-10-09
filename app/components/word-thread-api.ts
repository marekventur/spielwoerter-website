/** Client call: open a word thread (moderators). See server/routes/topics.ts. */
export async function openWordThread(
  request: ({ suggestionId: number } | { commentId: number }) & { body: string }
): Promise<{ topicId: number } | { error: string }> {
  const res = await fetch("/api/topics/word", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  const data = (await res.json().catch(() => ({}))) as { error?: string; topicId?: number };
  if (!res.ok || data.topicId === undefined) return { error: data.error ?? "Fehler" };
  return { topicId: data.topicId };
}
