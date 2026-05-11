// 환자조회 — MRN/이름/차트번호로 환자 검색 → 클릭 시 진료기록(/records/:id)으로 이동
import { useState, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Search, ChevronRight, Calendar, Clock } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import {
  KTAS_META,
  CHIEF_COMPLAINT_LABELS,
  type QueuePatient,
  type KTAS,
} from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

export default function PatientSearchPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [filterKtas, setFilterKtas] = useState<KTAS | "all">("all");

  const results = useMemo(() => {
    return ALL_PATIENTS.filter((p) => {
      if (filterKtas !== "all" && p.ktas !== filterKtas) return false;
      if (!query) return true;
      const q = query.toLowerCase();
      return (
        p.name.toLowerCase().includes(q) ||
        p.mrn.toLowerCase().includes(q) ||
        p.id.toLowerCase().includes(q)
      );
    }).sort((a, b) => (a.ktas ?? 5) - (b.ktas ?? 5));
  }, [query, filterKtas]);

  return (
    <EMRPageShell
      title="환자 조회"
      subtitle={`총 ${ALL_PATIENTS.length}명 등록 / ${results.length}명 검색됨`}
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측: 검색 + 필터 */}
        <aside className="col-span-3 space-y-3">
          <Panel title="검색" hotkey="F2">
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 border border-gray-400 bg-white px-2 h-9">
                <Search size={14} className="text-gray-500" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="이름 / 차트번호 / MRN"
                  className="flex-1 outline-none text-[12px] bg-transparent"
                />
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1">
                  KTAS 필터
                </p>
                <div className="grid grid-cols-3 gap-1">
                  <FilterPill
                    label="전체"
                    active={filterKtas === "all"}
                    onClick={() => setFilterKtas("all")}
                  />
                  {([1, 2, 3, 4, 5] as KTAS[]).map((k) => {
                    const meta = KTAS_META[k];
                    return (
                      <FilterPill
                        key={k}
                        label={`${k} ${meta.label}`}
                        active={filterKtas === k}
                        onClick={() => setFilterKtas(k)}
                        color={meta.bg}
                      />
                    );
                  })}
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="단축키 안내">
            <ul className="text-[11px] text-gray-700 space-y-1">
              <li>• 환자 클릭 → 진료기록 열람</li>
              <li>• 환자 더블클릭 → AI 분석 진행</li>
              <li>• KTAS 1·2 = 우선순위</li>
            </ul>
          </Panel>
        </aside>

        {/* 우측: 결과 테이블 */}
        <section className="col-span-9">
          <Panel
            title="검색 결과"
            headerRight={
              <span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">
                {results.length} hits
              </span>
            }
          >
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="border-b-2 border-gray-300 bg-gray-100 text-gray-800">
                  <th className="text-left px-2 py-1.5 w-12">KTAS</th>
                  <th className="text-left px-2 py-1.5 w-20">차트번호</th>
                  <th className="text-left px-2 py-1.5">성명</th>
                  <th className="text-left px-2 py-1.5 w-16">성별/나이</th>
                  <th className="text-left px-2 py-1.5">주호소</th>
                  <th className="text-left px-2 py-1.5 w-32">도착시각</th>
                  <th className="text-left px-2 py-1.5 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {results.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-2 py-4 text-center text-gray-500 italic">
                      검색 결과 없음
                    </td>
                  </tr>
                )}
                {results.map((p) => {
                  const ktas = KTAS_META[p.ktas as KTAS];
                  const cc = p.chief_complaint
                    ? CHIEF_COMPLAINT_LABELS[p.chief_complaint]?.ko ?? p.chief_complaint
                    : "—";
                  return (
                    <tr
                      key={p.id}
                      onClick={() => navigate(`/records/${p.mrn}`)}
                      onDoubleClick={() => navigate(`/dashboard?patient=${p.id}`)}
                      className="border-b border-gray-200 hover:bg-blue-50 cursor-pointer"
                    >
                      <td className="px-2 py-1.5">
                        <span className={`inline-block w-6 h-6 leading-6 text-center text-[11px] font-bold ${ktas.bg} ${ktas.text}`}>
                          {p.ktas}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 font-mono text-gray-700">{p.mrn}</td>
                      <td className="px-2 py-1.5 font-bold text-gray-900">{p.name}</td>
                      <td className="px-2 py-1.5 text-gray-700">
                        {p.sex === "M" ? "남" : "여"} / {p.age}
                      </td>
                      <td className="px-2 py-1.5 text-red-700 truncate max-w-[300px]">{cc}</td>
                      <td className="px-2 py-1.5 text-[11px] text-gray-600 font-mono">
                        <span className="inline-flex items-center gap-1">
                          <Clock size={11} />
                          {new Date(p.arrived_at).toLocaleString("ko-KR", {
                            month: "2-digit",
                            day: "2-digit",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </td>
                      <td className="px-2 py-1.5 text-gray-400">
                        <ChevronRight size={14} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Panel>
          <p className="mt-2 text-[10px] text-gray-500 flex items-center gap-1">
            <Calendar size={11} />
            클릭 → 진료기록 / 더블클릭 → AI 분석 즉시 진행
          </p>
        </section>
      </div>
    </EMRPageShell>
  );
}

function FilterPill({
  label,
  active,
  onClick,
  color,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  color?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-1.5 py-1 text-[10px] font-bold border transition-colors",
        active
          ? `${color ?? "bg-gray-800"} text-white border-gray-900`
          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-100",
      ].join(" ")}
    >
      {label}
    </button>
  );
}
