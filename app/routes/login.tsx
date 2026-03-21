import { useState } from "react";
import { redirect, useNavigate } from "react-router";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";
import type { Route } from "./+types/login";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Anmelden – Spielwörter.de" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  if (context.user) {
    const url = new URL(request.url);
    const from = url.searchParams.get("from") || "/";
    return redirect(from);
  }
  return null;
}

export default function LoginPage({}: Route.ComponentProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"email" | "code">("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const from =
    typeof window !== "undefined"
      ? new URL(window.location.href).searchParams.get("from") || "/"
      : "/";

  const handleRequestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Senden");
      setStep("code");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyCode = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, code }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fehler beim Verifizieren");
      // Full reload to refresh session state
      window.location.href = from;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unbekannter Fehler");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div>

      {/* Login card */}
      <div className="flex-1 flex items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="bg-white rounded-2xl border shadow-sm p-8">
            {step === "email" ? (
              <>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Anmelden
                </h1>
                <p className="text-gray-500 mb-6 text-sm">
                  Wir senden dir einen 6-stelligen Code per E-Mail.
                </p>
                <form onSubmit={handleRequestCode} className="space-y-4">
                  <div>
                    <label
                      htmlFor="email"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      E-Mail-Adresse
                    </label>
                    <Input
                      id="email"
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="deine@email.de"
                      required
                      autoFocus
                      className="w-full"
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-red-600">{error}</p>
                  )}
                  <Button
                    type="submit"
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                    disabled={loading}
                  >
                    {loading ? "Wird gesendet…" : "Code senden"}
                  </Button>
                </form>
              </>
            ) : (
              <>
                <h1 className="text-2xl font-bold text-gray-900 mb-2">
                  Code eingeben
                </h1>
                <p className="text-gray-500 mb-6 text-sm">
                  Wir haben einen Code an <strong>{email}</strong> gesendet.
                </p>
                <form onSubmit={handleVerifyCode} className="space-y-4">
                  <div>
                    <label
                      htmlFor="code"
                      className="block text-sm font-medium text-gray-700 mb-1"
                    >
                      6-stelliger Code
                    </label>
                    <Input
                      id="code"
                      type="text"
                      inputMode="numeric"
                      value={code}
                      onChange={(e) =>
                        setCode(e.target.value.replace(/\D/g, "").slice(0, 6))
                      }
                      placeholder="123456"
                      required
                      autoFocus
                      className="w-full text-2xl tracking-widest text-center"
                    />
                  </div>
                  {error && (
                    <p className="text-sm text-red-600">{error}</p>
                  )}
                  <Button
                    type="submit"
                    className="w-full bg-orange-500 hover:bg-orange-600 text-white"
                    disabled={loading || code.length !== 6}
                  >
                    {loading ? "Wird geprüft…" : "Anmelden"}
                  </Button>
                  <button
                    type="button"
                    onClick={() => {
                      setStep("email");
                      setCode("");
                      setError(null);
                    }}
                    className="w-full text-sm text-gray-500 hover:text-gray-700"
                  >
                    Andere E-Mail verwenden
                  </button>
                </form>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
