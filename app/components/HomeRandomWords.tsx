import { WordLemmaDescriptionTable } from "~/components/WordLemmaDescriptionTable";
import type { RandomWordEntry } from "../../lib/random-words-cache.js";

type Props = { entries: RandomWordEntry[] };

export function HomeRandomWords({ entries }: Props) {
  if (entries.length === 0) return null;

  return (
    <nav aria-label="Zufällige Stichwörter" className="max-w-3xl mx-auto mt-8 mb-12">
      <WordLemmaDescriptionTable
        rows={entries.map((e) => ({ word: e.word, description: e.description }))}
      />
    </nav>
  );
}
