import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Plus, AlertCircle } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card } from "~/components/ui/card";
import { WordBadge } from "~/components/WordBadge";
import { HeroWordBadge } from "~/components/HeroWordBadge";
import { CC0LicenseConfirm } from "~/components/CC0LicenseConfirm";
import { AddWordSuggestionForm } from "~/components/AddWordSuggestionForm";
import { AddWordSuggestionDoneState } from "~/components/AddWordSuggestionDoneState";
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

  // Inline "add" form state
  const [addFormOpen, setAddFormOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [base, setBase] = useState("");
  const [baseLoading, setBaseLoading] = useState(false);

  const openAddForm = async () => {
    setAddFormOpen(true);
    setDescription("");
    setBase("");
    setBaseLoading(true);
    try {
      const r = await fetch(`/api/word-enrich/${encodeURIComponent(wordLower)}`);
      const d = await r.json() as { base: string | null; description: string | null };
      setBase(d.base ?? "");
      setDescription(d.description ?? "");
    } catch { /* ignore */ }
    setBaseLoading(false);
  };

  const submitSuggestion = async (
    action: "add" | "remove",
    payload?: { description?: string; base?: string },
  ) => {
    setActionState("loading");
    setActionError(null);
    const body: Record<string, unknown> = { word: wordLower, action };
    if (payload && (payload.description || payload.base)) {
      const p: Record<string, string> = {};
      if (payload.description) p.description = payload.description;
      if (payload.base) p.base = payload.base;
      body.payload = p;
    }
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
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
      setAddFormOpen(false);
    }
  };

  const handleSuggest = (action: "add" | "remove") => {
    if (action === "add") {
      openAddForm();
    } else {
      submitSuggestion(action);
    }
  };

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
      const action = pendingAction;
      setPendingAction(null);
      // Re-submit with the description/base payload if this was an "add" action
      const payload = action === "add" ? { description, base } : undefined;
      await submitSuggestion(action, payload);
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
    <div>

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
              <CC0LicenseConfirm
                actionState={actionState}
                onAccept={handleAcceptLicense}
                onCancel={() => {
                  setActionState("idle");
                  setPendingAction(null);
                }}
              />
            ) : actionState === "done" ? (
              <AddWordSuggestionDoneState
                morphCandidates={morphCandidates}
                morphState={morphState}
                selectedMorph={selectedMorph}
                onToggleMorphWord={(w, checked) => {
                  const next = new Set(selectedMorph);
                  checked ? next.add(w) : next.delete(w);
                  setSelectedMorph(next);
                }}
                onMorphSubmit={handleMorphSubmit}
              />
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
            ) : addFormOpen ? (
              <AddWordSuggestionForm
                word={word}
                baseLoading={baseLoading}
                description={description}
                base={base}
                actionState={actionState}
                onDescriptionChange={setDescription}
                onBaseChange={setBase}
                onSubmit={({ description, base }) => submitSuggestion("add", { description, base })}
                onCancel={() => {
                  setAddFormOpen(false);
                  setActionState("idle");
                }}
              />
            ) : (
              <Button
                className="bg-orange-500 hover:bg-orange-600"
                onClick={() => handleSuggest("add")}
              >
                <Plus className="w-4 h-4 mr-2" />
                Hinzufügen vorschlagen
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

      
    </div>
  );
}
