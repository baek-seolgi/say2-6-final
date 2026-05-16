// say-6 — CXR PACS 스타일 풀스크린 뷰어
// 레거시 CXRView(이미지 + UNet 세그멘테이션 + 측정선)를 PACS 워크스테이션
// 크롬으로 감싼다: 다크 테마 · 좌측 툴 레일 · 코너 메타 · 우측 측정값/판독 패널.

import { useState } from "react";
import {
  X, ZoomIn, ZoomOut, Maximize2, Move, Ruler, Contrast, Layers, FileText,
} from "lucide-react";
import { CXRView, type ModalRawResponse } from "./ModalViews";

interface Props {
  result: ModalRawResponse;
  subjectId: string | null;
  patientName: string;
  patientMeta: string; // 예: "남 / 64세"
  studyDateLabel?: string;
  onClose: () => void;
}

export function CxrPacsViewer({
  result, subjectId, patientName, patientMeta, studyDateLabel, onClose,
}: Props) {
  const [zoom, setZoom] = useState(1);
  const m = (result.measurements || {}) as Record<string, unknown>;
  const meta = (result.metadata || {}) as Record<string, unknown>;
  const view = (meta.view as string) || "PA";
  const risk = (result.risk_level as string) || "routine";

  const num = (v: unknown) => (typeof v === "number" ? v : undefined);
  const ctr = num(m.ctr);
  const measureRows: [string, string, string][] = [
    ["심흉곽비 (CTR)", ctr != null ? ctr.toFixed(2) : "—", String(m.ctr_status ?? "")],
    ["심장폭", m.heart_width_px != null ? `${m.heart_width_px} px` : "—", ""],
    ["흉곽폭", m.thorax_width_px != null ? `${m.thorax_width_px} px` : "—", ""],
    ["우 늑횡각", num(m.right_cp_angle) != null ? `${num(m.right_cp_angle)!.toFixed(1)}°` : "—", String(m.right_cp_status ?? "")],
    ["좌 늑횡각", num(m.left_cp_angle) != null ? `${num(m.left_cp_angle)!.toFixed(1)}°` : "—", String(m.left_cp_status ?? "")],
    ["기관 편위", String(m.trachea_deviation_direction ?? "정중"), ""],
    ["횡격막", String(m.diaphragm_status ?? "—"), ""],
    ["종격동", String(m.mediastinum_status ?? "—"), ""],
  ];

  const findingsText =
    (result.findings_text as string) ||
    (result.impression as string) ||
    (result.summary as string) ||
    "판독 소견 없음";
  const findingsList = Array.isArray(result.findings)
    ? (result.findings as Array<Record<string, unknown>>)
    : [];
  const pertNeg = Array.isArray(result.pertinent_negatives)
    ? (result.pertinent_negatives as string[])
    : [];

  const riskColor =
    risk === "critical" ? "text-red-400 border-red-500/50" :
    risk === "urgent" ? "text-amber-400 border-amber-500/50" :
    "text-emerald-400 border-emerald-500/50";

  return (
    <div className="fixed inset-0 z-50 bg-[#070b14] flex flex-col" onClick={onClose}>
      {/* ── 상단 스터디 바 ── */}
      <div
        className="h-11 flex items-center gap-3 px-3 bg-[#0d1320] border-b border-cyan-500/20 text-xs"
        onClick={(e) => e.stopPropagation()}
      >
        <span className="flex items-center gap-1.5 font-bold text-cyan-300 tracking-wider">
          <Layers className="h-4 w-4" /> say-6 PACS · CXR Viewer
        </span>
        <span className="h-4 w-px bg-white/15" />
        <span className="text-slate-200 font-semibold">{patientName}</span>
        <span className="text-slate-500">{patientMeta}</span>
        <span className="h-4 w-px bg-white/15" />
        <span className="text-slate-400 font-mono">Chest {view} · 단순흉부촬영</span>
        {studyDateLabel && <span className="text-slate-500 font-mono">{studyDateLabel}</span>}
        <span className={`ml-auto px-2 py-0.5 border text-[10px] font-bold tracking-widest uppercase ${riskColor}`}>
          {risk}
        </span>
        <button onClick={onClose} className="h-7 w-7 grid place-items-center text-slate-400 hover:text-white hover:bg-white/10">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 flex min-h-0" onClick={(e) => e.stopPropagation()}>
        {/* ── 좌측 툴 레일 ── */}
        <div className="w-12 bg-[#0d1320] border-r border-white/10 flex flex-col items-center py-2 gap-1">
          <ToolBtn icon={ZoomIn} label="확대" onClick={() => setZoom((z) => Math.min(z + 0.25, 3))} />
          <ToolBtn icon={ZoomOut} label="축소" onClick={() => setZoom((z) => Math.max(z - 0.25, 1))} />
          <ToolBtn icon={Maximize2} label="원래 크기" onClick={() => setZoom(1)} />
          <div className="h-px w-6 bg-white/10 my-1" />
          <ToolBtn icon={Move} label="이동 (드래그)" disabled />
          <ToolBtn icon={Ruler} label="길이 측정" disabled />
          <ToolBtn icon={Contrast} label="윈도우 레벨" disabled />
        </div>

        {/* ── 중앙 뷰포트 ── */}
        <div className="flex-1 relative bg-black overflow-hidden">
          <div
            className="absolute inset-0 transition-transform duration-150"
            style={{ transform: `scale(${zoom})`, transformOrigin: "center" }}
          >
            <CXRView subjectId={subjectId} cacheKey="" cxrResult={result} isLoading={false} />
          </div>

          {/* PACS 코너 메타 오버레이 */}
          <CornerText pos="bottom-left">
            SL: 1 · {view} View<br />
            {meta.image_size ? `Matrix: ${(meta.image_size as number[]).join(" × ")}` : ""}
          </CornerText>
          <CornerText pos="bottom-right">
            Zoom: {Math.round(zoom * 100)}%<br />
            say-6 DeepCXR · UNet+측정
          </CornerText>
        </div>

        {/* ── 우측 패널 — 측정값 + AI 판독 ── */}
        <div className="w-[320px] bg-[#0d1320] border-l border-white/10 flex flex-col overflow-auto">
          <PanelSection title="정량 측정값 (Measurements)">
            <table className="w-full text-[11px]">
              <tbody>
                {measureRows.map(([label, val, status]) => (
                  <tr key={label} className="border-b border-white/5">
                    <td className="py-1.5 text-slate-400">{label}</td>
                    <td className="py-1.5 text-right font-mono text-slate-100 font-bold">{val}</td>
                    <td className="py-1.5 pl-2 text-[10px] text-slate-500">{status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </PanelSection>

          <PanelSection title="AI 판독 소견 (Findings)">
            <p className="text-[11px] text-slate-300 leading-relaxed whitespace-pre-line">
              {findingsText}
            </p>
            {findingsList.length > 0 && (
              <ul className="mt-2 space-y-1">
                {findingsList.map((f, i) => (
                  <li key={i} className="text-[11px] text-slate-300 flex gap-1.5">
                    <span className="text-cyan-400 flex-shrink-0">·</span>
                    <span>
                      {String(f.name ?? f.label ?? f.finding ?? "")}
                      {typeof f.confidence === "number" && (
                        <span className="text-slate-500 font-mono ml-1">
                          ({Math.round((f.confidence as number) * 100)}%)
                        </span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </PanelSection>

          {pertNeg.length > 0 && (
            <PanelSection title="음성 소견 (Pertinent Negatives)">
              <div className="flex flex-wrap gap-1">
                {pertNeg.map((p) => (
                  <span key={p} className="px-1.5 py-0.5 text-[10px] bg-white/5 border border-white/10 text-slate-400">
                    {p}
                  </span>
                ))}
              </div>
            </PanelSection>
          )}

          {result.impression && (
            <PanelSection title="결론 (Impression)">
              <div className="text-[12px] font-bold text-cyan-200 leading-relaxed">
                {String(result.impression)}
              </div>
            </PanelSection>
          )}

          <div className="mt-auto p-3 border-t border-white/10 flex items-start gap-1.5">
            <FileText className="h-3.5 w-3.5 text-slate-500 flex-shrink-0 mt-0.5" />
            <p className="text-[9px] text-slate-500 leading-relaxed">
              본 판독은 say-6 AI 진단 보조 결과이며, 최종 판독은 영상의학과 전문의의 검토를 따릅니다.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  icon: Icon, label, onClick, disabled,
}: {
  icon: typeof ZoomIn;
  label: string;
  onClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={label}
      className={
        "h-8 w-8 grid place-items-center transition-colors " +
        (disabled
          ? "text-slate-600 cursor-default"
          : "text-slate-400 hover:text-cyan-300 hover:bg-white/10")
      }
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

function CornerText({
  pos, children,
}: {
  pos: "top-left" | "top-right" | "bottom-left" | "bottom-right";
  children: React.ReactNode;
}) {
  const cls: Record<string, string> = {
    "top-left": "top-2 left-2 text-left",
    "top-right": "top-2 right-2 text-right",
    "bottom-left": "bottom-2 left-2 text-left",
    "bottom-right": "bottom-2 right-2 text-right",
  };
  return (
    <div className={`absolute ${cls[pos]} text-[10px] font-mono text-cyan-300/70 leading-tight pointer-events-none`}>
      {children}
    </div>
  );
}

function PanelSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="px-3 py-3 border-b border-white/10">
      <div className="text-[10px] font-bold text-cyan-400/80 tracking-wider uppercase mb-2">{title}</div>
      {children}
    </div>
  );
}
