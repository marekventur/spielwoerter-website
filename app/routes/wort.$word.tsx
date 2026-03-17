import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Plus, AlertCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { WordBadge } from "~/components/WordBadge";
import { HeroWordBadge } from "~/components/HeroWordBadge";
import type { Route } from "./+types/wort.$word";
import type { WordBadgeStatus } from "~/components/WordBadge";

export function meta({ params }: Route.MetaArgs) {
  return [{ title: `${params.word} – Spielwörter.de` }];
}

// Mock data – in real app this would come from backend/API
function getWordData(word: string) {
  const isAccepted = word.length > 3;
  return {
    isAccepted,
    relatedWords: [
      { word: "WASSER", status: "accepted" as WordBadgeStatus },
      { word: "TURM", status: "accepted" as WordBadgeStatus },
      { word: "WASSERS", status: "accepted" as WordBadgeStatus },
      { word: "TÜRME", status: "accepted" as WordBadgeStatus },
      { word: "WASSERTURMS", status: "not-accepted" as WordBadgeStatus },
      { word: "WASSERTÜRME", status: "pending-add" as WordBadgeStatus },
      { word: "TURMES", status: "accepted" as WordBadgeStatus },
      { word: "WASSERTURMES", status: "not-accepted" as WordBadgeStatus },
      { word: "WÄSSER", status: "accepted" as WordBadgeStatus },
      { word: "TURMSPITZE", status: "accepted" as WordBadgeStatus },
    ],
  };
}

const externalDictionaries = [
  { name: "Wiktionary", url: (w: string) => `https://de.wiktionary.org/wiki/${w.toLowerCase()}` },
  { name: "Duden", url: (w: string) => `https://www.duden.de/suchen/dudenonline/${w.toLowerCase()}` },
  { name: "DWDS", url: (w: string) => `https://www.dwds.de/wb/${w.toLowerCase()}` },
  { name: "Wahrig", url: (w: string) => `https://www.wahrig.de/search?q=${w.toLowerCase()}` },
];

export default function WortPage({ params }: Route.ComponentProps) {
  const word = decodeURIComponent(params.word);
  const [pendingAction, setPendingAction] = useState<"add" | "remove" | null>(null);
  const wordData = getWordData(word);

  const status: WordBadgeStatus =
    pendingAction === "add"
      ? "pending-add"
      : pendingAction === "remove"
        ? "pending-remove"
        : wordData.isAccepted
          ? "accepted"
          : "not-accepted";

  const handleRequestAdd = () => {
    setPendingAction("add");
    // TODO: Send request to backend
  };

  const handleRequestRemove = () => {
    setPendingAction("remove");
    // TODO: Send request to backend
  };

  const wordLower = word.toLowerCase();

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-orange-50">
      {/* Navigation – aligned with home.tsx */}
      <nav className="border-b bg-white/80 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-6xl mx-auto px-6 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <div className="flex gap-1">
              <div className="w-8 h-8 bg-orange-500 rounded flex items-center justify-center text-white font-bold text-sm">
                S
              </div>
              <div className="w-8 h-8 bg-orange-400 rounded flex items-center justify-center text-white font-bold text-sm">
                W
              </div>
            </div>
            <span className="text-xl font-bold text-gray-800">
              Spielwörter.de
            </span>
          </Link>
          <div className="flex items-center gap-4">
            <a
              href="#"
              className="text-gray-600 hover:text-orange-600 transition-colors"
            >
              Über das Projekt
            </a>
            <a
              href="#"
              className="text-gray-600 hover:text-orange-600 transition-colors"
            >
              Download
            </a>
            <Button
              variant="outline"
              className="border-orange-500 text-orange-600 hover:bg-orange-50"
            >
              Login
            </Button>
          </div>
        </div>
      </nav>

      {/* Content */}
      <div className="max-w-4xl mx-auto px-6 py-12">
        {/* Word title and hero badge */}
        <div className="text-center mb-8">
          <div className="flex justify-center mb-4">
            <HeroWordBadge word={word} status={status} />
          </div>

          {pendingAction && (
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4 inline-block">
              <p className="text-blue-800">
                {pendingAction === "add"
                  ? "✓ Dein Vorschlag wurde eingereicht. Ein Reviewer wird ihn prüfen."
                  : "✓ Dein Löschvorschlag wurde eingereicht. Ein Reviewer wird ihn prüfen."}
              </p>
            </div>
          )}

          {!pendingAction && (
            <div className="flex gap-4 justify-center">
              {wordData.isAccepted ? (
                <Button
                  variant="outline"
                  onClick={handleRequestRemove}
                  className="border-amber-500 text-amber-700 hover:bg-amber-50"
                >
                  <AlertCircle className="w-4 h-4 mr-2" />
                  Melde dieses Wort als fehlerhaft
                </Button>
              ) : (
                <Button
                  onClick={handleRequestAdd}
                  className="bg-orange-500 hover:bg-orange-600"
                >
                  <Plus className="w-4 h-4 mr-2" />
                  Hinzufügen vorschlagen
                </Button>
              )}
            </div>
          )}
        </div>

        {/* External dictionaries */}
        <div className="mb-8">
          <h2 className="text-lg font-bold mb-3 text-gray-800">
            Externe Wörterbücher
          </h2>
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

        {/* Related words */}
        <Card className="p-6">
          <h2 className="text-lg font-bold mb-4 text-gray-800">
            Verwandte Wörter
          </h2>
          <div className="flex flex-wrap gap-3">
            {wordData.relatedWords.map((related) => (
              <Link
                key={related.word}
                to={`/wort/${encodeURIComponent(related.word)}`}
                className="inline-block transition-opacity hover:opacity-80"
              >
                <WordBadge
                  word={related.word}
                  status={related.status}
                  size="md"
                />
              </Link>
            ))}
          </div>
        </Card>

        <p className="mt-8 text-center">
          <Link
            to="/"
            className="text-orange-600 hover:text-orange-700 font-medium"
          >
            ← Zurück zur Startseite
          </Link>
        </p>
      </div>

      {/* Footer – aligned with home.tsx */}
      <footer className="bg-gray-50 border-t py-8 mt-16">
        <div className="max-w-6xl mx-auto px-6 text-center text-gray-600">
          <p className="mb-2">
            <strong>Spielwörter.de</strong> – Ein offenes Projekt für die
            deutsche Wortspiel-Community
          </p>
          <p className="text-sm">
            Lizenziert unter einer offenen Lizenz · Hosted auf GitHub · Made
            with ❤️ für Wortspieler
          </p>
        </div>
      </footer>
    </div>
  );
}
