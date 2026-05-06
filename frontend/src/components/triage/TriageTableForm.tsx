// 트리아지 입력 폼 — 한국 클래식 EMR (의차트/의사랑) 스타일
// 다중 패널 레이아웃:
//   1. 환자 헤더 바 (진한 회색)
//   2. 활력징후 가로 표 (일자/시간/SBP/DBP/HR/...)
//   3. 3-column 행: 주증상(F1) + 환자메모 + 특이사항(F4)
//   4. 상병/과거력(F2) 표 (전체 너비)
//   5. KTAS(F3) 선택 바
import type { ReactNode } from "react";
import {
  KTAS_META,
  CHIEF_COMPLAINT_LABELS,
  PAST_HISTORY_LABELS,
  type Sex,
  type KTAS,
  type Vitals,
  type TriageInput,
  type ChiefComplaint,
  type PastHistoryCode,
} from "../../types/triage";

interface Props {
  value: Partial<TriageInput> & { mrn?: string };
  vitals: Vitals;
  onChange: (patch: Partial<TriageInput> & { mrn?: string }) => void;
  onVitalsChange: (v: Vitals) => void;
  onHistoryToggle: (code: PastHistoryCode) => void;
}

// ICD-10 코드 매핑
const COMPLAINT_ICD: Record<ChiefComplaint, string> = {
  chest_pain: "R07.4", dyspnea: "R06.0", abdominal_pain: "R10.4",
  fever: "R50.9", trauma: "T14.9", altered_mental: "R41.82",
  syncope: "R55", headache: "R51", weakness: "R53.1",
  palpitation: "R00.2", back_pain: "M54.9", nausea_vomiting: "R11.0",
  other: "R69",
};

const HISTORY_ICD: Record<PastHistoryCode, string> = {
  HTN: "I10",     DM: "E11",      CAD: "I25.10", AFIB: "I48.91",
  CVA: "I63.9",   COPD: "J44.9",  ASTHMA: "J45.9", CKD: "N18.9",
  LIVER: "K76.9", CANCER: "C80.1", ALLERGY: "Z88", PREGNANT: "Z33.1",
};

const COMPLAINT_ORDER: ChiefComplaint[] = [
  "chest_pain", "dyspnea", "abdominal_pain", "fever", "trauma",
  "altered_mental", "syncope", "headache", "weakness", "palpitation",
  "back_pain", "nausea_vomiting", "other",
];

const HISTORY_ORDER: PastHistoryCode[] = [
  "HTN", "DM", "CAD", "AFIB", "CVA",
  "COPD", "ASTHMA", "CKD", "LIVER", "CANCER",
  "ALLERGY", "PREGNANT",
];

// 활력징후 명세
const VITAL_SPECS = [
  { key: "sbp"  as const, label: "SBP",  unit: "mmHg", normal: [90, 140],   cl: 80, ch: 180, step: 1 },
  { key: "dbp"  as const, label: "DBP",  unit: "mmHg", normal: [60, 90],    cl: 50, ch: 110, step: 1 },
  { key: "hr"   as const, label: "HR",   unit: "bpm",  normal: [60, 100],   cl: 40, ch: 130, step: 1 },
  { key: "rr"   as const, label: "RR",   unit: "/min", normal: [12, 20],    cl: 8,  ch: 30,  step: 1 },
  { key: "spo2" as const, label: "SpO₂", unit: "%",    normal: [95, 100],   cl: 90, ch: 999, step: 1 },
  { key: "bt"   as const, label: "BT",   unit: "℃",   normal: [36.5, 37.5], cl: 35, ch: 39,  step: 0.1 },
];

function vitalCls(v: number | null, spec: typeof VITAL_SPECS[number]): string {
  if (v === null || isNaN(v)) return "";
  if (v <= spec.cl || v >= spec.ch) return "bg-red-100 text-red-700 font-bold";
  if (v < spec.normal[0] || v > spec.normal[1]) return "bg-amber-100 text-amber-700 font-semibold";
  return "bg-emerald-50 text-emerald-700";
}

// ─── EMR 클래식 패널 ─────────────────────────────────────
function EMRPanel({
  title,
  hotkey,
  children,
  className = "",
}: {
  title: string;
  hotkey?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`bg-white border border-gray-500 flex flex-col ${className}`}>
      <header className="bg-gray-200 border-b border-gray-500 px-2 py-0.5 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <span className="w-2 h-2 bg-gray-700" />
          <span className="text-[12px] font-bold text-gray-900">{title}</span>
          {hotkey && (
            <span className="text-[11px] text-gray-700">({hotkey})</span>
          )}
        </div>
      </header>
      <div className="flex-1 overflow-auto">{children}</div>
    </section>
  );
}

