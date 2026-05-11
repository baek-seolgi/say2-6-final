// 검사실 — 모든 환자의 LAB 오더 큐 (상태별 필터)
import { useState, useMemo } from "react";
import { FlaskConical, Clock, CheckCircle2, AlertTriangle } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { KTAS_META, type QueuePatient, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

type LabStatus = "pending" | "running" | "completed" | "critical";

interface LabOrder {
  patient: QueuePatient;
  panel: string;
  orderedAt: Date;
  status: LabStatus;
  resultSummary?: string;
  riskLevel?: "critical" | "urgent" | "routine";
}

// 데모용 mock 큐 — KTAS 기반으로 자동 생성
function buildLabQueue(): LabOrder[] {
  const PANELS = ["CBC", "BMP", "Cardiac Markers", "BUN/Cre + K+", "Liver panel", "Coag"];
  const now = Date.now();
  return ALL_PATIENTS.slice(0, 18).map((p, i) => {
    const orderedAt = new Date(now - (i + 1) * 7 * 60 * 1000);
    let status: LabStatus = "pending";
    let resultSummary: string | undefined;
    let riskLevel: LabOrder["riskLevel"] = "routine";
    if (i % 5 === 0 && p.ktas <= 2) {
      status = "critical";
      resultSummary = "K+ 6.6, BUN 172 — 중증 고칼륨혈증 + ESRD";
      riskLevel = "critical";
    } else if (i < 5) {
      status = "completed";
      resultSummary = "WBC 12.4, CRP 8.2 — 감염 의심";
      riskLevel = "urgent";
    } else if (i < 10) {
      status = "running";
    }
    return {
      patient: p,
      panel: PANELS[i % PANELS.length],
      orderedAt,
      status,
      resultSummary,
      riskLevel,
    };
  });
}

const STATUS_META: Record<LabStatus, { ko: string; bg: string; text: string }> = {
  pending:   { ko: "대기",     bg: "bg-gray-200",    text: "text-gray-800" },
  running:   { ko: "분석 중",  bg: "bg-blue-100",    text: "text-blue-800" },
  completed: { ko: "완료",     bg: "bg-emerald-100", text: "text-emerald-800" },
  critical:  { ko: "긴급",     bg: "bg-red-100",     text: "text-red-800" },
};

export default function LabQueuePage() {
  const [filter, setFilter] = useState<LabStatus | "all">("all");
  const queue = useMemo(buildLabQueue, []);

  const filtered = filter === "all" ? queue : queue.filter((q) => q.status === filter);
  const counts = queue.reduce(
    (acc, q) => ({ ...acc, [q.status]: (acc[q.status] || 0) + 1 }),
    {} as Record<LabStatus, number>
  );

  return (
    <EMRPageShell
      title="검사실 큐 (LAB)"
      subtitle={`전체 ${queue.length}건 / 표시 ${filtered.length}건`}
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측 — 통계 */}
        <aside className="col-span-3 space-y-3">
          <Panel title="LAB 현황">
            <div className="grid grid-cols-2 gap-2">
              <StatusCard label="긴급" count={counts.critical || 0} color="bg-red-50 border-red-400 text-red-700" icon={AlertTriangle} />
              <StatusCard label="분석 중" count={counts.running || 0} color="bg-blue-50 border-blue-400 text-blue-700" icon={FlaskConical} />
              <StatusCard label="완료" count={counts.completed || 0} color="bg-emerald-50 border-emerald-400 text-emerald-700" icon={CheckCircle2} />
              <StatusCard label="대기" count={counts.pending || 0} color="bg-gray-50 border-gray-400 text-gray-700" icon={Clock} />
            </div>
          </Panel>
          <Panel title="필터">
            <div className="flex flex-wrap gap-1">
              {(["all", "critical", "running", "completed", "pending"] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={[
                    "px-2 py-1 text-[11px] font-bold border",
                    filter === f
                      ? "bg-gray-800 text-white border-gray-900"
                      : "bg-white text-gray-700 border-gray-300 hover:bg-gray-100",
                  ].join(" ")}
                >
                  {f === "all" ? "전체" : STATUS_META[f].ko}
                </button>
              ))}
            </div>
          </Panel>
        </aside>

        {/* 우측 — 큐 테이블 */}
        <section className="col-span-9">
          <Panel title="검사 오더 큐">
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300 bg-gray-100 text-gray-800">
                  <th className="text-left px-2 py-1.5 w-12">KTAS</th>
                  <th className="text-left px-2 py-1.5">환자</th>
                  <th className="text-left px-2 py-1.5">검사 패널</th>
                  <th className="text-left px-2 py-1.5 w-20">오더</th>
                  <th className="text-left px-2 py-1.5 w-20">상태</th>
                  <th className="text-left px-2 py-1.5">결과 요약</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((q, i) => {
                  const ktas = KTAS_META[q.patient.ktas as KTAS];
                  const sm = STATUS_META[q.status];
                  return (
                    <tr key={i} className="border-b border-gray-200 hover:bg-gray-50">
                      <td className="px-2 py-1">
                        <span className={`inline-block w-5 h-5 leading-5 text-center text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
                          {q.patient.ktas}
                        </span>
                      </td>
                      <td className="px-2 py-1">
                        <span className="font-bold text-gray-900">{q.patient.name}</span>
                        <span className="text-[10px] font-mono text-gray-500 ml-2">#{q.patient.mrn}</span>
                      </td>
                      <td className="px-2 py-1 text-gray-700">{q.panel}</td>
                      <td className="px-2 py-1 font-mono text-[10px] text-gray-600">
                        {q.orderedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0 text-[10px] font-bold ${sm.bg} ${sm.text}`}>
                          {sm.ko}
                        </span>
                      </td>
                      <td className={`px-2 py-1 ${q.riskLevel === "critical" ? "text-red-700 font-bold" : "text-gray-700"}`}>
                        {q.resultSummary ? (
                          <span className="flex items-center gap-1">
                            {q.riskLevel === "critical" && <AlertTriangle size={11} />}
                            {q.resultSummary}
                          </span>
                        ) : (
                          <span className="text-gray-400 italic">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
        </section>
      </div>
    </EMRPageShell>
  );
}

function StatusCard({
  label,
  count,
  color,
  icon: Icon,
}: {
  label: string;
  count: number;
  color: string;
  icon: typeof FlaskConical;
}) {
  return (
    <div className={`border ${color} px-2 py-2`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold">
        <Icon size={11} />
        {label}
      </div>
      <p className="font-mono text-[18px] font-bold mt-0.5">{count}</p>
    </div>
  );
}
