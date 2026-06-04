# Power-Edit Page – Plan

## Goal

A new page (`/power-edit`) accessible to all logged-in users (and moderators) that lets power users bulk-edit the accepted wordlist: update base forms, update descriptions, and delete words, all from a searchable table UI, with a local changeset basket and a checkout-style confirmation flow.

---

## Open questions (resolve before implementing)

1. **Wordlist size & loading strategy**: The accepted wordlist may be tens of thousands of entries. Should the table load all words at once (client-side filter, fast UX once loaded) or paginate with server-side search? Client-side is fine up to ~50k rows, but an initial load of e.g. 100k rows would be slow. → *Recommendation: server-side search endpoint with lightweight client-side delta for the changeset view.* <- I think server-side search is better, but let's make sure it's super-fast. 

2. **Route name**: `/power-edit` (changed this) We can add entry points later

3. **Checkout tab**: Is "Änderung Bestätigen" a tab alongside search (replacing the results area), or a full-page overlay/separate route? <- same page, please

4. **Batch review for non-moderators**: When a regular user submits a batch of 80 `change_description` suggestions, should each suggestion enter the normal AI review pipeline individually (same as today), or should the whole batch be reviewed together? The existing pipeline handles individual suggestions; batch-together would need new logic. <- I think we should expose the 'batch' to the moderation interface and the MCP server, but i think it still makes sense to treat them as individual words so they can be accepted or rejectd separately.

5. **`change_description` can touch both `description` and `base`**: The existing action handles this already. Confirm that editing *only* base in the power-edit table (leaving description unchanged) is fine as a `change_description` suggestion with `payload: { base: "..." }`. <- yep, either should be editable separately or together

6. **LLM search tab**: Treat as a hidden/disabled third tab stub for now, to be designed separately. Does this need a stub placeholder in the UI yet, or just a note in code? <- no need to add it yet, just keep the tabs flexible

---

## Page structure

### Route

`/bearbeiten` — requires logged-in user (`requireUser`). No moderator-only restriction; moderators just get a higher limit and fast-track approval.

### Layout

```
[ Textsuche ] [ Änderung bestätigen (N) ]       ← tabs; second only visible if basket non-empty
──────────────────────────────────────────────
[ search controls ]
──────────────────────────────────────────────
[ results table ]
```

---

## Search tab: Textsuche

### Controls

| Control | Detail |
|---|---|
| Text input (big) | Main search box, supports multiple terms (split on `,` or whitespace), unless 'regex' mode is on; a row is included if ANY term matches ANY of the selected fields (flat OR across terms and fields) |
| Match-type dropdown | Teilwort / Wortanfang / Wortende |
| Field toggle (multi-select buttons) | Wort · Grundform · Beschreibung (all selected by default) |
| Regex checkbox | Disables multi-term splitting; treats input as regex. Use `better-sqlite3`'s `db.function('regexp', ...)` to register a JS `RegExp` as a SQLite `REGEXP` operator — filtering stays in SQL, no full-table JS scan needed |

### Search execution

- Triggered on input change (debounced ~300 ms) or Enter.
- **Server-side**: new endpoint `GET /api/words/search?q=...&mode=partial|start|end&fields=word,base,description&regex=0` — returns up to 1000 rows, contains a 'has_more' boolean, no pagination yet. Keeps initial page load fast; avoids shipping the full wordlist to the browser. 
- Results merged with the local changeset before rendering (so pending edits are shown immediately in results).

---

## Results table

Columns per row:

| # | Column | Details |
|---|---|---|
| 1 | Checkbox | Selects row for bulk ops (future); also auto-checked when row enters changeset | <- actually, let's leave this out for now. we can add later
| 2 | Wort | Display-only, uppercase CSS (`text-transform: uppercase`), links to `/wort/:word` |
| 3 | Grundform | `<input>` pre-filled from `words.base`; `uppercase` CSS class |
| 4 | Beschreibung | `<input>` pre-filled from `words.description` |
| 5 | Löschen | Toggle button; first click marks for deletion (row goes light grey, inputs disabled); second click undoes |

### Row-level changeset rules

- Any edit to Grundform or Beschreibung that differs from the DB value → entry added to changeset as `change_description`.
- Edit reverted to original value → entry removed from changeset.
- Löschen clicked → entry added as `remove`; clicked again → removed from changeset.
- **No row-level submit button** — all changes accumulate in the basket.

---

## Local changeset basket

```ts
type ChangesetEntry =
  | { base?: string; description?: string } // simplified this a lot, we don't need to repeat the word and the 'type' is implicit in the field being null or not
  | null // delete

type Changeset = Map<string, ChangesetEntry>;
```

