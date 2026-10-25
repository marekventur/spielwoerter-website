import type Database from "better-sqlite3";

/**
 * Guards on outgoing mail, which is what our sending reputation rides on.
 *
 * request-code mails a login code to any address typed into /login — signup
 * and login are the same path. Bots abuse exactly that (seen on another site
 * of ours): strangers' real addresses submitted from rotating IPs, so the
 * per-IP rate limit never trips, and the recipients mark the unasked-for codes
 * as spam. Two caps, both persisted so a restart does not reset them:
 *
 * - per address: OTP_PER_ADDRESS_PER_DAY codes in any rolling 24 h.
 * - globally: OTP_NEW_ADDRESSES_PER_DAY codes per UTC day to addresses without
 *   an account. Existing users are never affected by this one.
 *
 * Both apply in every environment: the dev box sends login codes through the
 * same Mailgun domain as production (see server/mailgun.ts).
 */
export const OTP_PER_ADDRESS_PER_DAY = 5;
export const OTP_NEW_ADDRESSES_PER_DAY = 30;

export type OtpOutcome = "sent" | "address_cap" | "global_cap";

/**
 * The address a cap counts against: lower-cased, with any +tag removed, so
 * Foo+1@x and foo+2@x share one budget — they reach the same inbox.
 */
export function otpAddressKey(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;
  return lower.slice(0, at).replace(/\+.*$/, "") + lower.slice(at);
}

/** "m***@example.com" — enough to recognise a pattern in the log, not to harvest it. */
export function maskEmail(email: string): string {
  const at = email.lastIndexOf("@");
  if (at < 1) return "***";
  return `${email[0]}***${email.slice(at)}`;
}

/**
 * Decide whether a login code may go out to `email`, and record the request.
 * Only "sent" requests count towards the caps, so a capped address recovers
 * 24 h after its first code instead of being locked out for as long as a bot
 * keeps hammering it.
 */
export function recordOtpRequest(db: Database.Database, email: string): OtpOutcome {
  const key = otpAddressKey(email);
  const hasAccount = !!db
    .prepare("SELECT 1 FROM users WHERE email = ? COLLATE NOCASE")
    .get(email.trim());

  return db.transaction((): OtpOutcome => {
    db.prepare("DELETE FROM otp_requests WHERE created_at < datetime('now', '-7 days')").run();

    const forAddress = (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM otp_requests
            WHERE email_key = ? AND outcome = 'sent'
              AND created_at > datetime('now', '-24 hours')`
        )
        .get(key) as { n: number }
    ).n;

    let outcome: OtpOutcome = "sent";
    if (forAddress >= OTP_PER_ADDRESS_PER_DAY) {
      outcome = "address_cap";
    } else if (!hasAccount) {
      // date('now') is today's UTC midnight; created_at strings compare lexically.
      const newToday = (
        db
          .prepare(
            `SELECT COUNT(*) AS n FROM otp_requests
              WHERE has_account = 0 AND outcome = 'sent' AND created_at >= date('now')`
          )
          .get() as { n: number }
      ).n;
      if (newToday >= OTP_NEW_ADDRESSES_PER_DAY) outcome = "global_cap";
    }

    db.prepare(
      "INSERT INTO otp_requests (email_key, has_account, outcome) VALUES (?, ?, ?)"
    ).run(key, hasAccount ? 1 : 0, outcome);
    return outcome;
  })();
}

/**
 * True the first time `kind` is claimed on a UTC day, false after that — so an
 * owner alert fires once per attack-day, not once per blocked request.
 */
export function claimDailyAlert(db: Database.Database, kind: string): boolean {
  return (
    db
      .prepare("INSERT OR IGNORE INTO daily_alerts (kind, day) VALUES (?, date('now'))")
      .run(kind).changes === 1
  );
}

// ── Suppression list ────────────────────────────────────────────────────────

export function isSuppressed(db: Database.Database, email: string): boolean {
  return !!db
    .prepare("SELECT 1 FROM mail_suppressions WHERE email = ?")
    .get(email.trim().toLowerCase());
}

/** Returns true when the address was newly added. */
export function suppressAddress(
  db: Database.Database,
  email: string,
  reason: string | null,
  source: "mailgun" | "manual"
): boolean {
  return (
    db
      .prepare("INSERT OR IGNORE INTO mail_suppressions (email, reason, source) VALUES (?, ?, ?)")
      .run(email.trim().toLowerCase(), reason, source).changes === 1
  );
}

export function unsuppressAddress(db: Database.Database, email: string): boolean {
  return (
    db
      .prepare("DELETE FROM mail_suppressions WHERE email = ?")
      .run(email.trim().toLowerCase()).changes === 1
  );
}

/** One `failed` / `severity=permanent` event from Mailgun's events API. */
export type PermanentFailure = {
  recipient: string;
  /** Mailgun's classification: bounce, suppress-bounce, generic, espblock, … */
  reason: string;
  messageId: string;
  description: string;
};

/**
 * Mailgun has already judged these undeliverable (a real bounce, or an address
 * on its own bounce/complaint list), so one is enough.
 */
const SUPPRESS_ON_FIRST = new Set(["bounce", "suppress-bounce", "suppress-complaint"]);

/**
 * Turn permanent failures into suppressions. Anything Mailgun calls a bounce
 * suppresses at once; any other permanent failure (e.g. "550 Relaying denied",
 * which Mailgun files as `generic` and keeps retrying on every digest) needs
 * two different messages to fail, so a single content-based rejection cannot
 * silence a real user. Returns how many addresses were newly suppressed.
 */
export function applyPermanentFailures(
  db: Database.Database,
  failures: PermanentFailure[]
): number {
  const byAddress = new Map<string, { messages: Set<string>; first: boolean; reason: string }>();
  for (const f of failures) {
    const email = f.recipient.trim().toLowerCase();
    const entry = byAddress.get(email) ?? { messages: new Set(), first: false, reason: "" };
    entry.messages.add(f.messageId);
    entry.first ||= SUPPRESS_ON_FIRST.has(f.reason);
    entry.reason = `${f.reason}: ${f.description}`.slice(0, 200);
    byAddress.set(email, entry);
  }

  let added = 0;
  db.transaction(() => {
    for (const [email, e] of byAddress) {
      if (!e.first && e.messages.size < 2) continue;
      if (suppressAddress(db, email, e.reason, "mailgun")) added++;
    }
  })();
  return added;
}
