# `/diskussion` – ein Kanal für die Moderator:innen

## Goal

A mailing-list-shaped discussion board on spielwoerter.de, **moderators only**.
Every post mails every moderator, and they can answer **by replying to that
mail**, or start a thread by writing to **`moderatoren@mail.spielwoerter.de`** —
so it behaves like the Google Group they were asked to join, except the archive
lives on the site and needs no account beyond the OTP login they already have.

Concrete needs, from the actual mail threads:

| Need | Who asked | Date |
|---|---|---|
| "ich kann sie oder ihn auch nicht anschreiben" (Besucher-34 bulk-deleted correct forms) | Robert | 10 Aug |
| "ein Chat auf der Moderatorenseite … um sich über Fragen zu verständigen" | Maria | 11 Aug |
| "ähnlich wie Wikipedia eine 'Diskussions' Seite" | Marek | 22 Jul |
| A place for the REGELN.md rewrite debate (not tied to one word) | Robert | 3 Aug |
| "ich finde nirgends eine Liste der Moderatoren" | Robert | 17 Jul |

The last one is **already shipped** — `/moderation` renders a `Moderator:innen`
card. Tell him; costs nothing.

---

## Decisions

1. **Who reads and writes:** moderators (and admins) only. No visibility for
   other users. See "Consequences of moderators-only" — it is not just a WHERE
   clause.
2. **Public-readable:** no. Opening it up later is additive (a per-topic flag),
   so nothing here forecloses it.
3. **Reply by email:** **in v1.** A no-reply address that silently eats replies
   is worse than not having mail at all, and the two things that made this look
   expensive turned out to be already solved — see below.
4. **Opt-out:** per channel, not one global switch, and with a Google-Groups-style
   middle setting rather than a boolean.
5. **Word-comments do not mail all moderators.** That's the firehose; it would
   get muted and take `/diskussion` with it. Stays out of v1.

### Two findings that made decision 3 cheap

Both checked, not assumed:

- **The MX records already exist.** `mail.spielwoerter.de` resolves to
  `mxa.eu.mailgun.org` / `mxb.eu.mailgun.org`. The Porkbun step I'd flagged as
  the risky part of inbound is simply already done.
- **Mailgun strips quoted replies and signatures for us.** Parsed inbound
  messages carry `stripped-text` and `stripped-signature` alongside
  `body-plain`. That was the open-ended, never-quite-finished part of the
  estimate, and it isn't ours to write. It's best-effort and can be absent, so
  we fall back to `body-plain` and keep the raw body (below).

Note the region: `MAILGUN_API_URL=https://api.eu.mailgun.net` and the MX are
`*.eu.mailgun.org`. **Create the Route in the EU control panel** — routes are
region-scoped and a US-created route will never fire.

---

## Already done (ahead of this work)

Two guards, both prompted by this plan, both `typecheck`-clean and **not yet
committed** (pushing `main` deploys to prod):

- **`server/mailgun.ts`** — `mailEnabled()` now gates `mailgunSend()` itself, so
  no send path can leave the process outside production, whichever route calls
  it. Dev logs `[mail] Skipped (not production): "<subject>" → <to>`. This
  closed a live hole: `server/routes/sync-push.ts` called `sendDigestEmails`
  with no guard, so a moderator hitting sync on `dev.spielwoerter.de` would have
  mailed real users.
- **`lib/sync.ts`** — `syncPush()` is production-only by default and returns
  `{ pushed: 0 }` with `[sync push] Skipped (not production).` otherwise. Same
  hole, bigger blast radius: `/api/sync/push` on dev would have committed to the
  live `marekventur/spielwoerter` wordlists. `scripts/sync-push.ts` opts back in
  explicitly (`allowNonProduction: true`) and warns loudly, since running it is
  a deliberate act. `syncPull` is untouched — it is read-only and `npm run
  sync:pull` still works on dev.

The `/diskussion` fan-out therefore inherits its production guard for free.

---

## Schema

