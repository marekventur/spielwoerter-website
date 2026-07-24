import { getRegelnHtml } from "../../lib/regeln.js";
import { formatTimestamp } from "~/components/WordHistoryList";
import type { Route } from "./+types/regeln";

const REGELN_SOURCE =
  "https://github.com/marekventur/spielwoerter/blob/main/REGELN.md";

export function meta({}: Route.MetaArgs) {
  return [
    { title: "Wortregeln – Spielwoerter.de" },
    { name: "description", content: "Welche Wörter sind in deutschen Wortspielen zulässig? Die Regeln auf Spielwoerter.de, angelehnt an die offiziellen ORZ-Regeln von Scrabble Deutschland e.V." },
  ];
}

export async function loader({}: Route.LoaderArgs) {
  return { regeln: await getRegelnHtml() };
}

export default function RegelnPage({ loaderData }: Route.ComponentProps) {
  const { regeln } = loaderData;

  return (
    <div className="max-w-3xl mx-auto px-6 py-12 text-gray-800">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">
        Spielwoerter.de Wortregeln
      </h1>
      <p className="text-sm text-gray-500 mb-8">
        Quelle:{" "}
        <a
          href={REGELN_SOURCE}
          className="text-orange-600 hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          REGELN.md
        </a>{" "}
        im Projekt-Repository
        {regeln && <> · Stand: {formatTimestamp(new Date(regeln.fetchedAt).toISOString())}</>}.
      </p>

      {regeln ? (
        <div
          className="regeln-markdown"
          dangerouslySetInnerHTML={{ __html: regeln.html }}
        />
      ) : (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-4 py-3">
          Die Regeln konnten gerade nicht geladen werden. Die vollständige Fassung steht in{" "}
          <a
            href={REGELN_SOURCE}
            className="underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            REGELN.md
          </a>{" "}
          im Projekt-Repository.
        </p>
      )}
    </div>
  );
}
