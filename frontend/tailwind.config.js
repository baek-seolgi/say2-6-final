/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
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
      },
      fontFamily: {
        sans: [
          "Gulim", "굴림",
          "Dotum", "돋움",
          "Apple SD Gothic Neo",
          "맑은 고딕", "Malgun Gothic",
          "sans-serif",
        ],
        mono: [
          "Dotum", "돋움",
          "Consolas", "Menlo", "Monaco",
          "Courier New", "monospace",
        ],
      },
      boxShadow: {
        "card": "0 1px 2px rgba(17,24,39,0.04), 0 1px 3px rgba(17,24,39,0.06)",
      },
    },
  },
  plugins: [],
};
