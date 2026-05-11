import { NavLink, Outlet, useLocation } from "react-router-dom";
import { useState, useEffect } from "react";
import { checkHealth } from "../lib/api";

const NAV_ITEMS = [
  { to: "/", icon: "ecg_heart", label: "실시간 모니터" },
  { to: "/triage", icon: "stethoscope", label: "트리아지" },
  { to: "/dashboard", icon: "monitoring", label: "AI 분석" },
  { to: "/archive", icon: "folder_open", label: "환자 기록" },
  { to: "#", icon: "tune", label: "시스템 설정" },
];

// 자체 헤더/사이드바를 가진 페이지 (트리아지처럼 EMR 풀화면)
const FULL_BLEED_ROUTES = [
  "/triage", "/dashboard",
  "/patients", "/notes", "/records",
  "/lab-queue", "/imaging-queue", "/prescriptions",
  "/consult", "/call", "/stats",
];

export default function Layout() {
  const [online, setOnline] = useState(false);
  const location = useLocation();
  const isFullBleed = FULL_BLEED_ROUTES.some((r) => location.pathname.startsWith(r));

  useEffect(() => {
    checkHealth().then(setOnline);
    const id = setInterval(() => checkHealth().then(setOnline), 15000);
    return () => clearInterval(id);
  }, []);

  // 풀화면 모드 (트리아지) — 헤더·사이드바 없이 페이지 전체 사용
  if (isFullBleed) {
    return (
      <div className="min-h-screen flex flex-col bg-slate-50">
        <Outlet />
      </div>
    );
  }

  // 일반 모드 — 기존 헤더 + 사이드바
  return (
    <div className="min-h-screen flex flex-col">
      <header className="sticky top-0 z-50 bg-slate-50 flex justify-between items-center px-6 h-16 w-full border-b border-outline-variant/30">
        <div className="flex items-center gap-2">
          <span className="material-symbols-outlined text-blue-700 text-2xl">monitor_heart</span>
          <h1 className="text-lg font-bold tracking-tight text-blue-800">ECG 실시간 AI 분석 대시보드</h1>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className={`w-2.5 h-2.5 rounded-full ${online ? "bg-emerald-400 animate-pulse" : "bg-gray-400"}`} />
            <span className="text-[10px] font-bold text-on-surface-variant tracking-widest uppercase">
              {online ? "System Online" : "Offline"}
            </span>
          </div>
        </div>
      </header>

      <div className="flex flex-1">
        <nav className="hidden md:flex h-[calc(100vh-4rem)] w-56 sticky top-16 flex-col py-6 gap-1 bg-slate-100 text-sm font-medium">
          <div className="px-6 mb-4">
            <p className="text-blue-800 font-bold uppercase tracking-widest text-xs">임상 의사결정 지원</p>
          </div>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.label}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                `flex items-center gap-3 px-6 py-3 transition-all duration-200 ${
                  isActive
                    ? "bg-white text-blue-700 border-l-4 border-blue-700"
                    : "text-slate-600 hover:bg-slate-200 border-l-4 border-transparent"
                }`
              }
            >
              <span className="material-symbols-outlined text-xl">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 max-w-full overflow-x-hidden p-4 md:p-8">
          <Outlet />
        </main>
      </div>

      <footer className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-white flex items-center justify-around px-4 z-50 border-t border-gray-200">
        {[
          { to: "/", icon: "ecg_heart", label: "모니터" },
          { to: "/triage", icon: "stethoscope", label: "트리아지" },
          { to: "/dashboard", icon: "monitoring", label: "AI 분석" },
          { to: "/archive", icon: "folder_open", label: "기록" },
        ].map((item) => (
          <NavLink
            key={item.label}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex flex-col items-center gap-1 ${isActive ? "text-blue-700" : "text-slate-500"}`
            }
          >
            <span className="material-symbols-outlined">{item.icon}</span>
            <span className="text-[10px] font-bold">{item.label}</span>
          </NavLink>
        ))}
      </footer>
    </div>
  );
}
