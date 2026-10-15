/** Withdraws the viewer's own draft suggestions. Returns an error message, or null. */
export async function withdrawDrafts(ids: number[]): Promise<string | null> {
  for (const id of ids) {
    const res = await fetch(`/api/suggestions/${id}`, { method: "DELETE" }).catch(() => null);
    if (!res?.ok) return "Die Löschung ist schon freigegeben und lässt sich hier nicht mehr zurücknehmen.";
  }
  return null;
}
