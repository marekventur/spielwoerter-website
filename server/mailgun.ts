import type { DigestUser } from "../lib/sync.js";

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
};

async function mailgunSend(
  to: string,
  subject: string,
  form: FormData
): Promise<void> {
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

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";

  if (!apiKey || !domain) {
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
    const approved = u.approved.map(
      (s) => `${s.word.toUpperCase()} (${ACTION_LABELS[s.action] ?? s.action})`
    );
    const rejected = u.rejected.map(
      (s) => `${s.word.toUpperCase()} (${ACTION_LABELS[s.action] ?? s.action})`
    );

    const form = new FormData();
    form.append("from", from);
    form.append("to", u.email);
    form.append("subject", "Deine Spielwörter-Updates");
    form.append("template", "digest");
    form.append(
      "t:variables",
      JSON.stringify({
        approved: approved.map((w) => ({ word: w, action: "" })),
        rejected: rejected.map((w) => ({ word: w, action: "" })),
        site_url: siteUrl,
      })
    );

    try {
      await mailgunSend(u.email, "Deine Spielwörter-Updates", form);
    } catch (err) {
      console.error(`[digest] Failed to send to ${u.email}:`, err);
    }
  }
}

export async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const siteUrl = process.env.SITE_URL || "https://spielwoerter.de";

  if (!apiKey || !domain) {
    console.log(`[DEV] OTP-Code für ${email}: ${code}`);
    return;
  }

  const from =
    process.env.MAILGUN_FROM || `Spielwörter <noreply@${domain}>`;
  const form = new FormData();
  form.append("from", from);
  form.append("to", email);
  form.append("subject", "Dein Spielwörter-Code");
  form.append("template", "otp");
  form.append("t:variables", JSON.stringify({ code, site_url: siteUrl }));

  await mailgunSend(email, "Dein Spielwörter-Code", form);
}
