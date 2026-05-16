import { useEffect, useRef, useState } from "react";

interface Options {
  /** 화면에서 얼마나 보여야 발동 (0~1) */
  threshold?: number;
  /** 한 번만 실행할지 (스크롤 아래로 갈 때만) */
  once?: boolean;
  /** 진입 전 미리 margin (아래로 200px이면 "0px 0px 200px 0px") */
  rootMargin?: string;
}

/**
 * IntersectionObserver 기반 in-view 감지 훅
 * 요소가 뷰포트에 들어오면 visible=true
 */
export function useInView<T extends HTMLElement = HTMLDivElement>({
  threshold = 0.15,
  once = true,
  rootMargin = "0px 0px -100px 0px",
}: Options = {}) {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const obs = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          if (once) obs.disconnect();
        } else if (!once) {
          setVisible(false);
        }
      },
      { threshold, rootMargin },
    );

    obs.observe(el);
    return () => obs.disconnect();
  }, [threshold, once, rootMargin]);

  return { ref, visible };
}
