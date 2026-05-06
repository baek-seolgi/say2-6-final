// 응급실 환자 대기열 사이드바 — NEDIS / 권역응급의료센터 표준
// [구조]
//   1. 진한 네이비 헤더 (응급센터 식별)
//   2. 운영 통계 (가용병상 / 체류 / 의료진)
//   3. KTAS 분포 + 의료법 KPI (평균체류 / 6h 초과)
//   4. 7-stage 환자 동선 탭 (도착 → 트리아지 → 진료중 → 검사 → 결과대기 → 입원대기 → 퇴실)
//   5. 검색
//   6. 환자 카드 리스트
import { useMemo, useState } from "react";
import { Search, Clock, AlertCircle, BedDouble, UserRound } from "lucide-react";
import {
  CHIEF_COMPLAINT_LABELS,
  KTAS_META,
  type QueuePatient,
  type ChiefComplaint,
  type EDStatus,
} from "../../types/triage";

const COMPLAINT_ICD: Record<ChiefComplaint, string> = {
  chest_pain: "R07.4", dyspnea: "R06.0", abdominal_pain: "R10.4",
  fever: "R50.9", trauma: "T14.9", altered_mental: "R41.82",
  syncope: "R55", headache: "R51", weakness: "R53.1",
  palpitation: "R00.2", back_pain: "M54.9", nausea_vomiting: "R11.0",
  other: "R69",
};

interface Props {
  patients: QueuePatient[];
  selectedId: string | null;
  onSelect: (p: QueuePatient) => void;
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const min = Math.max(0, Math.floor(ms / 60000));
  if (min < 60) return `${min}분`;
  return `${Math.floor(min / 60)}h ${min % 60}m`;
}

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

// ─── 7단계 환자 동선 ─────────────────────────────────────
const STAGE_ORDER: EDStatus[] = [
  "arrived", "triage", "in_consult", "testing",
  "results_pending", "admit_wait", "discharged",
];

const STAGE_META: Record<EDStatus, { ko: string; tone: string; bg: string }> = {
  arrived:         { ko: "도착",     tone: "text-gray-700",    bg: "bg-gray-100 text-gray-700 border border-gray-400" },
  triage:          { ko: "트리아지", tone: "text-blue-900",    bg: "bg-blue-100 text-blue-900 border border-blue-700" },
  in_consult:      { ko: "진료중",   tone: "text-cyan-900",    bg: "bg-cyan-100 text-cyan-900 border border-cyan-700" },
  testing:         { ko: "검사진행", tone: "text-orange-900",  bg: "bg-orange-100 text-orange-900 border border-orange-600" },
  results_pending: { ko: "결과대기", tone: "text-amber-900",   bg: "bg-amber-100 text-amber-900 border border-amber-600" },
  admit_wait:     { ko: "입원대기",  tone: "text-purple-900",  bg: "bg-purple-100 text-purple-900 border border-purple-700" },
  discharged:      { ko: "퇴실",     tone: "text-emerald-900", bg: "bg-emerald-100 text-emerald-900 border border-emerald-700" },
};

// KTAS 색상 (한국 표준)
const KTAS_COLORS: Record<number, string> = {
  1: "bg-blue-600",
  2: "bg-red-600",
  3: "bg-amber-500",
  4: "bg-emerald-600",
  5: "bg-slate-500",
};