const inputCell = "w-full px-1.5 py-0.5 border border-gray-400 bg-white text-[12px] focus:outline-none focus:border-gray-700";

export default function TriageTableForm({
  value, vitals, onChange, onVitalsChange, onHistoryToggle,
}: Props) {
  return (
    <div className="bg-gray-200 p-1 space-y-1 text-[12px]">
      {/* ─── 1. 환자 헤더 바 (의차트 진회색, 한 줄 고정) ─── */}
      <div className="bg-gray-800 text-white px-3 py-1.5 flex items-center gap-3 text-[12px] whitespace-nowrap overflow-x-auto border border-gray-900">
        <span className="font-mono text-yellow-200 flex-shrink-0">{value.arrived_at?.slice(0, 10) ?? "—"}</span>
        <span className="bg-gray-700 px-2 py-0.5 border border-gray-600 flex-shrink-0">환자정보</span>
        <span className="text-gray-400 flex-shrink-0">No.</span>
        <span className="font-mono flex-shrink-0">1</span>
        <span className="font-bold text-base flex-shrink-0">{value.name || "—"}</span>
        <span className="text-gray-300 flex-shrink-0">{value.sex ?? "?"}/{value.age ?? "?"}세</span>
        <span className="font-mono text-gray-300 flex-shrink-0">{value.mrn || "—"}</span>
        <span className="bg-gray-900 px-2 py-0.5 border border-gray-700 flex-shrink-0">건강보험</span>
        <label className="flex items-center gap-1 text-[11px] flex-shrink-0">
          <input type="checkbox" className="w-3 h-3" />만성질환관리제
        </label>
        <label className="flex items-center gap-1 text-[11px] flex-shrink-0">
          <input type="checkbox" className="w-3 h-3" defaultChecked />SMS
        </label>
        <label className="flex items-center gap-1 text-[11px] flex-shrink-0">
          <input type="checkbox" className="w-3 h-3" />임산부
        </label>
        <span className="text-yellow-200 flex-shrink-0">●</span>
        <span className="text-[11px] flex-shrink-0">직접입력</span>
      </div>

      {/* ─── 2. 활력징후 가로 표 ─── */}
      <EMRPanel title="활력징후">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-2 py-0.5 text-gray-700 w-[100px]">일자</th>
              <th className="border border-gray-400 px-1 py-0.5 text-gray-700 w-[60px]">시간</th>
              {VITAL_SPECS.map(s => (
                <th key={s.key} className="border border-gray-400 px-1 py-0.5 text-gray-700">
                  {s.label}<span className="text-gray-400 font-normal text-[10px]"> ({s.unit})</span>
                </th>
              ))}
              <th className="border border-gray-400 px-1 py-0.5 text-gray-700 w-[80px]">상태</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="border border-gray-400 px-2 py-0 font-mono bg-yellow-50/30">
                {value.arrived_at?.slice(0, 10) ?? "—"}
              </td>
              <td className="border border-gray-400 px-1 py-0 font-mono bg-yellow-50/30 text-center">
                {value.arrived_at?.slice(11, 16) ?? "—"}
              </td>
              {VITAL_SPECS.map(spec => {
                const v = vitals[spec.key];
                return (
                  <td key={spec.key} className={`border border-gray-400 px-0 py-0 ${vitalCls(v as number | null, spec)}`}>
                    <input
                      type="number"
                      step={spec.step}
                      value={v ?? ""}
                      onChange={e => onVitalsChange({
                        ...vitals,
                        [spec.key]: e.target.value === "" ? null : Number(e.target.value),
                      })}
                      className="w-full px-1 py-0.5 bg-transparent text-center font-mono focus:outline-none focus:bg-white"
                    />
                  </td>
                );
              })}
              <td className="border border-gray-400 px-1 py-0 text-center text-[10px]">
                {VITAL_SPECS.some(s => {
                  const v = vitals[s.key] as number | null;
                  return v !== null && (v <= s.cl || v >= s.ch);
                }) ? <span className="text-red-700 font-bold">⚠ 위험</span> :
                VITAL_SPECS.some(s => {
                  const v = vitals[s.key] as number | null;
                  return v !== null && (v < s.normal[0] || v > s.normal[1]);
                }) ? <span className="text-amber-700">주의</span> :
                <span className="text-emerald-700">정상</span>}
              </td>
            </tr>
          </tbody>
        </table>
      </EMRPanel>

      {/* ─── 3. 3-column: 주증상(F1) + 환자메모 + 특이사항(F4) ─── */}
      <div className="grid grid-cols-3 gap-1">
        {/* 주증상 (F1) */}
        <EMRPanel title="증상" hotkey="F1">
          <div className="p-2 space-y-1.5">
            <div className="font-mono text-[11px] text-gray-600">
              {value.arrived_at?.slice(0, 10) ?? "—"}
            </div>
            <div className="text-[11px]">
              <span className="font-bold text-gray-700">C/C </span>
              <span className="font-mono text-gray-500 text-[10px]">
                ({value.chief_complaint ? COMPLAINT_ICD[value.chief_complaint] : "—"})
              </span>
            </div>
            <div className="flex flex-wrap gap-0.5">
              {COMPLAINT_ORDER.map(cc => {
                const meta = CHIEF_COMPLAINT_LABELS[cc];
                const active = value.chief_complaint === cc;
                return (
                  <button key={cc} type="button" onClick={() => onChange({ chief_complaint: cc })}
                    className={`px-1.5 py-0 border border-gray-400 text-[11px] ${
                      active ? "bg-blue-900 text-white border-blue-950" : "bg-white text-gray-700 hover:bg-blue-50"
                    }`}>
                    {meta.ko}
                  </button>
                );
              })}
            </div>
            <div>
              <span className="font-bold text-gray-700 text-[11px]">P/I</span>
              <textarea rows={4}
                className={`${inputCell} mt-1 font-mono leading-tight resize-none`}
                value={value.complaint_detail ?? ""}
                onChange={e => onChange({ complaint_detail: e.target.value })}
                placeholder="발병·양상·동반증상" />
            </div>
          </div>
        </EMRPanel>

        {/* 환자메모 */}
        <EMRPanel title="환자메모">
          <div className="p-2 space-y-1.5">
            <div className="text-[11px] text-gray-700">
              <div className="font-bold text-gray-800">
                {value.name || "—"} <span className="font-normal text-gray-500">({value.sex ?? "?"}/{value.age ?? "?"})</span>
              </div>
              <div className="font-mono text-gray-500 text-[10px]">{value.mrn || "MRN: —"}</div>
            </div>
            <textarea rows={5}
              className={`${inputCell} font-mono leading-tight resize-none`}
              value={value.notes ?? ""}
              onChange={e => onChange({ notes: e.target.value })}
              placeholder="환자별 특이 메모, 가족력, 사회력 등" />
            <div className="flex gap-1 text-[10px]">
              <button className="flex-1 px-1 py-0 border border-gray-400 bg-white hover:bg-gray-100">처방등록</button>
              <button className="flex-1 px-1 py-0 border border-gray-400 bg-gray-200 text-gray-900">환자메모</button>
            </div>
          </div>
        </EMRPanel>

        {/* 특이사항 (F4) — 알레르기/약물 */}
        <EMRPanel title="특이사항" hotkey="F4">
          <div className="p-2 space-y-1.5">
            <div>
              <span className="text-[11px] font-bold text-red-700">알레르기 (Allergy)</span>
              <input
                className={`${inputCell} mt-1 border-red-300 focus:border-red-600`}
                value={value.allergies ?? ""}
                onChange={e => onChange({ allergies: e.target.value })}
                placeholder="없으면 NKDA" />
            </div>
            <div>
              <span className="text-[11px] font-bold text-gray-700">복용약물 (Medication)</span>
              <textarea rows={3}
                className={`${inputCell} mt-1 font-mono leading-tight resize-none`}
                value={value.medications ?? ""}
                onChange={e => onChange({ medications: e.target.value })}
                placeholder="예: Aspirin, Metformin, Amlodipine" />
            </div>
            <div className="flex gap-1 text-[10px]">
              <button className="flex-1 px-1 py-0 border border-gray-400 bg-gray-200 text-gray-900">특이사항</button>
              <button className="flex-1 px-1 py-0 border border-gray-400 bg-white hover:bg-gray-100">접수메모</button>
            </div>
          </div>
        </EMRPanel>
      </div>

      {/* ─── 4. 상병/과거력 (F2) 표 ─── */}
      <EMRPanel title="상병 / 과거력" hotkey="F2">
        <table className="w-full border-collapse text-[11px]">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-gray-400 px-2 py-0.5 w-[80px]">사용자코드</th>
              <th className="border border-gray-400 px-2 py-0.5">상병명칭</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[80px]">특정기</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[60px]">주상병</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[60px]">의증</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[60px]">수술여</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[80px]">경과</th>
              <th className="border border-gray-400 px-2 py-0.5 w-[100px]">입력일자</th>
            </tr>
          </thead>
          <tbody>
            {HISTORY_ORDER.map(code => {
              const checked = (value.past_history ?? []).includes(code);
              return (
                <tr key={code} className={checked ? "bg-cyan-50" : "bg-white hover:bg-gray-50"}>
                  <td className="border border-gray-400 px-2 py-0.5 font-mono text-gray-700">
                    {HISTORY_ICD[code]}
                  </td>
                  <td className="border border-gray-400 px-2 py-0.5">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={checked}
                        onChange={() => onHistoryToggle(code)}
                        className="w-3 h-3 accent-cyan-700" />
                      <span className="font-mono text-[10px] text-gray-500">{code}</span>
                      <span>{PAST_HISTORY_LABELS[code]}</span>
                    </label>
                  </td>
                  <td className="border border-gray-400 px-2 py-0.5 text-center text-gray-400">—</td>
                  <td className="border border-gray-400 px-2 py-0.5 text-center">
                    <input type="checkbox" className="w-3 h-3" />
                  </td>
                  <td className="border border-gray-400 px-2 py-0.5 text-center">
                    <input type="checkbox" className="w-3 h-3" />
                  </td>
                  <td className="border border-gray-400 px-2 py-0.5 text-center">
                    <input type="checkbox" className="w-3 h-3" />
                  </td>
                  <td className="border border-gray-400 px-2 py-0.5 text-center text-gray-400">—</td>
                  <td className="border border-gray-400 px-2 py-0.5 font-mono text-[10px] text-gray-600 text-center">
                    {checked ? value.arrived_at?.slice(0, 10) ?? "—" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EMRPanel>

      {/* ─── 5. KTAS (F3) 선택 바 ─── */}
      <EMRPanel title="KTAS 중증도" hotkey="F3">
        <div className="p-2 flex items-center gap-3">
          <span className="text-[11px] font-bold text-gray-700">KTAS</span>
          <span className="font-mono text-[11px] text-gray-600">
            {value.ktas ? `K${value.ktas}` : "—"}
          </span>
          <div className="grid grid-cols-5 gap-1 flex-1">
            {([1, 2, 3, 4, 5] as KTAS[]).map(k => {
              const meta = KTAS_META[k];
              const active = value.ktas === k;
              return (
                <button key={k} type="button" onClick={() => onChange({ ktas: k })}
                  className={`py-1.5 border border-gray-400 text-[12px] font-bold ${
                    active ? `${meta.bg} ${meta.text}` : "bg-white text-gray-700 hover:bg-gray-100"
                  }`}>
                  {k} {meta.label}
                </button>
              );
            })}
          </div>
          <span className="text-[10px] text-gray-500 w-32 text-right">
            {value.ktas ? KTAS_META[value.ktas].desc : "1=소생 / 5=비응급"}
          </span>
        </div>
      </EMRPanel>

      {/* ─── 성별 / 도착시각 (보조 입력 영역) ─── */}
      <EMRPanel title="기본 입력">
        <div className="p-2 grid grid-cols-3 gap-3 text-[11px]">
          <label className="flex items-center gap-2">
            <span className="font-bold text-gray-700 w-12">이름</span>
            <input className={inputCell}
              value={value.name ?? ""}
              onChange={e => onChange({ name: e.target.value })} />
          </label>
          <label className="flex items-center gap-2">
            <span className="font-bold text-gray-700 w-12">나이</span>
            <input type="number" className={`${inputCell} text-center font-mono w-20`}
              value={value.age ?? ""}
              onChange={e => onChange({ age: Number(e.target.value) })} />
            <div className="flex gap-0.5 ml-2">
              {(["M", "F"] as Sex[]).map(s => {
                const active = value.sex === s;
                return (
                  <button key={s} type="button" onClick={() => onChange({ sex: s })}
                    className={`px-2 py-0.5 border border-gray-400 text-[11px] ${
                      active
                        ? s === "M" ? "bg-gray-700 text-white" : "bg-blue-900 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-100"
                    }`}>
                    {s === "M" ? "남" : "여"}
                  </button>
                );
              })}
            </div>
          </label>
          <label className="flex items-center gap-2">
            <span className="font-bold text-gray-700 w-12">도착</span>
            <input type="datetime-local"
              className={`${inputCell} font-mono bg-yellow-50/50`}
              value={value.arrived_at?.slice(0, 16) ?? ""}
              onChange={e => onChange({ arrived_at: e.target.value })} />
          </label>
        </div>
      </EMRPanel>
    </div>
  );
}
