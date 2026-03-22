export type VariantNotice = {
  word: string;
  reason: "in_list" | "rejected" | "in_review";
  description: string;
};

const REASON_COPY: Record<VariantNotice["reason"], string> = {
  in_list: "Dieses Wort ist bereits in der Wortliste (akzeptiert oder unsicher).",
  rejected: "Dieses Wort wurde zuvor abgelehnt.",
  in_review: "Dieses Wort steht bereits in Prüfung.",
};

type LlmVariantNoticesProps = {
  notices: VariantNotice[];
};

export function LlmVariantNotices({ notices }: LlmVariantNoticesProps) {
  if (notices.length === 0) return null;

  return (
    <div className="w-full max-w-lg space-y-3 pt-2 border-t border-gray-200">
      <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        Weitere erkannte Formen (kein Vorschlag nötig)
      </p>
      {notices.map((n) => (
        <div
          key={n.word}
          className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-left text-sm"
        >
          <p className="font-mono font-bold text-gray-800">{n.word.toUpperCase()}</p>
          <p className="text-gray-600 mt-1">{REASON_COPY[n.reason]}</p>
          {n.description ? (
            <p className="text-gray-500 text-xs mt-2 leading-relaxed">{n.description}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}
