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
import { useLocalStorageChangeset, type Changeset } from "~/hooks/useLocalStorageChangeset";
import { withdrawDrafts } from "~/components/withdraw-drafts";
import type { Route } from "./+types/pruefliste.ss";
import { upper } from "../../lib/normalise.js";

export function meta({}: Route.MetaArgs) {
  return [{ title: "Prüfliste ss/ß – Spielwoerter.de" }, { name: "robots", content: "noindex" }];
}

/** Removed, or a removal is already in the pipeline. */
const settled = (f: FormState) => f.inList !== "accepted" || f.removalPending;

export async function loader({ context, request }: Route.LoaderArgs) {
  if (!context.user) return redirect("/login?from=/pruefliste/ss");
  if (!context.user.isModerator) return redirect("/");

  const decisions = ssDecisions(context.db);
  const states = formStates(context.db, SS_ENTRIES.flatMap((e) => [e.s, e.b]), context.user.id);
  // Decided: kept on purpose, or either spelling's removal is submitted or done.
  const isDecided = (e: (typeof SS_ENTRIES)[number]) =>
    decisions.has(e.s) || settled(states.get(e.s)!) || settled(states.get(e.b)!);

  const groups = SS_GROUPS.map((g) => {
    const entries = SS_ENTRIES.filter((e) => e.g === g.id);
    return { ...g, total: entries.length, open: entries.filter((e) => !isDecided(e)).length };
  }).filter((g) => g.total > 0);

  const url = new URL(request.url);
  const group = (url.searchParams.get("g") ?? groups.find((g) => g.open > 0)?.id ?? groups[0]?.id) as SsGroup;
  const openOnly = url.searchParams.get("alle") === null;
  const rows = SS_ENTRIES.filter((e) => e.g === group).map((e) => ({
    ...e,
    kept: decisions.get(e.s)?.decision === "behalten" ? decisions.get(e.s)!.decided_by : null,
    decided: isDecided(e),
    sState: states.get(e.s)!,
    bState: states.get(e.b)!,
  }));

  return {
    group,
    openOnly,
    rows,
    groups,
    total: SS_ENTRIES.length,
    decided: SS_ENTRIES.filter(isDecided).length,
  };
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

const queuedForRemoval = (cs: Changeset, word: string) => cs.has(word) && cs.get(word)!.pending === null;

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

/**
 * One spelling of a pair: live state, description and base. Edits go into the
 * PowerEdit changeset, like an edit made in PowerEdit itself.
 */
function FormLine({
  word,
  state,
  changeset,
  setChangeset,
}: {
  word: string;
  state: FormState;
  changeset: Changeset;
  setChangeset: (updater: (prev: Changeset) => Changeset) => void;
}) {
  const entry = changeset.get(word);
  const queued = entry !== undefined && entry.pending === null;
  const edited = entry?.pending ?? null;
  const description = edited?.description ?? state.description ?? "";
  const base = edited?.base ?? state.base ?? "";
  const [editing, setEditing] = useState(false);
  const [draftDescription, setDraftDescription] = useState(description);
  const [draftBase, setDraftBase] = useState(base);
  const gone = state.inList !== "accepted";
  const struck = gone || state.removalPending || queued;

  const save = () => {
    setChangeset((prev) => {
      const next = new Map(prev);
      const original = prev.get(word)?.original ?? { base: state.base, description: state.description };
      const pending: { description?: string; base?: string } = {};
      if (draftDescription.trim() !== (original.description ?? "").trim()) pending.description = draftDescription.trim();
      if (draftBase.trim().toLowerCase() !== (original.base ?? "").trim()) pending.base = draftBase.trim().toLowerCase();
      if (Object.keys(pending).length === 0) next.delete(word);
      else next.set(word, { original, pending });
      return next;
    });
    setEditing(false);
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
        {queued && <span className="text-xs text-amber-700">zum Löschen vorgemerkt</span>}
        {edited && <span className="text-xs text-amber-700">Änderung vorgemerkt</span>}
        {state.removalPending && <span className="text-xs text-red-600">Löschung geplant</span>}
        {gone && !state.removalPending && <span className="text-xs text-gray-400">nicht in der Liste</span>}
        <DictLinks word={word} />
        {!gone && !queued && !editing && (
          <button
            type="button"
            onClick={() => {
              setDraftDescription(description);
              setDraftBase(base);
              setEditing(true);
            }}
            className="inline-flex items-center gap-0.5 text-xs text-gray-400 hover:text-orange-600"
          >
            <Pencil className="w-3 h-3" />
            Bearbeiten
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1">
          <input
            value={draftDescription}
            onChange={(ev) => setDraftDescription(ev.target.value)}
            placeholder="Beschreibung"
            aria-label={`Beschreibung von ${upper(word)}`}
            className="w-full rounded border border-gray-300 px-2 py-1 text-sm"
          />
          <div className="flex gap-2">
            <input
              value={draftBase}
              onChange={(ev) => setDraftBase(ev.target.value)}
              placeholder="Grundform"
              aria-label={`Grundform von ${upper(word)}`}
              className="flex-1 rounded border border-gray-300 px-2 py-1 text-sm font-mono"
            />
            <button type="button" onClick={save} className="text-xs rounded px-2 py-1 border border-sky-400 text-sky-700 hover:bg-sky-50">
              Vormerken
            </button>
            <button type="button" onClick={() => setEditing(false)} className="text-xs text-gray-500 hover:underline">
              Abbrechen
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm text-gray-600">
          {description || <span className="text-gray-400">keine Beschreibung</span>}
          {base && base !== word && <span className="text-gray-400"> · Grundform {upper(base)}</span>}
        </p>
      )}
    </div>
  );
}

export default function SsPrueflistePage({ loaderData }: Route.ComponentProps) {
  const { group, openOnly, rows, groups, total, decided } = loaderData;
  const [, setSearchParams] = useSearchParams();
  const revalidator = useRevalidator();
  const { changeset, setChangeset, limit } = useLocalStorageChangeset(true);
  const [busy, setBusy] = useState(false);
  // Rows touched on this page stay visible until the next group change, so a
  // mis-click can be undone in place.
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const current = groups.find((g) => g.id === group);
  const labels = formLabels(group);

  const recordKept = (word: string, kept: boolean) =>
    fetch(`/api/pruefliste-ss/${encodeURIComponent(word)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision: kept ? "behalten" : null }),
    });

  /** The decision a row currently shows: queued, submitted or done removals, or "behalten". */
  const currentDecision = (row: (typeof rows)[number]): SsDecision | null => {
    const s = queuedForRemoval(changeset, row.s) || settled(row.sState);
    const b = queuedForRemoval(changeset, row.b) || settled(row.bState);
    if (s && b) return "beide";
    if (s) return "streichen";
    if (b) return "b_streichen";
    return row.kept ? "behalten" : null;
  };

  // Removals are only queued in the PowerEdit changeset; nothing is written
  // until it is submitted there. Undoing an already submitted removal
  // withdraws the moderator's own draft, as long as it is still a draft.
  const decide = async (row: (typeof rows)[number], decision: SsDecision | null) => {
    setBusy(true);
    setError(null);
    setTouched((t) => new Set(t).add(row.s));
    const want = new Set(removedBy(decision, row.s, row.b));
    const withdraw = [
      ...(want.has(row.s) ? [] : row.sState.ownRemovalDrafts),
      ...(want.has(row.b) ? [] : row.bState.ownRemovalDrafts),
    ];
    let err = await withdrawDrafts(withdraw);
    if (!err) {
      setChangeset((prev) => {
        const next = new Map(prev);
        for (const [word, state] of [[row.s, row.sState], [row.b, row.bState]] as const) {
          if (want.has(word) && state.inList === "accepted" && !state.removalPending) {
            next.set(word, { original: { base: state.base, description: state.description }, pending: null });
          } else if (!want.has(word) && queuedForRemoval(next, word)) {
            next.delete(word);
          }
        }
        return next;
      });
      if (decision === "behalten" || row.kept) {
        if (!(await recordKept(row.s, decision === "behalten")).ok) err = `Speichern für ${upper(row.s)} fehlgeschlagen.`;
      }
    }
    setBusy(false);
    if (err) setError(err);
    revalidator.revalidate();
  };

  const acceptGroup = async () => {
    if (!current?.suggest) return;
    const open = rows.filter((r) => !r.decided && !queuedForRemoval(changeset, r.s));
    const what = current.suggest === "streichen" ? `${labels.ascii} zum Löschen vormerken` : "behalten";
    if (!window.confirm(`Alle ${open.length} offenen Wörter in „${current.label}“: ${what}?`)) return;
    setError(null);
    if (current.suggest === "behalten") {
      setBusy(true);
      const res = await fetch(`/api/pruefliste-ss/gruppe/${group}`, { method: "POST" });
      setBusy(false);
      if (!res.ok) setError("Speichern fehlgeschlagen.");
      revalidator.revalidate();
      return;
    }
    const room = limit - changeset.size;
    const add = open.filter((r) => r.sState.inList === "accepted").slice(0, Math.max(0, room));
    setChangeset((prev) => {
      const next = new Map(prev);
      for (const r of add) {
        next.set(r.s, { original: { base: r.sState.base, description: r.sState.description }, pending: null });
      }
      return next;
    });
    if (add.length < open.length) {
      setError(`Nur ${add.length} vorgemerkt: Pro Einreichung gehen höchstens ${limit} Änderungen. Bitte erst einreichen.`);
    }
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

  const shown = openOnly ? rows.filter((r) => !r.decided || touched.has(r.s)) : rows;
  const btn = "text-xs rounded px-2 py-1 border transition-colors disabled:opacity-50";

  return (
    <div className="max-w-4xl mx-auto px-6 py-12 w-full">
      <h1 className="text-3xl font-bold text-gray-900">Prüfliste ss/ß</h1>
      <p className="text-gray-500 mt-1">
        Wörter, die in der Liste doppelt stehen: einmal mit ss (oder ae/oe/ue) und einmal mit ß (oder Umlaut).
        Pro Paar lässt sich die ss-Form streichen, die ß-Form streichen (etwa eine alte Schreibung wie Ablaß),
        beide streichen oder beide behalten. Löschungen und Änderungen werden wie in PowerEdit gesammelt und
        erst beim Einreichen übernommen.
      </p>
      <p className="text-sm text-gray-600 mt-3 mb-4">
        <strong>{decided}</strong> von {total} entschieden.{" "}
        <Link to="/pruefliste" className="text-orange-600 hover:underline">
          Zur Prüfliste der Grundformen
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
            <button type="button" disabled={busy} onClick={() => void acceptGroup()} className={`${btn} border-orange-300 text-orange-700 hover:bg-orange-50`}>
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
            const cur = currentDecision(r);
            return (
              <li key={r.s} className="py-3 flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <FormLine word={r.s} state={r.sState} changeset={changeset} setChangeset={setChangeset} />
                  <FormLine word={r.b} state={r.bState} changeset={changeset} setChangeset={setChangeset} />
                  <p className="text-xs text-gray-400 mt-1">
                    {r.why}
                    {r.kept && ` · behalten von ${r.kept}`}
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
                      disabled={busy}
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