```sql
CREATE TABLE IF NOT EXISTS topics (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id          INTEGER NOT NULL REFERENCES users(id),
  title            TEXT NOT NULL,
  created_at       TEXT NOT NULL DEFAULT (datetime('now')),
  last_activity_at TEXT NOT NULL DEFAULT (datetime('now')),
  pinned           INTEGER NOT NULL DEFAULT 0,
  locked           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS topic_posts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  topic_id   INTEGER NOT NULL REFERENCES topics(id),
  parent_id  INTEGER REFERENCES topic_posts(id),   -- null = top-level in the thread
  user_id    INTEGER NOT NULL REFERENCES users(id),
  body       TEXT NOT NULL,                        -- what we render
  raw_body   TEXT,                                 -- inbound only: the untouched mail body
  source     TEXT NOT NULL DEFAULT 'web',          -- 'web' | 'email'
  message_id TEXT,                                 -- RFC Message-Id, for threading
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  emailed_at TEXT,                                 -- mirrors suggestions.notified_at
  hidden_at  TEXT,
  hidden_by  INTEGER REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_topic_posts_topic ON topic_posts(topic_id, created_at);
CREATE INDEX IF NOT EXISTS idx_topic_posts_msgid ON topic_posts(message_id);
```

**`raw_body` is cheap insurance.** Mailgun's stripping is best-effort; if it
mangles someone's post we can re-derive `body` later instead of having lost it.
A few KB per post, for three people.

Email preferences as pragma-guarded `ALTER TABLE` blocks, exactly like the
existing `display_name` one:

```sql
ALTER TABLE users ADD COLUMN email_diskussion TEXT NOT NULL DEFAULT 'all';
ALTER TABLE users ADD COLUMN email_digest INTEGER NOT NULL DEFAULT 1;
```

`cleanDb()` in `tests/helpers/seed.ts`: `topic_posts` → `topics` → `users`.

### Email preferences, per channel

One switch per channel rather than one global one, and the discussion channel
gets the three-way setting Google Groups has — that middle option is the whole
reason people stay subscribed to busy lists:

| Setting | Values | Default |
|---|---|---|
| `email_diskussion` | `all` — every post · `mine` — only threads I started or replied to · `none` | `all` |
| `email_digest` | on / off (the existing approve/reject digest) | on |
| OTP login codes | not configurable — transactional | — |

Rendered as an "E-Mail-Einstellungen" block on `/konto`. `mine` is one extra
`EXISTS` clause on the recipient query, so it costs almost nothing to offer.

**Scope note:** honouring `email_digest` means a small change in `lib/sync.ts`
where `DigestUser` rows are assembled — currently every affected user gets one
unconditionally. Worth doing in the same pass so the `/konto` block isn't half a
lie.

---

## Consequences of moderators-only

Closing it off is right for v1, but four places have to agree or the board leaks:

1. **Both loaders check `context.user?.isModerator` and throw 404** — not 403,
   which would confirm a thread exists. The loader runs server-side and is the
   real gate; hiding the nav link is not access control.
2. **Every `/api/topics` endpoint uses `requireModerator`**, reads included.
   Nothing may be `requireUser`.
3. **Keep it out of `server/routes/sitemap.ts`**, and set `noindex` — otherwise
   thread titles are handed to Google, which is exactly the leak we're avoiding.
4. **No `art=topic` in `/aenderungen`.** That feed is public, so topics stay out
   of it. This drops the "one feed" idea from the first draft: `/diskussion` is
   now a place you must remember to visit. The mail is what makes that
   acceptable, which is why it isn't optional.

`#42` linkification still works and is free, but a word comment linking to
`/diskussion/42` is a dead end for non-moderators — so don't advertise it.

---

## Routes and UI

- `app/routes/diskussion.tsx` — thread list: pinned first, then
  `last_activity_at DESC`, with post count and last poster's screen name.
- `app/routes/diskussion.$id.tsx` — thread view + "Antworten" box. Reuses the
  comment form and hide-toggle patterns from `WordHistorySection.tsx`.
- `server/routes/topics.ts`, mounted `app.use("/api/topics", topicsRouter)`:
  `POST /` (new topic), `POST /:id/posts` (reply, optional `parent_id`),
  `POST /posts/:id/hide`, `POST /:id/pin`, `POST /:id/lock` — all
  `requireModerator`.
- Register both routes in `app/routes.ts`, then `npm run typecheck` so
  `+types/*` regenerate.
- NavBar link only when `user?.isModerator`.

