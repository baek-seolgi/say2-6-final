import { cn } from "../../lib/cn";
import type { KTAS } from "../../types/triage";

const KTAS_STYLES: Record<KTAS, { bg: string; label: string }> = {
  1: { bg: "bg-blue-600 text-white",   label: "소생" },
  2: { bg: "bg-red-600 text-white",    label: "긴급" },
  3: { bg: "bg-amber-500 text-white",  label: "응급" },
  4: { bg: "bg-emerald-600 text-white", label: "준응급" },
  5: { bg: "bg-slate-400 text-white",  label: "비응급" },
};

interface KtasBadgeProps {
  level: KTAS;
  showLabel?: boolean;
  size?: "sm" | "md" | "lg";
  className?: string;
}

export function KtasBadge({ level, showLabel = true, size = "md", className }: KtasBadgeProps) {
  const style = KTAS_STYLES[level];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md font-semibold",
        style.bg,
        size === "sm" && "px-1.5 py-0.5 text-xs",
        size === "md" && "px-2 py-1 text-xs",
        size === "lg" && "px-3 py-1.5 text-sm",
        className,
      )}
    >
      <span>KTAS-{level}</span>
      {showLabel && <span className="opacity-90">{style.label}</span>}
    </span>
  );
}
