import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity, FlaskConical, Image as ImageIcon, FileText,
  CheckCircle2, Loader2, Sparkles, Maximize2, Stethoscope,
} from "lucide-react";
import { AppShell } from "../../components/v2/AppShell";
import { Tabs } from "../../components/v2/ui/Tabs";
import { Card, CardBody, CardHeader, CardTitle } from "../../components/v2/ui/Card";
import { RiskBadge } from "../../components/v2/RiskBadge";
import { findPatient, type DemoPatient } from "../../lib/v2/demoStore";
import {
  getModalResults, getServiceRequests, parseRecommendations, approveOrder, requestOrder,
  type ModalResults, type AIRec, type ModalKey,
} from "../../lib/v2/api";
import { CXRView, ECGView, LabView } from "../../components/modal-views/ModalViews";
import { CxrPacsViewer } from "../../components/modal-views/CxrPacsViewer";
import { PatientInfoSidebar, fmtTime } from "../../components/v2/PatientInfoSidebar";
import { cn } from "../../lib/cn";

type TabKey = "summary" | "ecg" | "cxr" | "lab";

export default function PatientDetailPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  const encounterId = searchParams.get("encounter_id");
  const nav = useNavigate();
  const patient = useMemo(() => findPatient(id), [id]);
  const [tab, setTab] = useState<TabKey>("summary");
  const [cxrPacsOpen, setCxrPacsOpen] = useState(false);

  // ── 백엔드 폴링: 모달 결과 + AI 권고(service-requests) ──
  const [modalResults, setModalResults] = useState<ModalResults | null>(null);
  const [recs, setRecs] = useState<AIRec[]>([]);
  const [approving, setApproving] = useState<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const poll = useCallback(async () => {
    if (!encounterId) return;
    const [mr, srList] = await Promise.all([
      getModalResults(encounterId),
      getServiceRequests(encounterId),
    ]);
    if (mr) setModalResults(mr);
    if (srList) setRecs(parseRecommendations(srList));
    if (mr && mr.CXR && mr.ECG && mr.LAB && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, [encounterId]);

  useEffect(() => {
    if (!encounterId) return;
    poll();
    // 폴링 주기 2초 — 모달 완료 즉시 UI 반영
    pollRef.current = setInterval(poll, 2000);
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [encounterId, poll]);

  async function handleApprove(srId: string) {
    setApproving((s) => new Set(s).add(srId));
    await approveOrder(srId);
    // 백엔드가 모달 호출 시작했으니 즉시 한 번 더 폴링 → 상태 빠르게 반영
    setTimeout(poll, 500);
    setTimeout(() => {
      setApproving((s) => {
        const n = new Set(s);
        n.delete(srId);
        return n;
      });
    }, 5000);
  }

  // 의사 직접 오더 — AI 권고와 무관하게 모달 검사 추가 실행
  // requesting: 5초간 loading 시각 효과용 (자동 해제)
  // requested: 클릭 즉시 영구 마킹 (낙관적 업데이트) — 폴링 race 무관하게 즉시 비활성화
  const [requesting, setRequesting] = useState<Set<ModalKey>>(new Set());
  const [requested, setRequested] = useState<Set<ModalKey>>(new Set());
  async function handleRequestOrder(modality: ModalKey) {
    if (!encounterId) return;
    // 즉시 영구 비활성화 + loading 시각화
    setRequested((s) => new Set(s).add(modality));
    setRequesting((s) => new Set(s).add(modality));
    await requestOrder(encounterId, patient?.fhirPatientId ?? encounterId, modality);
    setTimeout(poll, 500);
    setTimeout(() => {
      setRequesting((s) => {
        const n = new Set(s);
        n.delete(modality);
        return n;
      });
    }, 5000);
  }

  const reportHref = encounterId
    ? `/demo/patient/${id}/report?encounter_id=${encounterId}`
    : `/demo/patient/${id}/report`;

  if (!patient) {
    return (
      <AppShell>
        <div className="max-w-md mx-auto py-20 text-center">
          <p className="text-slate-500">환자를 찾을 수 없습니다.</p>
        </div>
      </AppShell>
    );
  }

  // 모달별 상태 — 결과 있으면 done, 승인됨=running, draft=pending(승인 대기)
  const modalStatus = (m: ModalKey): "pending" | "running" | "done" => {
    if (modalResults?.[m]) return "done";
    const rec = recs.find((r) => r.modality === m);
    if (rec?.status === "completed") return "done";
    if (rec?.status === "active") return "running";
    if (rec?.status === "draft") return "pending";
    if (encounterId) return "pending";
    return patient[m.toLowerCase() as "ecg" | "cxr" | "lab"];
  };

  return (
    <AppShell notifications={3}>
      {/* 3-컬럼: 환자정보 · AI 권고(가운데) · 검사 결과 — 세로 꽉 채움 */}
      <div className="max-w-[1700px] mx-auto px-5 py-4 grid grid-cols-1 lg:grid-cols-[300px_1fr_1.3fr] gap-4 items-stretch min-h-[calc(100vh-5rem)]">
        {/* ── 좌: 환자 정보 사이드바 ── */}
        <PatientInfoSidebar patient={patient} />

        {/* ── 중: AI 검사 권고 ── */}
        <AIRecPanel
          patient={patient}
          encounterId={encounterId}
          recs={recs}
          approving={approving}
          requesting={requesting}
          requested={requested}
          onApprove={handleApprove}
          onRequestOrder={handleRequestOrder}
          onOpenReport={() => nav(reportHref)}
        />

        {/* ── 우: 검사 결과 탭 ── */}
        <section className="min-w-0">
          <Card className="overflow-hidden h-full flex flex-col">
            <div className="px-4 py-2.5 border-b border-slate-200 bg-slate-50 flex items-center gap-2">
              <span className="text-sm font-bold text-slate-900">검사 결과</span>
              <span className="text-[10px] text-slate-400 tracking-wider uppercase">Examination Results</span>
            </div>
            <Tabs
              value={tab}
              onChange={(k) => setTab(k as TabKey)}
              items={[
                { key: "summary", label: "검사결과" },
                ...(["ECG", "CXR", "LAB"] as const).map((m) => {
                  const s = modalStatus(m);
                  return {
                    key: m.toLowerCase(),
                    label: m,
                    badge: s === "done" ? "✓ 완료" : s === "running" ? "분석 중" : undefined,
                    tone: (s === "done" ? "done" : s === "running" ? "analyzing" : "default") as "done" | "analyzing" | "default",
                  };
                }),
              ]}
              className="px-2"
            />
            <CardBody className="p-5 flex-1 overflow-auto">
              {tab === "summary" && <SummaryTab patient={patient} modalStatus={modalStatus} />}
              {tab === "ecg" && (
                modalResults?.ECG
                  ? <ModalViewFrame><ECGView ecgResult={modalResults.ECG} isLoading={false} /></ModalViewFrame>
                  : encounterId
                    ? <PendingModal kind="ECG" status={modalStatus("ECG")} />
                    : <ECGTab risk={patient.aiVerdict?.risk ?? "normal"} />
              )}
              {tab === "cxr" && (
                modalResults?.CXR
                  ? (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-slate-500">흉부 X-ray · UNet 세그멘테이션 + 측정선</span>
                        <button
                          onClick={() => setCxrPacsOpen(true)}
                          className="inline-flex items-center gap-1.5 h-7 px-3 bg-[#0d1320] text-cyan-300 border border-cyan-500/40 text-[11px] font-bold hover:bg-[#131b2e]"
                        >
                          <Maximize2 className="h-3.5 w-3.5" /> PACS 뷰어로 보기
                        </button>
                      </div>
                      <ModalViewFrame>
                        <CXRView subjectId={patient.mimic?.subject_id ?? null} cacheKey="" cxrResult={modalResults.CXR} isLoading={false} />
                      </ModalViewFrame>
                    </div>
                  )
                  : encounterId
                    ? <PendingModal kind="CXR" status={modalStatus("CXR")} />
                    : <CXRTab />
              )}
              {tab === "lab" && (
                modalResults?.LAB
                  ? <ModalViewFrame><LabView labResult={modalResults.LAB} isLoading={false} /></ModalViewFrame>
                  : encounterId
                    ? <PendingModal kind="LAB" status={modalStatus("LAB")} />
                    : <LABTab />
              )}
            </CardBody>
          </Card>
        </section>
      </div>

      {/* CXR PACS 풀스크린 뷰어 */}
      {cxrPacsOpen && modalResults?.CXR && (
        <CxrPacsViewer
          result={modalResults.CXR}
          subjectId={patient.mimic?.subject_id ?? null}
          patientName={patient.name}
          patientMeta={`${patient.sex === "M" ? "남" : "여"} / ${patient.age}세`}
          studyDateLabel={fmtTime(patient.arrivedAt)}
          onClose={() => setCxrPacsOpen(false)}
        />
      )}
    </AppShell>
  );
}

/* ═══════════════════════════════════════════════════════════
   우측 — AI 권고 1·2·3차 패널
   ═══════════════════════════════════════════════════════════ */
const RANK_META: Record<1 | 2 | 3, { ko: string; badge: string; bar: string }> = {
  1: { ko: "1차 권고", badge: "bg-purple-600", bar: "bg-purple-50 border-purple-300" },
  2: { ko: "2차 권고", badge: "bg-blue-600", bar: "bg-blue-50 border-blue-300" },
  3: { ko: "3차 권고", badge: "bg-emerald-600", bar: "bg-emerald-50 border-emerald-300" },
};

const MODAL_LABEL: Record<ModalKey, string> = {
  ECG: "심전도 12-Lead",
  CXR: "흉부 X-ray",
  LAB: "혈액 검사",
};

function AIRecPanel({
  patient, encounterId, recs, approving, requesting, requested, onApprove, onRequestOrder, onOpenReport,
}: {
  patient: DemoPatient;
  encounterId: string | null;
  recs: AIRec[];
  approving: Set<string>;
  requesting: Set<ModalKey>;
  requested: Set<ModalKey>;
  onApprove: (srId: string) => void;
  onRequestOrder: (modality: ModalKey) => void;
  onOpenReport: () => void;
}) {
  // 백엔드 미연동 — 정적 demoStore recommendation 폴백
  if (!encounterId) {
    return (
      <div className="bg-white border border-slate-300 shadow-sm h-full flex flex-col">
        <PanelHeader />
        <div className="flex-1 overflow-auto p-4">
          {patient.recommendation ? (
            <div className="space-y-2">
              <div className="text-xs text-slate-500 bg-slate-50 border border-slate-200 px-2.5 py-2">
                데모 모드 — 백엔드 미연동. 실제 AI 권고 시계열은 트리아지 제출로 encounter를 생성하면 표시됩니다.
              </div>
              <div className="border border-slate-200 p-3">
                <div className="text-[12px] font-bold text-slate-800 mb-1.5">
                  {patient.recommendation.diagnosis}
                </div>
                {patient.recommendation.reasons.map((r) => (
                  <div key={r} className="text-[11px] text-slate-600 leading-relaxed">· {r}</div>
                ))}
              </div>
            </div>
          ) : (
            <div className="py-10 text-center text-xs text-slate-400">AI 권고 없음</div>
          )}
        </div>
        <PanelFooter onOpenReport={onOpenReport} />
      </div>
    );
  }

  // AI 권고와 의사 직접 오더 분리
  const aiRecs = recs.filter((r) => !r.isManual);
  const manualRecs = recs.filter((r) => r.isManual);

  // AI 권고 rank별 그룹
  const byRank = new Map<1 | 2 | 3, AIRec[]>();
  aiRecs.forEach((r) => {
    const arr = byRank.get(r.rank) ?? [];
    arr.push(r);
    byRank.set(r.rank, arr);
  });
  const ranks = [...byRank.keys()].sort();
  const allDraft = recs.filter((r) => r.status === "draft");
  const doneCount = recs.filter((r) => r.status === "completed").length;
  // 모든 권고(AI + 의사 오더)가 완료돼야 소견서 생성 활성화.
  const allDone = recs.length > 0 && recs.every((r) => r.status === "completed");

  return (
    <div className="bg-white border border-slate-300 shadow-sm h-full flex flex-col">
      <PanelHeader />

      {recs.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-xs text-slate-400">
          <Loader2 className="h-6 w-6 mb-2 animate-spin text-slate-300" />
          AI 권고를 불러오는 중…
        </div>
      ) : (
        <div className="flex-1 overflow-auto p-3 space-y-3">
          {/* 진행 요약 + 일괄 승인 */}
          <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 px-3 py-2">
            <span className="text-[11px] text-slate-600">
              AI 권고 <b className="text-slate-900">{aiRecs.length}</b> · 의사 오더{" "}
              <b className="text-slate-900">{manualRecs.length}</b> · 완료{" "}
              <b className="text-emerald-600">{doneCount}</b> · 미승인{" "}
              <b className="text-purple-600">{allDraft.length}</b>
            </span>
            {allDraft.length > 0 && (
              <button
                onClick={() => allDraft.forEach((r) => onApprove(r.srId))}
                className="ml-auto h-7 px-3 bg-brand-600 text-white text-[11px] font-bold hover:bg-brand-700"
              >
                모두 승인 ({allDraft.length})
              </button>
            )}
          </div>

          {/* AI 1·2·3차 권고 — 시간 클러스터링으로 분류 */}
          {ranks.map((rank) => {
            const rm = RANK_META[rank];
            return (
              <div key={rank} className={cn("border", rm.bar)}>
                <div className="flex items-center gap-2 px-3 py-2 border-b border-black/5">
                  <Sparkles className="h-3 w-3 text-brand-600" />
                  <span className={cn("px-2 py-0.5 text-[11px] font-bold text-white", rm.badge)}>
                    {rm.ko}
                  </span>
                  <span className="text-[11px] text-slate-500 font-medium">
                    AI 분석 기반 · 검사 {byRank.get(rank)!.length}건
                  </span>
                </div>
                <div className="p-2.5 space-y-2 bg-white">
                  {byRank.get(rank)!.map((rec) => (
                    <RecRow
                      key={rec.srId}
                      rec={rec}
                      approving={approving.has(rec.srId)}
                      onApprove={() => onApprove(rec.srId)}
                    />
                  ))}
                </div>
              </div>
            );
          })}

          {/* 의사 직접 오더 — AI 권고와 별도 그룹 (차수 없음, 회색 톤) */}
          {manualRecs.length > 0 && (
            <div className="border border-slate-400 bg-slate-50">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-slate-300 bg-slate-100">
                <Stethoscope className="h-3.5 w-3.5 text-slate-700" />
                <span className="px-2 py-0.5 text-[11px] font-bold text-white bg-slate-700">
                  의사 직접 오더
                </span>
                <span className="text-[11px] text-slate-500 font-medium">
                  AI 권고와 무관 · 의사 판단 · 검사 {manualRecs.length}건
                </span>
              </div>
              <div className="p-2.5 space-y-2 bg-white">
                {manualRecs.map((rec) => (
                  <RecRow
                    key={rec.srId}
                    rec={rec}
                    approving={approving.has(rec.srId)}
                    onApprove={() => onApprove(rec.srId)}
                    manual
                  />
                ))}
              </div>
            </div>
          )}

          {/* 모든 권고 완료 — 추가 권고 없음 안내 */}
          {allDone && (
            <div className="border border-emerald-300 bg-emerald-50 px-3 py-2.5 flex items-start gap-2">
              <CheckCircle2 className="h-4 w-4 text-emerald-600 flex-shrink-0 mt-0.5" />
              <div>
                <div className="text-[12px] font-bold text-emerald-800">모든 권장 검사 완료</div>
                <div className="text-[11px] text-emerald-700 leading-snug mt-0.5">
                  AI가 추가로 권고하는 검사가 없습니다. 종합 소견서를 생성할 수 있습니다.
                </div>
              </div>
            </div>
          )}

          {/* 의사 직접 오더 — AI 권고와 무관하게 추가 검사 호출 */}
          <DoctorOrderSection recs={recs} requesting={requesting} requested={requested} onRequestOrder={onRequestOrder} />
        </div>
      )}

      <PanelFooter onOpenReport={onOpenReport} disabled={!allDone} />
    </div>
  );
}

// 의사 직접 검사 오더 — AI가 권고하지 않은 모달도 의사 판단으로 추가 실행
function DoctorOrderSection({
  recs, requesting, requested, onRequestOrder,
}: {
  recs: AIRec[];
  requesting: Set<ModalKey>;
  requested: Set<ModalKey>;
  onRequestOrder: (m: ModalKey) => void;
}) {
  // 백엔드 폴링이 반환한 SR + 로컬 낙관적 마킹(requested) → 둘 중 하나라도 있으면 비활성
  const ordered = new Set(recs.map((r) => r.modality));
  const ALL: ModalKey[] = ["ECG", "CXR", "LAB"];
  return (
    <div className="border border-slate-300 bg-slate-50">
      <div className="px-3 py-2 border-b border-slate-200">
        <div className="text-[12px] font-bold text-slate-800">검사 직접 오더</div>
        <div className="text-[10px] text-slate-500">AI 권고 외 검사를 의사가 직접 지시</div>
      </div>
      <div className="p-2.5 grid grid-cols-3 gap-2">
        {ALL.map((m) => {
          const Icon = m === "ECG" ? Activity : m === "CXR" ? ImageIcon : FlaskConical;
          const already = ordered.has(m) || requested.has(m);
          const loading = requesting.has(m);
          return (
            <button
              key={m}
              disabled={already || loading}
              onClick={() => onRequestOrder(m)}
              title={already ? "이미 권고/오더된 검사입니다" : `${m} 검사 직접 오더`}
              className={cn(
                "flex flex-col items-center justify-center gap-1 py-2.5 border text-[11px] font-bold transition-colors",
                already
                  ? "border-slate-200 bg-slate-100 text-slate-400 cursor-not-allowed"
                  : loading
                    ? "border-amber-300 bg-amber-50 text-amber-700 cursor-wait"
                    : "border-slate-400 bg-white text-slate-700 hover:bg-slate-800 hover:text-white hover:border-slate-800",
              )}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
              {m}
              <span className="text-[9px] font-medium opacity-70">
                {already ? "오더됨" : loading ? "요청 중" : "직접 오더"}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function PanelHeader() {
  return (
    <div className="px-4 py-3 border-b border-slate-300 bg-brand-50 flex items-center gap-2">
      <Sparkles className="h-5 w-5 text-brand-600" />
      <div>
        <div className="text-base font-bold text-slate-900 leading-none">AI 검사 권고</div>
        <div className="text-[10px] text-slate-400 tracking-wider uppercase mt-0.5">AI Recommendations · 1·2·3차</div>
      </div>
    </div>
  );
}

function PanelFooter({ onOpenReport, disabled }: { onOpenReport: () => void; disabled?: boolean }) {
  return (
    <div className="p-3 border-t border-slate-200 space-y-1.5">
      <button
        onClick={onOpenReport}
        disabled={disabled}
        title={disabled ? "모든 AI 검사 권고가 완료되어야 활성화됩니다" : ""}
        className={cn(
          "w-full h-11 text-[13px] font-bold inline-flex items-center justify-center gap-2 transition-colors",
          disabled
            ? "bg-slate-200 text-slate-400 cursor-not-allowed"
            : "bg-brand-600 text-white hover:bg-brand-700",
        )}
      >
        <FileText className="h-4 w-4" />
        {disabled ? "검사 진행 중 — 소견서 대기" : "종합 소견서 생성"}
      </button>
      {/* 의사 직권 — 검사 미완료여도 의사 판단으로 소견서 진행 가능 */}
      {disabled && (
        <button
          onClick={onOpenReport}
          className="w-full h-8 text-[11px] font-bold text-slate-600 border border-slate-300 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5"
        >
          의사 직권으로 소견서 생성 →
        </button>
      )}
    </div>
  );
}

function RecRow({ rec, approving, onApprove, manual }: { rec: AIRec; approving: boolean; onApprove: () => void; manual?: boolean }) {
  const Icon = rec.modality === "ECG" ? Activity : rec.modality === "CXR" ? ImageIcon : FlaskConical;
  const isDraft = rec.status === "draft" && !approving;
  const isRunning = approving || rec.status === "active";
  const isDone = rec.status === "completed";

  return (
    <div className={cn(
      "border px-2.5 py-2",
      isDone ? "border-emerald-200 bg-emerald-50/40" :
      isRunning ? "border-amber-200 bg-amber-50/40" :
      manual ? "border-slate-300 bg-slate-50/60" :
      "border-slate-200",
    )}>
      <div className="flex items-center gap-1.5 mb-1.5">
        <span className={cn(
          "h-6 w-6 grid place-items-center flex-shrink-0",
          isDone ? "bg-emerald-100 text-emerald-700" :
          isRunning ? "bg-amber-100 text-amber-700" :
          manual ? "bg-slate-200 text-slate-700" :
          "bg-slate-100 text-slate-600",
        )}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <div className="text-[12px] font-bold text-slate-800 leading-none">{rec.modality}</div>
          <div className="text-[9px] text-slate-400 mt-0.5">{MODAL_LABEL[rec.modality]}</div>
        </div>
        <span className="ml-auto">
          {isDone ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-emerald-100 text-emerald-700">
              <CheckCircle2 className="h-3 w-3" /> 완료
            </span>
          ) : isRunning ? (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold bg-amber-100 text-amber-700">
              <Loader2 className="h-3 w-3 animate-spin" /> 분석 중
            </span>
          ) : (
            <span className="px-1.5 py-0.5 text-[10px] font-bold bg-purple-100 text-purple-700">
              승인 대기
            </span>
          )}
        </span>
      </div>
      {rec.reason && (
        <div className="text-[10px] text-slate-500 leading-snug mb-1.5 line-clamp-2">{rec.reason}</div>
      )}
      {isDraft && (
        <button
          onClick={onApprove}
          className="w-full h-8 bg-slate-800 text-white text-[11px] font-bold hover:bg-slate-900 inline-flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 className="h-3.5 w-3.5" /> 승인하고 검사 실행
        </button>
      )}
      {isDone && (
        <div className="text-[10px] text-emerald-600 font-medium">→ 우측 {rec.modality} 탭에서 판독 결과 확인</div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════
   검사 탭 — 백엔드 연동 / 정적 폴백
   ═══════════════════════════════════════════════════════════ */
function ModalViewFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="relative h-[520px] border border-slate-200 rounded-lg overflow-hidden bg-white">
      {children}
    </div>
  );
}

// 백엔드 연동 모드 — 아직 결과 없을 때 (승인 대기 / 분석 중)
function PendingModal({ kind, status }: { kind: ModalKey; status: "pending" | "running" | "done" }) {
  return (
    <div className="h-[420px] flex flex-col items-center justify-center text-center border border-dashed border-slate-300 rounded-lg bg-slate-50">
      {status === "running" ? (
        <>
          <Loader2 className="h-8 w-8 text-brand-500 animate-spin mb-3" />
          <div className="text-sm font-semibold text-slate-700">{kind} 분석 중…</div>
          <div className="text-xs text-slate-500 mt-1">AI 모달 판독이 진행 중입니다</div>
        </>
      ) : (
        <>
          <div className="text-3xl mb-2">🩺</div>
          <div className="text-sm font-semibold text-slate-700">{kind} 검사 승인 대기</div>
          <div className="text-xs text-slate-500 mt-1">
            우측 <b>AI 검사 권고</b> 패널에서 {kind} 권고를 승인하면 분석이 시작됩니다.
          </div>
        </>
      )}
    </div>
  );
}

function SummaryTab({
  patient, modalStatus,
}: {
  patient: DemoPatient;
  modalStatus: (m: ModalKey) => "pending" | "running" | "done";
}) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">주요 검사 요약</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <ModuleCard Icon={Activity} title="ECG" status={modalStatus("ECG")} risk={patient.aiVerdict?.risk} />
          <ModuleCard Icon={ImageIcon} title="CXR" status={modalStatus("CXR")} />
          <ModuleCard Icon={FlaskConical} title="LAB" status={modalStatus("LAB")} />
        </div>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">활력징후</h3>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
          <VitalCard label="HR" value={patient.vitals.hr} unit="bpm" />
          <VitalCard label="SBP" value={patient.vitals.sbp} unit="mmHg" />
          <VitalCard label="DBP" value={patient.vitals.dbp} unit="mmHg" />
          <VitalCard label="RR" value={patient.vitals.rr} unit="/min" />
          <VitalCard label="SpO₂" value={patient.vitals.spo2} unit="%" abnormal={!!patient.vitals.spo2 && patient.vitals.spo2 < 95} />
          <VitalCard label="T°" value={patient.vitals.bt} unit="℃" />
        </div>
      </section>
    </div>
  );
}

function ECGTab({ risk }: { risk: string }) {
  return (
    <div className="space-y-5">
      <div className="rounded-lg bg-slate-900 p-6">
        <div className="text-xs text-emerald-400 mb-2 font-numeric">12-Lead ECG · 25 mm/s · 10 mm/mV</div>
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 font-numeric text-xs text-emerald-400">
          {["I", "aVR", "V1", "V4", "II", "aVL", "V2", "V5", "III", "aVF", "V3", "V6"].map((lead) => (
            <div key={lead} className="flex items-center gap-3">
              <span className="w-10 text-emerald-500 font-semibold">{lead}</span>
              <svg viewBox="0 0 200 24" className="flex-1 h-6">
                <path
                  d={lead.startsWith("V") && (lead === "V2" || lead === "V3" || lead === "V4")
                    ? "M0,12 L20,12 L25,4 L30,18 L35,2 L45,12 L70,12 L75,4 L80,18 L85,2 L95,12 L120,12 L125,4 L130,18 L135,2 L145,12 L170,12 L175,4 L180,18 L185,2 L195,12 L200,12"
                    : "M0,12 L20,12 L25,8 L30,14 L35,6 L45,12 L70,12 L75,8 L80,14 L85,6 L95,12 L120,12 L125,8 L130,14 L135,6 L145,12 L170,12 L175,8 L180,14 L185,6 L195,12 L200,12"}
                  stroke={lead.startsWith("V") && (lead === "V2" || lead === "V3" || lead === "V4") ? "#f87171" : "#34d399"}
                  strokeWidth="0.8"
                  fill="none"
                />
              </svg>
            </div>
          ))}
        </div>
      </div>

      {risk === "critical" && (
        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 flex items-start gap-3">
          <span className="text-critical mt-0.5">⚠</span>
          <div>
            <div className="text-sm font-semibold text-red-700">ST 상승 감지 (V2-V4)</div>
            <div className="text-xs text-red-600/80 mt-0.5">Anterior wall에서 명확한 ST 상승. Reciprocal change 확인됨.</div>
          </div>
        </div>
      )}

      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">측정값</h3>
        <div className="grid grid-cols-4 gap-2">
          <MeasureCard label="HR" value="88" unit="bpm" />
          <MeasureCard label="PR int" value="160" unit="ms" />
          <MeasureCard label="QRS" value="95" unit="ms" />
          <MeasureCard label="QT int" value="380" unit="ms" />
        </div>
      </section>

      <Card className="border-red-200 bg-red-50/40">
        <CardHeader>
          <CardTitle className="text-sm flex items-center gap-2">
            🤖 AI 판정 (ECG)
            <RiskBadge level="urgent" text="urgent" />
          </CardTitle>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-slate-700">
            "Anterior wall에서 ST 상승이 명확히 관찰됨. Reciprocal change도 확인됨."
          </p>
          <div className="mt-2 text-xs text-slate-500">신뢰도 89% · 모델 v1.2</div>
        </CardBody>
      </Card>
    </div>
  );
}

function CXRTab() {
  return (
    <div className="space-y-5">
      <div className="aspect-[4/3] max-w-md mx-auto rounded-lg bg-slate-900 grid place-items-center text-slate-500 text-sm border border-slate-700">
        <div className="text-center">
          <ImageIcon className="h-12 w-12 mx-auto mb-2 opacity-30" />
          <div>CXR 이미지 영역</div>
          <div className="text-xs mt-1 opacity-60">S3 PreSigned URL 연동 예정</div>
        </div>
      </div>
      <Card>
        <CardHeader><CardTitle className="text-sm">소견</CardTitle></CardHeader>
        <CardBody>
          <ul className="text-sm space-y-1.5 text-slate-700">
            <li>· 폐 침윤 음영 없음</li>
            <li>· 심장 음영 정상 범위</li>
            <li>· 늑막 삼출 없음</li>
            <li>· 골 구조물 이상 없음</li>
          </ul>
        </CardBody>
      </Card>
    </div>
  );
}

function LABTab() {
  const rows: Array<{ name: string; value: string; unit: string; ref: string; flag?: "high" | "low" }> = [
    { name: "Troponin I", value: "0.82", unit: "ng/mL", ref: "<0.04", flag: "high" },
    { name: "CK-MB", value: "12.4", unit: "ng/mL", ref: "<6.3", flag: "high" },
    { name: "WBC", value: "10.2", unit: "10³/µL", ref: "4.0–10.0", flag: "high" },
    { name: "Hb", value: "14.1", unit: "g/dL", ref: "13.5–17.5" },
    { name: "Platelet", value: "245", unit: "10³/µL", ref: "150–400" },
    { name: "Glucose", value: "112", unit: "mg/dL", ref: "70–110", flag: "high" },
    { name: "Cr", value: "0.9", unit: "mg/dL", ref: "0.7–1.3" },
  ];
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-slate-500 border-b border-slate-200">
            <th className="py-2 pr-4 font-medium">항목</th>
            <th className="py-2 pr-4 font-medium text-right">값</th>
            <th className="py-2 pr-4 font-medium">단위</th>
            <th className="py-2 pr-4 font-medium">참고치</th>
            <th className="py-2 font-medium">Flag</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.name} className="border-b border-slate-100">
              <td className="py-2.5 pr-4 font-medium text-slate-900">{r.name}</td>
              <td className={"py-2.5 pr-4 text-right font-numeric font-semibold " + (r.flag === "high" ? "text-critical" : r.flag === "low" ? "text-blue-600" : "text-slate-900")}>
                {r.value}
              </td>
              <td className="py-2.5 pr-4 text-slate-500 font-numeric">{r.unit}</td>
              <td className="py-2.5 pr-4 text-slate-500 font-numeric">{r.ref}</td>
              <td className="py-2.5">
                {r.flag === "high" && <RiskBadge level="urgent" text="↑↑" size="sm" />}
                {r.flag === "low" && <RiskBadge level="warning" text="↓" size="sm" />}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ModuleCard({ Icon, title, status, risk }: { Icon: typeof Activity; title: string; status: "pending" | "running" | "done"; risk?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 p-4 bg-white">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 mb-2">
        <Icon className="h-4 w-4 text-brand-500" />
        {title}
      </div>
      {status === "done" && risk === "critical" && <RiskBadge level="critical" />}
      {status === "done" && (!risk || risk === "normal") && <RiskBadge level="normal" />}
      {status === "running" && <RiskBadge level="analyzing" text="분석 중" />}
      {status === "pending" && <span className="text-xs text-slate-400">대기</span>}
    </div>
  );
}

function VitalCard({ label, value, unit, abnormal }: { label: string; value: number | null; unit: string; abnormal?: boolean }) {
  return (
    <div className="rounded-lg border border-slate-200 px-3 py-2.5 bg-white">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={"font-numeric font-semibold text-lg " + (abnormal ? "text-critical" : "text-slate-900")}>
        {value ?? "—"}
        <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>
      </div>
    </div>
  );
}

function MeasureCard({ label, value, unit }: { label: string; value: string; unit: string }) {
  return (
    <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2.5">
      <div className="text-xs text-slate-500">{label}</div>
      <div className="font-numeric font-semibold text-base text-slate-900">
        {value}
        <span className="text-xs font-normal text-slate-400 ml-1">{unit}</span>
      </div>
    </div>
  );
}
