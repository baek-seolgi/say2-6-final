import { Activity, Image as ImageIcon, FlaskConical, BrainCircuit } from "lucide-react";

/**
 * 멀티모달 AI 강조 — AI(중앙)를 중심으로 3개 모달이 둘러싸는 구조
 *
 * 필요한 이미지 파일 (frontend/public/):
 *   - ai-brain.jpg    (중앙 AI 두뇌)
 *   - ecg-wave.jpg    (위 ECG 파형)
 *   - cxr-image.jpg   (우하 CXR + 히트맵)
 *   - lab-monitor.jpg (좌하 LAB 모니터, 없으면 Unsplash fallback)
 */
export function MultiModalShowcase() {
  return (
    <div className="relative w-full aspect-square max-w-[600px] mx-auto">
      {/* 외곽 회전 궤도 링 (점선) */}
      <OrbitRing />

      {/* 가운데로 향하는 연결선 SVG */}
      <ConnectorLines />

      {/* AI 중앙 — 가장 큼 */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30">
        <AICenter />
      </div>

      {/* ECG — 12시 (위) · 빨강 (심혈관) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20">
        <ModalCard src="/ecg.jpg" icon={Activity} label="ECG" tone="red" />
      </div>

      {/* CXR — 4-5시 (우하) · 하늘색 (영상의학) */}
      <div className="absolute bottom-[2%] right-[2%] z-20">
        <ModalCard src="/CXR.jpeg" icon={ImageIcon} label="CXR" tone="sky" />
      </div>

      {/* LAB — 7-8시 (좌하) · 초록 (검사) */}
      <div className="absolute bottom-[2%] left-[2%] z-20">
        <ModalCard src="/lab.jpeg" icon={FlaskConical} label="LAB" tone="green" />
      </div>

      {/* 하단 캡션 — Multi-Modal AI (강조) */}
      <div className="absolute -bottom-20 left-1/2 -translate-x-1/2 whitespace-nowrap z-40">
        <div className="relative">
          {/* 글로우 백드롭 */}
          <div className="absolute -inset-3 bg-vuno-cyan/30 blur-2xl rounded-full" />
          <div className="relative inline-flex items-center gap-2 px-5 py-2.5 bg-vuno-bg border-2 border-vuno-cyan shadow-[0_0_30px_rgba(33,212,212,0.5)]">
            <BrainCircuit className="h-5 w-5 text-white flex-shrink-0" />
            <span className="text-sm font-bold text-white tracking-[0.2em] uppercase">
              Multi-Modal AI
            </span>
            <span className="text-white">·</span>
            <span className="text-xs font-bold text-white tracking-[0.15em] uppercase">
              3 Modalities
            </span>
            <span className="text-white">→</span>
            <span className="text-xs font-bold text-white tracking-[0.15em] uppercase">
              1 Diagnosis
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   외곽 점선 궤도 링 (천천히 회전)
   ───────────────────────────────────────────────────────── */
function OrbitRing() {
  return (
    <>
      {/* 큰 외곽 링 */}
      <div
        className="absolute inset-[6%] rounded-full border border-dashed border-vuno-cyan/30 pointer-events-none"
        style={{ animation: "rotate-slow 40s linear infinite" }}
      />
      {/* 작은 내곽 링 (반대 방향) */}
      <div
        className="absolute inset-[22%] rounded-full border border-dashed border-vuno-cyan/20 pointer-events-none"
        style={{ animation: "rotate-slow-reverse 30s linear infinite" }}
      />
      {/* 외곽 글로우 */}
      <div className="absolute inset-[10%] rounded-full bg-vuno-cyan/5 blur-3xl pointer-events-none" />

      <style>{`
        @keyframes rotate-slow {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
        @keyframes rotate-slow-reverse {
          from { transform: rotate(360deg); }
          to   { transform: rotate(0deg); }
        }
      `}</style>
    </>
  );
}

/* ─────────────────────────────────────────────────────────
   가운데로 향하는 3방향 연결선 + 흐르는 펄스 점 (각 모달 색상)
   ───────────────────────────────────────────────────────── */
function ConnectorLines() {
  // ECG=빨강, CXR=하늘, LAB=초록
  return (
    <svg viewBox="0 0 100 100" className="absolute inset-0 w-full h-full pointer-events-none z-10" preserveAspectRatio="none">
      <defs>
        <linearGradient id="line-ecg" x1="50%" y1="0%" x2="50%" y2="100%">
          <stop offset="0%" stopColor="#F87171" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#F87171" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#F87171" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="line-cxr" x1="100%" y1="100%" x2="0%" y2="0%">
          <stop offset="0%" stopColor="#38BDF8" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#38BDF8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#38BDF8" stopOpacity="0.1" />
        </linearGradient>
        <linearGradient id="line-lab" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#34D399" stopOpacity="0.1" />
          <stop offset="50%" stopColor="#34D399" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#34D399" stopOpacity="0.1" />
        </linearGradient>
      </defs>

      {/* ECG (위 → 중앙) — 빨강 */}
      <line x1="50" y1="15" x2="50" y2="40" stroke="url(#line-ecg)" strokeWidth="0.4" />
      {/* CXR (우하 → 중앙) — 하늘 */}
      <line x1="82" y1="82" x2="60" y2="60" stroke="url(#line-cxr)" strokeWidth="0.4" />
      {/* LAB (좌하 → 중앙) — 초록 */}
      <line x1="18" y1="82" x2="40" y2="60" stroke="url(#line-lab)" strokeWidth="0.4" />

      {/* 흐르는 펄스 점 — 각 모달 색상 */}
      <circle r="0.9" fill="#F87171" filter="drop-shadow(0 0 3px #F87171)">
        <animateMotion dur="2s" repeatCount="indefinite" path="M 50,15 L 50,40" />
      </circle>
      <circle r="0.9" fill="#38BDF8" filter="drop-shadow(0 0 3px #38BDF8)">
        <animateMotion dur="2.5s" repeatCount="indefinite" path="M 82,82 L 60,60" />
      </circle>
      <circle r="0.9" fill="#34D399" filter="drop-shadow(0 0 3px #34D399)">
        <animateMotion dur="2.2s" repeatCount="indefinite" path="M 18,82 L 40,60" />
      </circle>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   AI 중앙 — 두뇌 + "AI" 글씨, 회로/펄스 강조 (이미지 없음)
   ───────────────────────────────────────────────────────── */
function AICenter() {
  return (
    <div className="relative">
      {/* 외곽 펄스 글로우 (3겹) */}
      <div className="absolute -inset-12 bg-vuno-cyan/15 blur-3xl rounded-full animate-pulse" />
      <div className="absolute -inset-6  bg-vuno-cyan/25 blur-2xl rounded-full" />
      <div className="absolute -inset-2  bg-vuno-cyan/20 blur-xl rounded-full" />

      {/* 메인 원형 */}
      <div className="relative h-[42vw] w-[42vw] md:h-[240px] md:w-[240px] max-h-[280px] max-w-[280px] rounded-full bg-vuno-bg overflow-hidden shadow-[0_0_80px_rgba(33,212,212,0.7)]">
        {/* 회로 SVG 배경 (사용자가 준 두뇌 이미지 느낌) */}
        <BrainCircuitBackground />

        {/* 외곽 시안 링 (2겹) */}
        <span className="absolute inset-0 rounded-full border-2 border-vuno-cyan pointer-events-none" />
        <span className="absolute inset-3 rounded-full border border-vuno-cyan/40 pointer-events-none" />

        {/* 중앙 콘텐츠 */}
        <div className="absolute inset-0 grid place-items-center">
          <div className="text-center">
            {/* 두뇌 아이콘 (흰색 + 시안 글로우) */}
            <BrainCircuit
              className="h-14 w-14 md:h-20 md:w-20 mx-auto text-white mb-2"
              style={{ filter: "drop-shadow(0 0 12px rgba(33, 212, 212, 0.8))" }}
              strokeWidth={1.5}
            />

            {/* AI 글씨 — 흰색 + 시안 글로우 */}
            <div
              className="text-4xl md:text-6xl font-bold text-white tracking-[0.15em] font-numeric leading-none"
              style={{
                textShadow: "0 0 24px rgba(33, 212, 212, 0.9), 0 0 8px rgba(33, 212, 212, 1)",
              }}
            >
              AI
            </div>

            {/* 라벨 — 흰색 텍스트 + 시안 외곽 */}
            <div className="mt-3 inline-block px-2.5 py-0.5 border border-vuno-cyan bg-vuno-bg/80 shadow-[0_0_8px_rgba(33,212,212,0.4)]">
              <span className="text-[9px] md:text-[10px] font-bold text-white tracking-[0.25em] uppercase">
                Multi-Modal
              </span>
            </div>
          </div>
        </div>

        {/* 회전하는 점선 외곽 링 */}
        <span
          className="absolute inset-[-8px] rounded-full border-2 border-dashed border-vuno-cyan/30 pointer-events-none"
          style={{ animation: "rotate-slow 25s linear infinite" }}
        />
      </div>
    </div>
  );
}

/**
 * AI 두뇌 회로 SVG 배경 — 사용자가 준 두뇌 이미지의 회로 패턴 느낌
 * 두뇌 외곽선 + 회로 라인 + 빛나는 노드
 */
function BrainCircuitBackground() {
  return (
    <svg
      viewBox="0 0 200 200"
      className="absolute inset-0 w-full h-full"
      style={{ opacity: 0.5 }}
    >
      <defs>
        <radialGradient id="bg-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#21D4D4" stopOpacity="0.3" />
          <stop offset="60%" stopColor="#0A1929" stopOpacity="0.4" />
          <stop offset="100%" stopColor="#0A1929" stopOpacity="0.95" />
        </radialGradient>
      </defs>

      {/* 배경 글로우 */}
      <circle cx="100" cy="100" r="100" fill="url(#bg-glow)" />

      {/* 두뇌 외곽선 (좌·우 반구) */}
      <g stroke="#21D4D4" strokeWidth="0.6" fill="none" opacity="0.7">
        {/* 좌반구 */}
        <path d="M 100 60 Q 70 55, 55 75 Q 45 90, 50 110 Q 55 130, 75 140 Q 90 145, 100 140 Z" />
        <path d="M 70 75 Q 60 85, 65 100" />
        <path d="M 60 110 Q 70 115, 80 110" />
        <path d="M 78 90 Q 85 100, 78 115" />
        {/* 우반구 */}
        <path d="M 100 60 Q 130 55, 145 75 Q 155 90, 150 110 Q 145 130, 125 140 Q 110 145, 100 140 Z" />
        <path d="M 130 75 Q 140 85, 135 100" />
        <path d="M 140 110 Q 130 115, 120 110" />
        <path d="M 122 90 Q 115 100, 122 115" />
      </g>

      {/* 회로 라인 (두뇌 바깥쪽으로 뻗는) */}
      <g stroke="#21D4D4" strokeWidth="0.4" fill="none" opacity="0.4">
        <path d="M 100 60 L 100 30 L 130 30" />
        <path d="M 100 60 L 100 30 L 70 30" />
        <path d="M 50 110 L 25 110 L 25 130" />
        <path d="M 150 110 L 175 110 L 175 130" />
        <path d="M 75 140 L 75 170 L 100 170" />
        <path d="M 125 140 L 125 170 L 100 170" />
      </g>

      {/* 빛나는 노드 (회로 끝점) */}
      {[
        [100, 30], [130, 30], [70, 30],
        [25, 130], [175, 130],
        [75, 170], [125, 170], [100, 170],
        [55, 75], [145, 75],
      ].map(([x, y], i) => (
        <circle
          key={i}
          cx={x} cy={y} r="1.5"
          fill="#21D4D4"
          opacity="0.8"
          style={{
            animation: `pulse-node 2s ease-in-out infinite ${i * 0.2}s`,
          }}
        />
      ))}

      <style>{`
        @keyframes pulse-node {
          0%, 100% { opacity: 0.3; r: 1; }
          50%      { opacity: 1;   r: 2; }
        }
      `}</style>
    </svg>
  );
}

/* ─────────────────────────────────────────────────────────
   모달 카드 (위/좌하/우하 3개 위성)
   ───────────────────────────────────────────────────────── */
type Tone = "red" | "sky" | "green" | "cyan";

const TONE_STYLES: Record<Tone, {
  border: string;
  borderHover: string;
  shadow: string;
  text: string;
  dotBg: string;
  dotShadow: string;
  labelShadow: string;
}> = {
  red: {
    border:      "border-red-400/60",
    borderHover: "hover:border-red-400",
    shadow:      "shadow-[0_10px_30px_-10px_rgba(248,113,113,0.5)]",
    text:        "text-red-400",
    dotBg:       "bg-red-400",
    dotShadow:   "shadow-[0_0_8px_rgba(248,113,113,0.9)]",
    labelShadow: "shadow-[0_0_8px_rgba(248,113,113,0.5)]",
  },
  sky: {
    border:      "border-sky-400/60",
    borderHover: "hover:border-sky-400",
    shadow:      "shadow-[0_10px_30px_-10px_rgba(56,189,248,0.5)]",
    text:        "text-sky-400",
    dotBg:       "bg-sky-400",
    dotShadow:   "shadow-[0_0_8px_rgba(56,189,248,0.9)]",
    labelShadow: "shadow-[0_0_8px_rgba(56,189,248,0.5)]",
  },
  green: {
    border:      "border-emerald-400/60",
    borderHover: "hover:border-emerald-400",
    shadow:      "shadow-[0_10px_30px_-10px_rgba(52,211,153,0.5)]",
    text:        "text-emerald-400",
    dotBg:       "bg-emerald-400",
    dotShadow:   "shadow-[0_0_8px_rgba(52,211,153,0.9)]",
    labelShadow: "shadow-[0_0_8px_rgba(52,211,153,0.5)]",
  },
  cyan: {
    border:      "border-vuno-cyan/60",
    borderHover: "hover:border-vuno-cyan",
    shadow:      "shadow-[0_10px_30px_-10px_rgba(33,212,212,0.5)]",
    text:        "text-vuno-cyan",
    dotBg:       "bg-vuno-cyan",
    dotShadow:   "shadow-[0_0_8px_rgba(33,212,212,0.9)]",
    labelShadow: "shadow-[0_0_8px_rgba(33,212,212,0.5)]",
  },
};

function ModalCard({
  src, icon: Icon, label, tone = "cyan",
}: {
  src: string;
  icon: typeof Activity;
  label: string;
  tone?: Tone;
}) {
  const s = TONE_STYLES[tone];
  return (
    <div className="relative group">
      <div
        className={`relative h-[24vw] w-[24vw] md:h-[140px] md:w-[140px] max-h-[160px] max-w-[160px] border-2 ${s.border} ${s.borderHover} ${s.shadow} overflow-hidden bg-black transition-colors flex items-center justify-center`}
      >
        <img
          src={src}
          alt={label}
          className="max-w-full max-h-full object-contain p-1 group-hover:scale-105 transition-transform duration-500"
        />

        {/* 상단 라벨 — tone 색 적용 */}
        <div className="absolute top-1.5 left-1.5 z-10">
          <div className={`inline-flex items-center gap-1 px-2 py-0.5 bg-vuno-bg border-2 ${s.border.replace("/60", "")} ${s.labelShadow}`}>
            <Icon className={`h-3 w-3 ${s.text}`} />
            <span className={`text-[10px] font-bold tracking-[0.15em] ${s.text}`}>{label}</span>
          </div>
        </div>

        {/* Live dot — tone 색 */}
        <span className={`absolute top-2 right-2 z-10 h-2 w-2 rounded-full animate-pulse ${s.dotBg} ${s.dotShadow}`} />
      </div>
    </div>
  );
}
