import { useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import { Download, ExternalLink } from "lucide-react";
import { SS_ENTRIES, SS_GROUPS, ssDecisions, type SsDecision, type SsGroup } from "../../lib/pruefliste-ss";
import type { Route } from "./+types/pruefliste.ss";
import { upper } from "../../lib/normalise.js";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Prüfliste ss/ß – Spielwoerter.de" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/pruefliste/ss");
  if (!context.user.isModerator) return redirect("/");

  const decisions = ssDecisions(context.db);
  const groups = SS_GROUPS.map((g) => {
    const entries = SS_ENTRIES.filter((e) => e.g === g.id);
    return { ...g, total: entries.length, open: entries.filter((e) => !decisions.has(e.s)).length };
  }).filter((g) => g.total > 0);

  const url = new URL(request.url);
  const group = (url.searchParams.get("g") ?? groups.find((g) => g.open > 0)?.id ?? groups[0]?.id) as SsGroup;
  const openOnly = url.searchParams.get("alle") === null;
  const rows = SS_ENTRIES.filter((e) => e.g === group).map((e) => ({ ...e, decision: decisions.get(e.s) ?? null }));

  return { group, openOnly, rows, groups, total: SS_ENTRIES.length, decided: decisions.size };
}

/** Button labels: the umlaut group is about ae/oe/ue, not ss. */
function formLabels(group: SsGroup) {
  return group === "umlaut"
    ? { ascii: "ae/oe/ue-Form", real: "Umlaut-Form" }
    : { ascii: "ss-Form", real: "ß-Form" };
}

function DictLinks({ word }: { word: string }) {
  const cls = "inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-600";
  return (
    <>
      <a href={`https://www.duden.de/suchen/dudenonline/${encodeURIComponent(word)}`} target="_blank" rel="noopener noreferrer" className={cls}>
        <ExternalLink className="w-3 h-3" />
        Duden
      </a>
      <a href={`https://www.dwds.de/wb/${encodeURIComponent(word)}`} target="_blank" rel="noopener noreferrer" className={cls}>
        <ExternalLink className="w-3 h-3" />
        DWDS
      </a>
    </>
  );
}

