// say-6 — 임상용 ECG 검사결과지
// 핑크 그리드 ECG 종이 위에 12-lead + Lead II 리듬 스트립 + 측정값 헤더.
// 실제 ECG 프린트물처럼 보이도록 SVG 패턴 + 합성 normal sinus rhythm 파형.
//
// 백엔드 ECG waveform이 없을 때(정적 데모) ResultSheetBody 대용으로 사용.

interface EcgClinicalSheetProps {
  patientName?: string;
  age?: number;
  sex?: "M" | "F" | string;
  patientId?: string;
  recordedAt?: string;
  // 측정값 (없으면 정상 placeholder)
  hr?: number;
  prInterval?: number;
  qrsWidth?: number;
  qt?: number;
  qtc?: number;
  pAxis?: number;
  qrsAxis?: number;
  // 판정 코드 (Minnesota / 기계 해석)
  interpretation?: { code: string; text: string }[];
}

// 정상 NSR 한 박동 path — width=60 (1 박동/1초 가정, 25mm/s)
// baseline y=40, P wave + QRS + T wave 형태
function beatPath(scale = 1, baseline = 40): string {
  // 한 박동 width = 24 (60 * 0.4)
  const w = 24;
  // 시작 직선 → P → 잠시 → QRS → ST → T → 다음 박동까지 직선
  return [
    `M0,${baseline}`,
    `L${2 * scale},${baseline}`,
    // P 파 (작은 둥근 산)
    `Q${3 * scale},${baseline - 2 * scale} ${4 * scale},${baseline - 2.5 * scale}`,
    `Q${5 * scale},${baseline - 2 * scale} ${6 * scale},${baseline}`,
    `L${8 * scale},${baseline}`,
    // QRS (Q작은dip, R큰 spike, S dip)
    `L${8.5 * scale},${baseline + 1.5 * scale}`,
    `L${9 * scale},${baseline - 15 * scale}`,
    `L${9.5 * scale},${baseline + 5 * scale}`,
    `L${10 * scale},${baseline}`,
    `L${13 * scale},${baseline}`,
    // T 파 (큰 둥근 산)
    `Q${15 * scale},${baseline - 4 * scale} ${17 * scale},${baseline - 4 * scale}`,
    `Q${19 * scale},${baseline - 4 * scale} ${21 * scale},${baseline}`,
    `L${w * scale},${baseline}`,
  ].join(" ");
}

// 한 lead 안에 박동 3개 그리기 (waveform width=240)
function multiBeats(scale = 1, baseline = 40, count = 3): string {
  const parts: string[] = [];
  const w = 24 * scale;
  for (let i = 0; i < count; i++) {
    parts.push(beatPath(scale, baseline).replace(/M0,/, `M${i * w},`));
  }
  return parts.join(" ");
}

// 리듬 스트립용 — 박동 10개 정도 (긴 가로)
function rhythmStripPath(scale = 1, baseline = 40, count = 12): string {
  return multiBeats(scale, baseline, count);
}

const LEAD_GRID: { row: number; col: number; name: string }[] = [
  { row: 0, col: 0, name: "I" },   { row: 0, col: 1, name: "aVR" }, { row: 0, col: 2, name: "V1" }, { row: 0, col: 3, name: "V4" },
  { row: 1, col: 0, name: "II" },  { row: 1, col: 1, name: "aVL" }, { row: 1, col: 2, name: "V2" }, { row: 1, col: 3, name: "V5" },
  { row: 2, col: 0, name: "III" }, { row: 2, col: 1, name: "aVF" }, { row: 2, col: 2, name: "V3" }, { row: 2, col: 3, name: "V6" },
];

