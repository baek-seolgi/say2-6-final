// 기록보기 — 환자별 진료 timeline (encounter 목록 + 결과 요약)
import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ChevronRight, FileText, HeartPulse, FlaskConical, Image as ImageIcon, ArrowLeft } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import {
  KTAS_META,
  CHIEF_COMPLAINT_LABELS,
  PAST_HISTORY_LABELS,
  type QueuePatient,
  type KTAS,
} from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

// 데모용 가짜 과거 진료 기록 (실제론 ops_db + FHIR Encounter 시계열)
function fakeHistory(patient: QueuePatient) {
  const today = new Date();
  return [
    {
      date: today.toLocaleDateString("ko-KR"),
      ktas: patient.ktas,
      cc: patient.chief_complaint,
      detail: patient.complaint_detail,
      modals: ["ECG", "LAB"],
      outcome: "AI 분석 진행 중",
      severity: "current",
    },
    {
      date: new Date(today.getTime() - 14 * 86400000).toLocaleDateString("ko-KR"),
      ktas: 3,
      cc: "fever",
      detail: "고열 + 인후통, 외래 의뢰",
      modals: ["LAB"],
      outcome: "급성 인후염 — 외래 처방",
      severity: "past",
    },
    {
      date: new Date(today.getTime() - 90 * 86400000).toLocaleDateString("ko-KR"),
      ktas: 4,
      cc: "back_pain",
      detail: "허리 통증, 외상 없음",
      modals: ["LAB"],
      outcome: "근막통증 — 진통제 처방",
      severity: "past",
    },
  ];
}

