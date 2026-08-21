import { useState } from "react";
import { Mail } from "lucide-react";
import { Card } from "~/components/ui/card";
import type { User } from "../../lib/auth";

const DISKUSSION_OPTIONS: { value: User["emailDiskussion"]; label: string }[] = [
  { value: "all", label: "Jeden Beitrag" },
  { value: "mine", label: "Nur Themen, in denen ich geschrieben habe" },
  { value: "none", label: "Keine E-Mails" },
];

/** Per-channel mail preferences. Login codes are transactional and not listed. */
export function EmailSettingsCard({ user }: { user: User }) {
  const [diskussion, setDiskussion] = useState(user.emailDiskussion);
  const [digest, setDigest] = useState(user.emailDigest);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const save = async (patch: {
    emailDiskussion?: User["emailDiskussion"];
    emailDigest?: boolean;
  }) => {
    setState("saving");
    const res = await fetch("/api/profile/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    setState(res.ok ? "saved" : "error");
  };

  return (
    <Card className="p-4 mb-8">
      <div className="flex items-start gap-3">
        <Mail className="w-5 h-5 text-gray-400 mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-700 mb-3">E-Mail-Einstellungen</p>

          {user.isModerator && (
            <div className="mb-4">
              <p className="text-sm text-gray-700">Diskussion der Moderator:innen</p>
              <p className="text-xs text-gray-400 mt-0.5 mb-2">
                Beiträge auf der Diskussionsseite. Du kannst direkt auf diese E-Mails
                antworten.
              </p>
              <div className="space-y-1">
                {DISKUSSION_OPTIONS.map((o) => (
                  <label key={o.value} className="flex items-center gap-2 text-sm text-gray-600">
                    <input
                      type="radio"
                      name="email-diskussion"
                      checked={diskussion === o.value}
                      onChange={() => {
                        setDiskussion(o.value);
                        void save({ emailDiskussion: o.value });
                      }}
                    />
                    {o.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div>
            <label className="flex items-center gap-2 text-sm text-gray-600">
              <input
                type="checkbox"
                checked={digest}
                onChange={(e) => {
                  setDigest(e.target.checked);
                  void save({ emailDigest: e.target.checked });
                }}
              />
              Zusammenfassung zu meinen Vorschlägen
            </label>
            <p className="text-xs text-gray-400 mt-0.5 ml-6">
              Wenn deine Vorschläge angenommen oder abgelehnt wurden.
            </p>
          </div>

          <p className="text-xs mt-3 h-4">
            {state === "saving" && <span className="text-gray-400">Wird gespeichert…</span>}
            {state === "saved" && <span className="text-green-600">Gespeichert</span>}
            {state === "error" && <span className="text-red-600">Fehler beim Speichern</span>}
          </p>
        </div>
      </div>
    </Card>
  );
}