Mirror `word_comments` deliberately on hide semantics, but **not** on length:
web posts allow 10 000 characters (`word_comments` stays at 1 000 — a remark on
a single word is a different thing from a rules argument). **Inbound mail is
exempt from the length limit entirely** — truncating
someone's considered reply at 1000 characters would be infuriating and they
can't see the counter.

### Nesting: store deep, render one level

`parent_id` records the true parent, but the thread indents only **one** level —
a reply to a reply appears under the same top-level post, in time order. Column
width dies at depth 3 on Maria's iPad. Storing the real parent costs nothing and
is what inbound threading needs anyway.

---

## Outbound mail

Every post mails every moderator except the author, filtered by
`email_diskussion`. New function in `server/mailgun.ts` beside
`sendDigestEmails`, new template `server/email-templates/topic-post.ts` beside
`digest.ts`.

**Send one mail per recipient. Never a shared `To:`/`Cc:`.** That would leak
every moderator's address into every moderator's mail client — the public
identity rule broken through the back door. It's the one thing Google Groups
hides behind a list address that we have to do by hand.

| Header | Value |
|---|---|
| `subject` | `[Spielwörter] <Titel>`; replies get `Re: ` and the **same** title |
| `h:Message-Id` | `<post-<id>@mail.spielwoerter.de>` — stored in `topic_posts.message_id` |
| `h:In-Reply-To` | parent post's Message-Id (or the topic's first post) |
| `h:References` | root … parent chain |
| `h:Reply-To` | `moderatoren@mail.spielwoerter.de` — one list address, like a real mailing list |
| `h:List-Id` | `Spielwörter Diskussion <diskussion.spielwoerter.de>` — lets them filter |
| `h:Auto-Submitted` | `auto-generated` — see loop prevention |

Body: the full post (readable without clicking), author screen name, thread
link, and a footer linking to `/konto` for the email settings.

### Delivery is best-effort, with the hourly job as the safety net

`await` the send after the insert, but catch and log — a Mailgun outage must not
lose someone's post. Stamp `emailed_at` on success. Then in `startSyncJob()`'s
`run()`, sweep posts with `emailed_at IS NULL` older than 5 minutes and retry.
A self-healing outbox for one column and about ten lines, on a job that already
runs.

---

## Inbound mail

`server/routes/inbound.ts`, mounted **outside** the `/api` auth conventions
since the caller is Mailgun, not a browser.

1. **Mailgun Route (EU panel):** match recipient
   `moderatoren@mail.spielwoerter.de` → `forward("https://spielwoerter.de/api/inbound/diskussion")`.
   Routes post `multipart/form-data`, so this endpoint needs a multipart parser
   — the rest of the app doesn't have one, so that's one new dependency
   (`multer`) or Mailgun's `store()` + fetch-by-URL variant, which avoids it.
   **Prefer `store()`**: no new dependency, and a stored message can be
   re-fetched if our handler was down.
2. **Verify the signature** — `timestamp`, `token`, `signature` against the
   Mailgun signing key (HMAC-SHA256). This endpoint is public and unauthenticated;
   without this, anyone who learns the URL can post as anyone. Reject on failure
   **and** on a `timestamp` older than a few minutes (replay).
3. **Resolve the sender:** match `From:` against `users.email` and require
   `is_moderator`. Anything else is dropped with a log line — no bounce, no
   error page, nothing that confirms whether an address is a moderator.

   **`From:` alone is not authentication — it is trivially spoofed**, and
   `moderatoren@` is a guessable address, so treat it as public. The actual
   defence is Mailgun's SPF/DKIM verdict, which arrives in `message-headers`
   (`X-Mailgun-Spf`, `X-Mailgun-Dkim-Check-Result`). Require a pass before
   trusting `From:`. ⚠️ *Verify those exact field names against a real captured
   payload before relying on them — I have not confirmed them for the current
   API version.* Until that's confirmed, the honest fallback is that inbound
   posts are marked `source = 'email'` and visibly labelled in the UI, so a
   forged post is at least attributable to a channel with weaker auth.