export default function TriageQueueSidebar({ patients, selectedId, onSelect }: Props) {
  const [query, setQuery] = useState("");
  const [activeStage, setActiveStage] = useState<EDStatus | "all">("triage");

  // 단계별 카운트
  const stageCounts = useMemo(() => {
    const c: Record<EDStatus, number> = {
      arrived: 0, triage: 0, in_consult: 0, testing: 0,
      results_pending: 0, admit_wait: 0, discharged: 0,
    };
    patients.forEach((p) => (c[p.status] += 1));
    return c;
  }, [patients]);

  // KTAS 분포
  const ktasCounts = useMemo(() => {
    const c: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    patients.forEach((p) => (c[p.ktas] = (c[p.ktas] || 0) + 1));
    return c;
  }, [patients]);

  // 평균 체류시간 (퇴실 제외) + 6시간 초과 인원
  const { avgStayMin, over6h } = useMemo(() => {
    const inED = patients.filter((p) => p.status !== "discharged");
    if (inED.length === 0) return { avgStayMin: 0, over6h: 0 };
    const total = inED.reduce((sum, p) => sum + minutesSince(p.arrived_at), 0);
    const over = inED.filter((p) => minutesSince(p.arrived_at) > 360).length;
    return { avgStayMin: Math.floor(total / inED.length), over6h: over };
  }, [patients]);

  const inEDCount = patients.length - stageCounts.discharged;

  // 필터링
  const filtered = useMemo(() => {
    return patients.filter((p) => {
      if (activeStage !== "all" && p.status !== activeStage) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    });
  }, [patients, query, activeStage]);

  // KTAS 분포 막대 (시각화)
  const ktasMax = Math.max(...Object.values(ktasCounts), 1);

  return (
    <aside className="w-[320px] bg-white border-r border-gray-400 flex flex-col h-full">
      {/* ─── 1단: 응급센터 식별 (환자정보 바와 동일 진회색) ───────────── */}
      <div className="bg-gray-800 text-white px-3 py-2 border-b border-gray-900">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-bold tracking-widest text-yellow-200">권역응급의료센터</span>
          <span className="text-[11px] font-mono font-medium text-gray-300">
            {new Date().toLocaleString("ko-KR", { hour12: false }).replace(/\.\s/g, "-").slice(0, 16)}
          </span>
        </div>
        <div className="text-[15px] font-bold mt-0.5 text-white tracking-tight">응급의학과 응급실</div>
      </div>

      {/* ─── 2단: 운영 통계 (가용병상 + 의료진) ───────────── */}
      <div className="bg-gray-50 border-b border-gray-300 px-3 py-2 text-[12px] space-y-1.5 whitespace-nowrap">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <BedDouble size={13} className="text-gray-700 flex-shrink-0" />
            <span className="text-gray-600 font-medium">가용 병상</span>
            <span className="font-mono font-bold text-gray-900">18/30</span>
            <span className="text-gray-500 text-[11px] font-medium">(60%)</span>
          </div>
          <div className="flex items-center gap-1 whitespace-nowrap">
            <UserRound size={13} className="text-gray-700 flex-shrink-0" />
            <span className="text-gray-600 font-medium">체류</span>
            <span className="font-mono font-bold text-gray-900">{inEDCount}명</span>
          </div>
        </div>
        <div className="border-t border-gray-300 pt-1.5 space-y-1">
          <div className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-gray-500 font-medium flex-shrink-0">당직</span>
            <span className="font-bold text-gray-900">김의사</span>
            <span className="text-gray-500 text-[11px] font-medium">(응급의학)</span>
          </div>
          <div className="flex items-baseline gap-2 whitespace-nowrap">
            <span className="text-gray-500 font-medium flex-shrink-0">수간호사</span>
            <span className="font-bold text-gray-900">박간호사</span>
          </div>
        </div>
      </div>

      {/* ─── 3단: KTAS 분포 + 의료법 KPI ───────────── */}
      <div className="bg-gray-50 border-b border-gray-400 px-3 py-2 text-[12px]">
        <div className="flex items-center gap-1 mb-1">
          <span className="text-gray-700 font-bold">KTAS</span>
          <span className="text-gray-500 text-[10px] font-medium">분포</span>
        </div>
        {/* 5개 막대 시각화 */}
        <div className="flex items-end gap-0.5 h-7 mb-1">
          {[1, 2, 3, 4, 5].map((k) => {
            const cnt = ktasCounts[k] ?? 0;
            const pct = (cnt / ktasMax) * 100;
            return (
              <div key={k} className="flex-1 flex flex-col items-center justify-end">
                <span className="text-[10px] font-mono font-bold text-gray-700 leading-none mb-0.5">{cnt}</span>
                <div
                  className={`w-full ${KTAS_COLORS[k]} transition-all`}
                  style={{ height: `${pct}%`, minHeight: cnt > 0 ? "3px" : "0" }}
                />
              </div>
            );
          })}
        </div>
        <div className="flex justify-between text-[10px] font-mono font-bold text-gray-600 mb-1.5">
          {[1, 2, 3, 4, 5].map((k) => (
            <span key={k} className="flex-1 text-center">K{k}</span>
          ))}
        </div>
        {/* 의료법 KPI */}
        <div className="flex items-center justify-between border-t border-gray-300 pt-1.5 text-[11px]">
          <span className="text-gray-600 font-medium">
            평균체류 <span className="font-mono font-bold text-gray-900 ml-0.5">
              {Math.floor(avgStayMin / 60)}h {avgStayMin % 60}m
            </span>
          </span>
          <span className={over6h > 0 ? "text-red-700 font-bold" : "text-gray-600 font-medium"}>
            6h↑ <span className="font-mono ml-0.5">{over6h}명</span> {over6h > 0 && "⚠"}
          </span>
        </div>
      </div>

      {/* ─── 4단: 7단계 환자 동선 탭 ───────────── */}
      <div className="bg-white border-b border-gray-400 overflow-x-auto">
        <div className="flex min-w-max">
          {STAGE_ORDER.map((stage) => {
            const meta = STAGE_META[stage];
            const cnt = stageCounts[stage];
            const active = activeStage === stage;
            return (
              <button
                key={stage}
                type="button"
                onClick={() => setActiveStage(stage)}
                className={`flex-shrink-0 px-2.5 py-2 text-[12px] font-bold border-r border-gray-300 last:border-r-0 transition-colors whitespace-nowrap ${
                  active
                    ? "bg-gray-800 text-white"
                    : `bg-white ${meta.tone} hover:bg-gray-50`
                }`}
              >
                {meta.ko}<span className={`ml-1 text-[10px] ${active ? "text-gray-300" : "text-gray-500"} font-medium`}>({cnt})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── 5단: 검색 ───────────── */}
      <div className="p-2 border-b border-gray-300 bg-white">
        <div className="relative">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="이름·MRN·ID 검색"
            className="w-full pl-7 pr-2 py-1.5 border border-gray-400 text-[12px] focus:outline-none focus:border-blue-900 bg-white"
          />
        </div>
      </div>

      {/* ─── 6단: 환자 카드 리스트 ───────────── */}
      <div className="flex-1 overflow-y-auto bg-white">
        {filtered.length === 0 ? (
          <div className="p-6 text-center text-[12px] text-gray-400">
            {STAGE_META[activeStage as EDStatus]?.ko ?? "일치하는"} 환자 없음
          </div>
        ) : (
          filtered.map((p) => {
            const meta = KTAS_META[p.ktas];
            const cc = CHIEF_COMPLAINT_LABELS[p.chief_complaint];
            const stageMeta = STAGE_META[p.status];
            const isSelected = p.id === selectedId;
            const isCritical = p.ktas <= 2;
            const stay = minutesSince(p.arrived_at);
            const isOver6h = stay > 360;
            return (
              <button
                key={p.id}
                type="button"
                onClick={() => onSelect(p)}
                className={`w-full text-left border-b border-gray-200 px-2.5 py-2 transition-colors flex gap-2 ${
                  isSelected
                    ? "bg-blue-50 border-l-4 border-l-blue-900"
                    : "bg-white hover:bg-gray-50 border-l-4 border-l-transparent"
                }`}
              >
                {/* 좌측: 색 점 + KTAS */}
                <div className="flex-shrink-0 flex flex-col items-center gap-1">
                  <span className={`w-2 h-2 rounded-full ${isCritical ? "bg-red-600" : "bg-blue-600"}`} />
                  <div className={`w-6 h-6 ${meta.bg} text-white flex items-center justify-center font-bold text-[12px]`}>
                    {p.ktas}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {/* 1행: 차트번호 + 알람 */}
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono text-[12px] text-red-600 font-bold">
                      ch.{p.mrn.replace(/^M\d{4}-?/, "").replace(/[^0-9]/g, "").slice(0, 6) || p.mrn}
                    </span>
                    <div className="flex items-center gap-1">
                      {isOver6h && (
                        <span className="text-[10px] text-red-700 font-bold border border-red-400 bg-red-50 px-1">6h↑</span>
                      )}
                      {isCritical && <AlertCircle size={11} className="text-red-600 animate-pulse" />}
                    </div>
                  </div>

                  {/* 2행: 환자명 + 성별/나이 */}
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-[14px] font-bold truncate text-gray-900">{p.name}</span>
                    <span className="text-[11px] text-gray-600 font-medium">{p.sex}/{p.age}세</span>
                  </div>

                  {/* 3행: ICD + 주증상 */}
                  <div className="text-[12px] text-gray-700 truncate flex items-center gap-1 mt-0.5">
                    <span className="font-mono text-[10px] text-blue-900 bg-blue-50 px-1 border border-blue-300 font-bold">
                      {COMPLAINT_ICD[p.chief_complaint]}
                    </span>
                    <span className="truncate font-medium">{cc.ko}</span>
                  </div>

                  {/* 4행: 단계 태그 + 체류시간 */}
                  <div className="flex items-center justify-between mt-1 gap-1">
                    <span className={`px-1.5 py-0.5 text-[10px] font-bold ${stageMeta.bg}`}>
                      {stageMeta.ko}
                    </span>
                    <span className={`flex items-center gap-0.5 text-[10px] font-mono ${isOver6h ? "text-red-700 font-bold" : "text-gray-600 font-medium"}`}>
                      <Clock size={9} /> {timeAgo(p.arrived_at)}
                    </span>
                  </div>
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
