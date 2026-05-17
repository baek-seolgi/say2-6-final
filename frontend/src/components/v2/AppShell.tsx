import { Bell, ChevronDown, Activity, LogOut } from "lucide-react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { cn } from "../../lib/cn";
import { useAuth } from "../../lib/v2/auth";
import {
  getAllPatients,
  isLivePatient,
  getLocalReportStatus,
} from "../../lib/v2/demoStore";
import type { ReactNode } from "react";

interface AppShellProps {
  notifications?: number;
  children: ReactNode;
  /** 헤더 숨김 (로그인 등) */
  bare?: boolean;
}

export function AppShell({ notifications = 0, children, bare }: AppShellProps) {
  return (
    <div className="v2-root demo-root min-h-screen flex flex-col">
      {!bare && <Header notifications={notifications} />}
      <main className="flex-1">{children}</main>
      {!bare && <DisclaimerFooter />}
    </div>
  );
}

function DisclaimerFooter() {
  return (
    <footer className="border-t border-slate-300 bg-slate-100">
      <div className="max-w-[1700px] mx-auto px-6 py-3 flex items-start gap-2">
        <span className="text-amber-600 text-sm leading-none mt-0.5">⚠</span>
        <p className="text-[11px] text-slate-500 leading-relaxed">
          <b className="text-slate-700">진단 보조 시스템 안내</b> — 본 시스템의 모든 AI 분석 결과는
          의료진의 판단을 돕기 위한 <b className="text-slate-700">진단 보조 자료</b>이며, 의사를
          대체하지 않습니다. 환자에 대한 최종 진단 및 치료 결정은 반드시 담당 전문의의 임상적 판단과
          책임 하에 이루어져야 합니다. say-6 · 응급실 멀티모달 AI 진단 보조.
        </p>
      </div>
    </footer>
  );
}

function Header({ notifications }: { notifications: number }) {
  const { pathname } = useLocation();
  const nav = useNavigate();
  const { user, logout } = useAuth();

  const isWorklist = pathname.startsWith("/demo/worklist");
  const isTriage = pathname.startsWith("/demo/triage");
  const isDashboard = pathname.startsWith("/demo/dashboard");
  const isReports = pathname.startsWith("/demo/reports");
  // AI 분석: 환자별 AI 분석 페이지(/demo/patient/:id) — 검사 대기 환자가 진입
  const isAnalysis = /^\/demo\/patient\/[^/]+$/.test(pathname);
  // AI 종합소견 생성: 환자별 소견서 편집 페이지(/demo/patient/:id/report)
  const isReportEdit = /^\/demo\/patient\/[^/]+\/report(?!\/view)/.test(pathname);
  const roleLabel = user?.role === "doctor" ? "의사" : user?.role === "nurse" ? "간호사" : "게스트";

  function handleLogout() {
    logout();
    nav("/demo/login", { replace: true });
  }

  return (
    <header className="sticky top-0 z-30 bg-[#0A1929] border-b border-vuno-cyan/30">
      <div className="max-w-[1600px] mx-auto px-6 h-14 flex items-center gap-6">
        {/* 로고 */}
        <Link to="/" className="inline-flex items-center gap-2.5 font-bold text-white text-base tracking-wider">
          <div className="h-8 w-8 bg-vuno-cyan grid place-items-center text-vuno-bg">
            <Activity className="h-4 w-4" strokeWidth={2.5} />
          </div>
          <span>SAY<span className="text-vuno-cyan">-</span>6</span>
          <span className="text-[10px] font-medium text-vuno-cyan/80 uppercase tracking-[0.15em] ml-1">Med Console</span>
        </Link>

        {/* 메뉴 */}
        <nav className="hidden md:flex items-center gap-1 ml-4">
          <NavLink to="/demo/triage"    label="환자정보입력" active={isTriage} />
          <NavLink to="/demo/worklist"  label="환자 목록" active={isWorklist} />
          <NavButton
            label="AI 분석"
            active={isAnalysis}
            onClick={() => nav(pickAnalysisTarget())}
          />
          <NavButton
            label="AI 종합소견 생성"
            active={isReportEdit}
            onClick={() => nav(pickReportTarget())}
          />
          <NavLink to="/demo/reports"   label="종합소견서 목록" active={isReports} />
          <NavLink to="/demo/dashboard" label="검진현황" active={isDashboard} />
        </nav>

        {/* 우측 */}
        <div className="ml-auto flex items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-xs text-vuno-muted">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <span className="font-semibold tracking-wider uppercase">Live</span>
          </span>

          <button className="relative h-9 w-9 hover:bg-white/10 grid place-items-center transition-colors">
            <Bell className="h-4 w-4 text-white" />
            {notifications > 0 && (
              <span className="absolute top-1 right-1 h-4 min-w-[16px] px-1 bg-vuno-cyan text-vuno-bg text-[10px] font-bold grid place-items-center">
                {notifications}
              </span>
            )}
          </button>

          <div className="flex items-center gap-2 px-3 h-9 hover:bg-white/10 cursor-pointer transition-colors">
            <div className="h-7 w-7 bg-vuno-cyan/20 border border-vuno-cyan/40 text-vuno-cyan grid place-items-center text-xs font-bold">
              {user?.name.slice(0, 1) ?? "?"}
            </div>
            <span className="text-sm font-medium text-white">{user?.name ?? "Guest"}</span>
            <span className={cn(
              "text-[10px] px-1.5 py-0.5 font-bold uppercase tracking-wider",
              user?.role === "doctor" && "bg-vuno-cyan/20 text-vuno-cyan",
              user?.role === "nurse"  && "bg-emerald-500/20 text-emerald-400",
              !user                   && "bg-white/10 text-white/70",
            )}>
              {roleLabel}
            </span>
            <ChevronDown className="h-3.5 w-3.5 text-white/50" />
          </div>

          <button
            onClick={handleLogout}
            className="h-9 w-9 hover:bg-white/10 grid place-items-center transition-colors"
            title="로그아웃"
          >
            <LogOut className="h-4 w-4 text-white/70" />
          </button>
        </div>
      </div>
    </header>
  );
}