4. **Resolve the target — this is what the single address costs.** With one
   list address there is no token in the recipient, so threading is done the way
   Mailman and Google Groups do it, in this order:
   1. `In-Reply-To` matched against `topic_posts.message_id` → that post is the
      parent, its topic is the topic.
   2. Failing that, walk the `References` chain and take the newest match.
   3. Failing that, compare the subject with `Re:`/`AW:`/`[Spielwörter]`
      stripped against existing topic titles → attach to the thread root.
   4. Failing all three, **create a new topic** with the subject as its title.

   Step 4 is the feature, not the fallback: a moderator can start a discussion
   by mailing `moderatoren@` from their phone, without opening the site. And the
   failure mode of bad threading is a stray new topic — visible, fixable, never
   a lost message. Locked topic → drop with a log.
5. **Body:** `stripped-text` if present, else `body-plain`; store the untouched
   original in `raw_body`, set `source = 'email'`.
6. **Fan out as usual** — an emailed reply mails the other moderators exactly
   like a web reply.

### Loop prevention

Our own notification mail must never be ingested as a new post. Three cheap
belts:

- Drop anything whose `From:` is our own `MAILGUN_FROM` / `noreply@` /
  `moderatoren@` — with a single list address this matters more, since our own
  fan-out mail is now plausibly deliverable back to the list.
- Drop anything carrying `Auto-Submitted:` other than `no`, or
  `List-Id: …spielwoerter…` (which our own mail sets).
- Rate-limit per sender per topic. A mail loop between two systems generates
  thousands of messages in minutes; the DB should not be the thing that notices.

### Testing inbound without a mail round-trip

The handler is a plain function over a parsed payload, so the E2E spec posts a
fixture with a correctly computed signature. One live end-to-end send is still
worth doing by hand after deploy — signature keys and route regexes fail in ways
fixtures don't reproduce.

**Note this is the one part that cannot be tested on the dev box**, since
`spielwoerter.de` is where the Route points and the mail guard means dev never
sends. Verify in production with a throwaway topic.

---

## What we deliberately do not build

- **Discord.** Swaps a Google signup for a Discord signup, so it doesn't solve
  Robert's stated objection, and it's a poor fit for Maria on an iPad recovering
  from eye surgery.
- **Live chat.** Maria said "Chat", but the traffic is a handful of messages a
  week across three people in different timezones and health situations.
  Asynchronous threads are the right shape; presence is not.
- **A second identity system.** Everyone already logs in by OTP. That is the
  entire competitive advantage over Google Groups and Discord.
- **Attachments.** Inbound mail will carry them; ignore them in v1 and say so in
  the mail footer, rather than half-supporting them.
- **Google Group.** Robert is added but hasn't confirmed; Maria hasn't either.
  Leave it, invest nothing further, stop mentioning it once `/diskussion` exists.

---

## Status (implementiert)

Stage 1 is **built and typecheck-clean**; 11/11 of its E2E tests pass. Nothing is
committed — pushing `main` deploys to production.

| Piece | Where |
|---|---|
| Schema: `topics`, `topic_posts`, `users.email_diskussion`, `users.email_digest` | `lib/schema.ts` |
| Board logic, recipients, depth-1 threading, subject normalisation | `lib/topics.ts` |
| API (all `requireModerator`) | `server/routes/topics.ts` → `/api/topics` |
| Inbound mail | `server/routes/inbound.ts` → `/api/inbound/:secret/diskussion` |
| Outbound fan-out, headers, retry sweep | `server/topic-mail.ts` |
| Mail template | `server/email-templates/topic-post.ts` |
| Pages (404 for non-moderators, `noindex`) | `app/routes/diskussion.tsx`, `app/routes/diskussion.$id.tsx` |
| E-Mail settings | `app/components/EmailSettingsCard.tsx`, `POST /api/profile/email` |
| Digest honours `email_digest` | `lib/sync.ts` |
| Retry sweep on the hourly job | `server/jobs.ts` |
| Tests | `tests/e2e/diskussion.spec.ts` |

### ⚠️ The repository is public

`marekventur/spielwoerter-website` is a **public** repo. Two values are
therefore env-only and must never be committed:

- `DISKUSSION_ADDRESS` — the obscure list address. Hardcoding it would defeat
  the entire point of choosing an unguessable one. Falls back to
  `moderatoren@<MAILGUN_DOMAIN>` for dev and tests.
- `INBOUND_SECRET` — the path secret on the inbound endpoint. Without it set,
  the endpoint 404s everything, which is the correct closed default.

The same applies to this plan file if it is ever committed: it deliberately
contains neither value.