export function EcgClinicalSheet({
  patientName = "환자",
  age = 0,
  sex = "M",
  patientId = "—",
  recordedAt,
  hr = 88,
  prInterval = 148,
  qrsWidth = 88,
  qt = 372,
  qtc = 398,
  pAxis = 52,
  qrsAxis = 38,
  interpretation,
}: EcgClinicalSheetProps) {
  const sexLabel = sex === "M" ? "남" : sex === "F" ? "여" : sex;
  const interp =
    interpretation && interpretation.length > 0
      ? interpretation
      : [
          { code: "1100", text: "Sinus rhythm" },
          { code: "9110", text: "** normal ECG **" },
        ];
  const ts =
    recordedAt ??
    new Date().toLocaleString("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div className="bg-white text-[10px] font-mono leading-tight">
      {/* ── 헤더 (환자 + 측정값) ─────────────────────── */}
      <div className="border-b border-slate-400 px-3 py-2">
        <div className="grid grid-cols-[1.4fr_1fr_auto] gap-4">
          {/* 좌: 환자 정보 */}
          <div className="space-y-0.5">
            <div className="grid grid-cols-[60px_1fr]">
              <span className="text-slate-500">ID:</span>
              <span className="font-bold">{patientId}</span>
            </div>
            <div className="grid grid-cols-[60px_1fr]">
              <span className="text-slate-500">Name:</span>
              <span>{patientName}</span>
            </div>
            <div className="grid grid-cols-[60px_1fr]">
              <span className="text-slate-500">SEX/AGE:</span>
              <span>{sexLabel} · {age}세</span>
            </div>
            <div className="grid grid-cols-[60px_1fr]">
              <span className="text-slate-500">Medication:</span>
              <span className="text-slate-400">None</span>
            </div>
          </div>
          {/* 중: 측정값 */}
          <div className="space-y-0.5">
            <div className="grid grid-cols-[80px_1fr]">
              <span className="text-slate-500">Heart Rate</span>
              <span className="font-bold">{hr} bpm</span>
            </div>
            <div className="grid grid-cols-[80px_1fr]">
              <span className="text-slate-500">PR Int.</span>
              <span>{prInterval} ms</span>
            </div>
            <div className="grid grid-cols-[80px_1fr]">
              <span className="text-slate-500">QRS Int.</span>
              <span>{qrsWidth} ms</span>
            </div>
            <div className="grid grid-cols-[80px_1fr]">
              <span className="text-slate-500">QT/QTc</span>
              <span>{qt} / {qtc} ms</span>
            </div>
            <div className="grid grid-cols-[80px_1fr]">
              <span className="text-slate-500">P/QRS axis</span>
              <span>{pAxis}° / {qrsAxis}°</span>
            </div>
          </div>
          {/* 우: 메타 + 일시 */}
          <div className="text-right space-y-0.5">
            <div>10mm/mV  25mm/s</div>
            <div className="text-slate-500">{ts}</div>
            <div className="text-slate-500">Minnesota (03-05)</div>
            <div className="text-slate-500">say-6 DeepECG v1.2</div>
          </div>
        </div>
      </div>

      {/* ── 12-Lead 그리드 4×3 (ECG 종이 핑크 그리드) ─────── */}
      <div className="px-3 py-2">
        <svg
          viewBox="0 0 720 270"
          className="w-full block border border-rose-300 bg-rose-50/30"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <pattern id="grid-sm" width="6" height="6" patternUnits="userSpaceOnUse">
              <path
                d="M 6 0 L 0 0 0 6"
                fill="none"
                stroke="#fda4af"
                strokeOpacity="0.45"
                strokeWidth="0.3"
              />
            </pattern>
            <pattern id="grid-lg" width="30" height="30" patternUnits="userSpaceOnUse">
              <rect width="30" height="30" fill="url(#grid-sm)" />
              <path
                d="M 30 0 L 0 0 0 30"
                fill="none"
                stroke="#fb7185"
                strokeOpacity="0.55"
                strokeWidth="0.55"
              />
            </pattern>
          </defs>
          <rect width="720" height="270" fill="url(#grid-lg)" />

          {/* 12-lead waveforms — 4열 × 3행 */}
          {LEAD_GRID.map(({ row, col, name }) => {
            const x0 = col * 180 + 4;
            const y0 = row * 90 + 4;
            // 각 셀 안에 3박동
            return (
              <g key={name} transform={`translate(${x0}, ${y0})`}>
                <text x="2" y="14" fill="#475569" fontSize="11" fontWeight="bold">
                  {name}
                </text>
                {/* calibration pulse (1mV = 10mm 박스) */}
                <path
                  d={`M0,${42 + 4} L5,${42 + 4} L5,${42 + 4 - 18} L10,${42 + 4 - 18} L10,${42 + 4} L172,${42 + 4}`}
                  stroke="#0f172a"
                  strokeWidth="0.6"
                  fill="none"
                />
                {/* 박동 패턴 (위에 calibration 한 박스 표시 + 그 뒤로 정상 sinus) */}
                <path
                  transform="translate(14, 4) scale(1.6, 1)"
                  d={multiBeats(1, 42, 3)}
                  stroke="#0f172a"
                  strokeWidth="0.7"
                  fill="none"
                />
              </g>
            );
          })}
        </svg>
      </div>

      {/* ── 판정 (Interpretation 코드) ───────────────────── */}
      <div className="px-3 pb-1 space-y-0.5">
        {interp.map((it) => (
          <div key={it.code} className="flex gap-3">
            <span className="text-slate-500 w-12">{it.code}</span>
            <span className={it.text.includes("*") ? "font-bold" : ""}>{it.text}</span>
          </div>
        ))}
      </div>

      {/* ── Lead II 리듬 스트립 ──────────────────────────── */}
      <div className="px-3 pb-3 pt-1">
        <svg
          viewBox="0 0 720 110"
          className="w-full block border border-rose-300 bg-rose-50/30"
          xmlns="http://www.w3.org/2000/svg"
        >
          <rect width="720" height="110" fill="url(#grid-lg)" />
          <text x="6" y="14" fill="#475569" fontSize="10" fontWeight="bold">
            Rhythm[II] 10mm/mV 25mm/s Filter:(H60 D)100Hz
          </text>
          {/* calibration */}
          <path
            d="M0,60 L8,60 L8,40 L16,40 L16,60 L710,60"
            stroke="#0f172a"
            strokeWidth="0.6"
            fill="none"
          />
          {/* 리듬 — 박동 12개 */}
          <path
            transform="translate(20, 20) scale(2.4, 1)"
            d={rhythmStripPath(1, 38, 12)}
            stroke="#0f172a"
            strokeWidth="0.7"
            fill="none"
          />
        </svg>
      </div>

      {/* 푸터 */}
      <div className="border-t border-slate-200 px-3 py-1 text-[9px] text-slate-400 flex justify-between">
        <span>1350K · say-6 응급실 멀티모달 AI 진단 보조</span>
        <span>v1.2</span>
      </div>
    </div>
  );
}