function NavLink({ to, label, active }: { to: string; label: string; active: boolean }) {
  return (
    <Link
      to={to}
      className={cn(
        "h-9 px-3 text-sm font-semibold transition-colors flex items-center tracking-wider uppercase",
        active ? "text-vuno-cyan border-b-2 border-vuno-cyan" : "text-white/70 hover:text-white",
      )}
    >
      {label}
    </Link>
  );
}

function NavButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "h-9 px-3 text-sm font-semibold transition-colors flex items-center tracking-wider uppercase",
        active ? "text-vuno-cyan border-b-2 border-vuno-cyan" : "text-white/70 hover:text-white",
      )}
    >
      {label}
    </button>
  );
}

// AI 분석 탭 — 분석 중·대기 환자가 있으면 그 환자의 PatientDetail(AI 분석)로,
// 없으면 환자 목록 페이지로 폴백. live 환자는 encounter_id 쿼리 동반.
function pickAnalysisTarget(): string {
  const all = getAllPatients();
  // 우선순위: analyzing > 그 외(미완료). KTAS 낮은(중증) 환자 우선.
  const candidates = all
    .filter((p) => p.aiStatus !== "done")
    .sort((a, b) => {
      const aw = a.aiStatus === "analyzing" ? 0 : 1;
      const bw = b.aiStatus === "analyzing" ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.ktas - b.ktas;
    });
  const p = candidates[0];
  if (!p) return "/demo/worklist";
  const q = isLivePatient(p.id) ? `?encounter_id=${p.id}` : "";
  return `/demo/patient/${p.id}${q}`;
}

// AI 종합소견 생성 탭 — 분석 완료됐고 아직 서명 전인 환자의 소견서 편집기로.
// 우선순위: 검토 중 > 작성 가능(분석 완료) > KTAS 낮은 순. 없으면 목록으로 폴백.
function pickReportTarget(): string {
  const all = getAllPatients();
  const candidates = all
    .filter((p) => {
      if (p.aiStatus !== "done") return false;
      const local = getLocalReportStatus(p.id);
      return local !== "signed" && local !== "amended";
    })
    .sort((a, b) => {
      const aw = getLocalReportStatus(a.id) === "reviewed" ? 0 : 1;
      const bw = getLocalReportStatus(b.id) === "reviewed" ? 0 : 1;
      if (aw !== bw) return aw - bw;
      return a.ktas - b.ktas;
    });
  const p = candidates[0];
  if (!p) return "/demo/reports";
  const q = isLivePatient(p.id) ? `?encounter_id=${p.id}` : "";
  return `/demo/patient/${p.id}/report${q}`;
}
