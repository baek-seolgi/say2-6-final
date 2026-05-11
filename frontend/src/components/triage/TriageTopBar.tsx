// 트리아지 상단 아이콘 툴바 — 의사랑 EMR 스타일
// 클래식 윈도우 툴바: 작은 아이콘 + 한글 라벨 + 그룹 구분선
import {
  UserPlus, Search, FileText, FlaskConical, Image as ImageIcon,
  Pill, Stethoscope, Phone, History, BarChart3,
  Printer, Settings, HelpCircle, LogOut, Bell,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

interface ToolItem {
  icon: LucideIcon;
  label: string;
  group: number;
  color?: string;
  hotkey?: string;
  route?: string;          // 클릭 시 이동할 경로
  disabled?: boolean;
}

const TOOLS: ToolItem[] = [
  // 그룹 A — 환자 라이프사이클
  { icon: UserPlus, label: "환자등록", group: 1, hotkey: "F1", route: "/triage" },
  { icon: Search,   label: "환자조회", group: 1, hotkey: "F2", route: "/patients" },
  { icon: FileText, label: "진료노트", group: 1, hotkey: "F3", route: "/notes" },

  // 그룹 B — 검사·처방 큐
  { icon: FlaskConical, label: "검사실",   group: 2, color: "text-amber-700", route: "/lab-queue" },
  { icon: ImageIcon,    label: "영상실",   group: 2, color: "text-blue-700",  route: "/imaging-queue" },
  { icon: Pill,         label: "처방등록", group: 2, color: "text-emerald-700", route: "/prescriptions" },

  // 그룹 C — 협업
  { icon: Stethoscope, label: "협진",     group: 3, route: "/consult" },
  { icon: Phone,       label: "환자호출", group: 3, color: "text-red-600", route: "/call" },
  { icon: Bell,        label: "알림",     group: 3 },

  // 기록·통계
  { icon: History,   label: "기록보기", group: 4, route: "/records" },
  { icon: BarChart3, label: "통계",     group: 4, route: "/stats" },

  // AI·시스템
  { icon: Sparkles, label: "AI 분석",  group: 5, color: "text-purple-700", hotkey: "Ctrl+Enter", route: "/dashboard" },
  { icon: Printer,  label: "인쇄",     group: 6 },
  { icon: Settings, label: "설정",     group: 6 },
  { icon: HelpCircle, label: "도움말", group: 6 },
  { icon: LogOut,   label: "종료",     group: 6 },
];

export default function TriageTopBar() {
  const navigate = useNavigate();
  const location = useLocation();

  // 그룹별로 묶기
  const groups: ToolItem[][] = [];
  let currentGroup = -1;
  for (const tool of TOOLS) {
    if (tool.group !== currentGroup) {
      groups.push([]);
      currentGroup = tool.group;
    }
    groups[groups.length - 1].push(tool);
  }

  function handleClick(tool: ToolItem) {
    if (tool.route) {
      navigate(tool.route);
    } else {
      // 라우트 없는 항목 (알림/인쇄/설정/도움말/종료) — 임시 안내
      alert(`${tool.label} — 준비 중입니다.`);
    }
  }

  function isActive(route?: string): boolean {
    if (!route) return false;
    if (route === "/") return location.pathname === "/";
    return location.pathname.startsWith(route);
  }

  return (
    <div className="bg-gray-200 border-b-2 border-gray-500 px-2 py-1 flex items-center gap-0.5 overflow-x-auto">
      {groups.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {group.map((tool) => {
            const Icon = tool.icon;
            const active = isActive(tool.route);
            return (
              <button
                key={tool.label}
                type="button"
                disabled={tool.disabled}
                onClick={() => handleClick(tool)}
                title={tool.hotkey ? `${tool.label} (${tool.hotkey})` : tool.label}
                className={[
                  "flex flex-col items-center justify-center px-2 py-1 min-w-[56px] border transition-colors",
                  active
                    ? "bg-white border-blue-500 ring-1 ring-blue-300"
                    : "border-transparent hover:bg-white hover:border-gray-400 active:bg-gray-100",
                  "disabled:opacity-40 disabled:cursor-not-allowed",
                ].join(" ")}
              >
                <Icon
                  size={18}
                  className={active ? "text-blue-700" : tool.color ?? "text-gray-700"}
                  strokeWidth={1.5}
                />
                <span
                  className={[
                    "text-[10px] mt-0.5 leading-none whitespace-nowrap",
                    active ? "text-blue-700 font-bold" : "text-gray-800",
                  ].join(" ")}
                >
                  {tool.label}
                </span>
              </button>
            );
          })}
          {gi < groups.length - 1 && (
            <div className="w-px h-9 bg-gray-400 mx-1" />
          )}
        </div>
      ))}
    </div>
  );
}
