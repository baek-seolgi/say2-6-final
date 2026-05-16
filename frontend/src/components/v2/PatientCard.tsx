import { Activity, ChevronRight, Image as ImageIcon, FlaskConical, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "../../lib/cn";
import { Card, CardBody, CardHeader } from "./ui/Card";
import { KtasBadge } from "./KtasBadge";
import { RiskBadge, type RiskLevel } from "./RiskBadge";
import type { KTAS, Sex } from "../../types/triage";

export interface PatientCardData {
  id: string;            // 환자 표시 ID (e.g. "042")
  name: string;
  age: number;
  sex: Sex;
  ktas: KTAS;
  chief: string;         // 주증상 한글
  registeredAt: string;  // ISO
  // 검사 진행 상태
  ecg: "pending" | "running" | "done";
  cxr: "pending" | "running" | "done";
  lab: "pending" | "running" | "done";
  // AI
  aiStatus: "pending" | "analyzing" | "done";
  aiVerdict?: { risk: RiskLevel; summary: string };
  // 의사 단계
  awaitingSign?: boolean;
}

interface PatientCardProps {
  data: PatientCardData;
  onClick?: () => void;
}

const STATUS_ICONS = {
  pending: { Icon: Loader2,       className: "text-slate-300" },
  running: { Icon: Loader2,       className: "text-brand-500 animate-spin" },
  done:    { Icon: CheckCircle2,  className: "text-emerald-500" },
};

function ModalityChip({ label, status, Icon }: { label: string; status: "pending" | "running" | "done"; Icon: typeof Activity }) {
  const s = STATUS_ICONS[status];
  return (
    <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-50 border border-slate-100">
      <Icon className="h-3.5 w-3.5 text-slate-500" />
      <span className="text-xs font-medium text-slate-700">{label}</span>
      <s.Icon className={cn("h-3.5 w-3.5 ml-auto", s.className)} />
    </div>
  );
}

function elapsedMin(iso: string): number {
  const diff = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.round(diff / 60000));
}

export function PatientCard({ data, onClick }: PatientCardProps) {
  const isCritical = data.aiVerdict?.risk === "critical" || data.ktas === 1 || data.ktas === 2;
  const elapsed = elapsedMin(data.registeredAt);

  return (
    <Card
      onClick={onClick}
      className={cn(
        "cursor-pointer overflow-hidden",
        "hover:-translate-y-0.5 transition-transform duration-200",
        isCritical && "v2-critical-glow border-red-500/60",
      )}
    >
      {/* 상단 컬러 바 (KTAS 색) */}
      <div
        className={cn(
          "h-1 w-full",
          data.ktas === 1 && "bg-blue-600",
          data.ktas === 2 && "bg-red-600 animate-pulse-critical",
          data.ktas === 3 && "bg-amber-500",
          data.ktas === 4 && "bg-emerald-600",
          data.ktas === 5 && "bg-slate-400",
        )}
      />

      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <KtasBadge level={data.ktas} size="sm" />
              <span className="font-numeric text-xs text-slate-500">#{data.id}</span>
            </div>
            <h3 className="text-base font-semibold text-slate-900 truncate">
              {data.name}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {data.sex}/{data.age}
              </span>
            </h3>
            <p className="text-sm text-slate-600 truncate mt-0.5">{data.chief}</p>
          </div>
        </div>
        <div className="mt-2 text-xs text-slate-400 font-numeric">
          {elapsed}분 경과 · {new Date(data.registeredAt).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })} 등록
        </div>
      </CardHeader>

      <CardBody className="space-y-3">
        {/* 검사 진행 */}
        <div>
          <div className="text-xs font-medium text-slate-500 mb-1.5">검사 진행</div>
          <div className="grid grid-cols-3 gap-1.5">
            <ModalityChip label="ECG" status={data.ecg} Icon={Activity} />
            <ModalityChip label="CXR" status={data.cxr} Icon={ImageIcon} />
            <ModalityChip label="LAB" status={data.lab} Icon={FlaskConical} />
          </div>
        </div>

        {/* AI 판정 */}
        <div className="rounded-lg bg-ai-bg border border-ai-border px-3 py-2.5">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Sparkles className="h-3.5 w-3.5 text-brand-600" />
            <span className="text-xs font-semibold text-brand-700">AI 판정</span>
          </div>
          {data.aiStatus === "analyzing" ? (
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Loader2 className="h-3 w-3 animate-spin" />
              분석 중…
            </div>
          ) : data.aiVerdict ? (
            <div className="space-y-1.5">
              <RiskBadge level={data.aiVerdict.risk} size="sm" />
              <p className="text-xs text-slate-700 leading-snug line-clamp-2">{data.aiVerdict.summary}</p>
            </div>
          ) : (
            <span className="text-xs text-slate-400">대기 중</span>
          )}
        </div>
      </CardBody>

      <div className="px-5 py-3 bg-slate-50 border-t border-slate-100 flex items-center justify-between">
        <span className="text-xs text-slate-500">
          {data.awaitingSign ? "📝 서명 대기" : data.aiStatus === "done" ? "검토 가능" : "분석 중"}
        </span>
        <span className="inline-flex items-center gap-1 text-xs font-medium text-brand-700">
          {data.awaitingSign ? "서명" : "검토"}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </Card>
  );
}
