// 영상실 — CXR/CT/MRI 오더 큐 (방사선사 측)
import { useState, useMemo } from "react";
import { Image as ImageIcon, Clock, CheckCircle2, AlertTriangle, Eye } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { KTAS_META, type QueuePatient, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

type ImgStatus = "pending" | "scanning" | "ai_analysis" | "completed" | "critical";

interface ImgOrder {
  patient: QueuePatient;
  modality: "흉부X-ray" | "흉부CT" | "복부CT" | "Brain MRI";
  view?: string;
  orderedAt: Date;
  status: ImgStatus;
  finding?: string;
  ctr?: number;
}

function buildImagingQueue(): ImgOrder[] {
  const PROCEDURES: Array<ImgOrder["modality"]> = ["흉부X-ray", "흉부CT", "복부CT", "Brain MRI"];
  const VIEWS = ["PA", "AP", "Lateral", "PA+Lat"];
  const now = Date.now();
  return ALL_PATIENTS.slice(0, 14).map((p, i) => {
    const mod = PROCEDURES[i % PROCEDURES.length];
    const view = mod === "흉부X-ray" ? VIEWS[i % VIEWS.length] : undefined;
    const orderedAt = new Date(now - (i + 1) * 6 * 60 * 1000);
    let status: ImgStatus = "pending";
    let finding: string | undefined;
    let ctr: number | undefined;
    if (i % 6 === 0 && p.ktas <= 2) {
      status = "critical";
      finding = "심확대 + 폐부종 의심 (CTR 0.60)";
      ctr = 0.6;
    } else if (i < 4) {
      status = "completed";
      finding = "특이소견 없음";
    } else if (i < 8) {
      status = "ai_analysis";
    } else if (i < 11) {
      status = "scanning";
    }
    return { patient: p, modality: mod, view, orderedAt, status, finding, ctr };
  });
}

const STATUS_META: Record<ImgStatus, { ko: string; bg: string; text: string }> = {
  pending:     { ko: "대기",     bg: "bg-gray-200",    text: "text-gray-800" },
  scanning:    { ko: "촬영 중",  bg: "bg-amber-100",   text: "text-amber-800" },
  ai_analysis: { ko: "AI 분석",  bg: "bg-blue-100",    text: "text-blue-800" },
  completed:   { ko: "완료",     bg: "bg-emerald-100", text: "text-emerald-800" },
  critical:    { ko: "긴급",     bg: "bg-red-100",     text: "text-red-800" },
};

export default function ImagingQueuePage() {
  const [filter, setFilter] = useState<ImgStatus | "all">("all");
  const queue = useMemo(buildImagingQueue, []);

  const filtered = filter === "all" ? queue : queue.filter((q) => q.status === filter);
  const counts = queue.reduce(
    (acc, q) => ({ ...acc, [q.status]: (acc[q.status] || 0) + 1 }),
    {} as Record<ImgStatus, number>
  );

  return (
    <EMRPageShell
      title="영상실 큐 (CXR/CT/MRI)"
      subtitle={`전체 ${queue.length}건 / 표시 ${filtered.length}건`}
    >
      <div className="grid grid-cols-12 gap-3">
        <aside className="col-span-3 space-y-3">
          <Panel title="영상 현황">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="긴급" count={counts.critical || 0} color="bg-red-50 border-red-400 text-red-700" icon={AlertTriangle} />
              <Stat label="촬영 중" count={counts.scanning || 0} color="bg-amber-50 border-amber-400 text-amber-700" icon={ImageIcon} />
              <Stat label="AI 분석" count={counts.ai_analysis || 0} color="bg-blue-50 border-blue-400 text-blue-700" icon={Eye} />
              <Stat label="완료" count={counts.completed || 0} color="bg-emerald-50 border-emerald-400 text-emerald-700" icon={CheckCircle2} />
            </div>
          </Panel>
          <Panel title="필터">
            <div className="flex flex-wrap gap-1">
              {(["all", "critical", "scanning", "ai_analysis", "completed", "pending"] as const).map((f) => (
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
          <Panel title="장비 현황 (mock)">
            <ul className="text-[11px] space-y-1">
              <li className="flex items-center justify-between">
                <span>X-ray Room A</span>
                <span className="px-1.5 py-0 bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-400">가동</span>
              </li>
              <li className="flex items-center justify-between">
                <span>X-ray Room B</span>
                <span className="px-1.5 py-0 bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-400">사용 중</span>
              </li>
              <li className="flex items-center justify-between">
                <span>CT 64-channel</span>
                <span className="px-1.5 py-0 bg-emerald-100 text-emerald-800 text-[10px] font-bold border border-emerald-400">가동</span>
              </li>
              <li className="flex items-center justify-between">
                <span>MRI 1.5T</span>
                <span className="px-1.5 py-0 bg-red-100 text-red-800 text-[10px] font-bold border border-red-400">점검 중</span>
              </li>
            </ul>
          </Panel>
        </aside>

        <section className="col-span-9">
          <Panel title="영상 오더 큐">
            <table className="w-full text-[11.5px] border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300 bg-gray-100 text-gray-800">
                  <th className="text-left px-2 py-1.5 w-12">KTAS</th>
                  <th className="text-left px-2 py-1.5">환자</th>
                  <th className="text-left px-2 py-1.5">검사</th>
                  <th className="text-left px-2 py-1.5 w-20">View</th>
                  <th className="text-left px-2 py-1.5 w-20">오더</th>
                  <th className="text-left px-2 py-1.5 w-20">상태</th>
                  <th className="text-left px-2 py-1.5">소견</th>
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
                      <td className="px-2 py-1 text-gray-700">{q.modality}</td>
                      <td className="px-2 py-1 text-[11px] font-mono text-gray-600">{q.view ?? "—"}</td>
                      <td className="px-2 py-1 font-mono text-[10px] text-gray-600">
                        {q.orderedAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                      </td>
                      <td className="px-2 py-1">
                        <span className={`px-1.5 py-0 text-[10px] font-bold ${sm.bg} ${sm.text}`}>
                          {sm.ko}
                        </span>
                      </td>
                      <td className={`px-2 py-1 ${q.status === "critical" ? "text-red-700 font-bold" : "text-gray-700"}`}>
                        {q.finding ? (
                          <span className="flex items-center gap-1">
                            {q.status === "critical" && <AlertTriangle size={11} />}
                            {q.finding}
                            {q.ctr !== undefined && (
                              <span className="ml-1 text-[10px] font-mono">CTR {q.ctr.toFixed(2)}</span>
                            )}
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

function Stat({
  label,
  count,
  color,
  icon: Icon,
}: {
  label: string;
  count: number;
  color: string;
  icon: typeof ImageIcon;
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
