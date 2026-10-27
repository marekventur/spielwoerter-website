import { useState } from "react";
import { Link } from "react-router";
import { ExternalLink, Pencil } from "lucide-react";
import type { Changeset } from "~/hooks/useLocalStorageChangeset";
import type { FormState } from "../../lib/form-state";
import { upper } from "../../lib/normalise.js";

export function DictLinks({ word }: { word: string }) {
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
export function FormLine({
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
