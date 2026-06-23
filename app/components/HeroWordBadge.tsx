import { Check, X } from "lucide-react";
import type { WordBadgeStatus } from "./WordBadge";

interface HeroWordBadgeProps {
  word: string;
  status: WordBadgeStatus;
}

const statusConfig: Record<
  WordBadgeStatus,
  {
    bg: string;
    text: string;
    icon: React.ReactNode;
    message: string;
  }
> = {
  accepted: {
    bg: "bg-green-100 border-green-300",
    text: "text-green-800",
    icon: <Check className="w-6 h-6" />,
    message: "Im Wörterbuch enthalten",
  },
  "not-accepted": {
    bg: "bg-gray-100 border-gray-300",
    text: "text-gray-700",
    icon: <X className="w-6 h-6" />,
    message: "Noch nicht im Wörterbuch",
  },
  rejected: {
    bg: "bg-red-100 border-red-300",
    text: "text-red-800",
    icon: <X className="w-6 h-6" />,
    message: "Nicht gültig",
  },
  uncertain: {
    bg: "bg-amber-100 border-amber-300",
    text: "text-amber-800",
    icon: null,
    message: "Status unsicher",
  },
  "pending-add": {
    bg: "bg-blue-100 border-blue-300",
    text: "text-blue-800",
    icon: null,
    message: "Hinzufügen vorgeschlagen",
  },
  "pending-remove": {
    bg: "bg-orange-100 border-orange-300",
    text: "text-orange-800",
    icon: null,
    message: "Entfernen vorgeschlagen",
  },
};

export function HeroWordBadge({ word, status }: HeroWordBadgeProps) {
  const config = statusConfig[status];

  return (
    <div
      className={`inline-flex flex-col items-center gap-3 rounded-2xl border-2 font-bold ${config.bg} ${config.text} px-8 py-6`}
    >
      <div className="flex items-center gap-3">
        {config.icon}
        <span className="text-sm font-semibold uppercase tracking-wide">
          {config.message}
        </span>
      </div>
      <span className="text-6xl">{word}</span>
    </div>
  );
}
