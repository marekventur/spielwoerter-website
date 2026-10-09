export type CommentReplyMailData = {
  word: string;
  moderatorName: string;
  originalComment: string;
  reply: string;
};

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function paragraphs(body: string, color: string): string {
  return body
    .split(/\n{2,}/)
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;color:${color}">${escapeHtml(
          p
        ).replace(/\n/g, "<br>")}</p>`
    )
    .join("");
}

function wordLink(word: string, siteUrl: string): string {
  return `${siteUrl}/wort/${encodeURIComponent(word.toUpperCase())}`;
}

export function commentReplySubject(word: string): string {
  return `Antwort auf deinen Kommentar zu ${word.toUpperCase()}`;
}

export function renderCommentReplyHtml(data: CommentReplyMailData, siteUrl: string): string {
  const link = wordLink(data.word, siteUrl);
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;padding:24px">
  <p style="margin:0 0 16px;font-size:13px;color:#6b7280">${escapeHtml(
    data.moderatorName
  )} aus der Moderation hat auf deinen Kommentar zu <strong>${escapeHtml(
    data.word.toUpperCase()
  )}</strong> geantwortet:</p>
  ${paragraphs(data.reply, "#1f2937")}
  <div style="margin:16px 0 0;padding-left:12px;border-left:3px solid #e5e7eb">
    <p style="margin:0 0 6px;font-size:12px;color:#9ca3af">Dein Kommentar:</p>
    ${paragraphs(data.originalComment, "#6b7280")}
  </div>
  <p style="margin:24px 0 0;font-size:14px">
    <a href="${escapeHtml(link)}" style="color:#ea580c">Zum Wort und antworten</a>
  </p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0 12px">
  <p style="margin:0;font-size:12px;color:#9ca3af">
    Antworten auf diese E-Mail kommen nicht an. Schreib einfach einen Kommentar auf der Wortseite.
  </p>
</div>`;
}

export function renderCommentReplyText(data: CommentReplyMailData, siteUrl: string): string {
  return [
    `${data.moderatorName} aus der Moderation hat auf deinen Kommentar zu ${data.word.toUpperCase()} geantwortet:`,
    "",
    data.reply,
    "",
    "Dein Kommentar:",
    data.originalComment,
    "",
    `Zum Wort und antworten: ${wordLink(data.word, siteUrl)}`,
    "",
    "Antworten auf diese E-Mail kommen nicht an. Schreib einfach einen Kommentar auf der Wortseite.",
  ].join("\n");
}
