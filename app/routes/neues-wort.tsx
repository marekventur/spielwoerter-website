import { useEffect, useMemo, useState } from "react";
import { redirect } from "react-router";
import { Link } from "react-router";
import type { Route } from "./+types/neues-wort";
import { WORTARTEN, baseDescription, type Wortart } from "../../lib/wortarten";
import { generateVerbForms, regularParts, type VerbParts } from "../../lib/verb-forms";
import type { Prefill } from "../../lib/neues-wort";
import { upper } from "../../lib/normalise.js";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Neues Wort – Spielwoerter.de" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/neues-wort");
  if (!context.user.isModerator) return redirect("/");
  return {};
}

type Status = "actionable" | "in_list" | "rejected" | "in_review";
type Existing = { in_list: string; description: string | null; base: string | null } | null;

const STATUS_LABEL: Record<Exclude<Status, "actionable">, string> = {
  in_list: "schon in der Liste",
  rejected: "abgelehnt",
  in_review: "wird schon geprüft",
};

const input = "w-full rounded border border-gray-300 px-2 py-1 text-sm focus:border-orange-400 focus:outline-none";
const list = (s: string) => s.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-gray-600">{label}</span>
      {children}
      {hint && <span className="text-xs text-gray-400">{hint}</span>}
    </label>
  );
}

