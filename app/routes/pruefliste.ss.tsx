import { useState } from "react";
import { Link, redirect, useRevalidator, useSearchParams } from "react-router";
import { ExternalLink, Pencil } from "lucide-react";
import {
  SS_ENTRIES,
  SS_GROUPS,
  formStates,
  ssDecisions,
  type FormState,
  type SsDecision,
  type SsGroup,
} from "../../lib/pruefliste-ss";
import { submitBatch, withdrawDrafts, type BatchChange } from "~/components/batch-api";
import type { Route } from "./+types/pruefliste.ss";
import { upper } from "../../lib/normalise.js";

const BATCH_MESSAGE = "Prüfliste ss/ß";

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
  const entries = SS_ENTRIES.filter((e) => e.g === group);
  const states = formStates(context.db, entries.flatMap((e) => [e.s, e.b]), context.user.id);
  const rows = entries.map((e) => ({
    ...e,
    decision: decisions.get(e.s) ?? null,
    sState: states.get(e.s)!,
    bState: states.get(e.b)!,
  }));

  return { group, openOnly, rows, groups, total: SS_ENTRIES.length, decided: decisions.size };
}

/** Button labels: the umlaut group is about ae/oe/ue, not ss. */
function formLabels(group: SsGroup) {
  return group === "umlaut"
    ? { ascii: "ae/oe/ue-Form", real: "Umlaut-Form" }
    : { ascii: "ss-Form", real: "ß-Form" };
}

/** Which spellings a decision removes. */
function removedBy(decision: SsDecision | null, s: string, b: string): string[] {
  if (decision === "streichen") return [s];
  if (decision === "b_streichen") return [b];
  if (decision === "beide") return [s, b];
  return [];
}

const accepted = (f: FormState) => f.inList === "accepted" && !f.removalPending;

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

