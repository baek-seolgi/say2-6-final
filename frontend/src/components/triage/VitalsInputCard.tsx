// 활력징후 — 슬레이트/블루 톤, 정상범위 자동 색상
import Panel from "./Panel";
import type { Vitals } from "../../types/triage";

interface Props {
  value: Vitals;
  onChange: (v: Vitals) => void;
}

interface VitalSpec {
  key: keyof Vitals;
  label: string;
  unit: string;
  normal: [number, number];
  criticalLow?: number;
  criticalHigh?: number;
  step?: number;
}

const SPECS: VitalSpec[] = [
  { key: "sbp",  label: "SBP",  unit: "mmHg", normal: [90, 140], criticalLow: 80, criticalHigh: 180 },
  { key: "dbp",  label: "DBP",  unit: "mmHg", normal: [60, 90],  criticalLow: 50, criticalHigh: 110 },
  { key: "hr",   label: "HR",   unit: "bpm",  normal: [60, 100], criticalLow: 40, criticalHigh: 130 },
  { key: "rr",   label: "RR",   unit: "/min", normal: [12, 20],  criticalLow: 8,  criticalHigh: 30 },
  { key: "spo2", label: "SpO₂", unit: "%",    normal: [95, 100], criticalLow: 90 },
  { key: "bt",   label: "BT",   unit: "℃",   normal: [36.5, 37.5], criticalLow: 35, criticalHigh: 39, step: 0.1 },
];

function getStatus(v: number | null, spec: VitalSpec): "normal" | "warn" | "critical" | "empty" {
  if (v === null || v === undefined || isNaN(v)) return "empty";
  if (spec.criticalLow !== undefined && v <= spec.criticalLow) return "critical";
  if (spec.criticalHigh !== undefined && v >= spec.criticalHigh) return "critical";
  if (v < spec.normal[0] || v > spec.normal[1]) return "warn";
  return "normal";
}

function statusStyle(s: ReturnType<typeof getStatus>): string {
  switch (s) {
    case "critical": return "bg-red-50 border-red-500 text-red-700 font-bold";
    case "warn":     return "bg-amber-50 border-amber-500 text-amber-700 font-semibold";
    case "normal":   return "bg-emerald-50 border-emerald-500 text-emerald-700";
    default:         return "bg-white border-gray-400 text-gray-900";
  }
}

export default function VitalsInputCard({ value, onChange }: Props) {
  return (
    <Panel title="활력징후 (Vital Signs)" hotkey="F2">
      <div className="grid grid-cols-3 gap-2">
        {SPECS.map((spec) => {
          const v = value[spec.key];
          const status = getStatus(v, spec);
          return (
            <div key={spec.key} className="flex flex-col">
              <div className="flex items-baseline justify-between px-0.5 mb-1">
                <span className="text-[12px] font-bold text-gray-700">{spec.label}</span>
                <span className="text-[10px] text-gray-400">{spec.unit}</span>
              </div>
              <input
                type="number"
                step={spec.step ?? 1}
                value={v ?? ""}
                onChange={(e) => {
                  const n = e.target.value === "" ? null : Number(e.target.value);
                  onChange({ ...value, [spec.key]: n });
                }}
                className={`w-full px-2 py-1.5 border rounded-md text-center font-mono text-[14px] focus:outline-none focus:ring-2 focus:ring-gray-500/20 ${statusStyle(status)}`}
              />
            </div>
          );
        })}
      </div>

      <div className="mt-3 pt-2 border-t border-gray-400 flex items-center gap-3 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-emerald-500" /> 정상
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-amber-500" /> 주의
        </span>
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-full bg-red-500" /> 위험
        </span>
      </div>
    </Panel>
  );
}