function YesNo({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label: string }) {
  const base = "text-xs rounded px-2 py-1 border";
  return (
    <div className="flex gap-1.5" role="group" aria-label={label}>
      <button type="button" aria-pressed={value} onClick={() => onChange(true)}
        className={`${base} ${value ? "bg-green-600 border-green-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
        Ja
      </button>
      <button type="button" aria-pressed={!value} onClick={() => onChange(false)}
        className={`${base} ${!value ? "bg-gray-600 border-gray-600 text-white" : "border-gray-300 text-gray-600 hover:bg-gray-50"}`}>
        Nein
      </button>
    </div>
  );
}

/**
 * One key form, or several separated by commas ("fragst, frägst"). Keeps the
 * typed text so a trailing comma survives, and resyncs when a new suggestion
 * replaces the value from outside.
 */
function ListField({ label, display, value, onChange }: {
  label: string; display?: string; value: string[]; onChange: (v: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const joined = value.join(",");
  useEffect(() => {
    if (list(text).join(",") !== joined) setText(value.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joined]);
  const bad = list(text).filter((w) => !/^[a-zäöüß]+$/.test(w));
  return (
    <Field label={display ?? label}>
      <input aria-label={label} className={input} value={text}
        onChange={(e) => { setText(e.target.value); onChange(list(e.target.value)); }} />
      {bad.length > 0 && <span className="text-xs text-red-600">Nur Buchstaben: {bad.join(", ")}</span>}
    </Field>
  );
}

/** The key forms a moderator confirms; everything else is generated from them. */
function VerbFields({ v, onChange }: { v: VerbParts; onChange: (v: VerbParts) => void }) {
  const set = (patch: Partial<VerbParts>) => onChange({ ...v, ...patch });
  const P = v.prefix && v.infinitive.startsWith(v.prefix) ? v.prefix : "";
  const sep = Boolean(P);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Abtrennbare Vorsilbe" hint="z. B. auf bei aufgeben; leer, wenn keine">
          <input aria-label="Abtrennbare Vorsilbe" className={input} value={v.prefix}
            onChange={(e) => set({ prefix: e.target.value.trim().toLowerCase() })} />
        </Field>
        {v.prefix && !P && <p className="text-xs text-red-600 sm:col-span-2 self-center">
          „{v.prefix}“ steht nicht am Anfang von {upper(v.infinitive)}.</p>}
      </div>
      <p className="text-xs text-gray-500">
        Die folgenden Formen {sep ? <>ohne die Vorsilbe „{P}“</> : null} eingeben, so wie im Wörterbuch.
        Nebenformen mit Komma trennen (fragst, frägst).
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <ListField label="ich (Präsens)" value={v.praesens1} onChange={(praesens1) => set({ praesens1 })} />
        <ListField label="du (Präsens)" value={v.praesens2} onChange={(praesens2) => set({ praesens2 })} />
        <ListField label="er/sie/es (Präsens)" value={v.praesens3} onChange={(praesens3) => set({ praesens3 })} />
        <ListField label="ich/er (Präteritum)" value={v.praeteritum} onChange={(praeteritum) => set({ praeteritum })} />
        <ListField label="ich/er (Konjunktiv II)" value={v.konjunktiv2} onChange={(konjunktiv2) => set({ konjunktiv2 })} />
        <ListField label="Imperativ Singular" value={v.imperativ} onChange={(imperativ) => set({ imperativ })} />
        <ListField label="Partizip II" display={`Partizip II${sep ? " (mit Vorsilbe)" : ""}`} value={v.partizip2}
          onChange={(partizip2) => set({ partizip2 })} />
      </div>

      <div className="rounded-lg border border-gray-200 divide-y divide-gray-100">
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <span className="text-sm text-gray-700">
            Akkusativobjekt: Ergibt „Wen oder was {v.praesens1[0] || "…"} ich{sep ? ` ${P}` : ""}?“ einen Sinn?
          </span>
          <YesNo label="Akkusativobjekt" value={v.akkusativ} onChange={(akkusativ) => set({ akkusativ })} />
        </div>
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <span className="text-sm text-gray-700">Passiv: Ergibt „Ich werde {v.partizip2[0] || "…"}.“ einen Sinn?</span>
          <YesNo label="Passiv" value={v.passiv} onChange={(passiv) => set({ passiv })} />
        </div>
        <div className="flex items-center justify-between gap-4 px-3 py-2">
          <span className="text-sm text-gray-700">
            Partizip II als Adjektiv verwendbar? (transitive Verben und Verben mit Perfekt auf „sein“)
          </span>
          <YesNo label="Partizip II als Adjektiv" value={v.partizip2Adjektivisch}
            onChange={(partizip2Adjektivisch) => set({ partizip2Adjektivisch })} />
        </div>
        {sep && (
          <p className="px-3 py-2 text-xs text-gray-500">
            Das Gerundiv ({P}zu{v.infinitive.slice(P.length)}de …) wird nur erzeugt, wenn Akkusativobjekt und
            Passiv beide Ja sind.
          </p>
        )}
      </div>
    </div>
  );
}

export default function NeuesWortPage() {
  const [word, setWord] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | null>(null);
  const [existing, setExisting] = useState<Existing>(null);
  const [quelle, setQuelle] = useState<Prefill["quelle"] | null>(null);
  const [wortart, setWortart] = useState<Wortart | null>(null);
  const [bedeutung, setBedeutung] = useState("");
  const [verb, setVerb] = useState<VerbParts | null>(null);
  const [status, setStatus] = useState<Record<string, Status>>({});
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [unsicher, setUnsicher] = useState<Set<string>>(new Set());

  const fetchPrefill = async () => {
    const w = word.trim().toLowerCase();
    if (!w) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/neues-wort/vorschlag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ word: w }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Vorschlag fehlgeschlagen");
      const p = data.prefill as Prefill;
      setCurrent(data.word);
      setExisting(data.existing);
      setQuelle(p.quelle);
      setWortart(p.wortart);
      setBedeutung(p.bedeutung);
      setVerb(p.verb);
      setSkipped(new Set());
      setUnsicher(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Vorschlag fehlgeschlagen");
    } finally {
      setLoading(false);
    }
  };

  const chooseWortart = (w: Wortart) => {
    setWortart(w);
    if (w === "verb" && !verb && current) setVerb(regularParts(current));
  };

  const forms = useMemo(() => {
    if (!current || !wortart) return [];
    const own = { word: current, description: baseDescription(wortart, bedeutung) };
    if (wortart === "verb" && verb) return [own, ...generateVerbForms({ ...verb, infinitive: current })];
    return [own];
  }, [current, wortart, bedeutung, verb]);

  // Look up which forms are already listed, rejected or in review.
  const wordsKey = forms.map((f) => f.word).join(",");
  useEffect(() => {
    if (!wordsKey) return;
    const t = setTimeout(async () => {
      const res = await fetch("/api/neues-wort/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ words: wordsKey.split(",") }),
      });
      if (res.ok) setStatus(await res.json());
    }, 300);
    return () => clearTimeout(t);
  }, [wordsKey]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, w: string) => {
    const next = new Set(set);
    if (next.has(w)) next.delete(w);
    else next.add(w);
    setter(next);
  };

  const fresh = forms.filter((f) => (status[f.word] ?? "actionable") === "actionable");
  const chosen = fresh.filter((f) => !skipped.has(f.word));

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Neues Wort</h1>
      <p className="text-gray-500 mt-1">
        Wortart und Grundformen angeben, alle Beugungsformen werden daraus erzeugt. Die KI macht einen
        Vorschlag, der korrigiert werden kann. Nach dem Vorschlag aus{" "}
        <Link to="/diskussion/8" className="text-orange-600 hover:underline">Diskussion 8</Link>.
      </p>
      <div className="mt-4 mb-8 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
        <strong>Probelauf:</strong> Es wird noch nichts gespeichert oder eingereicht. Formen für Substantive und
        Adjektive folgen; bis dahin werden nur Verben vollständig erzeugt.
      </div>

      <form className="flex gap-2 mb-6" onSubmit={(e) => { e.preventDefault(); void fetchPrefill(); }}>
        <input aria-label="Neues Wort" className={`${input} max-w-xs text-base`} placeholder="Grundform, z. B. aussinnen"
          value={word} onChange={(e) => setWord(e.target.value)} />
        <button type="submit" disabled={loading || !word.trim()}
          className="rounded bg-orange-500 px-3 py-1 text-sm font-medium text-white hover:bg-orange-600 disabled:opacity-50">
          {loading ? "Frage KI …" : "Vorschlag holen"}
        </button>
      </form>
      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

      {current && (
        <div className="space-y-6">
          {existing && (
            <p className="text-sm text-amber-700">
              {upper(current)} steht schon in der Liste
              {existing.in_list !== "accepted" && ` (${existing.in_list})`}: {existing.description ?? "ohne Beschreibung"}
              {existing.base && existing.base !== current && <>, Grundform {upper(existing.base)}</>}.
            </p>
          )}
          {quelle === "regel" && (
            <p className="text-sm text-gray-500">Kein KI-Vorschlag verfügbar, die Felder sind nach den Regeln für regelmäßige Verben vorbelegt.</p>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-2">Wortart</h2>
            <div className="flex flex-wrap gap-1.5">
              {WORTARTEN.map((w) => (
                <button key={w.key} type="button" aria-pressed={wortart === w.key} title={w.beispiele}
                  onClick={() => chooseWortart(w.key)}
                  className={`text-sm rounded px-2.5 py-1 border ${wortart === w.key ? "bg-orange-500 border-orange-500 text-white" : "border-gray-300 text-gray-700 hover:bg-orange-50"}`}>
                  {w.label}
                </button>
              ))}
            </div>
          </section>

          <Field label="Bedeutung" hint={wortart ? `Beschreibung: ${baseDescription(wortart, bedeutung)}` : undefined}>
            <input aria-label="Bedeutung" className={input} value={bedeutung} onChange={(e) => setBedeutung(e.target.value)} />
          </Field>

          {wortart === "verb" && verb && <VerbFields v={{ ...verb, infinitive: current }} onChange={setVerb} />}

          {forms.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-1">Formen</h2>
              <p className="text-xs text-gray-500 mb-2">
                {chosen.length} neu ausgewählt, {forms.length - fresh.length} schon vorhanden oder in Prüfung.
                Häkchen entfernen, um eine Form auszulassen; „Unsicher“ bittet die anderen Moderatoren um ihre Meinung.
              </p>
              <ul className="divide-y divide-gray-100 border-t border-b border-gray-100">
                {forms.map((f) => {
                  const s = status[f.word] ?? "actionable";
                  const open = s === "actionable";
                  return (
                    <li key={f.word} className="py-1.5 flex items-center gap-3 text-sm">
                      <input type="checkbox" aria-label={`${upper(f.word)} aufnehmen`} disabled={!open}
                        checked={open && !skipped.has(f.word)} onChange={() => toggle(skipped, setSkipped, f.word)} />
                      <span className={`font-mono w-56 shrink-0 ${open ? "text-gray-900" : "text-gray-400"}`}>{upper(f.word)}</span>
                      <span className={`flex-1 ${open ? "text-gray-600" : "text-gray-400"}`}>{f.description}</span>
                      {!open ? (
                        <span className="text-xs text-gray-400 shrink-0">{STATUS_LABEL[s]}</span>
                      ) : (
                        <button type="button" aria-pressed={unsicher.has(f.word)} onClick={() => toggle(unsicher, setUnsicher, f.word)}
                          className={`text-xs rounded px-2 py-0.5 border shrink-0 ${unsicher.has(f.word) ? "bg-amber-500 border-amber-500 text-white" : "border-gray-300 text-gray-500 hover:bg-amber-50"}`}>
                          Unsicher
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="mt-4 flex items-center gap-3">
                <button type="button" disabled
                  className="rounded bg-orange-500 px-3 py-1.5 text-sm font-medium text-white opacity-50 cursor-not-allowed">
                  {chosen.length} Formen einreichen
                </button>
                <span className="text-xs text-gray-500">Im Probelauf noch abgeschaltet.</span>
              </div>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
