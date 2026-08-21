import type { DigestUser } from "../lib/sync.js";
import { renderDigestHtml } from "./email-templates/digest.js";

/**
 * Who a mail can reach decides whether dev may send it.
 *
 * - `transactional` — only ever reaches the person who just triggered it
 *   (a login code they asked for). Dev may send these: there is nobody else to
 *   disturb, and swallowing them makes the dev site unusable for anyone but
 *   whoever can read the server log.
 * - `broadcast` — reaches other people (digest, /diskussion fan-out).
 *   Production only. The dev box runs the same .env with real Mailgun
 *   credentials, so without this a sync triggered from dev.spielwoerter.de
 *   would mail real users.
 *
 * The default is `broadcast`, so a future send path that forgets to say what it
 * is stays silent on dev rather than surprising someone.
 */
export type MailKind = "transactional" | "broadcast";

export function mailEnabled(kind: MailKind = "broadcast"): boolean {
  if (!process.env.MAILGUN_API_KEY || !process.env.MAILGUN_DOMAIN) return false;
  if (kind === "transactional") return true;
  return process.env.NODE_ENV === "production";
}

async function mailgunSend(
  to: string,
  subject: string,
  form: FormData,
  kind: MailKind = "broadcast"
): Promise<void> {
  if (!mailEnabled(kind)) {
    console.log(`[mail] Skipped (${kind}, not production): "${subject}" → ${to}`);
    return;
  }

  const apiUrl = process.env.MAILGUN_API_URL || "https://api.mailgun.net";
  const domain = process.env.MAILGUN_DOMAIN!;
  const apiKey = process.env.MAILGUN_API_KEY!;

  const response = await fetch(`${apiUrl}/v3/${domain}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`api:${apiKey}`).toString("base64")}`,
    },
    body: form,
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Mailgun ${response.status}: ${text}`);
  }
}

export async function sendDigestEmails(users: DigestUser[]): Promise<void> {
  if (users.length === 0) return;

  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";

  if (!mailEnabled()) {
    for (const u of users) {
      console.log(
        `[DEV] Digest für ${u.email}: +${u.approved.length} genehmigt, -${u.rejected.length} abgelehnt`
      );
    }
    return;
  }

  const from =
    process.env.MAILGUN_FROM || `Spielwörter <noreply@${domain}>`;

  for (const u of users) {
    const form = new FormData();
    form.append("from", from);
    form.append("to", u.email);
    form.append("subject", "Deine Spielwörter-Updates");
    form.append("html", renderDigestHtml(u, siteUrl));

    try {
      await mailgunSend(u.email, "Deine Spielwörter-Updates", form);
    } catch (err) {
      console.error(`[digest] Failed to send to ${u.email}:`, err);
    }
  }
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";
  const isProduction = process.env.NODE_ENV === "production";

  // Always log it too: without Mailgun credentials this is the only way in, and
  // with them it is still the fastest way to log in on a dev box.
  console.log(`[auth] OTP-Code für ${email}: ${code}`);

  if (!mailEnabled("transactional")) return;

  // A code from a dev box must be impossible to confuse with a real one — it
  // only works on that host, and its link points at that host.
  const subject = isProduction
    ? "Dein Spielwörter-Code"
    : "[DEV] Dein Spielwörter-Code";

  const from =
    process.env.MAILGUN_FROM || `Spielwörter <noreply@${domain}>`;
  const form = new FormData();
  form.append("from", from);
  form.append("to", email);
  form.append("subject", subject);
  form.append("template", "otp");
  form.append("t:variables", JSON.stringify({ code, site_url: siteUrl }));

  await mailgunSend(email, subject, form, "transactional");
}

/**
 * The moderator discussion list address.
 *
 * Deliberately env-configured and NOT hardcoded: this repository is public, and
 * the address being hard to guess is one of the layers protecting an inbound
 * endpoint that has no other way to know who is writing. The fallback is a
 * guessable default, which is fine for dev and tests (where nothing is sent).
 */
export function diskussionAddress(): string {
  const domain = process.env.MAILGUN_DOMAIN || "mail.spielwoerter.de";
  return process.env.DISKUSSION_ADDRESS || `moderatoren@${domain}`;
}

export type OutgoingMail = {
  subject: string;
  html: string;
  text: string;
  /** Raw RFC headers, sent through Mailgun's `h:` prefix. */
  headers?: Record<string, string>;
};

/**
 * One mail per recipient — never a shared To:/Cc:.
 *
 * A shared header would leak every moderator's address into every moderator's
 * mail client, which is the public-identity rule broken through the back door.
 * A mailing list hides that behind a list address; we do it by sending N times.
 */
export async function sendTopicPostEmails(
  recipients: string[],
  mail: OutgoingMail
): Promise<{ sent: number; failed: number }> {
  let sent = 0;
  let failed = 0;
  const from = `Spielwörter Moderation <${diskussionAddress()}>`;

  for (const to of recipients) {
    const form = new FormData();
    form.append("from", from);
    form.append("to", to);
    form.append("subject", mail.subject);
    form.append("html", mail.html);
    form.append("text", mail.text);
    for (const [key, value] of Object.entries(mail.headers ?? {})) {
      form.append(`h:${key}`, value);
    }
    try {
      await mailgunSend(to, mail.subject, form);
      sent++;
    } catch (err) {
      failed++;
      console.error(`[diskussion] Failed to send to ${to}:`, err);
    }
  }
  return { sent, failed };
}