export default function RecordsPage() {
  const { mrn } = useParams<{ mrn: string }>();
  const navigate = useNavigate();
  const patient = ALL_PATIENTS.find((p) => p.mrn === mrn) ?? null;
  const [activeIdx, setActiveIdx] = useState(0);

  if (!patient) {
    return (
      <EMRPageShell title="기록보기" subtitle="환자 미선택">
        <div className="bg-white border border-gray-300 px-4 py-6 text-center">
          <p className="text-[13px] text-gray-700 mb-3">조회할 환자를 선택해주세요.</p>
          <button
            onClick={() => navigate("/patients")}
            className="px-4 py-1.5 bg-gray-800 text-white text-[12px] font-bold border border-gray-900"
          >
            환자조회로 이동
          </button>
        </div>
      </EMRPageShell>
    );
  }

  const ktas = KTAS_META[patient.ktas as KTAS];
  const ccLabel = patient.chief_complaint
    ? CHIEF_COMPLAINT_LABELS[patient.chief_complaint]?.ko
    : "—";
  const history = fakeHistory(patient);
  const active = history[activeIdx];

  return (
    <EMRPageShell
      title={`기록보기 — ${patient.name}`}
      subtitle={`#${patient.mrn} · ${patient.sex === "M" ? "남" : "여"}/${patient.age}`}
      headerRight={
        <button
          onClick={() => navigate("/patients")}
          className="px-2 py-1 text-[11px] bg-gray-700 text-white border border-gray-900 hover:bg-gray-600 flex items-center gap-1"
        >
          <ArrowLeft size={12} /> 환자조회
        </button>
      }
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측 — 환자 카드 */}
        <aside className="col-span-3 space-y-3">
          <Panel title="환자 정보">
            <table className="w-full text-[11.5px]">
              <tbody>
                <Row label="차트번호" v={<span className="font-mono">{patient.mrn}</span>} />
                <Row label="성별/나이" v={`${patient.sex === "M" ? "남" : "여"} / ${patient.age}세`} />
                <Row label="KTAS" v={
                  <span className={`px-1.5 py-0 text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
                    {patient.ktas} · {ktas.label}
                  </span>
                } />
                <Row label="현재 주호소" v={<span className="text-red-700 font-bold">{ccLabel}</span>} />
                <Row label="과거력" v={
                  patient.past_history && patient.past_history.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {patient.past_history.slice(0, 6).map((h) => (
                        <span key={h} className="px-1.5 py-0 bg-gray-100 border border-gray-300 text-[10px] font-mono" title={PAST_HISTORY_LABELS[h]}>{h}</span>
                      ))}
                    </div>
                  ) : <span className="text-gray-500">없음</span>
                } />
                <Row label="알레르기" v={<span className={patient.allergies && patient.allergies !== "NKDA" ? "text-red-700 font-bold" : ""}>{patient.allergies || "NKDA"}</span>} />
              </tbody>
            </table>
          </Panel>

          <Panel title="진료 시계열">
            <ol className="space-y-1">
              {history.map((h, i) => (
                <li
                  key={i}
                  onClick={() => setActiveIdx(i)}
                  className={[
                    "px-2 py-1.5 cursor-pointer border-l-4 text-[11px]",
                    activeIdx === i
                      ? "bg-blue-50 border-l-blue-600"
                      : "bg-white border-l-transparent hover:bg-gray-50",
                  ].join(" ")}
                >
                  <p className="font-mono text-gray-600">{h.date}</p>
                  <p className="font-bold text-gray-900 truncate">
                    {(CHIEF_COMPLAINT_LABELS as Record<string, { ko: string; en: string }>)[h.cc as string]?.ko ?? h.cc}
                  </p>
                  <p className="text-gray-600 truncate">{h.outcome}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </aside>

        {/* 우측 — 선택된 encounter 상세 */}
        <section className="col-span-9">
          <Panel
            title={`방문 상세 — ${active.date}`}
            headerRight={
              active.severity === "current" ? (
                <button
                  onClick={() => navigate(`/dashboard?patient=${patient.id}`)}
                  className="px-2 py-0.5 text-[11px] bg-emerald-700 text-white border border-emerald-900 hover:bg-emerald-800 flex items-center gap-1"
                >
                  AI 분석 보기 <ChevronRight size={11} />
                </button>
              ) : null
            }
          >
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <DetailCard label="KTAS" value={`${active.ktas} (${KTAS_META[active.ktas as KTAS]?.label})`} />
                <DetailCard label="주호소" value={(CHIEF_COMPLAINT_LABELS as Record<string, { ko: string; en: string }>)[active.cc as string]?.ko ?? (active.cc as string)} />
                <DetailCard label="시행 모달" value={active.modals.join(", ")} icons />
                <DetailCard label="결과" value={active.outcome} />
              </div>

              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-600 font-bold mb-1">
                  자유서술
                </p>
                <div className="bg-gray-50 border border-gray-300 px-3 py-2 text-[12px] text-gray-800 leading-relaxed">
                  {active.detail || "기록 없음"}
                </div>
              </div>

              {active.severity === "current" && (
                <div className="bg-amber-50 border border-amber-300 px-3 py-2 text-[12px] text-amber-800 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                  현재 진료 중인 방문 — AI 분석 페이지에서 실시간 결과 확인 가능
                </div>
              )}
            </div>
          </Panel>
        </section>
      </div>
    </EMRPageShell>
  );
}

function Row({ label, v }: { label: string; v: React.ReactNode }) {
  return (
    <tr className="border-b border-gray-200 last:border-b-0">
      <th className="text-left bg-gray-100 border-r border-gray-300 px-2 py-1 text-[10px] font-bold text-gray-700 w-20 align-top">{label}</th>
      <td className="px-2 py-1 align-top">{v}</td>
    </tr>
  );
}

function DetailCard({ label, value, icons }: { label: string; value: string; icons?: boolean }) {
  const ICON_MAP: Record<string, typeof FileText> = {
    ECG: HeartPulse,
    CXR: ImageIcon,
    LAB: FlaskConical,
  };
  return (
    <div className="bg-white border border-gray-300 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-gray-600 font-bold mb-0.5">{label}</p>
      {icons && value ? (
        <div className="flex items-center gap-2 text-[12px] font-bold text-gray-900">
          {value.split(", ").map((m) => {
            const Icon = ICON_MAP[m] || FileText;
            return (
              <span key={m} className="flex items-center gap-1">
                <Icon size={13} /> {m}
              </span>
            );
          })}
        </div>
      ) : (
        <p className="text-[13px] font-bold text-gray-900">{value}</p>
      )}
    </div>
  );
}
