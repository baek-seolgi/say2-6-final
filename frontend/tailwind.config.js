/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        monitor: {
          bg: "#0a0f0a",
          grid: "#1a2a1a",
          wave: "#00e676",
          text: "#80cbc4",
        },
        clinical: {
          dark: "#0b1120",
          card: "#111827",
          border: "#1e2d3d",
        },
        // say-6 v2 디자인 토큰
        // 의료 표준 응급도 색
        critical: "#DC2626",
        urgent:   "#EA580C",
        warning:  "#CA8A04",
        normal:   "#16A34A",
        // say-6 브랜드 (AI 영역)
        brand: {
          50:  "#EEF2FF",
          100: "#E0E7FF",
          200: "#C7D2FE",
          300: "#A5B4FC",
          400: "#818CF8",
          500: "#6366F1",
          600: "#4F46E5",
          700: "#4338CA",
          800: "#3730A3",
          900: "#312E81",
        },
        ai: {
          accent: "#8B5CF6",   // violet-500
          bg:     "#F5F3FF",   // violet-50
          border: "#DDD6FE",   // violet-200
        },
        // VUNO 톤 (브랜드 사이트 다크 모드)
        vuno: {
          bg:      "#0F172A",   // 메인 배경 (Deep Navy / slate-900)
          surface: "#162439",   // 카드/섹션 배경
          elevated:"#1E3050",   // 호버/elevated 카드
          border:  "#1E3A5F",   // 외곽선
          divider: "#1A2A3F",   // 디바이더
          text:    "#FFFFFF",   // 본문 텍스트 (Main)
          muted:   "#94A3B8",   // 보조 텍스트 (Sub)
          dim:     "#64748B",   // 가장 흐린 텍스트
          // 시그니처 액센트 — Mint
          cyan:    "#2DD4BF",   // teal-400 (VUNO 톤)
          cyanDim: "#14B8A6",   // teal-500
          cyanGlow:"#5EEAD4",   // teal-300
        },
      },
      fontFamily: {
        sans: [
          "Gulim", "굴림",
          "Dotum", "돋움",
          "Apple SD Gothic Neo",
          "맑은 고딕", "Malgun Gothic",
          "sans-serif",
        ],
        // v2 — 모던 산세리프
        pretendard: [
          "Pretendard Variable", "Pretendard",
          "-apple-system", "BlinkMacSystemFont",
          "Apple SD Gothic Neo",
          "Noto Sans KR",
          "sans-serif",
        ],
        mono: [
          "Dotum", "돋움",
          "Consolas", "Menlo", "Monaco",
          "Courier New", "monospace",
        ],
        // v2 — 검사값 표기용
        numeric: [
          "JetBrains Mono", "SF Mono",
          "Consolas", "Menlo", "Monaco",
          "monospace",
        ],
      },
      boxShadow: {
        "card": "0 1px 2px rgba(17,24,39,0.04), 0 1px 3px rgba(17,24,39,0.06)",
        "card-hover": "0 4px 6px -1px rgba(17,24,39,0.1), 0 2px 4px -1px rgba(17,24,39,0.06)",
        "ai": "0 4px 12px -2px rgba(139, 92, 246, 0.15)",
      },
      keyframes: {
        "pulse-critical": {
          "0%, 100%": { boxShadow: "0 0 0 0 rgba(220, 38, 38, 0.5)" },
          "50%":      { boxShadow: "0 0 0 8px rgba(220, 38, 38, 0)" },
        },
        "ai-thinking": {
          "0%, 100%": { opacity: "0.4" },
          "50%":      { opacity: "1" },
        },
      },
      animation: {
        "pulse-critical": "pulse-critical 1.5s ease-in-out infinite",
        "ai-thinking":    "ai-thinking 1.4s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
