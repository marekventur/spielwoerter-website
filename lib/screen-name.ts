/**
 * Public identity: every user has a stable screen name — their chosen
 * display_name, or the automatic "Besucher-<id>". Emails must never appear on
 * world-readable surfaces; moderator-only UIs may additionally show emails.
 */
export function screenName(displayName: string | null | undefined, userId: number): string {
  const chosen = displayName?.trim();
  return chosen ? chosen : `Besucher-${userId}`;
}

/** Matches automatic names (current and legacy formats) — reserved. */
export const AUTO_NAME_PATTERN = /^(besucher|user)-(\d+)$/i;

/** Chosen names: 3–30 chars, no @ (nothing email-like), letters/digits/space/_/-. */
export function validateDisplayName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed.length < 3) return "Anzeigename muss mindestens 3 Zeichen haben";
  if (trimmed.length > 30) return "Anzeigename darf höchstens 30 Zeichen haben";
  if (!/^[\p{L}\p{N} _-]+$/u.test(trimmed))
    return "Nur Buchstaben, Zahlen, Leerzeichen, - und _ erlaubt";
  if (AUTO_NAME_PATTERN.test(trimmed))
    return "Dieses Format ist für automatische Namen reserviert";
  return null;
}