- Persisted to `localStorage` via a small custom hook `useLocalStorageChangeset` (~20 lines, `app/hooks/useLocalStorageChangeset.ts`). Serialises the Map as `Array.from(map.entries())` on write, reconstructs with `new Map(stored)` on mount. No extra npm dependency needed.
- Drives all input values and visual state in the table. No separate "row state".
- Tab badge shows `Changeset.size`.

### Edit limit

| Role | Max edits per batch |
|---|---|
| Logged-in user | 100 |
| Moderator | 500 |

When `changeset.size >= limit`:
- New edits and new deletes are disabled (inputs become read-only, Löschen button disabled).
- Undeletes (removing a `remove` entry) are still allowed.
- A prominent banner appears: *"Du hast [N] Änderungen gesammelt – bitte reiche sie zuerst ein."* with a link/button to the checkout tab.

---

## Checkout tab: Änderung bestätigen

Only visible when `changeset.size >= 1`.

### Layout

```
[ Optional: Zusammenfassung / Commit-Nachricht textarea ]
[ Bearbeitung einreichen ]  ← primary action button

──────────────────────────────────────────────
[ Same results table component, but filtered to changeset entries only ]
```

- Table shows only changed/deleted words; same columns, same edit-in-place (user can still fine-tune before confirming).
- Beschreibung textarea allows a short summary of the batch (like a commit message; optional, max ~200 chars).
- "Bearbeitung einreichen" submits the whole changeset.

### Submit behaviour

- **Moderators**: suggestions created with `moderator_fast_track = 1`; they skip AI review and go straight to `moderator_approved` in the existing promotion job → ingest on next sync. Same as moderator edits today.
- **Non-moderators**: suggestions created with `moderator_fast_track = 0`; go through the normal `draft → pending_review → AI review → moderator` pipeline. Each entry becomes one `suggestions` row (action: `change_description` or `remove`). The batch message is stored on the batch record and surfaced in the moderation UI.

---

## Backend changes

### New DB table: `batches`

```sql
CREATE TABLE IF NOT EXISTS batches (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id),
  message   TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Migration: add `batch_id` to `suggestions`

```sql
ALTER TABLE suggestions ADD COLUMN batch_id INTEGER REFERENCES batches(id);
```

Surface `batch_id` in the moderation UI so a moderator can see that 80 suggestions came from the same user in one sitting.

### New server route: `POST /api/batch`

```
POST /api/batch
Body: {
  message?: string,          // commit message
  changes: Array<{
    word: string,
    type: 'change_description' | 'remove',
    payload?: { base?: string; description?: string }
  }>
}
```

Logic:
1. `requireUser`.
2. Validate: `changes.length <= limit` (100 / 500 by role).
3. Insert into `batches` → get `batch_id`.
4. For each entry, insert into `suggestions` (same validation as existing `POST /api/suggestions`, but skip the "already has a draft" uniqueness check — or upsert existing draft).
5. Return `{ ok: true, batchId, count }`.

### New server route: `GET /api/words/search`

```
GET /api/words/search?q=...&mode=teilwort|anfang|ende&fields=word,base,description&regex=0&limit=200
```

- Auth: `requireUser`.
- SQL: `WHERE in_list IN ('accepted', 'uncertain')` plus LIKE clauses for normal mode, or `REGEXP` for regex mode (handled via a registered `db.function` — no full-table JS scan).
- Returns `{ words: [{ word, base, description }] }`.

---

## Frontend file layout

```
app/routes/bearbeiten.tsx          ← main route, loader (auth check), tab state
app/components/WordEditTable.tsx   ← reusable table (used by both search and checkout)
app/components/ChangesetContext.tsx ← (or just useState in bearbeiten.tsx; no need to over-engineer)
```

---

## Future: LLM search tab

Let's not worry about this for now

---

## Moderation UI updates

/*
Let's leave this for now - but please include the batch message in the mcp server response -- that's currently the main way moderation happens.
- Show `batch_id` and batch message on grouped suggestions so moderators can see the full context.
- Add a "approve whole batch" / "reject whole batch" shortcut in the moderation UI (reuse existing batch-approve endpoint, filtered by `batch_id`).
*/
---

## Implementation order

1. DB migration (`batches` table, `batch_id` on `suggestions`).
2. `GET /api/words/search` endpoint.
3. `POST /api/batch` endpoint.
4. `WordEditTable` component (drives from props, no internal change state).
5. `bearbeiten.tsx` route: search tab with changeset basket, limit enforcement.
6. Checkout tab.
7. Moderation UI: surface `batch_id` and batch message.
8. (Later) LLM search tab stub.
