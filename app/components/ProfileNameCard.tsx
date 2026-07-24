import { useState } from "react";
import { UserRound } from "lucide-react";
import { Card } from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import { screenName } from "../../lib/screen-name";
import type { User } from "../../lib/auth";

/**
 * Public screen name settings: shown instead of the email on all public
 * surfaces (word history, changelog). Empty resets to the automatic Besucher-<id>.
 */
export function ProfileNameCard({ user }: { user: User }) {
  const [current, setCurrent] = useState(user.displayName);
  const [value, setValue] = useState(user.displayName ?? "");
  const [state, setState] = useState<"idle" | "loading" | "saved" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    setState("loading");
    setError(null);
    const res = await fetch("/api/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: value }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      error?: string;
      displayName?: string | null;
    };
    if (!res.ok) {
      setState("error");
      setError(data.error ?? "Fehler");
      return;
    }
    setCurrent(data.displayName ?? null);
    setValue(data.displayName ?? "");
    setState("saved");
  };

  return (
    <Card className="p-4 mb-8">
      <div className="flex items-start gap-3">
        <UserRound className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-700">
            Dein öffentlicher Anzeigename:{" "}
            <span className="font-medium">{screenName(current, user.id)}</span>
          </p>
          <p className="text-xs text-gray-400 mt-0.5 mb-2">
            Erscheint statt deiner E-Mail-Adresse in der Änderungshistorie. Leer lassen für den
            automatischen Namen.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                if (state === "saved") setState("idle");
              }}
              placeholder={`Besucher-${user.id}`}
              maxLength={30}
              className="h-9 w-52 text-sm"
            />
            <Button
              variant="outline"
              className="h-9 border-orange-400 text-orange-600 hover:bg-orange-50"
              disabled={state === "loading" || (value.trim() === (current ?? ""))}
              onClick={() => void save()}
            >
              {state === "loading" ? "Wird gespeichert…" : "Speichern"}
            </Button>
            {state === "saved" && <span className="text-sm text-green-600">✓ Gespeichert</span>}
          </div>
          {error && <p className="text-sm text-red-600 mt-1">{error}</p>}
        </div>
      </div>
    </Card>
  );
}
