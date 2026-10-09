export type WordThreadMailData = {
  topicId: number;
  title: string;
  authorName: string;
  body: string;
  isNewTopic: boolean;
  /** Names of everyone who can see the thread besides the moderation. */
  participantNames: string[];
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

function intro(data: WordThreadMailData): string {
  return data.isNewTopic
    ? `${data.authorName} hat ein Gespräch mit dir begonnen:`
    : `${data.authorName} hat geschrieben:`;
}

function visibility(data: WordThreadMailData): string {
  return `Dieses Gespräch sehen nur die Moderation und ${data.participantNames.join(", ")}.`;
}

/** Single line, whatever the title holds: no header injection. */
export function wordThreadSubject(data: WordThreadMailData): string {
  const title = data.title.replace(/[\r\n]+/g, " ");
  return data.isNewTopic ? `[Spielwörter] ${title}` : `Re: [Spielwörter] ${title}`;
}

export function renderWordThreadHtml(data: WordThreadMailData, siteUrl: string): string {
  const link = `${siteUrl}/diskussion/${data.topicId}`;
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p style="margin:0 0 4px;font-size:13px;color:#6b7280">${escapeHtml(intro(data))}</p>
  <h1 style="margin:0 0 16px;font-size:19px;color:#111827">${escapeHtml(data.title)}</h1>
  ${paragraphs(data.body)}
  <p style="margin:24px 0 0;font-size:14px">
    <a href="${escapeHtml(link)}" style="color:#ea580c">Im Browser öffnen und antworten</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="margin:0 0 6px;font-size:12px;color:#6b7280">
    Du kannst auch einfach auf diese E-Mail antworten, deine Antwort erscheint dann im Gespräch.
    ${escapeHtml(visibility(data))}
  </p>
  <p style="margin:0;font-size:12px;color:#9ca3af">
    <a href="${escapeHtml(siteUrl)}/konto" style="color:#9ca3af">E-Mail-Einstellungen ändern</a>
  </p>
</div>`;
}

export function renderWordThreadText(data: WordThreadMailData, siteUrl: string): string {
  return [
    intro(data),
    data.title,
    "",
    data.body,
    "",
    `Im Browser öffnen: ${siteUrl}/diskussion/${data.topicId}`,
    "",
    "Du kannst auch einfach auf diese E-Mail antworten.",
    visibility(data),
    `E-Mail-Einstellungen: ${siteUrl}/konto`,
  ].join("\n");
}
