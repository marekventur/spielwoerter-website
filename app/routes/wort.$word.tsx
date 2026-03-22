import { Link } from "react-router";
import { ExternalLink } from "lucide-react";
import { Card } from "~/components/ui/card";
import { WordBadge } from "~/components/WordBadge";
import { HeroWordBadge } from "~/components/HeroWordBadge";
import { WortPageSuggestionPanel } from "~/components/WortPageSuggestionPanel";
import type { Route } from "./+types/wort.$word";
import type { WordBadgeStatus } from "~/components/WordBadge";

type WordRow = {
  word: string;
  description: string | null;
  base: string | null;
  source: string | null;
  verified_by: string | null;
  in_list: string;
};

type RelatedRow = { word: string; in_list: string };

function toStatus(inList: string | undefined): WordBadgeStatus {
  if (inList === "accepted") return "accepted";
  if (inList === "uncertain") return "uncertain";
  return "not-accepted";
}

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.word} – Spielwörter.de` }];
}

type SuggestionRow = {
  id: number;
  action: string;
  status: string;
};

export async function loader({ context, params }: Route.LoaderArgs) {
  const wordLower = decodeURIComponent(params.word).toLowerCase();
  const db = context.db;

  const wordRow = db
    .prepare(
      "SELECT word, description, base, source, verified_by, in_list FROM words WHERE word = ?"
    )
    .get(wordLower) as WordRow | undefined;

  const effectiveBase = wordRow?.base ?? wordLower;
  const relatedWords = db
    .prepare(
      "SELECT word, in_list FROM words WHERE (base = ? OR word = ?) AND word != ? LIMIT 30"
    )
    .all(effectiveBase, effectiveBase, wordLower) as RelatedRow[];

  const userSuggestions = context.user
    ? (db
        .prepare(
          "SELECT id, action, status FROM suggestions WHERE user_id = ? AND word = ? ORDER BY created_at DESC"
        )
        .all(context.user.id, wordLower) as SuggestionRow[])
    : [];

  const pipelineStatuses =
    "('draft', 'pending_review', 'ai_approved', 'needs_moderator', 'moderator_approved')";
  const addInReviewByOthers = context.user
    ? Boolean(
        db
          .prepare(
            `SELECT 1 FROM suggestions WHERE word = ? AND action = 'add'
             AND status IN ${pipelineStatuses}
             AND user_id != ?
             LIMIT 1`
          )
          .get(wordLower, context.user.id)
      )
    : Boolean(
        db
          .prepare(
            `SELECT 1 FROM suggestions WHERE word = ? AND action = 'add'
             AND status IN ${pipelineStatuses}
             LIMIT 1`
          )
          .get(wordLower)
      );

  const removeInReviewByOthers = context.user
    ? Boolean(
        db
          .prepare(
            `SELECT 1 FROM suggestions WHERE word = ? AND action = 'remove'
             AND status IN ${pipelineStatuses}
             AND user_id != ?
             LIMIT 1`
          )
          .get(wordLower, context.user.id)
      )
    : false;

  return {
    user: context.user,
    wordRow,
    relatedWords,
    userSuggestions,
    addInReviewByOthers,
    removeInReviewByOthers,
  };
}

const externalDictionaries = [
  { name: "Wiktionary", url: (w: string) => `https://de.wiktionary.org/wiki/${w}` },
  { name: "Duden", url: (w: string) => `https://www.duden.de/suchen/dudenonline/${w}` },
  { name: "DWDS", url: (w: string) => `https://www.dwds.de/wb/${w}` },
  { name: "Wahrig", url: (w: string) => `https://www.wahrig.de/search?q=${w}` },
];

export default function WortPage({ params, loaderData }: Route.ComponentProps) {
  const {
    user,
    wordRow,
    relatedWords,
    userSuggestions,
    addInReviewByOthers,
    removeInReviewByOthers,
  } = loaderData;
  const word = decodeURIComponent(params.word).toUpperCase();
  const wordLower = word.toLowerCase();
  const status = toStatus(wordRow?.in_list);

  return (
    <div>
      <div className="max-w-4xl mx-auto px-6 py-12">
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <HeroWordBadge word={word} status={status} />
          </div>

          {wordRow?.description && (
            <p className="text-gray-600 mt-4 text-lg max-w-xl mx-auto">
              {wordRow.description}
            </p>
          )}

          {wordRow?.base && wordRow.base !== wordLower && (
            <p className="text-gray-600 mt-3 text-base max-w-xl mx-auto">
              Grundform:{" "}
              <Link
                to={`/wort/${encodeURIComponent(wordRow.base.toUpperCase())}`}
                className="font-mono font-semibold text-orange-600 hover:text-orange-700 hover:underline"
              >
                {wordRow.base.toUpperCase()}
              </Link>
            </p>
          )}

          <WortPageSuggestionPanel
            word={word}
            wordLower={wordLower}
            user={user}
            wordRow={wordRow}
            relatedWords={relatedWords}
            userSuggestions={userSuggestions}
            addInReviewByOthers={addInReviewByOthers}
            removeInReviewByOthers={removeInReviewByOthers}
          />
        </div>

        <div className="mb-8">
          <h2 className="text-lg font-bold mb-3 text-gray-800">Externe Wörterbücher</h2>
          <div className="flex flex-wrap gap-2">
            {externalDictionaries.map((dict) => (
              <a
                key={dict.name}
                href={dict.url(wordLower)}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 rounded-lg hover:border-orange-300 hover:bg-orange-50 transition-colors text-sm"
              >
                <ExternalLink className="w-3.5 h-3.5 text-gray-500" />
                <span className="font-medium text-gray-700">{dict.name}</span>
              </a>
            ))}
          </div>
        </div>

        {relatedWords.length > 0 && (
          <Card className="p-6 mb-8">
            <h2 className="text-lg font-bold mb-4 text-gray-800">Verwandte Wörter</h2>
            <div className="flex flex-wrap gap-3">
              {relatedWords.map((related) => (
                <Link
                  key={related.word}
                  to={`/wort/${encodeURIComponent(related.word.toUpperCase())}`}
                  className="inline-block transition-opacity hover:opacity-80"
                >
                  <WordBadge
                    word={related.word.toUpperCase()}
                    status={toStatus(related.in_list)}
                    size="md"
                  />
                </Link>
              ))}
            </div>
          </Card>
        )}

        <p className="mt-8 text-center">
          <Link to="/" className="text-orange-600 hover:text-orange-700 font-medium">
            ← Zurück zur Startseite
          </Link>
        </p>
      </div>
    </div>
  );
}