export default function SsPrueflistePage({ loaderData }: Route.ComponentProps) {
  const { group, openOnly, rows, groups, total, decided } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [local, setLocal] = useState<Record<string, SsDecision | null>>({});
  const [error, setError] = useState<string | null>(null);
  const current = groups.find((g) => g.id === group);
  const labels = formLabels(group);

  const decide = async (word: string, decision: SsDecision | null) => {
    setError(null);
    setLocal((l) => ({ ...l, [word]: decision }));
    const res = await fetch(`/api/pruefliste-ss/${encodeURIComponent(word)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      setError(`Speichern für ${upper(word)} fehlgeschlagen.`);
      setLocal((l) => {
        const { [word]: _, ...rest } = l;
        return rest;
      });
      return;
    }
    revalidator.revalidate();
  };

  const acceptGroup = async () => {
    if (!current?.suggest) return;
    const label = current.suggest === "streichen" ? `${labels.ascii} streichen` : "behalten";
    if (!window.confirm(`Alle ${current.open} offenen Wörter in „${current.label}“ als „${label}“ markieren?`)) return;
    const res = await fetch(`/api/pruefliste-ss/gruppe/${group}`, { method: "POST" });
    if (!res.ok) setError("Speichern fehlgeschlagen.");
    setLocal({});
    revalidator.revalidate();
  };

  const go = (params: Record<string, string | null>) => {
    setLocal({});
    setSearchParams((p) => {
      for (const [k, v] of Object.entries(params)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      return p;
    });
  };

  const shown = openOnly ? rows.filter((r) => r.decision === null || r.s in local) : rows;
  const btn = "text-xs rounded px-2 py-1 border transition-colors";

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Prüfliste ss/ß</h1>
      <p className="text-gray-500 mt-1">
        Wörter, die in der Liste doppelt stehen: einmal mit ss (oder ae/oe/ue) und einmal mit ß (oder Umlaut).
        Pro Paar lässt sich die ss-Form streichen (nur die ß-Schreibung bleibt), die ß-Form streichen (etwa
        eine alte Schreibung wie Ablaß), beide streichen oder beide behalten. Die Gruppen und Vorschläge
        kommen aus Wiktionary (Schweizer Schreibweise, Aussprache) und der Diphthong-Regel.
      </p>
      <p className="text-sm text-gray-600 mt-3 mb-6">
        <strong>{decided}</strong> von {total} entschieden.{" "}
        <a href="/api/pruefliste-ss/export" className="inline-flex items-center gap-1 text-orange-600 hover:underline">
          <Download className="w-3.5 h-3.5" />
          Entscheidungen herunterladen
        </a>
        {" · "}
        <Link to="/pruefliste" className="text-orange-600 hover:underline">
          Zur Prüfliste der Grundformen
        </Link>
      </p>

      <div className="flex flex-wrap gap-1 mb-3">
        {groups.map((g) => (
          <button
            key={g.id}
            type="button"
            onClick={() => go({ g: g.id })}
            className={`text-sm px-3 py-1 rounded border ${
              g.id === group
                ? "bg-orange-500 border-orange-500 text-white"
                : g.open === 0
                  ? "border-gray-200 text-gray-300"
                  : "border-gray-300 text-gray-700 hover:bg-orange-50"
            }`}
          >
            {g.label} <span className="opacity-70">({g.open}/{g.total})</span>
          </button>
        ))}
      </div>

      {current && (
        <div className="text-sm text-gray-600 mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
          <span>{current.hint}</span>
          {current.suggest && current.open > 0 && (
            <button type="button" onClick={() => void acceptGroup()} className={`${btn} border-orange-300 text-orange-700 hover:bg-orange-50`}>
              Vorschlag für alle {current.open} offenen übernehmen ({current.suggest === "streichen" ? `${labels.ascii} streichen` : "behalten"})
            </button>
          )}
        </div>
      )}

      <label className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <input type="checkbox" checked={openOnly} onChange={(e) => go({ alle: e.target.checked ? null : "1" })} />
        Nur offene zeigen
      </label>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 py-6">Hier ist alles entschieden.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-t border-b border-gray-100">
          {shown.map((e) => {
            const cur = e.s in local ? local[e.s] : (e.decision?.decision ?? null);
            return (
              <li key={e.s} className="py-3 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link to={`/wort/${encodeURIComponent(upper(e.s))}`} target="_blank" className="font-mono font-semibold text-gray-900 hover:text-orange-600">
                      {upper(e.s)}
                    </Link>
                    <span className="text-gray-400">neben</span>
                    <Link to={`/wort/${encodeURIComponent(upper(e.b))}`} target="_blank" className="font-mono font-semibold text-gray-700 hover:text-orange-600">
                      {upper(e.b)}
                    </Link>
                    <DictLinks word={e.b} />
                    {e.decision && !(e.s in local) && <span className="text-xs text-gray-400">· {e.decision.decided_by}</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">{e.why}</p>
                  {e.d && <p className="text-sm text-gray-600 mt-0.5">{e.d}</p>}
                </div>
                <div className="flex flex-wrap justify-end gap-1.5 shrink-0 max-w-[16rem]">
                  {(
                    [
                      ["behalten", "Behalten", "green"],
                      ["streichen", `${labels.ascii} streichen`, "red"],
                      ["b_streichen", `${labels.real} streichen`, "red"],
                      ["beide", "Beide streichen", "red"],
                    ] as const
                  ).map(([value, text, color]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => void decide(e.s, cur === value ? null : value)}
                      className={`${btn} ${
                        cur === value
                          ? color === "green"
                            ? "bg-green-600 border-green-600 text-white"
                            : "bg-red-600 border-red-600 text-white"
                          : color === "green"
                            ? "border-green-300 text-green-700 hover:bg-green-50"
                            : "border-red-300 text-red-700 hover:bg-red-50"
                      }`}
                    >
                      {text}
                    </button>
                  ))}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
