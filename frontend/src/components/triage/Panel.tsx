// 카드 패널 — 회색 클래식 EMR 톤
import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

interface PanelProps {
  title: string;
  hotkey?: string;
  children: ReactNode;
  className?: string;
  headerRight?: ReactNode;
  dense?: boolean;
}

export default function Panel({
  title,
  hotkey,
  children,
  className,
  headerRight,
  dense = true,
}: PanelProps) {
  return (
    <section className={cn("bg-gray-50 border border-gray-400 flex flex-col overflow-hidden", className)}>
      <header className="bg-gray-200 border-b border-gray-400 px-3 py-1.5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="w-1 h-3.5 bg-gray-700" />
          <h3 className="text-[14px] font-bold text-gray-900 tracking-tight">{title}</h3>
          {hotkey && (
            <span className="ml-1 px-1.5 py-0 text-[10px] font-mono text-gray-700 border border-gray-400 bg-white">
              {hotkey}
            </span>
          )}
        </div>
        {headerRight}
      </header>
      <div className={cn(dense ? "p-3" : "p-4", "flex-1 bg-white")}>{children}</div>
    </section>
  );
}
