# Spielwoerter website – next stages plan (final)

## Current state (brief)

- **spielwoerter-website**: React Router 7 + Express, better-sqlite3 (DB exists, no schema yet), routes home, wort/:word. Word page uses mock data; add/remove are TODO. Port from `process.env.PORT` (default 3000).
- **spielwoerter**: wordlist_accepted.jsonl, wordlist_uncertain.jsonl, JSONL schema. CC0. No wordlist_rejected yet.

**Decisions locked in:** Transactional data in repo = minimal (snapshots only). Moderator = explicit flag. Review = flat list, grouped by base. Sync = Option A (Node script in website). Rejected = wordlist_rejected.jsonl in repo.

---

## Phase 1: Dev port and auth

**1.1 Dev port 3004**

- In package.json: set `PORT=3004` in the `dev` script (e.g. `cross-env NODE_ENV=development PORT=3004 node server.js`). Server already reads `process.env.PORT`.

**1.2 Email OTP auth (login via email, 6-digit code)**

- Backend: SQLite table for pending codes (email, code, expires_at); endpoints: request code (generate, store, send via Mailgun), verify code and create session (cookie or JWT).
- **Mailgun template 1 – OTP**: One HTML template — subject “Dein Spielwörter-Code”, body with 6-digit code prominently displayed, short explanation, link to site. Minimal inline styles.
- Frontend: Login flow (email → “Code senden” → enter code → submit); session check on load; logout.

---

## Phase 2: Data model and source of truth

**2.1 Repo as source of truth**

- **Accepted**: unchanged `wordlist_accepted.jsonl`.
- **Rejected**: add `wordlist_rejected.jsonl` (minimal: word, base, optional reason/rejected_at). Prevents re-suggesting the same removal; sync job and “no remake” rule use it.
- **Repo = snapshots only**: no per-row history or last_updated in wordlist files.

**2.2 Website SQLite schema**

- **words**: read cache from repo (word, description, base, source, verified_by, in_list). in_list = `accepted` | `rejected` | `uncertain`. Updated by sync pull.
- **suggestions**: id, user_id, word, action, payload (e.g. new description), status, created_at, **last_modified_at**.
  - **status**: `draft` | `pending_review` | `ai_approved` | `ai_rejected` | `moderator_approved` | `moderator_rejected`.
  - **action**: `add` | `remove` | `change_description`.
  - Only `draft` is editable; after 60 min idle (see Phase 3) → `pending_review`. Final statuses are immutable.
- **users**: id, email, created_at, is_moderator, **license_approved** (boolean; set when user accepts CC0 contribution terms).
- **rejected_words**: small table (word, action) for fast “no remake” checks; filled from suggestions with rejected status + wordlist_rejected (for remove). Avoids scanning all rejected suggestions.
- **sessions**, **otp_codes**: as before.

**2.3 Rejected requests cannot be remade**

- When creating a new draft, enforce: the same **(word, action)** must not exist in rejected state. Check `rejected_words(word, action)` (and for action `remove`, word in wordlist_rejected after sync). If blocked, show: “Dieser Vorschlag wurde bereits abgelehnt.”
- Different action for the same word is allowed (e.g. “add” after a rejected “remove”).

**2.4 Rate limit**

- Optional per-user limit on number of drafts (e.g. max 50) to avoid abuse; add when usage warrants it.

---

## Phase 3: Draft-based flow (no cart) and 60-minute rule

**3.1 No cart/checkout**

- Users have a set of **drafts** (suggestions with status `draft`). They can add, edit, or delete drafts at any time. No “checkout” or “submit all”; each draft is independent.

**3.2 60-minute rule**

- A suggestion enters the review queue only after **at least 60 minutes** since its last change. Until then it stays editable.
- Implementation: store `last_modified_at` on every draft update. **Promotion job** (e.g. every 10–15 min): `UPDATE suggestions SET status = 'pending_review' WHERE status = 'draft' AND last_modified_at <= datetime('now', '-60 minutes')`. Can be same process as sync (e.g. “every hour: promote drafts, then pull, then process, then push, then email”) or a separate lighter cron.
- Once status is `pending_review` or any final status, the row is immutable (no further edits; “change” = new suggestion).

**3.3 User flow**

- From word page or search: “Vorschlag hinzufügen” (add draft: add/remove/change_description). Draft appears in “Meine Vorschläge”.
- “Meine Vorschläge”: list of user’s drafts (editable/delete) + list of in-review or decided (read-only, with status). Clear copy: “Vorschläge gehen nach 60 Min. ohne Änderung in die Prüfung.”

