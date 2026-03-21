import { Plus } from "lucide-react";

import { Button } from "~/components/ui/button";

type AddWordSuggestionFormProps = {
  word: string;
  baseLoading: boolean;
  description: string;
  base: string;
  actionState: "idle" | "loading" | "done" | "error" | "license";
  onDescriptionChange: (value: string) => void;
  onBaseChange: (value: string) => void;
  onSubmit: (payload: { description: string; base: string }) => void | Promise<void>;
  onCancel: () => void;
};

export function AddWordSuggestionForm({
  word,
  baseLoading,
  description,
  base,
  actionState,
  onDescriptionChange,
  onBaseChange,
  onSubmit,
  onCancel,
}: AddWordSuggestionFormProps) {
  return (
    <div className="w-full max-w-md bg-orange-50 border border-orange-200 rounded-xl p-5 text-left">
      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
        <Plus className="w-4 h-4 text-orange-600" />
        {word} hinzufügen
      </h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Beschreibung{" "}
            {baseLoading ? (
              <span className="text-gray-400 font-normal text-xs">Wird vorgeschlagen…</span>
            ) : (
              <span className="text-gray-400 font-normal">(optional, bitte prüfen)</span>
            )}
          </label>
          <textarea
            value={description}
            onChange={(e) => onDescriptionChange(e.target.value)}
            placeholder={baseLoading ? "" : "Kurze Erläuterung – z. B. Plural von HUND"}
            rows={2}
            disabled={baseLoading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none disabled:bg-gray-50 disabled:text-gray-400"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Grundform <span className="text-gray-400 font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={base}
            onChange={(e) => onBaseChange(e.target.value.toLowerCase())}
            placeholder={baseLoading ? "Wird erkannt…" : "z. B. hund"}
            disabled={baseLoading}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-400"
          />
          <p className="text-xs text-gray-400 mt-1">
            Grundform / Lemma (Kleinbuchstaben). Wird automatisch erkannt, falls möglich.
          </p>
        </div>
        <div className="flex gap-2 pt-1">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            disabled={actionState === "loading"}
            onClick={() => onSubmit({ description, base })}
          >
            {actionState === "loading" ? "Wird gespeichert…" : "Vorschlag einreichen"}
          </Button>
          <Button
            variant="outline"
            onClick={onCancel}
          >
            Abbrechen
          </Button>
        </div>
      </div>
    </div>
  );
}

