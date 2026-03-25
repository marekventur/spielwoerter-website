import { useState, useEffect } from "react";
import { Link } from "react-router";
import { Plus, AlertCircle, Pencil } from "lucide-react";
import { Button } from "~/components/ui/button";
import { VariantSuggestionCard } from "~/components/VariantSuggestionCard";
import { LlmVariantNotices, type VariantNotice } from "~/components/LlmVariantNotices";
import { AddWordSuggestionDoneState } from "~/components/AddWordSuggestionDoneState";
import type { User } from "../../lib/auth";

type WordRow = {
  description: string | null;
  base: string | null;
  in_list: string;
};

type RelatedRow = { word: string; in_list: string; description: string | null };

type SuggestionRow = {
  id: number;
  action: string;
  status: string;
};

type SuggestionCardData = { word: string; description: string; base: string };

type WortPageSuggestionPanelProps = {
  word: string;
  wordLower: string;
  user: User | null;
  wordRow: WordRow | undefined;
  relatedWords: RelatedRow[];
  userSuggestions: SuggestionRow[];
  addInReviewByOthers: boolean;
  removeInReviewByOthers: boolean;
};

export function WortPageSuggestionPanel({
  word,
  wordLower,
  user,
  wordRow,
  relatedWords,
  userSuggestions,
  addInReviewByOthers,
  removeInReviewByOthers,
}: WortPageSuggestionPanelProps) {
  const [actionState, setActionState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const [lastAction, setLastAction] = useState<"remove" | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [selectedMorph, setSelectedMorph] = useState<Set<string>>(new Set());
  const [morphState, setMorphState] = useState<"idle" | "loading" | "done">("idle");

  const [editFormOpen, setEditFormOpen] = useState(false);
  const [editDescription, setEditDescription] = useState("");
  const [editBase, setEditBase] = useState("");

  const [addFlow, setAddFlow] = useState<"idle" | "loading" | "cards" | "done">("idle");
  const [suggestionCards, setSuggestionCards] = useState<SuggestionCardData[]>([]);
  const [handledCards, setHandledCards] = useState<Map<string, "submitted" | "dismissed">>(
    new Map()
  );
  const [variantNotices, setVariantNotices] = useState<VariantNotice[]>([]);

  useEffect(() => {
    if (addFlow !== "cards" || suggestionCards.length === 0) return;
    if (handledCards.size < suggestionCards.length) return;
    const anySubmitted = Array.from(handledCards.values()).some((v) => v === "submitted");
    setAddFlow(anySubmitted ? "done" : "idle");
  }, [addFlow, handledCards, suggestionCards]);

  const openAddForm = async () => {
    setAddFlow("loading");
    setSuggestionCards([]);
    setHandledCards(new Map());
    setVariantNotices([]);
    try {
      const r = await fetch(`/api/word-enrich/${encodeURIComponent(wordLower)}`);
      const d = await r.json() as {
        base: string | null;
        description: string | null;
        variants: Array<{ word: string; description: string; base: string | null }>;
        variantNotices?: VariantNotice[];
      };
      const cards: SuggestionCardData[] = [
        { word: wordLower, description: d.description ?? "", base: d.base ?? "" },
        ...(d.variants ?? []).map((v) => ({
          word: v.word,
          description: v.description,
          base: v.base ?? "",
        })),
      ];
      setSuggestionCards(cards);
      setVariantNotices(d.variantNotices ?? []);
      setAddFlow("cards");
    } catch {
      setSuggestionCards([{ word: wordLower, description: "", base: "" }]);
      setVariantNotices([]);
      setAddFlow("cards");
    }
  };

  const handleCardDone = (cardWord: string, submitted: boolean) => {
    setHandledCards((prev) =>
      new Map(prev).set(cardWord, submitted ? "submitted" : "dismissed")
    );
  };

  const pendingSuggestionCards = suggestionCards.filter((c) => !handledCards.has(c.word));

  const submitRemove = async () => {
    setActionState("loading");
    setActionError(null);
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ word: wordLower, action: "remove" }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setActionState("error");
      setActionError(data.error ?? "Fehler");
    } else {
      setLastAction("remove");
      setActionState("done");
    }
  };

  const openEditForm = () => {
    setEditFormOpen(true);
    setEditDescription(wordRow?.description ?? "");
    setEditBase(wordRow?.base ?? "");
  };

  const submitChangeDescription = async () => {
    const d = editDescription.trim();
    const b = editBase.trim();
    if (!d && !b) {
      setActionError("Mindestens Beschreibung oder Grundform ausfüllen.");
      return;
    }
    setActionState("loading");
    setActionError(null);
    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word: wordLower,
        action: "change_description",
        payload: { description: d, base: b },
      }),
    });
    const data = await res.json() as { error?: string };
    if (!res.ok) {
      setActionState("error");
      setActionError(data.error ?? "Fehler");
    } else {
      setLastAction(null);
      setActionState("done");
      setEditFormOpen(false);
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

  const anyActive = userSuggestions.some((s) =>
    [
      "draft",
      "pending_review",
      "ai_approved",
      "needs_moderator",
      "moderator_approved",
    ].includes(s.status)
  );

  const morphCandidates = relatedWords.filter((r) =>
    lastAction === "remove"
      ? r.in_list === "accepted" || r.in_list === "uncertain"
      : false
  );

  const inList = wordRow?.in_list === "accepted" || wordRow?.in_list === "uncertain";
  const loginHref = `/login?from=/wort/${encodeURIComponent(word)}`;

  return (
    <div className="flex flex-col items-center gap-3 mt-6">
      {addFlow === "done" ? (
        <p className="text-green-700 bg-green-50 border border-green-200 rounded-lg px-4 py-2 text-sm">
          ✓ Entwurf gespeichert.{" "}
          <Link to="/meine-vorschlaege" className="underline font-medium">
            Meine Vorschläge
          </Link>
        </p>
      ) : addFlow === "loading" ? (
        <p className="text-sm text-gray-400 animate-pulse">Wird vorbereitet…</p>
      ) : addFlow === "cards" ? (
        <div className="w-full max-w-lg space-y-4">
          {pendingSuggestionCards.map((card) => (
            <VariantSuggestionCard
              key={card.word}
              word={card.word}
              initialDescription={card.description}
              initialBase={card.base}
              onDone={handleCardDone}
            />
          ))}
          <LlmVariantNotices notices={variantNotices} />
        </div>
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
      ) : !inList && addInReviewByOthers ? (
        <div className="flex flex-col items-center gap-3 max-w-md text-center">
          <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-xl px-4 py-3 w-full">
            Dieses Wort wird bereits geprüft – du kannst derzeit keinen weiteren Vorschlag für dieses Wort
            einreichen.
          </p>
          {!user ? (
            <Link to={loginHref}>
              <Button
                variant="outline"
                className="border-orange-500 text-orange-600 hover:bg-orange-50"
              >
                Fehler gefunden? Anmelden und beheben!
              </Button>
            </Link>
          ) : null}
        </div>
      ) : !user ? (
        <Link to={loginHref}>
          <Button variant="outline" className="border-orange-500 text-orange-600 hover:bg-orange-50">
            Fehler gefunden? Anmelden und beheben!
          </Button>
        </Link>
      ) : inList && editFormOpen ? (
        <div className="w-full max-w-md bg-sky-50 border border-sky-200 rounded-xl p-5 text-left">
          <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
            <Pencil className="w-4 h-4 text-sky-600" />
            {word} bearbeiten
          </h3>
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Beschreibung</label>
              <textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                rows={3}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-400 resize-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Grundform <span className="text-gray-400 font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={editBase}
                onChange={(e) => setEditBase(e.target.value.toLowerCase())}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
            </div>
            <div className="flex gap-2 pt-1">
              <Button
                className="bg-sky-600 hover:bg-sky-700 text-white"
                disabled={actionState === "loading"}
                onClick={() => void submitChangeDescription()}
              >
                {actionState === "loading" ? "Wird gespeichert…" : "Vorschlag einreichen"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setEditFormOpen(false);
                  setActionState("idle");
                  setActionError(null);
                }}
              >
                Abbrechen
              </Button>
            </div>
          </div>
        </div>
      ) : inList ? (
        <div className="flex flex-col items-center gap-3 max-w-lg w-full">
          {removeInReviewByOthers ? (
            <p className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 w-full text-center">
              Eine Entfernung wird bereits geprüft
            </p>
          ) : null}
          <div className="flex flex-col items-center gap-3">
            <Button
              variant="outline"
              className="border-sky-500 text-sky-700 hover:bg-sky-50"
              disabled={actionState === "loading"}
              onClick={openEditForm}
            >
              <Pencil className="w-4 h-4 mr-2" />
              Eintrag verbessern
            </Button>
            <Button
              variant="outline"
              className="border-amber-500 text-amber-700 hover:bg-amber-50"
              disabled={actionState === "loading" || removeInReviewByOthers}
              onClick={() => void submitRemove()}
            >
              <AlertCircle className="w-4 h-4 mr-2" />
              {actionState === "loading" ? "Wird gespeichert…" : "Melde dieses Wort als fehlerhaft"}
            </Button>
          </div>
        </div>
      ) : (
        <Button className="bg-orange-500 hover:bg-orange-600" onClick={() => void openAddForm()}>
          <Plus className="w-4 h-4 mr-2" />
          Wort hinzufügen
        </Button>
      )}
      {actionState === "error" && <p className="text-sm text-red-600">{actionError}</p>}
    </div>
  );
}
