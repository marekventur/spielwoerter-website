import { useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import { Download, ExternalLink } from "lucide-react";
import {
  REVIEW_ENTRIES,
  reviewDecisions,
  reviewLetter,
  type Decision,
} from "../../lib/pruefliste";
import type { Route } from "./+types/pruefliste";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Prüfliste – Spielwoerter.de" }, { name: "robots", content: "noindex" }];
}

export async function loader({ context, request }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/pruefliste");
  if (!context.user.isModerator) return redirect("/");

  const decisions = reviewDecisions(context.db);
  const letters = new Map<string, { total: number; open: number }>();
  for (const e of REVIEW_ENTRIES) {
    const l = reviewLetter(e.w);
    const c = letters.get(l) ?? { total: 0, open: 0 };
    c.total++;
    if (!decisions.has(e.w)) c.open++;
    letters.set(l, c);
  }

  const url = new URL(request.url);
  const firstOpen = [...letters].find(([, c]) => c.open > 0)?.[0] ?? [...letters.keys()][0];
  const letter = url.searchParams.get("b") ?? firstOpen;
  const openOnly = url.searchParams.get("alle") === null;

  const rows = REVIEW_ENTRIES.filter((e) => reviewLetter(e.w) === letter).map((e) => ({
    ...e,
    decision: decisions.get(e.w) ?? null,
  }));

  return {
    letter,
    openOnly,
    rows,
    letters: [...letters].map(([l, c]) => ({ letter: l, ...c })),
    total: REVIEW_ENTRIES.length,
    decided: decisions.size,
  };
}

function DecisionButtons({
  word,
  current,
  onDecide,
}: {
  word: string;
  current: Decision | null;
  onDecide: (word: string, decision: Decision | null) => void;
}) {
  const base = "text-xs rounded px-2 py-1 border transition-colors";
  return (
    <div className="flex gap-1.5 shrink-0">
      <button
        type="button"
        onClick={() => onDecide(word, current === "behalten" ? null : "behalten")}
        className={`${base} ${current === "behalten" ? "bg-green-600 border-green-600 text-white" : "border-green-300 text-green-700 hover:bg-green-50"}`}
      >
        Behalten
      </button>
      <button
        type="button"
        onClick={() => onDecide(word, current === "streichen" ? null : "streichen")}
        className={`${base} ${current === "streichen" ? "bg-red-600 border-red-600 text-white" : "border-red-300 text-red-700 hover:bg-red-50"}`}
      >
        Streichen
      </button>
    </div>
  );
}

export default function PrueflistePage({ loaderData }: Route.ComponentProps) {
  const { letter, openOnly, rows, letters, total, decided } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [local, setLocal] = useState<Record<string, Decision | null>>({});
  const [error, setError] = useState<string | null>(null);

  const decide = async (word: string, decision: Decision | null) => {
    setError(null);
    setLocal((l) => ({ ...l, [word]: decision }));
    const res = await fetch(`/api/pruefliste/${encodeURIComponent(word)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (!res.ok) {
      setError(`Speichern für ${word.toUpperCase()} fehlgeschlagen.`);
      setLocal((l) => {
        const { [word]: _, ...rest } = l;
        return rest;
      });
      return;
    }
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

  // "Nur offene" filters here, not in the loader: rows decided on this page
  // stay until the next letter change, so a mis-click can be undone in place.
  const shown = openOnly ? rows.filter((r) => r.decision === null || r.w in local) : rows;

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Prüfliste</h1>
      <p className="text-gray-500 mt-1">
        Grundformen, die nur in Wörterbüchern vorkommen, nicht in echten Texten. Behalten heißt: ihre
        langen Formen (10+ Buchstaben) werden ergänzt. Streichen heißt: das Wort kommt samt aller seiner
        Formen auf die Sperrliste.
      </p>
      <p className="text-sm text-gray-600 mt-3 mb-6">
        <strong>{decided}</strong> von {total} entschieden.{" "}
        <a href="/api/pruefliste/export" className="inline-flex items-center gap-1 text-orange-600 hover:underline">
          <Download className="w-3.5 h-3.5" />
          Entscheidungen herunterladen
        </a>
      </p>

      <div className="flex flex-wrap gap-1 mb-4">
        {letters.map((l) => (
          <button
            key={l.letter}
            type="button"
            onClick={() => go({ b: l.letter })}
            title={`${l.open} von ${l.total} offen`}
            className={`text-sm font-mono w-9 py-1 rounded border ${
              l.letter === letter
                ? "bg-orange-500 border-orange-500 text-white"
                : l.open === 0
                  ? "border-gray-200 text-gray-300"
                  : "border-gray-300 text-gray-700 hover:bg-orange-50"
            }`}
          >
            {l.letter.toUpperCase()}
          </button>
        ))}
      </div>

      <label className="flex items-center gap-2 text-sm text-gray-600 mb-4">
        <input
          type="checkbox"
          checked={openOnly}
          onChange={(e) => go({ alle: e.target.checked ? null : "1" })}
        />
        Nur offene zeigen
      </label>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {shown.length === 0 ? (
        <p className="text-sm text-gray-400 py-6">Hier ist alles entschieden.</p>
      ) : (
        <ul className="divide-y divide-gray-100 border-t border-b border-gray-100">
          {shown.map((e) => {
            const current = e.w in local ? local[e.w] : (e.decision?.decision ?? null);
            return (
              <li key={e.w} className="py-3 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <Link
                      to={`/wort/${encodeURIComponent(e.w.toUpperCase())}`}
                      target="_blank"
                      className="font-mono font-semibold text-gray-900 hover:text-orange-600"
                    >
                      {e.w.toUpperCase()}
                    </Link>
                    <a
                      href={`https://www.duden.de/suchen/dudenonline/${encodeURIComponent(e.w)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-600"
                    >
                      <ExternalLink className="w-3 h-3" />
                      Duden
                    </a>
                    <a
                      href={`https://www.dwds.de/wb/${encodeURIComponent(e.w)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-600"
                    >
                      <ExternalLink className="w-3 h-3" />
                      DWDS
                    </a>
                    {e.decision && !(e.w in local) && (
                      <span className="text-xs text-gray-400">· {e.decision.decided_by}</span>
                    )}
                  </div>
                  {e.d && <p className="text-sm text-gray-600 mt-0.5">{e.d}</p>}
                  <p className="text-xs text-gray-400 mt-1 break-words">{e.f.join(", ")}</p>
                </div>
                <DecisionButtons word={e.w} current={current} onDecide={(w, d) => void decide(w, d)} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
