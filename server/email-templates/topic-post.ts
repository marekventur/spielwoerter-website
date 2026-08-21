export type TopicPostMailData = {
  topicId: number;
  title: string;
  authorName: string;
  body: string;
  isNewTopic: boolean;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphs(body: string): string {
  return body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:#1f2937">${escapeHtml(
          p
        ).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

export function renderTopicPostHtml(
  data: TopicPostMailData,
  siteUrl: string
): string {
  const link = `${siteUrl}/diskussion/${data.topicId}`;
  const intro = data.isNewTopic
    ? `${escapeHtml(data.authorName)} hat ein neues Thema begonnen:`
    : `${escapeHtml(data.authorName)} hat geschrieben:`;

  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p style="margin:0 0 4px;font-size:13px;color:#6b7280">${intro}</p>
  <h1 style="margin:0 0 16px;font-size:19px;color:#111827">${escapeHtml(data.title)}</h1>
  ${paragraphs(data.body)}
  <p style="margin:24px 0 0;font-size:14px">
    <a href="${escapeHtml(link)}" style="color:#ea580c">Im Browser öffnen und antworten</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="margin:0 0 6px;font-size:12px;color:#6b7280">
    Du kannst auch einfach auf diese E-Mail antworten — deine Antwort erscheint
    dann im Thema. Anhänge werden dabei noch nicht übernommen.
  </p>
  <p style="margin:0;font-size:12px;color:#9ca3af">
    Diese Nachricht geht an alle Moderator:innen.
    <a href="${escapeHtml(siteUrl)}/konto" style="color:#9ca3af">E-Mail-Einstellungen ändern</a>
  </p>
</div>`;
}

export function renderTopicPostText(
  data: TopicPostMailData,
  siteUrl: string
): string {
  const intro = data.isNewTopic
    ? `${data.authorName} hat ein neues Thema begonnen:`
    : `${data.authorName} hat geschrieben:`;
  return [
    intro,
    data.title,
    "",
    data.body,
    "",
    `Im Browser öffnen: ${siteUrl}/diskussion/${data.topicId}`,
    "",
    "Du kannst auch einfach auf diese E-Mail antworten.",
    `E-Mail-Einstellungen: ${siteUrl}/konto`,
  ].join("\n");
}
