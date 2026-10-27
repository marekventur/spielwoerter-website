import { useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import { Download } from "lucide-react";
import {
  REVIEW_ENTRIES,
  reviewDecisions,
  reviewLetter,
  type Decision,
} from "../../lib/pruefliste";
import { formStates } from "../../lib/form-state";
import { useLocalStorageChangeset } from "~/hooks/useLocalStorageChangeset";
import { FormLine } from "~/components/ChangesetFormLine";
import type { Route } from "./+types/pruefliste";
import { upper } from "../../lib/normalise.js";

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

  const entries = REVIEW_ENTRIES.filter((e) => reviewLetter(e.w) === letter);
  // Live description/base from the words table (the snapshot's may be stale),
  // editable on the page through the PowerEdit changeset.
  const states = formStates(context.db, entries.map((e) => e.w), context.user.id);
  const rows = entries.map((e) => ({
    ...e,
    decision: decisions.get(e.w) ?? null,
    state: states.get(e.w)!,
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
  const { changeset, setChangeset } = useLocalStorageChangeset(true);

  const decide = async (word: string, decision: Decision | null) => {
    setError(null);
    setLocal((l) => ({ ...l, [word]: decision }));
    const res = await fetch(`/api/pruefliste/${encodeURIComponent(word)}`, {
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
        Formen auf die Sperrliste. Beschreibung und Grundform lassen sich über „Bearbeiten“ korrigieren;
        die Änderungen werden wie in PowerEdit gesammelt und dort eingereicht.
      </p>
      <p className="text-sm text-gray-600 mt-3 mb-6">
        <strong>{decided}</strong> von {total} entschieden.{" "}
        <a href="/api/pruefliste/export" className="inline-flex items-center gap-1 text-orange-600 hover:underline">
          <Download className="w-3.5 h-3.5" />
          Entscheidungen herunterladen
        </a>
        {" · "}
        <Link to="/pruefliste/ss" className="text-orange-600 hover:underline">
          Prüfliste ss/ß
        </Link>
      </p>

      {changeset.size > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3 text-sm text-amber-800">
          <span>
            {changeset.size} Änderung{changeset.size !== 1 ? "en" : ""} vorgemerkt (auch aus PowerEdit).
          </span>
          <Link to="/power-edit?tab=checkout" className="font-medium underline hover:no-underline">
            In PowerEdit prüfen und einreichen
          </Link>
        </div>
      )}

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
            {upper(l.letter)}
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
                  <FormLine word={e.w} state={e.state} changeset={changeset} setChangeset={setChangeset} />
                  {e.decision && !(e.w in local) && (
                    <p className="text-xs text-gray-400">entschieden von {e.decision.decided_by}</p>
                  )}
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