/** One spelling of a pair: live state, description and base, editable in place. */
function FormLine({
  word,
  state,
  dim,
  onSaved,
}: {
  word: string;
  state: FormState;
  dim: boolean;
  onSaved: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(state.description ?? "");
  const [base, setBase] = useState(state.base ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const gone = state.inList !== "accepted";
  const struck = gone || state.removalPending || dim;

  const save = async () => {
    setBusy(true);
    setError(null);
    const payload: { description?: string; base?: string } = {};
    if (description.trim() !== (state.description ?? "")) payload.description = description.trim();
    if (base.trim() !== (state.base ?? "")) payload.base = base.trim();
    const err = Object.keys(payload).length
      ? await submitBatch([{ word, type: "change_description", payload }], BATCH_MESSAGE)
      : null;
    setBusy(false);
    if (err) return setError(err);
    setEditing(false);
    onSaved();
  };

  return (
    <div className="mt-1 first:mt-0">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <Link
          to={`/wort/${encodeURIComponent(upper(word))}`}
          target="_blank"
          className={`font-mono font-semibold hover:text-orange-600 ${
            struck ? "line-through decoration-2 text-red-600" : "text-gray-900"
          }`}
        >
          {upper(word)}
        </Link>
        {state.removalPending && <span className="text-xs text-red-600">Löschung geplant</span>}
        {gone && !state.removalPending && <span className="text-xs text-gray-400">nicht in der Liste</span>}
        <DictLinks word={word} />
        {!gone && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-600">
            <Pencil className="w-3 h-3" />
            Bearbeiten
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1">
          <input
            value={description}
            onChange={(ev) => setDescription(ev.target.value)}
            placeholder="Beschreibung"
            aria-label={`Beschreibung von ${upper(word)}`}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={base}
              onChange={(ev) => setBase(ev.target.value)}
              placeholder="Grundform"
              aria-label={`Grundform von ${upper(word)}`}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
            <button type="button" disabled={busy} onClick={() => void save()} className="text-xs rounded px-2 py-1 border border-sky-400 text-sky-700 hover:bg-sky-50 disabled:opacity-50">
              Speichern
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">
              Abbrechen
            </button>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          {state.description || <span className="text-gray-400">keine Beschreibung</span>}
          {state.base && state.base !== word && <span className="text-gray-400"> · Grundform {upper(state.base)}</span>}
        </p>
      )}
    </div>
  );
}

export default function SsPrueflistePage({ loaderData }: Route.ComponentProps) {
  const { group, openOnly, rows, groups, total, decided } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const [busy, setBusy] = useState<string | null>(null);
  // Rows decided on this page stay visible until the next group change, so a
  // mis-click can be undone in place.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const current = groups.find((g) => g.id === group);
  const labels = formLabels(group);

  const record = (word: string, decision: SsDecision | null) =>
    fetch(`/api/pruefliste-ss/${encodeURIComponent(word)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });

  // A decision is applied right away: removals become suggestions via
  // /api/batch; switching or undoing withdraws the viewer's own drafts.
  const decide = async (row: (typeof rows)[number], decision: SsDecision | null) => {
    setBusy(row.s);
    setTouched((t) => new Set(t).add(row.s));
    setError(null);
    const want = new Set(removedBy(decision, row.s, row.b));
    const withdraw = [
      ...(want.has(row.s) ? [] : row.sState.ownRemovalDrafts),
      ...(want.has(row.b) ? [] : row.bState.ownRemovalDrafts),
    ];
    let err = await withdrawDrafts(withdraw);
    const removals: BatchChange[] = [];
    if (want.has(row.s) && accepted(row.sState)) removals.push({ word: row.s, type: "remove" });
    if (want.has(row.b) && accepted(row.bState)) removals.push({ word: row.b, type: "remove" });
    if (!err && removals.length) err = await submitBatch(removals, BATCH_MESSAGE);
    if (!err && !(await record(row.s, decision)).ok) err = `Speichern für ${upper(row.s)} fehlgeschlagen.`;
    setBusy(null);
    if (err) setError(err);
    revalidator.revalidate();
  };

  const acceptGroup = async () => {
    if (!current?.suggest) return;
    const open = rows.filter((r) => r.decision === null);
    const removals: BatchChange[] =
      current.suggest === "streichen"
        ? open.filter((r) => accepted(r.sState)).map((r) => ({ word: r.s, type: "remove" as const }))
        : [];
    const what = current.suggest === "streichen" ? `${labels.ascii} streichen` : "behalten";
    if (!window.confirm(`Alle ${open.length} offenen Wörter in „${current.label}“: ${what}?`)) return;
    setBusy("*");
    setError(null);
    let err: string | null = null;
    for (let i = 0; i < removals.length && !err; i += 500) {
      err = await submitBatch(removals.slice(i, i + 500), BATCH_MESSAGE);
    }
    if (!err) {
      const res = await fetch(`/api/pruefliste-ss/gruppe/${group}`, { method: "POST" });
      if (!res.ok) err = "Speichern fehlgeschlagen.";
    }
    setBusy(null);
    if (err) setError(err);
    revalidator.revalidate();
  };

  const go = (params: Record<string, string | null>) => {
    setTouched(new Set());
    setSearchParams((p) => {
      for (const [k, v] of Object.entries(params)) {
        if (v === null) p.delete(k);
        else p.set(k, v);
      }
      return p;
    });
  };

  const shown = openOnly ? rows.filter((r) => r.decision === null || touched.has(r.s)) : rows;
  const btn = "text-xs rounded px-2 py-1 border transition-colors disabled:opacity-50";

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Prüfliste ss/ß</h1>
      <p className="text-gray-500 mt-1">
        Wörter, die in der Liste doppelt stehen: einmal mit ss (oder ae/oe/ue) und einmal mit ß (oder Umlaut).
        Pro Paar lässt sich die ss-Form streichen, die ß-Form streichen (etwa eine alte Schreibung wie Ablaß),
        beide streichen oder beide behalten. Gestrichen wird sofort als normale Löschung, mit den üblichen 72
        Stunden Wartezeit. Beschreibung und Grundform lassen sich direkt bearbeiten.
      </p>
      <p className="text-sm text-gray-600 mt-3 mb-6">
        <strong>{decided}</strong> von {total} entschieden.{" "}
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
            <button type="button" disabled={busy !== null} onClick={() => void acceptGroup()} className={`${btn} border-orange-300 text-orange-700 hover:bg-orange-50`}>
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
          {shown.map((r) => {
            const cur = r.decision?.decision ?? null;
            const goes = removedBy(cur, r.s, r.b);
            return (
              <li key={r.s} className="py-3 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <FormLine key={`${r.s}:${r.sState.description}:${r.sState.base}`} word={r.s} state={r.sState} dim={goes.includes(r.s)} onSaved={() => revalidator.revalidate()} />
                  <FormLine key={`${r.b}:${r.bState.description}:${r.bState.base}`} word={r.b} state={r.bState} dim={goes.includes(r.b)} onSaved={() => revalidator.revalidate()} />
                  <p className="text-xs text-gray-400 mt-1">
                    {r.why}
                    {r.decision && ` · entschieden von ${r.decision.decided_by}`}
                  </p>
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
                      disabled={busy !== null}
                      onClick={() => void decide(r, cur === value ? null : value)}
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
