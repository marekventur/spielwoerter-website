import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "~/components/ui/button";

type VariantSuggestionCardProps = {
  word: string;
  initialDescription: string;
  initialBase: string;
  onDone: (word: string, submitted: boolean) => void;
};

export function VariantSuggestionCard({
  word,
  initialDescription,
  initialBase,
  onDone,
}: VariantSuggestionCardProps) {
  const [description, setDescription] = useState(initialDescription);
  const [base, setBase] = useState(initialBase);
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setStatus("loading");
    setError(null);

    const payload: Record<string, string> = {};
    if (description.trim()) payload.description = description.trim();
    const baseTrim = base.trim().toLowerCase();
    if (baseTrim && baseTrim !== word.toLowerCase()) {
      payload.base = baseTrim;
    }

    const res = await fetch("/api/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        word,
        action: "add",
        ...(Object.keys(payload).length > 0 ? { payload } : {}),
      }),
    });

    if (!res.ok) {
      const d = await res.json() as { error?: string };
      setStatus("error");
      setError(d.error ?? "Fehler");
    } else {
      onDone(word, true);
    }
  };

  return (
    <div className="w-full bg-orange-50 border border-orange-200 rounded-xl p-5 text-left">
      <h3 className="font-bold text-gray-900 mb-3 flex items-center gap-2">
        <Plus className="w-4 h-4 text-orange-600" />
        {word.toUpperCase()} hinzufügen
      </h3>
      <div className="space-y-3">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            Beschreibung{" "}
            <span className="text-gray-400 font-normal">(optional, bitte prüfen)</span>
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Kurze Erläuterung – z. B. Plural von HUND"
            rows={2}
            disabled={status === "loading"}
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
            onChange={(e) => setBase(e.target.value)}
            placeholder="z. B. hund"
            disabled={status === "loading"}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-gray-50 disabled:text-gray-400 uppercase"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex gap-2 pt-1">
          <Button
            className="bg-orange-500 hover:bg-orange-600 text-white"
            disabled={status === "loading"}
            onClick={() => void handleSubmit()}
          >
            {status === "loading" ? "Wird gespeichert…" : "Vorschlag einreichen"}
          </Button>
          <Button
            variant="outline"
            disabled={status === "loading"}
            onClick={() => onDone(word, false)}
          >
            Abbrechen
          </Button>
        </div>
      </div>
    </div>
  );
}
