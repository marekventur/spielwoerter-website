# Spielwoerter.de (Website)

Web frontend and API for **[Spielwörter](https://github.com/marekventur/spielwoerter)** — the open German word list. Built with **React Router v7** (framework mode), **Express**, **Tailwind CSS v4**, **SQLite**, **TypeScript**.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:3004](http://localhost:3004) (port from `package.json` / `server.js`).

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Dev: Vite HMR + Express (`PORT=3004` by default) |
| `npm run build` | Production build |
| `npm run start` | Production server (`node server.js`) |
| `npm run typecheck` | `react-router typegen` + `tsc -b` |
| `npm run test:e2e` | Playwright tests (`tests/e2e/`) |
| `npm run sync:pull` | Pull wordlists from GitHub into SQLite (see `scripts/sync-pull.ts`) |
| `npm run pm2:*` | PM2 process management (after build) |

## Main routes (`app/routes.ts`)

| Path | Purpose |
|------|---------|
| `/` | Home / search |
| `/wort/:word` | Word detail, suggestions (add/remove/change) |
| `/login` | Email OTP login |
| `/meine-vorschlaege` | User’s drafts and suggestion status |
| `/regeln`, `/warum`, `/entstehung`, `/mitmachen` | Static info pages |
| `/moderation` | Moderators only |
| `/admin` | Admins only |

## Backend (`server/app.ts`)

Express app: session auth, REST APIs for suggestions, moderation, auth, word enrichment, etc. React Router is mounted as middleware. Loaders receive `context.db` and `context.user` (see `getLoadContext`).

Shared logic lives under `lib/` (`db.ts`, `schema.ts`, `auth.ts`, `sync.ts`).

## VPS deployment

Same flow as the template: `app.config` (`NAME`, `PORT`), `./deploy.sh`, `./post_deploy.sh`, PM2 — see inline comments in those scripts.

## Stack (summary)

- **React Router v7** — file-based routes, loaders, SSR via Express adapter.
- **Express** — `server/app.ts`; entry `server.js`.
- **Tailwind v4** + **DaisyUI** — `app/app.css`; root uses `data-theme` / base colors (some UI uses small local components under `app/components/ui/`).
- **SQLite** — `better-sqlite3`; path `DATABASE_PATH` or `./data/app.db`.
- **TypeScript** — app, server, `lib/`; `server.js` stays JS.

## Layout

```
├── app/                 # React app: routes, components, styles
├── lib/                 # DB, schema, auth, GitHub sync helpers
├── server/app.ts        # Express + API + RR handler
├── scripts/             # e.g. sync-pull
├── tests/e2e/           # Playwright
├── server.js            # Dev/prod entry
└── react-router.config.ts
```

The **word list data** is maintained in the [spielwoerter](https://github.com/marekventur/spielwoerter) repo; this site hosts community suggestions and moderation workflows that can sync changes back via GitHub.
