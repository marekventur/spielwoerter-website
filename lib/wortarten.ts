/**
 * The nine basic word classes from forum thread 8, with the abbreviation
 * that starts a word's description ("Verb — ...", "Subst. — ...").
 */
export const WORTARTEN = [
  { key: "verb", label: "Verb", abbr: "Verb", beispiele: "atmen, laufen, schwanzwedeln" },
  { key: "subst", label: "Substantiv", abbr: "Subst.", beispiele: "Abend, Schule" },
  { key: "adj", label: "Adjektiv", abbr: "Adj.", beispiele: "bunt, klassisch, schön" },
  { key: "art", label: "Artikel", abbr: "Art.", beispiele: "der, die, das, ein" },
  { key: "pron", label: "Pronomen", abbr: "Pron.", beispiele: "er, dieser, meine" },
  { key: "num", label: "Numerale", abbr: "Num.", beispiele: "erst, dritt, einerlei" },
  { key: "adv", label: "Adverb", abbr: "Adv.", beispiele: "abseits, gestern, herein" },
  { key: "praep", label: "Präposition", abbr: "Präp.", beispiele: "in, auf, wegen" },
  { key: "konj", label: "Konjunktion", abbr: "Konjunk.", beispiele: "und, weil, aber" },
] as const;

export type Wortart = (typeof WORTARTEN)[number]["key"];

/** "Verb — sich etwas ausdenken" */
export function baseDescription(wortart: Wortart, bedeutung: string): string {
  const abbr = WORTARTEN.find((w) => w.key === wortart)!.abbr;
  return bedeutung.trim() ? `${abbr} — ${bedeutung.trim()}` : abbr;
}
