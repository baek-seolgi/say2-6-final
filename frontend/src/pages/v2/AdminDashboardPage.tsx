import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  Users, Activity, ClipboardCheck, AlertTriangle, Clock, Bell, ChevronRight,
} from "lucide-react";
import { AppShell } from "../../components/v2/AppShell";
import { getAllPatients, isLivePatient, type DemoPatient } from "../../lib/v2/demoStore";
import { KTAS_META, type KTAS } from "../../types/triage";
import { cn } from "../../lib/cn";

/* ─────────────────────────────────────────────────────────
   say-6 검진 현황 대시보드 — 행정팀용 모니터링
   응급실 운영 현황 · 알림 · 활동 로그
   ───────────────────────────────────────────────────────── */

interface LogEntry {
  at: string;
  patient: DemoPatient;
  kind: "register" | "ai_done" | "await_sign" | "analyzing";
  text: string;
}

export default function AdminDashboardPage() {
  const nav = useNavigate();
  const patients = getAllPatients();

  const stats = useMemo(() => {
    const ktasDist: Record<KTAS, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    let critical = 0, analyzing = 0, done = 0, awaitingSign = 0;
    for (const p of patients) {
      ktasDist[p.ktas] = (ktasDist[p.ktas] ?? 0) + 1;
      if (p.aiVerdict?.risk === "critical" || p.ktas <= 2) critical += 1;
      if (p.aiStatus === "analyzing") analyzing += 1;
      if (p.aiStatus === "done") done += 1;
      if (p.awaitingSign) awaitingSign += 1;
    }
    return { total: patients.length, ktasDist, critical, analyzing, done, awaitingSign };
  }, [patients]);

  // 알림 — 위급 환자 + 미서명 소견서
  const alerts = useMemo(() => {
    const criticalPts = patients.filter((p) => p.aiVerdict?.risk === "critical" || p.ktas <= 2);
    const unsigned = patients.filter((p) => p.awaitingSign);
    return { criticalPts, unsigned };
  }, [patients]);

  // 활동 로그 — 환자 데이터에서 이벤트 합성, 최신순
  const logs = useMemo<LogEntry[]>(() => {
    const entries: LogEntry[] = [];
    for (const p of patients) {
      entries.push({ at: p.registeredAt, patient: p, kind: "register", text: "트리아지 등록 완료" });
      if (p.aiStatus === "done") {
        entries.push({ at: p.registeredAt, patient: p, kind: "ai_done", text: "AI 멀티모달 분석 완료" });
      } else if (p.aiStatus === "analyzing") {
        entries.push({ at: p.registeredAt, patient: p, kind: "analyzing", text: "AI 분석 진행 중" });
      }
      if (p.awaitingSign) {
        entries.push({ at: p.registeredAt, patient: p, kind: "await_sign", text: "소견서 검토·서명 대기" });
      }
    }
    return entries
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, 14);
  }, [patients]);

  const maxKtas = Math.max(1, ...Object.values(stats.ktasDist));

  return (
    <AppShell notifications={alerts.criticalPts.length}>
      <div className="max-w-[1500px] mx-auto px-6 py-6">
        {/* 페이지 헤더 */}
        <div className="mb-5">
          <h1 className="text-xl font-bold text-slate-900">검진 현황 대시보드</h1>
          <p className="text-sm text-slate-500 mt-0.5">응급실 운영 모니터링 · 행정팀 전용</p>
        </div>

        {/* 상단 통계 카드 */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
          <StatCard Icon={Users} label="전체 환자" value={stats.total} tone="slate" />
          <StatCard Icon={AlertTriangle} label="위급 (KTAS 1·2)" value={stats.critical} tone="red" />
          <StatCard Icon={Activity} label="AI 분석 진행 중" value={stats.analyzing} tone="amber" />
          <StatCard Icon={ClipboardCheck} label="미서명 소견서" value={stats.awaitingSign} tone="blue" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.1fr] gap-4">
          {/* ── 좌: KTAS 분포 ── */}
          <Panel title="KTAS 등급 분포" subtitle="Triage Severity Distribution">
            <div className="space-y-2.5">
              {([1, 2, 3, 4, 5] as KTAS[]).map((k) => {
                const meta = KTAS_META[k];
                const count = stats.ktasDist[k];
                return (
                  <div key={k} className="flex items-center gap-2.5">
                    <span className={cn("inline-block w-16 px-1.5 py-0.5 text-[10px] font-bold text-white text-center", meta.bg)}>
                      KTAS {k}
                    </span>
                    <span className="text-[11px] text-slate-500 w-10">{meta.label}</span>
                    <div className="flex-1 h-4 bg-slate-100 border border-slate-200 relative">
                      <div className={cn("h-full", meta.bg)} style={{ width: `${(count / maxKtas) * 100}%` }} />
                    </div>
                    <span className="w-8 text-right text-xs font-numeric font-bold text-slate-800">{count}</span>
                  </div>
                );
              })}
            </div>

            <div className="mt-5 pt-4 border-t border-slate-200 grid grid-cols-3 gap-3 text-center">
              <MiniStat label="분석 완료" value={stats.done} />
              <MiniStat label="분석 중" value={stats.analyzing} />
              <MiniStat label="미서명" value={stats.awaitingSign} />
            </div>
          </Panel>

          {/* ── 우: 알림 ── */}
          <Panel title="알림" subtitle="Alerts · 즉시 조치 필요" icon={Bell}>
            {alerts.criticalPts.length === 0 && alerts.unsigned.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">현재 알림이 없습니다.</div>
            ) : (
              <div className="space-y-1.5">
                {alerts.criticalPts.map((p) => (
                  <AlertRow
                    key={`c-${p.id}`}
                    tone="red"
                    Icon={AlertTriangle}
                    title={`위급 환자 — ${p.name}`}
                    desc={`KTAS ${p.ktas} · ${p.chief}`}
                    onClick={() => nav(detailHref(p))}
                  />
                ))}
                {alerts.unsigned.map((p) => (
                  <AlertRow
                    key={`u-${p.id}`}
                    tone="blue"
                    Icon={ClipboardCheck}
                    title={`소견서 서명 대기 — ${p.name}`}
                    desc="의사 검토·서명이 필요합니다"
                    onClick={() => nav(detailHref(p))}
                  />
                ))}
              </div>
            )}
          </Panel>
        </div>

        {/* ── 활동 로그 ── */}
        <div className="mt-4">
          <Panel title="활동 로그" subtitle="Activity Log · 최근 이벤트" icon={Clock}>
            <div className="divide-y divide-slate-100">
              {logs.map((e, i) => (
                <button
                  key={i}
                  onClick={() => nav(detailHref(e.patient))}
                  className="w-full flex items-center gap-3 py-2 text-left hover:bg-slate-50 transition-colors px-1"
                >
                  <span className={cn("h-2 w-2 rounded-full flex-shrink-0", LOG_DOT[e.kind])} />
                  <span className="text-[11px] font-numeric text-slate-400 w-20 flex-shrink-0">
                    {fmtTime(e.at)}
                  </span>
                  <span className="text-xs font-semibold text-slate-800 w-24 flex-shrink-0 truncate">
                    {e.patient.name}
                  </span>
                  <span className="text-xs text-slate-600 flex-1 truncate">{e.text}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-slate-300 flex-shrink-0" />
                </button>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </AppShell>
  );
}

function detailHref(p: DemoPatient): string {
  return isLivePatient(p.id)
    ? `/demo/patient/${p.id}?encounter_id=${p.id}`
    : `/demo/patient/${p.id}`;
}

function fmtTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

const LOG_DOT: Record<LogEntry["kind"], string> = {
  register: "bg-slate-400",
  ai_done: "bg-emerald-500",
  analyzing: "bg-amber-500",
  await_sign: "bg-blue-500",
};

const TONE: Record<string, { bg: string; text: string; icon: string }> = {
  slate: { bg: "bg-slate-50 border-slate-200", text: "text-slate-900", icon: "text-slate-500" },
  red: { bg: "bg-red-50 border-red-200", text: "text-red-700", icon: "text-red-500" },
  amber: { bg: "bg-amber-50 border-amber-200", text: "text-amber-700", icon: "text-amber-500" },
  blue: { bg: "bg-blue-50 border-blue-200", text: "text-blue-700", icon: "text-blue-500" },
};

function StatCard({
  Icon, label, value, tone,
}: {
  Icon: typeof Users;
  label: string;
  value: number;
  tone: keyof typeof TONE;
}) {
  const t = TONE[tone];
  return (
    <div className={cn("border px-4 py-3.5 flex items-center justify-between", t.bg)}>
      <div>
        <div className="text-[11px] text-slate-500 mb-1">{label}</div>
        <div className={cn("text-2xl font-bold font-numeric", t.text)}>{value}</div>
      </div>
      <Icon className={cn("h-7 w-7", t.icon)} />
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-lg font-bold font-numeric text-slate-900">{value}</div>
      <div className="text-[10px] text-slate-500">{label}</div>
    </div>
  );
}

function Panel({
  title, subtitle, icon: Icon, children,
}: {
  title: string;
  subtitle: string;
  icon?: typeof Bell;
  children: React.ReactNode;
}) {
  return (
    <section className="bg-white border border-slate-300 shadow-sm">
      <header className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
        {Icon && <Icon className="h-4 w-4 text-slate-600" />}
        <div>
          <div className="text-sm font-bold text-slate-900 leading-none">{title}</div>
          <div className="text-[9px] text-slate-400 tracking-wider uppercase mt-0.5">{subtitle}</div>
        </div>
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

function AlertRow({
  tone, Icon, title, desc, onClick,
}: {
  tone: "red" | "blue";
  Icon: typeof AlertTriangle;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  const t = TONE[tone];
  return (
    <button
      onClick={onClick}
      className={cn("w-full flex items-center gap-2.5 px-2.5 py-2 border text-left hover:brightness-95 transition", t.bg)}
    >
      <Icon className={cn("h-4 w-4 flex-shrink-0", t.icon)} />
      <div className="min-w-0 flex-1">
        <div className={cn("text-[12px] font-bold leading-tight", t.text)}>{title}</div>
        <div className="text-[10px] text-slate-500 truncate">{desc}</div>
      </div>
      <ChevronRight className="h-4 w-4 text-slate-400 flex-shrink-0" />
    </button>
  );
}
