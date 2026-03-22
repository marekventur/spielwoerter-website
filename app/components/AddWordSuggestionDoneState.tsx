import { Button } from "~/components/ui/button";
import { Link } from "react-router";

type MorphCandidate = {
  word: string;
};

type AddWordSuggestionDoneStateProps = {
  morphCandidates: MorphCandidate[];
  morphState: "idle" | "loading" | "done";
  selectedMorph: Set<string>;
  onToggleMorphWord: (word: string, checked: boolean) => void;
  onMorphSubmit: () => void | Promise<void>;
};

export function AddWordSuggestionDoneState({
  morphCandidates,
  morphState,
  selectedMorph,
  onToggleMorphWord,
  onMorphSubmit,
}: AddWordSuggestionDoneStateProps) {
  return (
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
                  onChange={(e) => onToggleMorphWord(r.word, e.target.checked)}
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
            onClick={onMorphSubmit}
          >
            {morphState === "loading"
              ? "Wird gespeichert…"
              : `${selectedMorph.size > 0 ? selectedMorph.size + " " : ""}Entwurf${
                  selectedMorph.size !== 1 ? "würfe" : ""
                } hinzufügen`}
          </Button>
        </div>
      )}

      {morphState === "done" && (
        <p className="text-sm text-gray-500 text-center">
          Weitere Entwürfe gespeichert.
        </p>
      )}
    </div>
  );
}
