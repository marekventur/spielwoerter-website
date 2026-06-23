import { Check, X } from "lucide-react";

export type WordBadgeStatus =
  | "accepted"
  | "not-accepted"
  | "rejected"
  | "uncertain"
  | "pending-add"
  | "pending-remove";

interface WordBadgeProps {
  word: string;
  status: WordBadgeStatus;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
}

export function WordBadge({
  word,
  status,
  size = "md",
  onClick,
}: WordBadgeProps) {
  const sizeClasses = {
    sm: "text-sm px-2 py-1",
    md: "text-base px-3 py-1.5",
    lg: "text-2xl px-4 py-2",
  };

  const statusConfig: Record<
    WordBadgeStatus,
    {
      bg: string;
      text: string;
      icon: React.ReactNode;
    }
  > = {
    accepted: {
      bg: "bg-green-100 border-green-300",
      text: "text-green-800",
      icon: (
        <Check
          className={
            size === "lg" ? "w-6 h-6" : size === "md" ? "w-4 h-4" : "w-3 h-3"
          }
        />
      ),
    },
    "not-accepted": {
      bg: "bg-gray-100 border-gray-300",
      text: "text-gray-700",
      icon: (
        <X
          className={
            size === "lg" ? "w-6 h-6" : size === "md" ? "w-4 h-4" : "w-3 h-3"
          }
        />
      ),
    },
    rejected: {
      bg: "bg-red-100 border-red-300",
      text: "text-red-800",
      icon: (
        <X
          className={
            size === "lg" ? "w-6 h-6" : size === "md" ? "w-4 h-4" : "w-3 h-3"
          }
        />
      ),
    },
    uncertain: {
      bg: "bg-amber-100 border-amber-300",
      text: "text-amber-800",
      icon: null,
    },
    "pending-add": {
      bg: "bg-blue-100 border-blue-300",
      text: "text-blue-800",
      icon: null,
    },
    "pending-remove": {
      bg: "bg-orange-100 border-orange-300",
      text: "text-orange-800",
      icon: null,
    },
  };

  const config = statusConfig[status];

  return (
    <div
      className={`inline-flex items-baseline gap-2 rounded-lg border-2 font-bold ${config.bg} ${config.text} ${sizeClasses[size]} ${onClick ? "cursor-pointer hover:opacity-80 transition-opacity" : ""}`}
      onClick={onClick}
      role={onClick ? "button" : undefined}
    >
      {config.icon}
      <span>{word}</span>
    </div>
  );
}
