import type { DigestUser } from "../../lib/sync.js";

const ACTION_LABELS: Record<string, string> = {
  add: "Hinzufügen",
  remove: "Entfernen",
  change_description: "Beschreibung ändern",
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function approvedItem(item: DigestUser["approved"][number]): string {
  const action = ACTION_LABELS[item.action] ?? item.action;
  let html = `${escapeHtml(item.word.toUpperCase())} <span style="color:#6b7280">(${escapeHtml(action)})</span>`;
  if (item.changed) {
    const details: string[] = [];
    if (item.description) details.push(escapeHtml(item.description));
    if (item.base) details.push(`Grundform: ${escapeHtml(item.base)}`);
    html += `<br><span style="color:#b45309;font-size:13px">Mit Anpassungen angenommen${details.length > 0 ? `: ${details.join(" · ")}` : ""}</span>`;
  }
  return `<li style="margin-bottom:6px;font-size:14px;color:#1f2937">${html}</li>`;
}

function rejectedItem(item: DigestUser["rejected"][number]): string {
  const action = ACTION_LABELS[item.action] ?? item.action;
  let html = `${escapeHtml(item.word.toUpperCase())} <span style="color:#6b7280">(${escapeHtml(action)})</span>`;
  if (item.comment) {
    html += `<br><span style="color:#6b7280;font-size:13px">Kommentar der Moderation: ${escapeHtml(item.comment)}</span>`;
  }
  return `<li style="margin-bottom:6px;font-size:14px;color:#1f2937">${html}</li>`;
}

export function renderDigestHtml(user: DigestUser, siteUrl: string): string {
  const site = escapeHtml(siteUrl);

  const approvedSection =
    user.approved.length > 0
      ? `<h2 style="margin:0 0 8px;font-size:14px;font-weight:700;color:#15803d;text-transform:uppercase;letter-spacing:0.05em">&#10003; Angenommen</h2>
         <ul style="margin:0 0 20px;padding-left:20px">${user.approved.map(approvedItem).join("")}</ul>`
      : "";

  const rejectedSection =
    user.rejected.length > 0
      ? `<h2 style="margin:0 0 8px;font-size:14px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em">&#10007; Abgelehnt</h2>
         <ul style="margin:0 0 20px;padding-left:20px">${user.rejected.map(rejectedItem).join("")}</ul>`
      : "";

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Deine Spielwörter-Updates</title>
</head>
<body style="margin:0;padding:0;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#1f2937">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;padding:40px 16px">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border-radius:16px;border:1px solid #e5e7eb;overflow:hidden">

          <!-- Header -->
          <tr>
            <td style="padding:32px 40px 24px;text-align:center">
              <span style="display:inline-flex;gap:6px;vertical-align:middle">
                <span style="display:inline-block;width:40px;height:40px;background:#f97316;border-radius:8px;text-align:center;line-height:40px;color:#ffffff;font-weight:700;font-size:20px">S</span>
                <span style="display:inline-block;width:40px;height:40px;background:#fb923c;border-radius:8px;text-align:center;line-height:40px;color:#ffffff;font-weight:700;font-size:20px">W</span>
              </span>
              <p style="margin:12px 0 0;font-size:13px;color:#9ca3af;letter-spacing:0.05em;text-transform:uppercase">Spielwoerter.de</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding:0 40px 32px">
              <h1 style="margin:0 0 8px;font-size:20px;font-weight:700;color:#111827">Deine Spielwörter-Updates</h1>
              <p style="margin:0 0 24px;font-size:15px;color:#6b7280;line-height:1.5">Hier ist die Übersicht zu deinen Vorschlägen.</p>

              ${approvedSection}
              ${rejectedSection}

              <a href="${site}/meine-vorschlaege"
                 style="display:inline-block;margin-top:8px;padding:10px 20px;background:#f97316;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">
                Meine Vorschläge ansehen
              </a>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 40px;background:#f9fafb;border-top:1px solid #e5e7eb;text-align:center">
              <a href="${site}" style="color:#ea580c;text-decoration:none;font-size:13px">${site}</a>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`;
}
