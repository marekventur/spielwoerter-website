import { data, Link, redirect } from "react-router";
import { normalise } from "../../lib/normalise.js";
import { wordHistory } from "../../lib/history.js";
import { ExternalLink } from "lucide-react";
import { Card } from "~/components/ui/card";
import { HeroWordBadge } from "~/components/HeroWordBadge";
import { WortPageSuggestionPanel } from "~/components/WortPageSuggestionPanel";
import { WordLemmaDescriptionTable } from "~/components/WordLemmaDescriptionTable";
import { WordHistorySection } from "~/components/WordHistorySection";
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

type RelatedRow = { word: string; in_list: string; description: string | null };

function toStatus(inList: string | undefined): WordBadgeStatus {
  if (inList === "accepted") return "accepted";
  if (inList === "uncertain") return "uncertain";
  // A row that exists but is flagged `rejected` was explicitly removed/declined —
  // distinct from a word that was never in the DB (no row → undefined).
  if (inList === "rejected") return "rejected";
  return "not-accepted";
}

export function meta({ params, data }: Route.MetaArgs) {
  const word = params.word;
  const description = data?.wordRow?.description;
  const metaDescription = description
    ? `${word} – ${description} – Das offene, deutsche Wortspiel-Wörterbuch`
    : `${word} – Das offene, deutsche Wortspiel-Wörterbuch`;
  const siteUrl = data?.siteUrl ?? "https://spielwoerter.de";
  const canonical = `${siteUrl}/wort/${encodeURIComponent(word ?? "")}`;
  const tags: ReturnType<Route.MetaFunction> = [
    { title: `${word} – Spielwoerter.de` },
    { name: "description", content: metaDescription },
    { tagName: "link", rel: "canonical", href: canonical },
  ];
  if (!data?.wordRow) {
    tags.push({ name: "robots", content: "noindex, follow" });
  }
  return tags;
}

type SuggestionRow = {
  id: number;
  action: string;
  status: string;
};

