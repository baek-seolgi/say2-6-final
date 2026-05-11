// 응급실 통계 — NEDIS 톤 KPI 대시보드
import { useMemo } from "react";
import { BedDouble, Users, AlertTriangle, Activity, Clock, TrendingUp } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { KTAS_META, type QueuePatient, type KTAS, type EDStatus } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

function minutesSince(iso: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60000));
}

const STAGE_KO: Record<EDStatus, string> = {
  arrived: "도착",
  triage: "트리아지",
  in_consult: "진료중",
  testing: "검사진행",
  results_pending: "결과대기",
  admit_wait: "입원대기",
  discharged: "퇴실",
};

export default function StatsPage() {
  const stats = useMemo(() => {
    const inED = ALL_PATIENTS.filter((p) => p.status !== "discharged");
    const ktasDist: Record<KTAS, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    const stageDist: Partial<Record<EDStatus, number>> = {};
    let totalStay = 0;
    let over6h = 0;
    inED.forEach((p) => {
      ktasDist[p.ktas as KTAS] = (ktasDist[p.ktas as KTAS] || 0) + 1;
      stageDist[p.status] = (stageDist[p.status] || 0) + 1;
      const m = minutesSince(p.arrived_at);
      totalStay += m;
      if (m > 360) over6h += 1;
    });
    const avgStay = inED.length > 0 ? Math.floor(totalStay / inED.length) : 0;
    const totalDischarged = ALL_PATIENTS.length - inED.length;
    return { inED, ktasDist, stageDist, avgStay, over6h, totalDischarged };
  }, []);

  return (
    <EMRPageShell
      title="응급실 통계 (NEDIS)"
      subtitle="실시간 KPI · KTAS 분포 · 단계별 환자 현황"
      headerRight={
        <span className="flex items-center gap-1 text-[10px] text-emerald-300 font-mono">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          실시간
        </span>
      }
    >
      <div className="space-y-3">
        {/* KPI 큰 카드 6개 */}
        <div className="grid grid-cols-6 gap-2">
          <KPICard label="입실 환자" value={stats.inED.length} unit="명" icon={Users} color="bg-blue-50 border-blue-400 text-blue-700" />
          <KPICard label="가용 병상" value={`${30 - stats.inED.length}`} unit={`/30`} icon={BedDouble} color="bg-emerald-50 border-emerald-400 text-emerald-700" />
          <KPICard
            label="6h↑ 환자"
            value={stats.over6h}
            unit="명"
            icon={AlertTriangle}
            color={stats.over6h > 0 ? "bg-red-50 border-red-400 text-red-700" : "bg-gray-50 border-gray-300 text-gray-700"}
          />
          <KPICard label="평균 체류" value={`${Math.floor(stats.avgStay / 60)}시${stats.avgStay % 60}분`} icon={Clock} color="bg-amber-50 border-amber-400 text-amber-700" />
          <KPICard label="KTAS 1·2" value={stats.ktasDist[1] + stats.ktasDist[2]} unit="명" icon={Activity} color="bg-red-50 border-red-400 text-red-700" />
          <KPICard label="퇴실/입원" value={stats.totalDischarged} unit="명" icon={TrendingUp} color="bg-gray-50 border-gray-300 text-gray-700" />
        </div>

        <div className="grid grid-cols-12 gap-3">
          {/* KTAS 분포 막대 */}
          <section className="col-span-6">
            <Panel title="KTAS 분포 (실시간)">
              <div className="space-y-2">
                {([1, 2, 3, 4, 5] as KTAS[]).map((k) => {
                  const count = stats.ktasDist[k];
                  const pct = stats.inED.length > 0 ? (count / stats.inED.length) * 100 : 0;
                  const meta = KTAS_META[k];
                  return (
                    <div key={k} className="flex items-center gap-2 text-[12px]">
                      <span className={`w-7 h-7 flex items-center justify-center text-[12px] font-bold ${meta.bg} ${meta.text}`}>
                        {k}
                      </span>
                      <span className="w-14 text-gray-700">{meta.label}</span>
                      <div className="flex-1 bg-gray-100 border border-gray-300 h-5 relative">
                        <div
                          className={`h-full ${meta.bg}`}
                          style={{ width: `${pct}%` }}
                        />
                        {pct > 12 && (
                          <span className="absolute inset-0 flex items-center px-2 text-white text-[10px] font-bold">
                            {pct.toFixed(0)}%
                          </span>
                        )}
                      </div>
                      <span className="font-mono font-bold text-gray-900 w-10 text-right">{count}명</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-[10px] text-gray-500">
                총 {stats.inED.length}명 — KTAS 1·2 비중 {((stats.ktasDist[1] + stats.ktasDist[2]) / Math.max(stats.inED.length, 1) * 100).toFixed(0)}%
              </p>
            </Panel>
          </section>

          {/* 단계별 환자 분포 */}
          <section className="col-span-6">
            <Panel title="환자 동선 단계별 분포">
              <div className="grid grid-cols-7 gap-1">
                {(["arrived", "triage", "in_consult", "testing", "results_pending", "admit_wait", "discharged"] as EDStatus[]).map((s) => {
                  const count = s === "discharged" ? stats.totalDischarged : (stats.stageDist[s] ?? 0);
                  const max = Math.max(...Object.values(stats.stageDist).map(v => v ?? 0), stats.totalDischarged, 1);
                  const heightPct = (count / max) * 100;
                  return (
                    <div key={s} className="flex flex-col items-center gap-1">
                      <div className="h-32 w-full bg-gray-50 border border-gray-300 relative flex items-end">
                        <div
                          className="w-full bg-blue-500 transition-all"
                          style={{ height: `${heightPct}%` }}
                        />
                        <span className="absolute top-1 left-0 right-0 text-center text-[11px] font-bold text-gray-900">
                          {count}
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-700 text-center leading-tight">{STAGE_KO[s]}</p>
                    </div>
                  );
                })}
              </div>
            </Panel>
          </section>

          {/* 6h↑ 환자 명단 */}
          <section className="col-span-12">
            <Panel
              title="6시간 초과 환자 (의료법 모니터링)"
              headerRight={
                <span className={`text-[10px] font-mono px-1.5 ${stats.over6h > 0 ? "bg-red-100 text-red-800 border border-red-400" : "bg-gray-100 text-gray-700 border border-gray-300"} font-bold`}>
                  {stats.over6h}명
                </span>
              }
            >
              {stats.over6h === 0 ? (
                <p className="text-[12px] text-emerald-700 italic flex items-center gap-1">
                  ✓ 6시간 초과 환자 없음 — 양호
                </p>
              ) : (
                <table className="w-full text-[11.5px]">
                  <thead className="bg-gray-100 border-b border-gray-300">
                    <tr>
                      <th className="text-left px-2 py-1 w-12">KTAS</th>
                      <th className="text-left px-2 py-1">환자</th>
                      <th className="text-left px-2 py-1 w-32">현재 단계</th>
                      <th className="text-left px-2 py-1 w-24">체류 시간</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.inED
                      .filter((p) => minutesSince(p.arrived_at) > 360)
                      .sort((a, b) => minutesSince(b.arrived_at) - minutesSince(a.arrived_at))
                      .slice(0, 10)
                      .map((p) => {
                        const m = minutesSince(p.arrived_at);
                        const ktas = KTAS_META[p.ktas as KTAS];
                        return (
                          <tr key={p.id} className="border-b border-gray-100">
                            <td className="px-2 py-1">
                              <span className={`inline-block w-5 h-5 leading-5 text-center text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
                                {p.ktas}
                              </span>
                            </td>
                            <td className="px-2 py-1 font-bold">
                              {p.name}
                              <span className="text-[10px] font-mono text-gray-500 ml-2">#{p.mrn}</span>
                            </td>
                            <td className="px-2 py-1 text-gray-700">{STAGE_KO[p.status]}</td>
                            <td className="px-2 py-1 font-mono text-red-700 font-bold">
                              {Math.floor(m / 60)}시{m % 60}분
                            </td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              )}
            </Panel>
          </section>
        </div>
      </div>
    </EMRPageShell>
  );
}

function KPICard({
  label,
  value,
  unit,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  unit?: string;
  icon: typeof Users;
  color: string;
}) {
  return (
    <div className={`border-2 ${color} px-3 py-2`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest font-bold opacity-80">
        <Icon size={11} />
        {label}
      </div>
      <p className="font-mono text-[22px] font-bold mt-1 leading-none">
        {value}
        {unit && <span className="text-[12px] font-normal ml-1 opacity-70">{unit}</span>}
      </p>
    </div>
  );
}