### Deploy order

1. Commit and push → production deploys, `/diskussion` appears for moderators.
2. Confirm `INBOUND_SECRET` and `DISKUSSION_ADDRESS` are in the deployed `.env`.
3. **Then** create the Mailgun route (EU panel or API) forwarding the list
   address to `https://spielwoerter.de/api/inbound/<INBOUND_SECRET>/diskussion`.
   Creating it earlier just means inbound mail 404s.
4. Send one real mail to the list address and check it lands as a post.

The existing `catch_all()` → `marekventur@gmail.com` route stays and is **not**
given a `stop()`, so a copy of everything keeps arriving in Marek's inbox during
rollout. Turn that off later by adding `stop()` to the new route.

`spam_action` on `mail.spielwoerter.de` was changed from `disabled` to **`tag`**
on 2026-08-21, so Mailgun flags spam rather than dropping it and the inbound
handler can refuse flagged mail.

### Known limitations, deliberate

- **Attachments are ignored.** The multipart fallback parser skips file parts,
  and the notification mail says so in German.
- **`From:` is not authentication.** The moderator allowlist plus the path
  secret plus the spam flag are the layers; a determined spoofer who learns the
  list address could still post as a moderator. The `X-Mailgun-Sflag` and
  SPF/DKIM header names still want confirming against a real payload.
- **Running the E2E suite on the dev box needs two things** (both settled —
  corrected from an earlier wrong diagnosis of "Playwright does not support
  Ubuntu 26.04", which is a hardcoded platform allowlist in the pinned 1.58.2,
  not a real incompatibility; 1.62.1 in `~/tools/playwright` installs fine on
  this same box):

  1. Browsers, installed once with a platform override. The `-x64` suffix is
     required — the override replaces the whole platform string, so a bare
     `ubuntu24.04` fails differently. Install-time only; running needs no env
     var.

     ```
     PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64 npx playwright install chromium
     ```

  2. A free port. `TEST_PORT` is now overridable because the default 3005 is
     `wortopia-dev` under pm2 here, and the suite aborts before running a single
     test. **3014 is free on both boxes** (vps3 holds 3001–3011 + 3013; dev holds
     3003/3004/3005/3012):

     ```
     TEST_PORT=3014 npm run test:e2e
     ```

  `tests/e2e/diskussion.spec.ts` is still written to need no browser, which is
  worth keeping — it makes the board's own tests runnable anywhere in seconds.

---

## Stage 2 — mentions and word-comment notifications (later)

- `@Panikpilz` parsed on insert, resolved against `users.display_name` and the
  automatic `Besucher-<id>` form (`lib/screen-name.ts`). Addresses a screen
  name, never an email — what the screen-name system was for.
- A `notifications` table for word-comment activity with a **narrow** audience
  (people who commented on or suggested that word, plus the deciding
  moderator), batched onto the hourly job. Deliberately a different channel from
  `/diskussion`, with its own `email_*` column.

**Prerequisite, do it now:** set the moderators' `display_name` values in prod,
starting with `Panikpilz` for Robert — he asked on 10 Aug.

---

## Related but separate

Robert's underlying grievance is not communication: undoing a bad bulk removal
means restoring all 14 inflected forms of `rass` by hand, each with its own
comment. **No forum fixes that.** A bulk-undo for a `remove` cascade (or reusing
the Power-Edit CSV roundtrip for restores) is its own piece of work and is
arguably worth more to him than this plan.

---

## Testing

E2E in `tests/e2e/diskussion.spec.ts`, per repo convention (own server on 3005,
throwaway DB, 1 worker):

- create topic → reply → nested reply renders at depth 1
- `emailed_at` stamped; recipient list excludes the author
- `email_diskussion = 'none'` excludes a user; `'mine'` includes them only for
  threads they're in
- moderator hides a post → gone for others, visible to moderators
- **a logged-in non-moderator gets 404 on `/diskussion`, `/diskussion/:id` and
  every `/api/topics` endpoint**
- inbound: valid signature + moderator sender creates a post; bad signature,
  unknown sender, and non-moderator sender are all silently dropped

Assert on DB rows and on the computed recipient list, not on mail — the keys are
blanked in the test env and `mailEnabled()` is false, so nothing leaves the
process.
