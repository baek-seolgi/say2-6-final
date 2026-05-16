import type { CSSProperties, ReactNode } from "react";
import { useInView } from "./useInView";
import { cn } from "../../../lib/cn";

interface RevealProps {
  children: ReactNode;
  /** 시작 지연 (ms) */
  delay?: number;
  /** 추가 클래스 */
  className?: string;
  /** as 태그 (기본 div) */
  as?: "div" | "section" | "header" | "p" | "h2" | "h3";
}

/**
 * 뷰포트 진입 시 부드럽게 fade-up 등장
 */
export function Reveal({ children, delay = 0, className, as: Tag = "div" }: RevealProps) {
  const { ref, visible } = useInView<HTMLDivElement>();
  const style: CSSProperties = { animationDelay: `${delay}ms` };

  return (
    <Tag
      ref={ref as never}
      className={cn("reveal", visible && "is-visible", className)}
      style={style}
    >
      {children}
    </Tag>
  );
}
