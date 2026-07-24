import type Database from "better-sqlite3";

/**
 * Advisory warnings for removal suggestions. Nearly all wrongly removed words
 * were rule-permitted special forms (Dativ-e, e-Tilgung, archaic Konjunktiv II)
 * that don't appear as dictionary headwords — flag likely candidates so the
 * moderator checks REGELN.md before removing. Heuristic, never blocking.
 */

type WordRow = { word: string; description: string | null; base: string | null };

const SPECIAL_FORM_PATTERN = /konjunktiv|dativ|veraltet|dichterisch|gehoben|e-tilgung/i;

export function removalHints(db: Database.Database, wordLower: string): string[] {
  const hints: string[] = [];
  const row = db
    .prepare("SELECT word, description, base FROM words WHERE word = ?")
    .get(wordLower) as WordRow | undefined;

  if (row?.description && SPECIAL_FORM_PATTERN.test(row.description)) {
    hints.push(
      "Die Beschreibung deutet auf eine Sonderform hin (z. B. Dativ-e, Konjunktiv II oder veraltete Form) — solche Formen sind laut Regeln oft gültig."
    );
  }

  // e-Tilgung: re-inserting an "e" yields an existing word (umsehn→umsehen,
  // gewesne→gewesene, freun→freuen). Internal positions only — appending at
  // the end would match plurals (hund→hunde), which is not e-Tilgung.
  const exists = db.prepare(
    "SELECT 1 FROM words WHERE word = ? AND in_list IN ('accepted', 'uncertain')"
  );
  for (let i = 1; i < wordLower.length; i++) {
    const expanded = wordLower.slice(0, i) + "e" + wordLower.slice(i);
    if (expanded !== wordLower && exists.get(expanded)) {
      hints.push(
        `Möglicherweise verkürzte Form von „${expanded.toUpperCase()}" (e-Tilgung) — laut Regeln oft zulässig.`
      );
      break;
    }
  }

  // Dativ-e: trailing e whose stem is in the list and no description that
  // would identify it as a plural or other regular form.
  if (
    hints.length === 0 &&
    !row?.description &&
    wordLower.endsWith("e") &&
    exists.get(wordLower.slice(0, -1))
  ) {
    hints.push(
      `Könnte eine Dativ-e-Form von „${wordLower.slice(0, -1).toUpperCase()}" sein — das Dativ-e ist laut Regeln weiterhin zulässig.`
    );
  }

  return hints;
}
