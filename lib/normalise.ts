/** Replace umlauts and ß with ASCII equivalents (lowercase input assumed). */
export function normalise(word: string): string {
  return word
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss");
}

/**
 * Uppercase for display and /wort/ URLs. Plain toUpperCase() turns ß into
 * "SS", which then lowercases to "ss" — a different word (angießend became
 * ANGIESSEND, and typing that finds nothing). The capital ẞ round-trips.
 */
export function upper(word: string): string {
  return word.replace(/ß/g, "ẞ").toUpperCase();
}
