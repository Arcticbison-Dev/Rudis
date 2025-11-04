import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";

interface StatusBadgeProps {
  status: string;
  className?: string;
}

const statusConfig = {
  pending: {
    label: "Pending",
    color: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    pulse: true,
  },
  paid: {
    label: "Paid",
    color: "bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800",
    pulse: false,
  },
  expired: {
    label: "Expired",
    color: "bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700",
    pulse: false,
  },
};

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = statusConfig[status as keyof typeof statusConfig] || statusConfig.pending;

  return (
    <Badge
      className={`${config.color} rounded-full px-3 py-1 text-xs font-medium uppercase tracking-wide border ${className || ""}`}
    >
      <Circle
        className={`w-2 h-2 mr-2 fill-current ${config.pulse ? "animate-pulse" : ""}`}
      />
      {config.label}
    </Badge>
  );
}
