// EMR 페이지 공용 셸 — TriageTopBar + 페이지 헤더 + 본문
//
// 트리아지/대시보드 외 모든 EMR 페이지(환자조회·진료노트·검사실·통계 등)가 사용.
// 페이지마다 같은 톤으로 제목 헤더 + 본문 영역.
import type { ReactNode } from "react";
import TriageTopBar from "./triage/TriageTopBar";

interface Props {
  title: string;
  subtitle?: string;
  headerRight?: ReactNode;
  children: ReactNode;
}

export default function EMRPageShell({ title, subtitle, headerRight, children }: Props) {
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 의사랑 EMR 톤 툴바 */}
      <TriageTopBar />

      {/* 페이지 헤더 */}
      <header className="bg-gray-800 text-white border-b-2 border-gray-900 px-4 py-2 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-3">
          <span className="w-1 h-5 bg-blue-400" />
          <h1 className="text-[15px] font-bold tracking-tight">{title}</h1>
          {subtitle && (
            <span className="text-[11px] text-gray-300 font-mono">· {subtitle}</span>
          )}
        </div>
        <div className="flex items-center gap-3">{headerRight}</div>
      </header>

      {/* 본문 */}
      <main className="flex-1 p-3 overflow-auto">{children}</main>
    </div>
  );
}
