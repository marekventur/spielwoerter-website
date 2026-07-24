# Agent notes — Spielwoerter.de website

Context for AI coding agents working in this repository. A deeper architecture
reference (suggestion lifecycle, sync pipeline, identity rules) lives in
**[CLAUDE.md](./CLAUDE.md)**.

## What this repo is

A **React Router v7 + Express** app for **spielwoerter.de**: word lookup, user suggestions (add/remove/description changes), email OTP auth, moderator approval, and optional sync of approved changes to the **[spielwoerter](https://github.com/marekventur/spielwoerter)** GitHub wordlists. UI copy is **German**.

## Commands

- **Dev:** `npm run dev` → typically **http://localhost:3004**
- **Types:** `npm run typecheck` (includes `react-router typegen`)
- **E2E:** `npm run test:e2e` (Playwright; may need server + env; see `tests/`)

## Where things live

| Area | Location |
|------|----------|
| Pages / routes | `app/routes/*.tsx`, registered in `app/routes.ts` |
| Layout, nav, footer | `app/root.tsx`, `app/components/NavBar.tsx`, `SiteFooter.tsx` |
| Shared UI | `app/components/`, `app/components/ui/` (`Button`, `Input`, `Card`, …) |
| HTTP + APIs | `server/app.ts` |
| DB schema / SQLite | `lib/schema.ts`, `lib/db.ts`; access via **`context.db`** in loaders |
| Auth session helpers | `lib/auth.ts` |
| GitHub wordlist sync | `lib/sync.ts`, cron-related code in `server/app.ts` |

After adding or renaming a route, run **`npm run typecheck`** so `+types/*` stays in sync.

## Conventions worth keeping

- **`Button`:** Supports optional **`to`** (React Router `Link`) instead of wrapping `<Link><Button>`. See `app/components/ui/button.tsx`.
- **Language:** User-facing strings are **German**; keep tone consistent with existing pages.
- **Scope:** Prefer minimal, task-focused diffs; don’t refactor unrelated code or add docs the user didn’t ask for unless necessary for the change.
- **API behavior:** Deleting suggestions is **draft-only** (see `DELETE /api/suggestions/:id`). Promotion of drafts to review uses **`last_modified_at`** and a timed job in `server/app.ts`.

## Environment

Server reads typical **`.env`** / `process.env` (e.g. session secret, `DATABASE_PATH`, GitHub sync vars, DeepSeek key for enrichment). Don’t commit secrets; follow existing patterns in `server/app.ts`.

## Related repo

Pipeline and **REGELN.md** / wordlist JSONL live in **spielwoerter** (separate clone), not here. This site consumes pulled data and community edits.
