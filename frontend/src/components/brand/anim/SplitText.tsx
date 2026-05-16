import { useInView } from "./useInView";
import { cn } from "../../../lib/cn";

interface SplitTextProps {
  /** 표시할 텍스트 (줄바꿈은 \n으로) */
  text: string;
  /** 글자당 stagger 간격 (ms) */
  stagger?: number;
  /** 시작 지연 (ms) */
  delay?: number;
  /** 추가 클래스 */
  className?: string;
  /** 글자 그룹 단위로 분리할지 (true: 어절 단위, false: 글자 단위) */
  byWord?: boolean;
}

/**
 * 뷰포트 진입 시 글자(또는 어절) 하나하나 staggered animation으로 나타남
 *
 * 예시:
 *   <SplitText text="응급실의 AI 인턴" stagger={40} />
 */
export function SplitText({ text, stagger = 40, delay = 0, className, byWord = false }: SplitTextProps) {
  const { ref, visible } = useInView<HTMLSpanElement>();

  // 줄바꿈 보존, 단위 분리
  const lines = text.split("\n");

  return (
    <span ref={ref as never} className={cn("inline-block", className)}>
      {lines.map((line, lineIdx) => {
        const units = byWord ? line.split(" ") : Array.from(line);
        let charIndexInLine = 0;

        return (
          <span key={lineIdx} className="block">
            {units.map((unit, i) => {
              if (unit === " ") {
                return <span key={`${lineIdx}-${i}`} className="split-space" />;
              }

              // 어절 모드: 어절을 묶어서 한 단위로
              if (byWord) {
                const totalDelay = delay + charIndexInLine * stagger;
                charIndexInLine += unit.length;
                return (
                  <span key={`${lineIdx}-${i}`} className="inline-block mr-[0.25em]">
                    <span
                      className={cn("split-char", visible && "is-visible")}
                      style={{ animationDelay: `${totalDelay}ms` }}
                    >
                      {unit}
                    </span>
                  </span>
                );
              }

              // 글자 모드: 글자별 stagger
              const totalDelay = delay + charIndexInLine * stagger;
              charIndexInLine += 1;
              return (
                <span
                  key={`${lineIdx}-${i}`}
                  className={cn("split-char", visible && "is-visible")}
                  style={{ animationDelay: `${totalDelay}ms` }}
                >
                  {unit}
                </span>
              );
            })}
          </span>
        );
      })}
    </span>
  );
}
