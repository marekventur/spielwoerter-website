# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Related: [AGENTS.md](./AGENTS.md) has a short general agent briefing; this file is the deeper reference.

## Commands

```bash
npm run dev          # Dev server (Vite HMR + Express) on http://localhost:3004
npm run typecheck    # react-router typegen && tsc -b — run after adding/renaming routes so +types/* regenerate
npm run test:e2e     # Full Playwright suite (~95 tests, ~2 min)
npm run test:e2e -- tests/e2e/oversight.spec.ts   # Single spec file
npm run test:e2e -- -g "scheduled removal"        # Single test by title
npm run sync:pull    # Pull wordlists from GitHub into the local SQLite DB
```

Dev login: without `MAILGUN_API_KEY`, the OTP code is printed to the server console. `marekventur@gmail.com` is bootstrapped as admin+moderator on every schema init.

E2E tests boot their own server on port 3005 with a throwaway DB in the OS tmpdir (`tests/global-setup.ts`), blank out MAILGUN/DEEPSEEK keys for offline determinism, read OTP codes directly from the DB (`tests/helpers/auth.ts`), and run with 1 worker (SQLite). CI runs them on every push/PR (`.github/workflows/e2e.yml`).

**Deploy: every push to `main` auto-deploys to the production VPS** (`.github/workflows/deploy.yml` → rsync to `/var/www/spielwoerter.de`, excluding `data/`).

## Architecture

React Router v7 (framework mode) mounted as middleware in an Express app (`server/app.ts`). Route loaders get `context.db` (better-sqlite3, raw SQL) and `context.user`. Client-side mutations go through REST endpoints under `/api/*` (`server/routes/*.ts`) — there are no React Router actions. UI copy is German.

### The words table is a cache, not the source of truth

The wordlists live in the separate **spielwoerter** GitHub repo (3 JSONL files: accepted/uncertain/rejected, plus REGELN.md). An hourly production job (`server/jobs.ts` → `lib/sync.ts`) **pushes** approved suggestions to that repo and **pulls** the lists back, which *deletes and rebuilds* the local `words` table and re-derives the `remove`-action blocklist rows in `rejected_words`. Consequence: never edit `words.in_list` directly to make a permanent change — it will be overwritten within the hour. All permanent changes flow through `suggestions` rows.

### Suggestion lifecycle

```
draft ──(idle, lib/promotion.ts job)──► pending_review ──► needs_moderator ──► moderator_approved / moderator_rejected
   └──(moderator_fast_track=1)────────► moderator_approved directly
```

- Idle promotion: 60 min for everything **except moderator removals, which wait 72 h** (`FAST_TRACK_REMOVE_HOURS`). Waiting removals show as "geplant" on `/aenderungen` (and in word-page history), where a *different* moderator can approve early (`/api/moderation/scheduled/:id/approve`) or object with a mandatory comment (`.../object` → status `needs_moderator` + a `word_comments` row); `/moderation` shows only a count pointer.
- Decisions: `moderateOne` / `undoModeration` in `lib/moderate.ts`, with `decided_by`/`decided_at` audit columns. Once `synced_at` is set the suggestion is published to GitHub and undo is refused — the only fix is a counter-suggestion.
- Blocklist: `rejected_words(word, action)` answers add/remove resubmission with `409 {requiresConfirmation: true, prior}` for all users; moderators additionally get it when reverting a recent deliberate opposite decision (`lib/prior-decisions.ts`), and adds of ae/oe/ue/ss-spellings whose umlaut sibling exists (`normalised` collision) get the same treatment. The client re-sends with `force: true` and a mandatory comment that is stored as a `word_comments` row. Client helper: `app/components/suggestion-api.ts`. Regular users' forced re-proposals stay on the normal (non-fast-track) review path.
- `lib/removal-hints.ts` produces advisory warnings on removal flows for likely rule-permitted special forms (Dativ-e, e-Tilgung, etc.) — heuristic, never blocking.

### Public identity rule

**Emails must never render in any UI, moderator pages included.** Every user has a screen name — `display_name` (unique, validated, no `@`) or the automatic `Besucher-<id>` (`lib/screen-name.ts`). The only exceptions: a user's own email on their own `/konto` page and NavBar, and the admin-only `/admin` user management. `lib/history.ts` builds the public event stream (suggestions + `word_comments`) for the word-page history expander and the `/aenderungen` changelog; its `forModerator` flag only reveals hidden comments.

### Schema migrations

`lib/schema.ts` runs on every startup: `CREATE TABLE IF NOT EXISTS` plus pragma-guarded `ALTER TABLE ADD COLUMN` blocks. Add new columns the same way. When adding a table with a foreign key, also add it to `cleanDb()` in `tests/helpers/seed.ts` *before* its referenced tables (FK delete order).

## Conventions

- `Button` (`app/components/ui/button.tsx`) accepts a `to` prop for React Router links — don't wrap it in `<Link>`.
- Timestamps are SQLite UTC strings; format them with string slicing (`formatTimestamp` in `app/components/WordHistoryList.tsx`), not `Date.toLocale*`, to avoid SSR/client hydration mismatches.
- Prefer minimal, task-focused diffs; don't refactor unrelated code.