**3.4 Approval pipeline**

- AI agent processes only `pending_review` suggestions; outputs ai_approved / ai_rejected / needs_moderator. Moderator resolves needs_moderator → moderator_approved | moderator_rejected. Only approved go to sync.

---

## Phase 4: Sync job (Option A) + digest emails + public API

**4.1 Sync job (Option A)**

- **Pull (repo → website)**: Fetch from GitHub (wordlist_accepted, wordlist_uncertain, wordlist_rejected), reload SQLite `words` table and keep `rejected_words` in sync. Run hourly or daily.
- **Push (website → repo)**: Collect suggestions with status ai_approved or moderator_approved that are not yet synced (e.g. flag `synced_at` or “since last sync” query). Apply to wordlists, commit and push to spielwoerter repo (GitHub API or git + deploy key). On conflict: pull and re-apply, then push.

**4.2 Digest emails**

- Same job (or immediately after sync): for each user who had at least one suggestion **decided** in this run (approved or rejected), send **one summary email** per user. Use **Mailgun template 2 – digest** (see below).

**4.3 Public API – word lookup**

- **GET /api/words/:word** (e.g. GET /api/words/laufen): returns JSON for the given word from the `words` table (e.g. word, description, base, in_list). Normalize input (e.g. lowercase). 404 if not found. No auth required unless you want to restrict it later. Simple read-only API for external tools or clients.

---

### Mailgun template 2 – Digest email

Create a second Mailgun HTML template for the digest:

- **Subject**: e.g. “Deine Spielwörter-Updates” or “Deine Vorschläge – Übersicht”.
- **Body**:
  - Short intro: “Hier ist die Übersicht zu deinen Vorschlägen.”
  - **Angenommen** (approved): list each item (word, action: Hinzufügen / Entfernen / Beschreibung ändern).
  - **Abgelehnt** (rejected): list each item (word, action).
  - Optional: link to “Meine Vorschläge” on the site.
- Minimal inline styles; same tone as template 1. Variables to pass from app: list of approved items, list of rejected items (each with word + action), user email or name if desired.

---

## Phase 5: Approval interface (moderators)

- List suggestions with needs_moderator (or status pending_review and not yet AI-processed, depending on when moderator sees them). Group by **base**; “approve all in group” / “reject all in group”.
- Per item: word, action, current/suggested description; Duden link; one-click approve/reject (optional reason). No batch entity; flat pile, grouped only in UI.

---

## Phase 6: Morphology suggestions (no cart)

- When user creates a **draft** (e.g. “remove X”), suggest: “Weitere Formen mit gleichem Stichwort: Y, Z.” with checkboxes; “Hinzufügen” adds one draft per selected word (each with its own 60-min window). Same for “add” (optional, can be later).
- No cart; just “add more drafts” from the suggestion UI. Description suggestions (e.g. LLM) can be added later.

---

## Phase 7: License and contribution disclaimer

- Before **first draft creation** (or on first visit to “Meine Vorschläge”): short notice that contributions are under CC0 and user waives rights; require “Ich stimme zu” / checkbox. On accept, set **users.license_approved = true**. Block creating drafts until license_approved. Link “Lizenz” / “Mitmachen” in footer and from the flow.

---

## Suggested order of implementation

1. **Phase 1** – port + auth.
2. **Phase 2** – schema (including license_approved, rejected_words) + sync **pull** only; wire word page to SQLite; add wordlist_rejected and pull it.
3. **Phase 3** – draft flow, 60-min promotion job, “no remake” check (using rejected_words); AI + moderator pipeline.
4. **Phase 5** – approval UI for moderators.
5. **Phase 4** – sync push, digest emails (Mailgun template 2), GET /api/words/:word.
6. **Phase 6** – morphology “suggest related” when adding drafts.
7. **Phase 7** – license disclaimer and license_approved at first draft.

---

## Summary

- **Drafts**: No cart; users manage editable suggestions; 60 min idle → pending_review via promotion job.
- **Rejected = no remake**: Same (word, action) blocked; rejected_words table for fast checks.
- **Users**: license_approved column for CC0 consent; is_moderator explicit.
- **Digest**: Second Mailgun template (subject + approved/rejected lists + link).
- **API**: Simple GET /api/words/:word for word lookup.
- **Agreed**: Promotion job (10–15 min or with sync); rejected_words table; rate limit on drafts when needed.
