import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Plus, AlertCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { WordBadge } from "~/components/WordBadge";
import { HeroWordBadge } from "~/components/HeroWordBadge";
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

  return { user: context.user, wordRow, relatedWords, userSuggestions };
}

const externalDictionaries = [
  { name: "Wiktionary", url: (w: string) => `https://de.wiktionary.org/wiki/${w}` },
  { name: "Duden", url: (w: string) => `https://www.duden.de/suchen/dudenonline/${w}` },
  { name: "DWDS", url: (w: string) => `https://www.dwds.de/wb/${w}` },
  { name: "Wahrig", url: (w: string) => `https://www.wahrig.de/search?q=${w}` },
];

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
};

const STATUS_LABELS: Record<string, string> = {
  draft: "Entwurf",
  pending_review: "In Prüfung",
  ai_approved: "KI-genehmigt",
  ai_rejected: "Abgelehnt (KI)",
  moderator_approved: "Genehmigt",
  moderator_rejected: "Abgelehnt",
};

export default function WortPage({ params, loaderData }: Route.ComponentProps) {
  const { user, wordRow, relatedWords, userSuggestions } = loaderData;
  const word = decodeURIComponent(params.word).toUpperCase();
  const wordLower = word.toLowerCase();
  const status = toStatus(wordRow?.in_list);
  const [actionState, setActionState] = useState<"idle" | "loading" | "done" | "error" | "license">("idle");
  const [pendingAction, setPendingAction] = useState<"add" | "remove" | null>(null);
  const [lastAction, setLastAction] = useState<"add" | "remove" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedMorph, setSelectedMorph] = useState<Set<string>>(new Set());
  const [morphState, setMorphState] = useState<"idle" | "loading" | "done">("idle");

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    window.location.reload();
  };

  const submitSuggestion = async (action: "add" | "remove") => {
    setActionState("loading");
    setActionError(null);
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: wordLower, action }),
    });
    const data = await res.json();
    if (res.status === 403 && data.error === "license_required") {
      setPendingAction(action);
      setActionState("license");
    } else if (!res.ok) {
      setActionState("error");
      setActionError(data.error || "Fehler");
    } else {
      setLastAction(action);
      setActionState("done");
    }
  };

  const handleSuggest = (action: "add" | "remove") => submitSuggestion(action);

  const handleMorphSubmit = async () => {
    if (selectedMorph.size === 0 || !lastAction) return;
    setMorphState("loading");
    await Promise.all(
      Array.from(selectedMorph).map((w) =>
        fetch("/api/suggestions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ word: w, action: lastAction }),
        })
      )
    );
    setMorphState("done");
    setSelectedMorph(new Set());
  };

  const handleAcceptLicense = async () => {
    await fetch("/api/auth/accept-license", { method: "POST" });
    if (pendingAction) {
      setPendingAction(null);
      await submitSuggestion(pendingAction);
    }
  };

  const activeDraft = userSuggestions.find((s) => s.status === "draft");
  const anyActive = userSuggestions.some((s) =>
    ["draft", "pending_review", "ai_approved", "moderator_approved"].includes(s.status)
  );

  // Related words eligible for morphology suggestions after a draft is created
  const morphCandidates = relatedWords.filter((r) => {
    if (lastAction === "remove") return r.in_list === "accepted" || r.in_list === "uncertain";
    if (lastAction === "add") return r.in_list !== "accepted" && r.in_list !== "uncertain";
    return false;
  });

  return (
    <div className="min-h-screen bg-gradient-to-b from-orange-50 via-white to-orange-50">
      {/* Navigation */}
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
            <a href="#" className="text-gray-600 hover:text-orange-600 transition-colors">
              Über das Projekt
            </a>
            <a href="#" className="text-gray-600 hover:text-orange-600 transition-colors">
              Download
            </a>
            {user ? (
              <div className="flex items-center gap-3">
                <Link to="/meine-vorschlaege" className="text-gray-600 hover:text-orange-600 transition-colors text-sm">
                  Meine Vorschläge
                </Link>
                <Button
                  variant="outline"
                  className="border-gray-300 text-gray-600 hover:bg-gray-50"
                  onClick={handleLogout}
                >
                  Abmelden
                </Button>
              </div>
            ) : (
              <Link to="/login">
                <Button variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
                  Anmelden
                </Button>
              </Link>
            )}
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

          {wordRow?.description && (
            <p className="text-gray-600 mt-4 text-lg max-w-xl mx-auto">
              {wordRow.description}
            </p>
          )}

          <div className="flex flex-col items-center gap-3 mt-6">
            {actionState === "license" ? (
              <div className="bg-orange-50 border border-orange-200 rounded-xl p-5 max-w-md text-left">
                <h3 className="font-bold text-gray-900 mb-2">CC0-Lizenz bestätigen</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Beiträge zu Spielwörter.de werden unter der{" "}
                  <a href="https://creativecommons.org/publicdomain/zero/1.0/deed.de" target="_blank" rel="noopener noreferrer" className="underline text-orange-600">
                    CC0-Lizenz (Public Domain)
                  </a>{" "}
                  veröffentlicht. Mit dem Absenden verzichtest du auf alle Urheberrechte an deinem Beitrag.
                </p>
                <div className="flex gap-3">
                  <Button
                    className="bg-orange-500 hover:bg-orange-600 text-white"
                    onClick={handleAcceptLicense}
                    disabled={actionState !== "license"}
                  >
                    Ich stimme zu
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => { setActionState("idle"); setPendingAction(null); }}
                  >
                    Abbrechen
                  </Button>
                </div>
              </div>
            ) : actionState === "done" ? (
              <div className="w-full max-w-md">
                <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm mb-3">
                  ✓ Entwurf gespeichert.{" "}
                  <Link to="/meine-vorschlaege" className="underline font-medium">
                    Meine Vorschläge
                  </Link>
                </p>

                {morphCandidates.length > 0 && morphState !== "done" && (
                  <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                    <p className="text-sm font-medium text-gray-700 mb-3">
                      Weitere Formen mit gleichem Stichwort:
                    </p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {morphCandidates.map((r) => (
                        <label
                          key={r.word}
                          className="flex items-center gap-1.5 cursor-pointer select-none"
                        >
                          <input
                            type="checkbox"
                            className="rounded"
                            checked={selectedMorph.has(r.word)}
                            onChange={(e) => {
                              const next = new Set(selectedMorph);
                              e.target.checked ? next.add(r.word) : next.delete(r.word);
                              setSelectedMorph(next);
                            }}
                          />
                          <span className="text-sm font-mono font-bold text-gray-800">
                            {r.word.toUpperCase()}
                          </span>
                        </label>
                      ))}
                    </div>
                    <Button
                      className="bg-orange-500 hover:bg-orange-600 text-white text-sm"
                      disabled={selectedMorph.size === 0 || morphState === "loading"}
                      onClick={handleMorphSubmit}
                    >
                      {morphState === "loading"
                        ? "Wird gespeichert…"
                        : `${selectedMorph.size > 0 ? selectedMorph.size + " " : ""}Entwurf${selectedMorph.size !== 1 ? "würfe" : ""} hinzufügen`}
                    </Button>
                  </div>
                )}

                {morphState === "done" && (
                  <p className="text-sm text-gray-500 text-center">
                    Weitere Entwürfe gespeichert.
                  </p>
                )}
              </div>
            ) : anyActive ? (
              <p className="text-sm text-gray-500">
                Du hast bereits einen Vorschlag für dieses Wort.{" "}
                <Link to="/meine-vorschlaege" className="underline text-orange-600">
                  Meine Vorschläge
                </Link>
              </p>
            ) : !user ? (
              <Link to={`/login?from=/wort/${encodeURIComponent(word)}`}>
                <Button variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
                  Anmelden zum Vorschlagen
                </Button>
              </Link>
            ) : wordRow?.in_list === "accepted" || wordRow?.in_list === "uncertain" ? (
              <Button
                variant="outline"
                className="border-amber-500 text-amber-700 hover:bg-amber-50"
                disabled={actionState === "loading"}
                onClick={() => handleSuggest("remove")}
              >
                <AlertCircle className="w-4 h-4 mr-2" />
                {actionState === "loading" ? "Wird gespeichert…" : "Melde dieses Wort als fehlerhaft"}
              </Button>
            ) : (
              <Button
                className="bg-orange-500 hover:bg-orange-600"
                disabled={actionState === "loading"}
                onClick={() => handleSuggest("add")}
              >
                <Plus className="w-4 h-4 mr-2" />
                {actionState === "loading" ? "Wird gespeichert…" : "Hinzufügen vorschlagen"}
              </Button>
            )}
            {actionState === "error" && (
              <p className="text-sm text-red-600">{actionError}</p>
            )}
          </div>
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
        {relatedWords.length > 0 && (
          <Card className="p-6 mb-8">
            <h2 className="text-lg font-bold mb-4 text-gray-800">
              Verwandte Wörter
            </h2>
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

      {/* Footer */}
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