export async function loader({ context, params, request }: Route.LoaderArgs) {
  const url = new URL(request.url);
  const noRedirect = url.searchParams.get("no_redirect") === "1";
  const decoded = decodeURIComponent(params.word);
  if (decoded !== decoded.toUpperCase()) {
    // Keep the query string: ?no_redirect / ?redirect_from must survive case canonicalisation.
    throw redirect(`/wort/${encodeURIComponent(decoded.toUpperCase())}${url.search}`);
  }
  let wordLower = decoded.toLowerCase();
  const db = context.db;

  let wordRow = db
    .prepare(
      "SELECT word, description, base, source, verified_by, in_list FROM words WHERE word = ?"
    )
    .get(wordLower) as WordRow | undefined;

  // Set when ?no_redirect=1 suppressed a redirect to a differently-spelled entry.
  let suppressedTarget: string | null = null;

  if (!wordRow) {
    const normalisedInput = normalise(wordLower);
    const normalisedMatch = db
      .prepare("SELECT word FROM words WHERE normalised = ? LIMIT 1")
      .get(normalisedInput) as { word: string } | undefined;
    if (normalisedMatch) {
      // ß.toUpperCase() === 'SS' in JS, so words with ß in the DB produce a canonical
      // uppercase URL containing SS. When a user lands on that SS URL, lowercasing gives
      // 'ss' (not 'ß'), the direct lookup fails, and the normalise redirect would point
      // back to the same SS URL — an infinite loop. Detect this and serve directly instead.
      if (normalisedMatch.word.toUpperCase() !== decoded) {
        const target = normalisedMatch.word.toUpperCase();
        if (noRedirect) {
          suppressedTarget = target;
        } else {
          // Carry the original spelling along so the target page can offer a way back.
          throw redirect(
            `/wort/${encodeURIComponent(target)}?redirect_from=${encodeURIComponent(decoded)}`
          );
        }
      } else {
        wordLower = normalisedMatch.word;
        wordRow = db
          .prepare(
            "SELECT word, description, base, source, verified_by, in_list FROM words WHERE word = ?"
          )
          .get(wordLower) as WordRow | undefined;
      }
    }
  }

  // Only trust ?redirect_from if it really is another spelling of this word — the value
  // ends up in the page, so an arbitrary attacker-supplied string must not be shown.
  const redirectFromRaw = url.searchParams.get("redirect_from");
  const redirectFromUpper = redirectFromRaw ? redirectFromRaw.toUpperCase() : null;
  const redirectedFrom =
    redirectFromUpper &&
    redirectFromUpper !== decoded &&
    normalise(redirectFromUpper) === normalise(wordLower)
      ? redirectFromUpper
      : null;

  const effectiveBase = wordRow?.base ?? wordLower;
  const relatedWords = db
    .prepare(
      `SELECT word, in_list, description FROM words
       WHERE (base = ? OR word = ?) AND word != ? LIMIT 30`
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

  const loaderData = {
    user: context.user,
    wordRow,
    redirectedFrom,
    suppressedTarget,
    relatedWords,
    userSuggestions,
    addInReviewByOthers,
    removeInReviewByOthers,
    history: wordHistory(db, wordLower, {
      forModerator: context.user?.isModerator ?? false,
    }),
    siteUrl: (process.env.SITE_URL ?? "https://spielwoerter.de").replace(/\/$/, ""),
  };
  return data(loaderData, { status: wordRow ? 200 : 404 });
}

const externalDictionaries = [
  { name: "Wiktionary", url: (w: string) => `https://de.wiktionary.org/wiki/${w}` },
  { name: "Duden", url: (w: string) => `https://www.duden.de/suchen/dudenonline/${w}` },
  { name: "DWDS", url: (w: string) => `https://www.dwds.de/wb/${w}` },
];

export default function WortPage({ params, loaderData }: Route.ComponentProps) {
  const {
    user,
    wordRow,
    redirectedFrom,
    suppressedTarget,
    relatedWords,
    userSuggestions,
    addInReviewByOthers,
    removeInReviewByOthers,
    history,
  } = loaderData;
  const word = decodeURIComponent(params.word).toUpperCase();
  const wordLower = word.toLowerCase();
  const status = toStatus(wordRow?.in_list);

  return (
    <div>
      <div className="max-w-4xl mx-auto px-6 py-12">
        {redirectedFrom && (
          <p className="mb-6 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            Weitergeleitet von <span className="font-mono font-semibold">{redirectedFrom}</span>{" "}
            – diese Schreibweise wird im Wörterbuch unter{" "}
            <span className="font-mono font-semibold">{word}</span> geführt.{" "}
            <Link
              to={`/wort/${encodeURIComponent(redirectedFrom)}?no_redirect=1`}
              className="font-semibold text-amber-900 underline hover:text-amber-950"
            >
              Seite für {redirectedFrom} trotzdem anzeigen
            </Link>
          </p>
        )}

        {suppressedTarget && (
          <p className="mb-6 text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
            Weiterleitung deaktiviert:{" "}
            <span className="font-mono font-semibold">{word}</span> ist kein eigener Eintrag.{" "}
            <Link
              to={`/wort/${encodeURIComponent(suppressedTarget)}`}
              className="font-semibold text-amber-900 underline hover:text-amber-950"
            >
              Zum Eintrag {suppressedTarget}
            </Link>
          </p>
        )}

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
          <>
            <h2 className="text-lg font-bold mb-4 text-gray-800">Verwandte Wörter</h2>
            <WordLemmaDescriptionTable
              rows={relatedWords.map((related) => ({
                word: related.word,
                description: related.description,
                badgeStatus: toStatus(related.in_list),
              }))}
            />
          </>
        )}

        <WordHistorySection
          word={word}
          wordLower={wordLower}
          user={user}
          history={history}
        />
      </div>
    </div>
  );
}
