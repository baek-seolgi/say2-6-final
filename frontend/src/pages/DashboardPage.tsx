// 응급실 메인 대시보드 — 환자 1명을 선택해 멀티모달(CXR/ECG/LAB) AI 결과를 종합 검토
//
// [디자인 톤]
//   트리아지 페이지(/triage)와 동일 — 의사랑 EMR 클래식 한국 의료 GUI
//   gray-50/white + gray-400 hard border, lucide-react 아이콘, 굴림/돋움 폰트
//
// [흐름]
//   TriagePage → "AI 분석 시작"(Ctrl+Enter) → navigate('/dashboard?patient=MRN')
//   ↓
//   여기서 ?patient= 쿼리에서 MRN 추출 → 좌측 큐 + 멀티모달 표시
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import {
  Search,
  Activity,
  FileText,
  FlaskConical,
  Image as ImageIcon,
  Clock,
  ListChecks,
  CheckCircle2,
  Maximize2,
  Send,
  ArrowLeft,
  Sparkles,
  AlertTriangle,
  HeartPulse,
  ChevronRight,
  UserPlus,
  Pill,
  Stethoscope,
  Timer,
  BedDouble,
  ShieldAlert,
  Eye,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { CXRView, ECGView, LabView } from "../components/modal-views/ModalViews";
import type { ModalRawResponse } from "../components/modal-views/ModalViews";
import Panel from "../components/triage/Panel";
import TriageTopBar from "../components/triage/TriageTopBar";

import { DEMO_CASES_4, type DemoCasePatient } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import {
  KTAS_META,
  CHIEF_COMPLAINT_LABELS,
  PAST_HISTORY_LABELS,
  type QueuePatient,
  type KTAS,
  type EDStatus,
} from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

type Modality = "CXR" | "ECG" | "LAB";

interface ModalResultsState {
  CXR: ModalRawResponse | null;
  ECG: ModalRawResponse | null;
  LAB: ModalRawResponse | null;
}

// AI 권고 차수 — 트리아지 직후=1차, 첫 모달 결과 후=2차, 그 이후=3차
// 백엔드 ServiceRequest의 created_at 순서로 판단 (draft만 = 미승인 권고)
interface AIRecommendation {
  modality: Modality;
  rank: 1 | 2 | 3;            // 차수
  sr_id: string;
  reason?: string;
  created_at?: string;
}

// ── mock 결과 (백엔드 /reports 결과로 교체 예정) ─────────────
interface ModalReport {
  findings: string[];
  impression: string;
  bboxes?: { label: string; x: number; y: number; w: number; h: number; severity: "critical" | "info" }[];
  aiTags?: AITag[];   // 인라인 "AI 검출" 뱃지용 (모달 공통)
}

const MOCK_REPORTS: Record<Modality, ModalReport> = {
  CXR: {
    findings: [
      "우측 상엽 1.5cm 결절 음영",
      "양측 폐문주위 경미한 침윤",
      "심장 음영 정상",
    ],
    impression: "초기 결절 또는 국소 감염 의심. 후속 CT 권고.",
    bboxes: [
      { label: "결절", x: 38, y: 32, w: 12, h: 13, severity: "critical" },
      { label: "침윤", x: 60, y: 50, w: 22, h: 18, severity: "info" },
    ],
  },
  ECG: {
    findings: ["정상 동성 리듬", "급성 ST-T 변화 없음"],
    impression: "특이소견 없음.",
  },
  LAB: {
    findings: [
      "WBC 12.4 K/uL (상승)",
      "CRP 8.2 mg/dL (상승)",
      "Lactate 2.1 mmol/L (정상)",
    ],
    impression: "경미한 백혈구증가 + CRP 상승 — 감염 시사.",
  },
};

// ── 진료 진행 단계 (Pulsara 스타일) ───────────────────────
const EXAM_STAGES: { key: EDStatus | "analysis" | "transmit"; label: string; short: string; desc: string }[] = [
  { key: "arrived",         label: "환자 도착",        short: "도착",   desc: "응급실 등록 완료" },
  { key: "triage",          label: "트리아지",          short: "트리아지", desc: "KTAS 분류 완료" },
  { key: "in_consult",      label: "임상 진료",         short: "진료",   desc: "주치의 1차 진료" },
  { key: "testing",         label: "영상/검체 진행",   short: "검사",   desc: "X-ray·CT·혈액 진행" },
  { key: "analysis",        label: "AI 멀티모달 분석", short: "AI",     desc: "CXR + ECG + LAB 통합" },
  { key: "transmit",        label: "최종 소견 전송",    short: "전송",   desc: "EMR 등록 + 의사 서명" },
];

// KTAS 별 목표 처치 시간 (분) — 한국 KTAS 매뉴얼 기준
const KTAS_TARGET_MIN: Record<KTAS, number> = {
  1: 0,    // 즉시
  2: 10,
  3: 30,
  4: 60,
  5: 120,
};

// 환자가 MIMIC 데모 케이스인지 (subject_id, cxr_s3_uri 등을 가진 확장 타입)
function isDemoCase(p: QueuePatient): p is DemoCasePatient {
  return (p as DemoCasePatient).is_demo === true;
}

// FHIR ServiceRequest.code.coding[0].display 값 → 우리 Modality 코드로 매핑
function srToModality(sr: Record<string, unknown>): Modality | null {
  const code = (sr.code || {}) as Record<string, unknown>;
  const codings = (code.coding || []) as Array<Record<string, unknown>>;
  const display = String((codings[0] || {}).display || "").toLowerCase();
  if (display.includes("ekg") || display.includes("ecg") || display.includes("electrocard")) return "ECG";
  if (display.includes("chest") || display.includes("x-ray") || display.includes("xray") || display.includes("radiograph")) return "CXR";
  if (display.includes("lab") || display.includes("blood") || display.includes("chem") || display.includes("complete blood")) return "LAB";
  return null;
}

// /encounters/{eid}/service-requests 응답 → AI 권고 시계열
// draft 상태인 SR을 created_at 순으로 정렬해 1차/2차/3차 차수 부여
function parseAIRecommendations(srList: Array<Record<string, unknown>>): AIRecommendation[] {
  type RawSR = {
    id: string;
    status: string;
    modality: Modality;
    authored_on: string;
    reason: string;
  };
  const parsed: RawSR[] = [];
  for (const sr of srList) {
    const modality = srToModality(sr);
    if (!modality) continue;
    const reasonArr = (sr.reasonCode || []) as Array<Record<string, unknown>>;
    const reason = String((reasonArr[0] || {}).text || "");
    parsed.push({
      id: String(sr.id || ""),
      status: String(sr.status || ""),
      modality,
      authored_on: String(sr.authoredOn || sr.occurrenceDateTime || ""),
      reason,
    });
  }
  // created_at 오름차순 (가장 오래된 = 1차)
  parsed.sort((a, b) => a.authored_on.localeCompare(b.authored_on));

  // 차수 = 시간 클러스터 (병렬 오더 지원)
  // 같은 시점(±5초 이내) 생성된 SR들은 같은 차수 (예: ECG + LAB 병렬 1차)
  // 5초 이상 시간 갭이 있으면 차수 +1 (예: ECG 결과 후 CXR 자동 권고 → 2차)
  const TIME_CLUSTER_MS = 5_000;
  const rankOf = new Map<string, number>(); // sr_id → rank
  let rank = 1;
  let prevMs = 0;
  for (const p of parsed) {
    const t = new Date(p.authored_on).getTime();
    if (prevMs && !isNaN(t) && (t - prevMs) > TIME_CLUSTER_MS) {
      rank += 1;
    }
    rankOf.set(p.id, Math.min(rank, 3));
    if (!isNaN(t)) prevMs = t;
  }

  // 모달리티별 "가장 이른 AI draft" 1개 = 원초 권고. 이후 transition 되어도 유지.
  // (parallel 슬롯에서 ECG 완료 + LAB 진행중 같이 표시하기 위함)
  const earliestDraftByModality: Record<string, RawSR> = {};
  for (const p of parsed) {
    if (p.status === "draft" && !earliestDraftByModality[p.modality]) {
      earliestDraftByModality[p.modality] = p;
    }
  }

  const recs: AIRecommendation[] = Object.values(earliestDraftByModality).map((p) => ({
    modality: p.modality,
    rank: (rankOf.get(p.id) ?? 1) as 1 | 2 | 3,
    sr_id: p.id,
    reason: p.reason || undefined,
    created_at: p.authored_on,
  }));
  recs.sort((a, b) => a.rank - b.rank || a.modality.localeCompare(b.modality));
  return recs;
}

// CXR finding 영문명 → 한글 라벨
const CXR_KO: Record<string, string> = {
  "Cardiomegaly": "심확대",
  "Pleural_Effusion": "흉수",
  "Edema": "폐부종",
  "Pneumothorax": "기흉",
  "Atelectasis": "무기폐",
  "Enlarged_Cardiomediastinum": "심종격 확대",
  "Pneumonia": "폐렴",
  "Consolidation": "경화",
  "Lung_Opacity": "폐 음영",
  "Lung_Lesion": "폐 병변",
  "Fracture": "골절",
  "Support_Devices": "의료장치",
  "No_Finding": "특이소견 없음",
};

interface AITag {
  label: string;
  severity: "critical" | "warn" | "info";
}

// finding에서 한글 라벨 추출 (ECG는 detail 한글 사용, CXR은 name 매핑)
function findingLabel(f: Record<string, unknown>, modality: Modality): string {
  const name = String(f.name || "");
  if (modality === "CXR") {
    return CXR_KO[name] || name.replace(/_/g, " ");
  }
  // ECG/LAB: detail의 첫 부분 (신뢰도 앞)
  const detail = String(f.detail || "").trim();
  if (detail) {
    return detail.split(/\s*\(신뢰도/)[0].trim() || detail;
  }
  return name;
}

function severityToTag(sev: unknown): AITag["severity"] {
  const s = String(sev || "").toLowerCase();
  if (s === "critical" || s === "severe" || s === "high") return "critical";
  if (s === "moderate" || s === "warning") return "warn";
  return "info";
}

// LAB finding 이름 → biomarker 키 (중복 제거용)
//   "critical_potassium_high" / "secondary_potassium_high" → 둘 다 "potassium_high"
//   카테고리 prefix 제거 후 동일 키면 같은 finding으로 간주
function biomarkerKey(name: string): string {
  return name.replace(/^(critical|primary|secondary|general|respiratory|cardiac)_/i, "");
}
const SEVERITY_RANK: Record<string, number> = {
  critical: 4,
  primary: 3,
  cardiac: 3,
  general: 2,
  respiratory: 2,
  secondary: 1,
};
function categoryRank(name: string): number {
  const m = name.match(/^(critical|primary|secondary|general|respiratory|cardiac)_/i);
  const cat = (m?.[1] ?? "secondary").toLowerCase();
  return SEVERITY_RANK[cat] ?? 1;
}

// 백엔드 raw_response → 화면용 ModalReport 정규화
function extractReportFromBackend(raw: ModalRawResponse, modality: Modality): ModalReport {
  const rawFindings = (raw.findings ?? []) as Array<Record<string, unknown>>;

  // LAB만 biomarker 단위로 dedupe (critical 우선)
  const dedupedFindings: Array<Record<string, unknown>> =
    modality === "LAB"
      ? Object.values(
          rawFindings.reduce<Record<string, Record<string, unknown>>>((acc, f) => {
            const key = biomarkerKey(String(f.name || ""));
            const existing = acc[key];
            if (!existing || categoryRank(String(f.name || "")) > categoryRank(String(existing.name || ""))) {
              acc[key] = f;
            }
            return acc;
          }, {})
        )
      : rawFindings;

  const findings = dedupedFindings
    .map((f) => {
      const name = (f.name ?? f.label ?? "") as string;
      const detail = (f.detail ?? f.impression_text ?? "") as string;
      return name ? `${name}${detail ? `: ${detail}` : ""}` : "";
    })
    .filter(Boolean) as string[];

  const impression = (raw.impression as string) || (raw.summary as string) || "결과 없음";

  // CXR — measurements.ctr_lines 으로부터 bbox 도출(스크린샷 톤)
  let bboxes: ModalReport["bboxes"];
  if (modality === "CXR" && raw.measurements) {
    const m = raw.measurements as Record<string, unknown>;
    const lines = (m.ctr_lines || {}) as Record<string, number>;
    const meta = (raw.metadata || {}) as Record<string, unknown>;
    const origSize = (meta.original_size || meta.image_size || [0, 0]) as [number, number];
    const [origH, origW] = Array.isArray(origSize) ? origSize : [0, 0];
    if (origW > 0 && origH > 0 && lines.heart_left_x !== undefined) {
      const heartW = ((lines.heart_right_x - lines.heart_left_x) / origW) * 100;
      const heartX = (lines.heart_left_x / origW) * 100;
      const heartY = (lines.heart_row / origH) * 100;
      bboxes = [
        {
          label: `심장 ${lines.heart_right_x - lines.heart_left_x}px`,
          x: heartX, y: heartY - 1, w: heartW, h: 2,
          severity: ((m.ctr_status as string) === "elevated" ? "critical" : "info"),
        },
      ];
    }
  }

  // AI 검출 뱃지 — 모달 공통 (LAB은 dedup된 findings 사용)
  const aiTags: AITag[] = [];
  for (const f of dedupedFindings) {
    const conf = typeof f.confidence === "number" ? f.confidence : 1;
    const detectedFlag = f.detected;
    const isDetected =
      detectedFlag === true || (detectedFlag === undefined && conf >= 0.5);
    if (!isDetected) continue;
    const label = findingLabel(f, modality);
    if (!label || label === "특이소견 없음" || /^no[_ ]finding/i.test(String(f.name || ""))) continue;
    aiTags.push({ label, severity: severityToTag(f.severity) });
  }

  // LAB은 6시간 후 악화 예측을 인라인 FINDINGS에도 합쳐서 노출
  let mergedFindings = findings.length ? [...findings] : [impression];
  if (modality === "LAB") {
    const prog = raw.prognosis_6h as Record<string, unknown> | null | undefined;
    if (prog && typeof prog === "object") {
      const PROG_LABELS: Record<string, string> = {
        hemoglobin_down: "Hemoglobin 감소",
        creatinine_up:   "Creatinine 증가",
        potassium_worse: "Potassium 악화",
        lactate_up:      "Lactate 증가",
        troponin_up:     "Troponin 상승",
      };
      const progLines: string[] = [];
      for (const [key, label] of Object.entries(PROG_LABELS)) {
        const v = prog[key];
        if (typeof v === "number") {
          const pct = (v * 100).toFixed(1);
          const tag = v >= 0.5 ? "⚠ 고위험" : v >= 0.3 ? "주의" : "저위험";
          progLines.push(`[6h 예측] ${label}: ${pct}% — ${tag}`);
          // 50% 이상이면 AI 검출 뱃지에도 추가 (warn/critical)
          if (v >= 0.5) {
            aiTags.push({
              label: `${label} ${pct}%`,
              severity: v >= 0.7 ? "critical" : "warn",
            });
          }
        }
      }
      if (progLines.length > 0) {
        mergedFindings = [...mergedFindings, "── 6시간 후 악화 예측 ──", ...progLines];
      }
    }
  }

  return {
    findings: mergedFindings,
    impression,
    bboxes,
    aiTags,
  };
}


// ════════════════════════════════════════════════════════════════════
// 페이지
// ════════════════════════════════════════════════════════════════════

export default function DashboardPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const patientFromUrl = params.get("patient");
  const encounterIdFromUrl = params.get("encounter_id");

  const initialId =
    ALL_PATIENTS.find((p) => p.mrn === patientFromUrl || p.id === patientFromUrl)?.id ??
    ALL_PATIENTS[0]?.id ??
    "";

  const [selectedId, setSelectedId] = useState<string>(initialId);
  const [activeTab, setActiveTab] = useState<Modality>("CXR");
  const [search, setSearch] = useState("");

  // 백엔드 모달 결과 상태
  const [modalResults, setModalResults] = useState<ModalResultsState>({
    CXR: null, ECG: null, LAB: null,
  });
  const [modalLoading, setModalLoading] = useState<Record<Modality, boolean>>({
    CXR: false, ECG: false, LAB: false,
  });
  // AI 권고 시계열 (created_at 오름차순 — [0]=1차, [1]=2차, ...)
  const [aiRecommendations, setAiRecommendations] = useState<AIRecommendation[]>([]);
  // 통합 소견서 다이얼로그 열림 상태
  const [reportOpen, setReportOpen] = useState(false);
  // EMR 전송 완료 상태 (Pulsara 전송 단계 활성화 트리거)
  const [reportTransmitted, setReportTransmitted] = useState(false);
  const orderedRef = useRef<Set<string>>(new Set());  // 중복 오더 방지

  const patient = useMemo(
    () => ALL_PATIENTS.find((p) => p.id === selectedId) ?? ALL_PATIENTS[0],
    [selectedId]
  );

  // FHIR patient_id — TriagePage가 navigate URL에 ?patient_id=로 포함시켜둠
  // 못 받으면 encounter_id로 fallback (백엔드 /orders/request에서 patient_id는 거의 logging만 사용)
  const fhirPatientId = params.get("patient_id") || encounterIdFromUrl;
  const primaryModality = (params.get("primary_modality") || null) as Modality | null;

  // 의사가 버튼 클릭 → 모달 오더 발행 (의사 승인 = 트리거)
  const handleOrderModal = useCallback(
    async (modality: Modality) => {
      if (!encounterIdFromUrl) {
        alert("encounter가 없습니다. 트리아지에서 환자 등록 후 다시 시도해주세요.");
        return;
      }
      const orderKey = `${encounterIdFromUrl}-${modality}`;
      if (orderedRef.current.has(orderKey)) {
        return;  // 중복 클릭 방지
      }
      orderedRef.current.add(orderKey);
      setModalLoading((s) => ({ ...s, [modality]: true }));

      try {
        const res = await fetch("/orders/request", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            encounter_id: encounterIdFromUrl,
            patient_id: fhirPatientId,
            modality,
          }),
        });
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }
      } catch (e) {
        console.warn(`[orders] ${modality} 오더 실패:`, e);
        orderedRef.current.delete(orderKey);  // 실패 시 재시도 가능
        setModalLoading((s) => ({ ...s, [modality]: false }));
      }
    },
    [encounterIdFromUrl, fhirPatientId]
  );

  // ── encounter_id 있으면 결과 폴링 (모달은 의사 승인 시점에만 실행) ──
  useEffect(() => {
    if (!encounterIdFromUrl) return;
    const eid = encounterIdFromUrl;
    let stopped = false;

    const pollOnce = async () => {
      // 1) modal-results — 완료된 모달의 raw 응답
      try {
        const res = await fetch(`/encounters/${eid}/modal-results`);
        if (res.ok) {
          const data = await res.json();
          const results = data.results || {};
          setModalResults({
            CXR: results.CXR ?? null,
            ECG: results.ECG ?? null,
            LAB: results.LAB ?? null,
          });
          setModalLoading((prev) => ({
            CXR: prev.CXR && !results.CXR,
            ECG: prev.ECG && !results.ECG,
            LAB: prev.LAB && !results.LAB,
          }));
        }
      } catch (e) {
        console.warn("[modal-results] 폴링 실패:", e);
      }

      // 2) service-requests — AI 권고 SR 시계열
      try {
        const res = await fetch(`/encounters/${eid}/service-requests`);
        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list)) {
            const recs = parseAIRecommendations(list);
            setAiRecommendations(recs);
          }
        }
      } catch (e) {
        console.warn("[service-requests] 폴링 실패:", e);
      }
    };

    const tick = async () => {
      if (stopped) return;
      await pollOnce();
      if (!stopped) setTimeout(tick, 2000);
    };
    tick();

    return () => {
      stopped = true;
    };
  }, [encounterIdFromUrl]);

  const visiblePatients = useMemo(() => {
    const filtered = ALL_PATIENTS.filter((p) => {
      if (!search) return true;
      const s = search.toLowerCase();
      return (
        p.name.toLowerCase().includes(s) ||
        p.mrn.toLowerCase().includes(s) ||
        p.id.toLowerCase().includes(s)
      );
    });
    return filtered.sort((a, b) => (a.ktas ?? 5) - (b.ktas ?? 5)).slice(0, 14);
  }, [search]);

  if (!patient) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center text-gray-500">
        환자 데이터가 없습니다.
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* 상단 의사랑 EMR 스타일 툴바 */}
      <TriageTopBar />

      {/* 페이지 헤더 (환자 식별 바) */}
      <PatientHeaderBar
        patient={patient}
        onBack={() => navigate("/triage")}
      />

      {/* 디버그 인디케이터 — encounter 흐름 가시화 */}
      <FlowDebugBar
        encounterId={encounterIdFromUrl}
        patientId={fhirPatientId}
        primaryModality={primaryModality}
        modalResults={modalResults}
        modalLoading={modalLoading}
      />

      {/* Pulsara 수평 진행 바 */}
      <PulsaraStageBar
        patient={patient}
        hasEncounter={!!encounterIdFromUrl}
        modalResults={modalResults}
        modalLoading={modalLoading}
        recommendations={aiRecommendations}
        reportTransmitted={reportTransmitted}
      />

      {/* 3-컬럼 본문 */}
      <div className="flex-1 grid grid-cols-12 gap-2 p-2 min-h-0">
        {/* ── 좌: 환자 큐 + 환자 정보 ─────────────────── */}
        <aside className="col-span-3 flex flex-col gap-2 min-h-0">
          <PatientSearchBox value={search} onChange={setSearch} />
          <PatientQueuePanel
            patients={visiblePatients}
            selectedId={selectedId}
            onSelect={setSelectedId}
          />
          <PatientInfoPanel patient={patient} />
        </aside>

        {/* ── 중: AI 워크플로우 ────────────────────── */}
        <section className="col-span-4 flex flex-col gap-2 min-h-0">
          <ExamSuggestionsPanel
            patient={patient}
            onOrderModal={handleOrderModal}
            modalLoading={modalLoading}
            modalResults={modalResults}
            primaryModality={primaryModality}
            recommendations={aiRecommendations}
          />
          <KTASTimeTrackerPanel patient={patient} />
          <ERStatusBoardPanel />
          <BahmniTimelinePanel encounterId={encounterIdFromUrl} />
        </section>

        {/* ── 우: 멀티모달 뷰어 (영상 + FINDINGS/IMPRESSION 인라인) ── */}
        <section className="col-span-5 flex flex-col gap-2 min-h-0">
          <ModalityViewerPanel
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            patient={patient}
            modalResults={modalResults}
            modalLoading={modalLoading}
          />

          {/* 하단 액션: 통합 소견서 다이얼로그 트리거 */}
          <button
            onClick={() => setReportOpen(true)}
            disabled={
              !modalResults.CXR && !modalResults.ECG && !modalResults.LAB
            }
            className="w-full bg-gray-800 text-white text-[13px] font-bold py-2.5 hover:bg-gray-900 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 border border-gray-900"
          >
            <FileText size={14} />
            통합 의료 소견서 보기 / PDF 출력 / 의사 서명
          </button>
        </section>
      </div>

      {/* 통합 의료 소견서 다이얼로그 (PDF 톤, 의사 서명) */}
      {reportOpen && (
        <IntegratedReportDialog
          patient={patient}
          modalResults={modalResults}
          encounterId={encounterIdFromUrl}
          onClose={() => setReportOpen(false)}
          onTransmit={() => setReportTransmitted(true)}
        />
      )}
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 디버그 흐름 인디케이터 — 트리아지→encounter→모달 호출→결과 한눈에
// ════════════════════════════════════════════════════════════════════

function FlowDebugBar({
  encounterId,
  patientId,
  primaryModality,
  modalResults,
  modalLoading,
}: {
  encounterId: string | null;
  patientId: string | null;
  primaryModality: Modality | null;
  modalResults: ModalResultsState;
  modalLoading: Record<Modality, boolean>;
}) {
  const renderModalDot = (m: Modality) => {
    const ok = !!modalResults[m];
    const loading = modalLoading[m];
    const cls = ok ? "bg-emerald-500" : loading ? "bg-blue-500 animate-pulse" : "bg-gray-300";
    return (
      <span key={m} className="flex items-center gap-1">
        <span className={`w-2 h-2 rounded-full ${cls}`} />
        <span className={ok ? "text-emerald-700 font-bold" : loading ? "text-blue-700 font-bold" : "text-gray-500"}>
          {m}
        </span>
      </span>
    );
  };

  return (
    <div className="bg-amber-50 border-b border-amber-300 px-3 py-1.5 flex items-center gap-3 text-[11px] font-mono overflow-x-auto">
      <span className="text-amber-800 font-bold tracking-widest text-[10px] uppercase">FHIR Flow</span>
      <span className="text-gray-700">encounter_id:</span>
      <span className="font-bold text-blue-700">{encounterId || "—"}</span>
      <span className="text-gray-700">patient_id:</span>
      <span className="font-bold text-blue-700">{patientId || "—"}</span>
      <span className="text-gray-700">AI 1차 모달:</span>
      <span className="font-bold text-purple-700">{primaryModality || "—"}</span>
      <div className="w-px h-4 bg-amber-300" />
      <span className="text-gray-700">결과:</span>
      <div className="flex items-center gap-2">
        {(["CXR", "ECG", "LAB"] as Modality[]).map(renderModalDot)}
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// Pulsara 스타일 수평 진행 바 — 환자 동선을 한눈에
// ════════════════════════════════════════════════════════════════════

function PulsaraStageBar({
  patient,
  hasEncounter,
  modalResults,
  modalLoading,
  recommendations,
  reportTransmitted,
}: {
  patient: QueuePatient;
  hasEncounter: boolean;
  modalResults: ModalResultsState;
  modalLoading: Record<Modality, boolean>;
  recommendations: AIRecommendation[];
  reportTransmitted: boolean;
}) {
  // 단계별 상태를 모달 데이터 기반으로 동적 판단:
  //   0 도착          : 항상 완료 (encounter 진입 시점)
  //   1 트리아지       : encounter 있으면 완료
  //   2 임상진료       : AI 권고 1개 이상 떠 있으면 완료
  //   3 영상/검체 진행 : 현재 — 어떤 모달이라도 loading 중이면 current; 다 끝나면 완료
  //   4 AI 통합 분석   : 현재 — 모든 권고 모달이 완료된 직후 (보고서 생성 전)
  //   5 최종 전송       : 보고서 서명 후 (지금은 미구현 → idle)

  const anyModalRunning = modalLoading.CXR || modalLoading.ECG || modalLoading.LAB;
  const anyModalDone = !!(modalResults.CXR || modalResults.ECG || modalResults.LAB);
  const allRecsDone =
    recommendations.length > 0 &&
    recommendations.every((r) => !!modalResults[r.modality]);

  // patient.status 도 보조 신호로 (트리아지/검사 등)
  const fallbackIdx = (() => {
    switch (patient.status) {
      case "arrived":         return 0;
      case "triage":          return 1;
      case "in_consult":      return 2;
      case "testing":         return 3;
      case "results_pending": return 4;
      case "admit_wait":
      case "discharged":      return 5;
      default:                return 0;
    }
  })();

  let currentExamIdx: number;
  if (reportTransmitted) {
    // EMR 전송 완료 → 마지막 단계
    currentExamIdx = 5;
  } else if (allRecsDone) {
    // 모든 권고 모달 완료 → AI 통합 분석 단계
    currentExamIdx = 4;
  } else if (anyModalRunning) {
    // 검사 진행 중
    currentExamIdx = 3;
  } else if (anyModalDone) {
    // 일부 끝났으나 추가 진행 대기 (= 검사 단계 아직)
    currentExamIdx = 3;
  } else if (recommendations.length > 0) {
    // AI 권고 받았으나 의사 미승인 → 진료 중
    currentExamIdx = 2;
  } else if (hasEncounter) {
    currentExamIdx = 1;  // 트리아지 직후
  } else {
    currentExamIdx = fallbackIdx;
  }

  const STAGE_ICONS: Record<string, LucideIcon> = {
    arrived: UserPlus,
    triage: Stethoscope,
    in_consult: Eye,
    testing: FlaskConical,
    analysis: Sparkles,
    transmit: Send,
  };

  return (
    <div className="bg-white border-b border-gray-400 px-3 py-2 overflow-x-auto">
      <div className="flex items-center gap-1 min-w-max">
        {EXAM_STAGES.map((stage, i) => {
          const Icon = STAGE_ICONS[stage.key] ?? Activity;
          const isCompleted = i < currentExamIdx;
          const isCurrent = i === currentExamIdx;
          const isLast = i === EXAM_STAGES.length - 1;

          return (
            <div key={stage.key} className="flex items-center gap-1">
              <div
                className={[
                  "flex items-center gap-1.5 px-2.5 py-1 border",
                  isCompleted
                    ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                    : isCurrent
                    ? "bg-blue-50 border-blue-600 text-blue-900 shadow-[0_0_0_2px_rgba(37,99,235,0.2)]"
                    : "bg-gray-50 border-gray-300 text-gray-400",
                ].join(" ")}
              >
                <Icon size={13} />
                <span className="text-[12px] font-bold">{stage.short}</span>
                {isCompleted && (
                  <CheckCircle2 size={11} className="text-emerald-600" />
                )}
                {isCurrent && (
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-600 animate-pulse-soft" />
                )}
              </div>
              {!isLast && (
                <ChevronRight
                  size={14}
                  className={isCompleted ? "text-emerald-400" : "text-gray-300"}
                />
              )}
            </div>
          );
        })}
        <div className="flex-1" />
        <div className="flex items-center gap-1.5 text-[11px] text-gray-600 px-2 border-l border-gray-300 ml-2">
          <Timer size={12} />
          <span className="font-mono">
            도착 후 <span className="font-bold text-gray-900">{minutesSinceArrival(patient)}분</span>
          </span>
        </div>
      </div>
    </div>
  );
}

function minutesSinceArrival(patient: QueuePatient): number {
  return Math.max(0, Math.floor((Date.now() - new Date(patient.arrived_at).getTime()) / 60000));
}

// ════════════════════════════════════════════════════════════════════
// 환자 식별 바 — 트리아지 환자 정보바와 동일 진회색 (Medplum PatientHeader 강화)
// ════════════════════════════════════════════════════════════════════

function PatientHeaderBar({
  patient,
  onBack,
}: {
  patient: QueuePatient;
  onBack: () => void;
}) {
  const ktas = KTAS_META[patient.ktas as KTAS];
  const ccLabel = patient.chief_complaint
    ? CHIEF_COMPLAINT_LABELS[patient.chief_complaint]?.ko
    : "—";

  const allergyText = (patient.allergies || "").trim();
  const hasRealAllergy =
    allergyText && allergyText.toUpperCase() !== "NKDA" && allergyText !== "없음";

  // 환자 이름의 첫 글자 (Medplum avatar 스타일)
  const avatarChar = patient.name.charAt(0);

  return (
    <div className="bg-gray-800 text-white border-b-2 border-gray-900">
      {/* 1단: 식별 + KTAS + 주호소 */}
      <div className="px-3 py-2 flex items-center gap-3 flex-wrap">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 text-[12px] hover:bg-gray-700 border border-gray-600"
        >
          <ArrowLeft size={14} />
          트리아지
        </button>
        <div className="w-px h-6 bg-gray-600" />

        {/* Medplum 스타일 avatar */}
        <div className={`w-8 h-8 flex items-center justify-center text-[15px] font-bold border-2 ${ktas.ring} ${ktas.bg} ${ktas.text}`}>
          {avatarChar}
        </div>

        <div className="flex flex-col leading-tight">
          <span className="text-[14px] font-bold">{patient.name}</span>
          <span className="text-[10px] font-mono text-gray-300">
            #{patient.mrn} · {patient.age}세 · {patient.sex === "M" ? "남" : "여"}
          </span>
        </div>

        <div className="w-px h-6 bg-gray-600" />

        <span className={`px-2 py-0.5 text-[11px] font-bold ${ktas.bg} ${ktas.text}`}>
          KTAS {patient.ktas} · {ktas.label}
        </span>

        <div className="w-px h-6 bg-gray-600" />

        <span className="text-[12px]">
          <span className="text-gray-400">주호소:</span>{" "}
          <span className="text-amber-300 font-bold">{ccLabel}</span>
        </span>

        <div className="flex-1" />

        <span className="text-[11px] text-gray-300">
          도착 {new Date(patient.arrived_at).toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
        </span>
        <div className="w-px h-6 bg-gray-600" />
        <div className="flex items-center gap-1.5 text-[11px]">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span className="font-bold tracking-widest text-gray-200">시스템 정상</span>
        </div>
      </div>

      {/* 2단: Medplum 스타일 알레르기/활성상태 */}
      <div className="bg-gray-700 border-t border-gray-900 px-3 py-1 flex items-center gap-3 flex-wrap text-[11px]">
        {/* 알레르기 */}
        <div className="flex items-center gap-1.5">
          <ShieldAlert
            size={13}
            className={hasRealAllergy ? "text-red-400 animate-pulse-soft" : "text-gray-400"}
          />
          <span className="text-gray-300">알레르기</span>
          <span
            className={
              hasRealAllergy
                ? "px-1.5 py-0 bg-red-600 text-white font-bold border border-red-800"
                : "px-1.5 py-0 bg-gray-600 text-gray-200 border border-gray-500"
            }
          >
            {allergyText || "NKDA"}
          </span>
        </div>

        <div className="w-px h-4 bg-gray-600" />

        {/* 활성 상태 (과거력) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <Activity size={13} className="text-emerald-400" />
          <span className="text-gray-300">활성 상태</span>
          {patient.past_history && patient.past_history.length > 0 ? (
            patient.past_history.slice(0, 8).map((h) => (
              <span
                key={h}
                className="px-1.5 py-0 bg-gray-600 text-amber-300 font-mono font-bold border border-gray-500"
                title={PAST_HISTORY_LABELS[h]}
              >
                {h}
              </span>
            ))
          ) : (
            <span className="text-gray-400">없음</span>
          )}
        </div>

        <div className="w-px h-4 bg-gray-600" />

        {/* 복용약 */}
        {patient.medications && (
          <div className="flex items-center gap-1.5 min-w-0">
            <Pill size={13} className="text-blue-400" />
            <span className="text-gray-300">복용약</span>
            <span className="text-blue-200 truncate max-w-[260px]">{patient.medications}</span>
          </div>
        )}

        <div className="flex-1" />

        {/* 빠른 활력 */}
        <div className="flex items-center gap-2 font-mono text-gray-200">
          <span>BP <span className="font-bold text-white">{patient.vitals?.sbp ?? "-"}/{patient.vitals?.dbp ?? "-"}</span></span>
          <span>HR <span className="font-bold text-white">{patient.vitals?.hr ?? "-"}</span></span>
          <span>SpO2 <span className="font-bold text-white">{patient.vitals?.spo2 ?? "-"}%</span></span>
        </div>
      </div>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 좌측 컬럼
// ════════════════════════════════════════════════════════════════════

function PatientSearchBox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="bg-white border border-gray-400">
      <div className="flex items-center px-2 h-9">
        <Search size={14} className="text-gray-500 mr-2" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="환자 검색 (이름 / 차트번호)"
          className="flex-1 outline-none text-[12px] placeholder:text-gray-400 bg-transparent"
        />
      </div>
    </div>
  );
}

function PatientQueuePanel({
  patients,
  selectedId,
  onSelect,
}: {
  patients: QueuePatient[];
  selectedId: string;
  onSelect: (id: string) => void;
}) {
  return (
    <Panel title="환자 대기열" headerRight={<span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">{patients.length}명</span>}>
      <div className="-m-3 max-h-[280px] overflow-y-auto">
        <ul>
          {patients.map((p) => {
            const ktas = KTAS_META[p.ktas as KTAS];
            const isSelected = p.id === selectedId;
            return (
              <li
                key={p.id}
                onClick={() => onSelect(p.id)}
                className={[
                  "px-2 py-1.5 cursor-pointer border-b border-gray-200 transition-colors",
                  isSelected
                    ? "bg-yellow-100 border-l-4 border-l-amber-500"
                    : "bg-white hover:bg-gray-50 border-l-4 border-l-transparent",
                ].join(" ")}
              >
                <div className="flex items-center gap-2">
                  <span className={`shrink-0 w-5 h-5 flex items-center justify-center text-[11px] font-bold ${ktas.bg} ${ktas.text}`}>
                    {p.ktas}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-bold text-gray-900 truncate leading-tight">{p.name}</p>
                    <p className="text-[10px] font-mono text-gray-500 leading-tight">#{p.mrn} · {p.age}{p.sex === "M" ? "남" : "여"}</p>
                  </div>
                  <span className="text-[10px] text-gray-500 shrink-0">{stageKo(p.status)}</span>
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </Panel>
  );
}

function PatientInfoPanel({ patient }: { patient: QueuePatient }) {
  const ccLabel = patient.chief_complaint
    ? CHIEF_COMPLAINT_LABELS[patient.chief_complaint]?.ko
    : "—";

  return (
    <Panel title="환자 정보">
      <table className="w-full text-[12px] border-collapse">
        <tbody>
          <InfoRow label="차트번호" value={<span className="font-mono">{patient.mrn}</span>} />
          <InfoRow label="성별/나이" value={`${patient.sex === "M" ? "남" : "여"} / ${patient.age}세`} />
          <InfoRow
            label="주호소"
            value={
              <div>
                <span className="text-red-700 font-bold">{ccLabel}</span>
                {patient.complaint_detail && (
                  <p className="text-[11px] text-gray-700 mt-0.5 leading-tight">
                    {patient.complaint_detail}
                  </p>
                )}
              </div>
            }
          />
          <InfoRow
            label="과거력"
            value={
              patient.past_history && patient.past_history.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {patient.past_history.slice(0, 6).map((h) => (
                    <span
                      key={h}
                      className="inline-block px-1.5 py-0 text-[10px] font-mono bg-white border border-gray-400"
                      title={PAST_HISTORY_LABELS[h]}
                    >
                      {h}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-gray-500">없음</span>
              )
            }
          />
          <InfoRow
            label="활력징후"
            value={
              <div className="grid grid-cols-3 gap-1 text-[11px] font-mono">
                <VitalCell label="BP" value={`${patient.vitals?.sbp ?? "-"}/${patient.vitals?.dbp ?? "-"}`} />
                <VitalCell label="HR" value={patient.vitals?.hr ?? "-"} />
                <VitalCell label="SpO2" value={`${patient.vitals?.spo2 ?? "-"}%`} />
              </div>
            }
          />
          <InfoRow label="알레르기" value={patient.allergies || "NKDA"} />
        </tbody>
      </table>
    </Panel>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <tr className="border-b border-gray-200 last:border-b-0">
      <th className="text-left align-top text-[11px] font-bold text-gray-700 bg-gray-100 border-r border-gray-300 py-1 px-2 w-20">
        {label}
      </th>
      <td className="py-1 px-2 align-top">{value}</td>
    </tr>
  );
}

function VitalCell({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="border border-gray-300 bg-white px-1 py-0.5">
      <p className="text-[9px] uppercase text-gray-500 leading-none">{label}</p>
      <p className="text-gray-900 font-bold leading-tight">{value}</p>
    </div>
  );
}

// ════════════════════════════════════════════════════════════════════
// 중앙 컬럼
// ════════════════════════════════════════════════════════════════════

// Modality별 한글/아이콘 메타
const MODALITY_META: Record<Modality, { ko: string; verb: string; icon: LucideIcon }> = {
  CXR: { ko: "흉부X-ray", verb: "진행",   icon: ImageIcon },
  ECG: { ko: "심전도",     verb: "진행",   icon: HeartPulse },
  LAB: { ko: "혈액검사",   verb: "진행",   icon: FlaskConical },
};

// 차수별 색상 (1차=보라, 2차=파랑, 3차=초록)
const RANK_META: Record<1 | 2 | 3, { ko: string; ring: string; badge: string; bar: string }> = {
  1: { ko: "1차", ring: "border-purple-500",  badge: "bg-purple-600",  bar: "bg-purple-50  border-purple-300  text-purple-900" },
  2: { ko: "2차", ring: "border-blue-500",    badge: "bg-blue-600",    bar: "bg-blue-50    border-blue-300    text-blue-900" },
  3: { ko: "3차", ring: "border-emerald-500", badge: "bg-emerald-600", bar: "bg-emerald-50 border-emerald-300 text-emerald-900" },
};

function ExamSuggestionsPanel({
  patient,
  onOrderModal,
  modalLoading,
  modalResults,
  recommendations,
}: {
  patient: QueuePatient;
  onOrderModal: (modality: Modality) => void;
  modalLoading: Record<Modality, boolean>;
  modalResults: ModalResultsState;
  primaryModality: Modality | null;
  recommendations: AIRecommendation[];
}) {
  const ktasMeta = patient.ktas ? KTAS_META[patient.ktas as KTAS] : null;

  function statusOf(m: Modality): "idle" | "running" | "done" {
    if (modalResults[m]) return "done";
    if (modalLoading[m]) return "running";
    return "idle";
  }

  // 가장 높은 차수의 권고 묶음 — 그 중 미완료가 하나라도 있으면 그 차수 전체 표시
  // (병렬 ECG+LAB 중 ECG만 끝나도 슬롯 유지, LAB까지 끝나야 사라짐)
  const ranksWithUndone = recommendations
    .filter((r) => !modalResults[r.modality])
    .map((r) => r.rank);
  const latestRank = ranksWithUndone.length > 0 ? Math.max(...ranksWithUndone) : 0;
  // 같은 차수의 모든 모달리티 (완료된 것 포함)
  const currentRecs = recommendations.filter((r) => r.rank === latestRank);
  const currentRec = currentRecs[0] ?? null;
  const isParallelRec = currentRecs.length > 1;

  // 완료된 모달 (시계열 — modalResults 도착 순)
  const completedMods: Modality[] = (["ECG", "CXR", "LAB"] as Modality[]).filter(
    (m) => modalResults[m] != null
  );

  // 의사 직접 선택 (AI 권고와 무관)
  const [doctorChoice, setDoctorChoice] = useState<Modality | null>(null);

  function handleDoctorApprove() {
    if (!doctorChoice) return;
    if (statusOf(doctorChoice) !== "idle") {
      alert("이미 진행/완료된 검사입니다.");
      return;
    }
    onOrderModal(doctorChoice);
    setDoctorChoice(null);
  }

  return (
    <Panel
      title="검사 권고"
      headerRight={
        <span className="flex items-center gap-1 text-[10px] text-purple-700 font-bold">
          <Sparkles size={11} /> AI
        </span>
      }
    >
      <div className="space-y-3">
        {/* ── 1) AI 판단 근거 ────────────────────────── */}
        <div className="bg-blue-50 border border-blue-300 px-2.5 py-2">
          <div className="flex items-center gap-1.5 mb-1">
            <Sparkles size={12} className="text-blue-700" />
            <p className="text-[10px] font-bold tracking-widest text-blue-800">AI 판단 근거</p>
          </div>
          <p className="text-[12px] text-gray-800 leading-relaxed">
            {currentRec?.reason
              ? currentRec.reason
              : patient.complaint_detail
              ? `환자는 "${patient.complaint_detail}"을(를) 호소. KTAS ${patient.ktas}(${ktasMeta?.label}) 기준 평가 진행.`
              : "환자 평가 후 추가 검사 권고."}
          </p>
        </div>

        {/* ── 2) AI N차 권고 슬롯 — 병렬 오더면 여러 개 ───── */}
        {currentRec ? (
          isParallelRec ? (
            <ParallelRecommendationSlot
              recs={currentRecs}
              statusOf={statusOf}
              onApprove={(m) => onOrderModal(m)}
            />
          ) : (
            <RecommendationSlot
              rec={currentRec}
              status={statusOf(currentRec.modality)}
              onApprove={() => onOrderModal(currentRec.modality)}
            />
          )
        ) : completedMods.length === 3 ? (
          <div className="bg-emerald-50 border border-emerald-300 px-3 py-2 text-[12px] text-emerald-800 flex items-center gap-2">
            <CheckCircle2 size={14} />
            모든 모달 완료 — 종합 소견 생성 가능
          </div>
        ) : completedMods.length > 0 ? (
          <div className="bg-emerald-50 border border-emerald-300 px-3 py-2 text-[12px] text-emerald-800">
            <div className="flex items-center gap-2 mb-1">
              <CheckCircle2 size={14} />
              <span className="font-bold">AI 추가 권고 없음</span>
            </div>
            <p className="text-[11px] text-emerald-700 leading-relaxed">
              현재 완료된 검사({completedMods.map((m) => MODALITY_META[m].ko).join(", ")})로
              충분한 진단이 가능합니다. 추가 모달 시행 불필요.
              필요 시 의사 직접 지시로 추가 오더 가능.
            </p>
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-300 px-3 py-2 text-[12px] text-gray-500 italic">
            AI 판단 대기 중… (트리아지 제출 필요)
          </div>
        )}

        {/* ── 3) 의사 직접 지시 (AI 권고 무관) ───────── */}
        <div className="border-t border-dashed border-gray-300 pt-3">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-[10px] font-bold tracking-widest text-gray-700 flex items-center gap-1.5">
              <Stethoscope size={11} className="text-gray-700" />
              의사 직접 지시
            </p>
            <span className="text-[10px] text-gray-500 italic">AI 권고와 무관</span>
          </div>

          {/* 모달 선택 — 3개 토글 */}
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            {(["CXR", "ECG", "LAB"] as Modality[]).map((m) => {
              const meta = MODALITY_META[m];
              const Icon = meta.icon;
              const st = statusOf(m);
              const selected = doctorChoice === m;
              const disabled = st !== "idle";
              return (
                <button
                  key={m}
                  onClick={() => !disabled && setDoctorChoice(m)}
                  disabled={disabled}
                  className={[
                    "py-1.5 text-[12px] font-medium border-2 transition-colors flex flex-col items-center gap-0.5",
                    disabled
                      ? "bg-gray-100 border-gray-300 text-gray-400 cursor-not-allowed"
                      : selected
                      ? "bg-blue-100 border-blue-600 text-blue-900 font-bold"
                      : "bg-white border-gray-300 text-gray-700 hover:border-gray-500",
                  ].join(" ")}
                >
                  <Icon size={14} />
                  <span className="text-[11px]">{meta.ko}</span>
                  {st === "done" && (
                    <span className="text-[9px] text-emerald-700">✓ 완료</span>
                  )}
                  {st === "running" && (
                    <span className="text-[9px] text-blue-700">진행중</span>
                  )}
                </button>
              );
            })}
          </div>

          {/* 의사 승인 버튼 */}
          <button
            onClick={handleDoctorApprove}
            disabled={!doctorChoice}
            className={[
              "w-full text-[12px] font-bold py-1.5 flex items-center justify-center gap-1.5 border-2 transition-colors",
              doctorChoice
                ? "bg-blue-700 text-white border-blue-900 hover:bg-blue-800"
                : "bg-gray-100 text-gray-400 border-gray-300 cursor-not-allowed",
            ].join(" ")}
          >
            <CheckCircle2 size={13} />
            {doctorChoice
              ? `${MODALITY_META[doctorChoice].ko} 승인 (의사 직접 지시)`
              : "검사 선택 후 승인"}
          </button>
        </div>

        {/* ── 4) 종합 소견 액션 ──────────────────────── */}
        <button
          disabled={completedMods.length === 0}
          className="w-full bg-gray-100 border border-gray-400 text-gray-800 text-[12px] font-bold py-1.5 hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1.5"
        >
          <CheckCircle2 size={13} />
          종합 소견 생성 및 종료
        </button>
      </div>
    </Panel>
  );
}

// AI N차 권고 메인 슬롯 — 큰 버튼 + 차수 배지
function RecommendationSlot({
  rec,
  status,
  onApprove,
}: {
  rec: AIRecommendation;
  status: "idle" | "running" | "done";
  onApprove: () => void;
}) {
  const meta = MODALITY_META[rec.modality];
  const rankMeta = RANK_META[rec.rank];
  const Icon = meta.icon;

  const buttonLabel =
    status === "running"
      ? `${meta.ko} 분석 중...`
      : status === "done"
      ? `${meta.ko} 완료 ✓`
      : `${meta.ko} ${meta.verb}`;

  return (
    <div className="space-y-1">
      {/* 차수 라벨 + 배지 */}
      <div className={`flex items-center gap-2 px-2 py-1 border-l-4 ${rankMeta.bar} border-l-transparent`}>
        <span className={`px-1.5 py-0 text-[10px] font-bold tracking-widest text-white ${rankMeta.badge}`}>
          AI {rankMeta.ko} 권고
        </span>
        <span className="text-[11px] font-bold">{meta.ko}</span>
      </div>

      {/* 메인 큰 버튼 */}
      <button
        onClick={onApprove}
        disabled={status !== "idle"}
        className={[
          "w-full text-white text-[14px] font-bold py-2.5 flex items-center justify-center gap-2 border-2 disabled:opacity-60 disabled:cursor-not-allowed transition-colors",
          status === "done"
            ? "bg-emerald-700 border-emerald-900 hover:bg-emerald-800"
            : status === "running"
            ? "bg-blue-700 border-blue-900"
            : `bg-gray-800 hover:bg-gray-900 ${rankMeta.ring}`,
        ].join(" ")}
      >
        <Icon size={16} />
        {buttonLabel}
      </button>

      {/* 의사 승인 안내 (작게) */}
      {status === "idle" && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1 px-1">
          <span className="text-[12px]">ⓘ</span>
          의사 승인 시 AI가 자동 분석합니다
        </p>
      )}
    </div>
  );
}

// 병렬 오더 슬롯 — 같은 차수에 여러 모달리티 (ECG + LAB 같은 신장응급 케이스)
function ParallelRecommendationSlot({
  recs,
  statusOf,
  onApprove,
}: {
  recs: AIRecommendation[];
  statusOf: (m: Modality) => "idle" | "running" | "done";
  onApprove: (m: Modality) => void;
}) {
  if (recs.length === 0) return null;
  const rankMeta = RANK_META[recs[0].rank];
  const allDone = recs.every((r) => statusOf(r.modality) === "done");
  const allIdle = recs.every((r) => statusOf(r.modality) === "idle");

  function handleApproveAll() {
    for (const r of recs) {
      if (statusOf(r.modality) === "idle") {
        onApprove(r.modality);
      }
    }
  }

  return (
    <div className="space-y-1.5">
      {/* 차수 라벨 + 병렬 배지 */}
      <div className={`flex items-center gap-2 px-2 py-1 border-l-4 ${rankMeta.bar} border-l-transparent`}>
        <span className={`px-1.5 py-0 text-[10px] font-bold tracking-widest text-white ${rankMeta.badge}`}>
          AI {rankMeta.ko} 권고
        </span>
        <span className="px-1.5 py-0 text-[10px] font-bold border border-current">
          병렬 오더 ({recs.length}개)
        </span>
        <span className="text-[10px] text-gray-600 italic">
          AHA/NICE 가이드라인 — 동시 시행
        </span>
      </div>

      {/* 모달별 작은 카드 그리드 — 완료/진행중/대기 상태별 색상 */}
      <div className={`grid grid-cols-${Math.min(recs.length, 3)} gap-2`}>
        {recs.map((r) => {
          const meta = MODALITY_META[r.modality];
          const Icon = meta.icon;
          const st = statusOf(r.modality);
          const statusLabel =
            st === "done" ? "분석 완료" : st === "running" ? "분석 중" : "대기";
          return (
            <button
              key={r.sr_id}
              onClick={() => onApprove(r.modality)}
              disabled={st !== "idle"}
              className={[
                "text-[12px] font-bold py-2.5 px-2 flex flex-col items-center gap-1 border-2 disabled:cursor-not-allowed transition-colors",
                st === "done"
                  ? "bg-emerald-50 border-emerald-500 text-emerald-800"
                  : st === "running"
                  ? "bg-blue-50 border-blue-500 text-blue-800 animate-pulse-soft"
                  : `bg-gray-800 border-gray-900 text-white hover:bg-gray-900 ${rankMeta.ring}`,
              ].join(" ")}
            >
              <div className="flex items-center gap-1.5">
                <Icon size={14} />
                <span className="text-[13px]">{meta.ko}</span>
                {st === "done" && <CheckCircle2 size={14} className="text-emerald-700" />}
                {st === "running" && (
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                )}
              </div>
              <span className="text-[10px] opacity-90 font-mono">{statusLabel}</span>
            </button>
          );
        })}
      </div>

      {/* 한 번에 모두 승인 */}
      {!allDone && allIdle && (
        <button
          onClick={handleApproveAll}
          className={`w-full text-white text-[13px] font-bold py-2 flex items-center justify-center gap-2 border-2 ${rankMeta.ring} bg-gray-800 hover:bg-gray-900`}
        >
          <CheckCircle2 size={14} />
          전체 승인 ({recs.map((r) => MODALITY_META[r.modality].ko).join(" + ")})
        </button>
      )}

      {/* 의사 승인 안내 */}
      {!allDone && (
        <p className="text-[11px] text-gray-500 flex items-center gap-1 px-1">
          <span className="text-[12px]">ⓘ</span>
          {allIdle
            ? "전체 승인 또는 개별 모달 클릭 시 AI 분석"
            : "남은 모달도 승인하여 분석 진행"}
        </p>
      )}
    </div>
  );
}

// ── KTAS 시간 추적 — 한국 KTAS 매뉴얼 기준 목표 처치 시간 vs 경과 ──
function KTASTimeTrackerPanel({ patient }: { patient: QueuePatient }) {
  const ktas = KTAS_META[patient.ktas as KTAS];
  const targetMin = KTAS_TARGET_MIN[patient.ktas as KTAS];
  const elapsed = minutesSinceArrival(patient);

  // 진행률 (0~100%) — 초과 시 100% 클램프
  const ratio = targetMin === 0 ? 1 : Math.min(elapsed / targetMin, 1);
  const isOverdue = elapsed > targetMin && targetMin > 0;
  const remaining = Math.max(targetMin - elapsed, 0);

  const barColor = isOverdue
    ? "bg-red-600"
    : ratio > 0.7
    ? "bg-amber-500"
    : "bg-emerald-500";

  return (
    <Panel
      title="KTAS 시간 추적"
      headerRight={
        <span className={`px-1.5 py-0 text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
          KTAS {patient.ktas} · {ktas.label}
        </span>
      }
    >
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-[12px]">
          <span className="text-gray-700">{ktas.desc}</span>
          <span className="font-mono text-gray-900">
            목표 <span className="font-bold">{targetMin === 0 ? "즉시" : `${targetMin}분`}</span>
          </span>
        </div>

        {/* 진행 바 */}
        <div className="w-full bg-gray-200 border border-gray-400 h-3 relative overflow-hidden">
          <div className={`h-full ${barColor} transition-all`} style={{ width: `${ratio * 100}%` }} />
          {/* 목표 지점 마커 (이미 100% 도달했을 때 보이지 않으니 항상 우측 끝) */}
          <div className="absolute top-0 right-0 h-full w-px bg-gray-600" />
        </div>

        {/* 결과 라벨 */}
        <div className="flex items-center justify-between text-[12px]">
          <span className="font-mono text-gray-700">
            경과 <span className="font-bold text-gray-900">{elapsed}분</span>
          </span>
          {isOverdue ? (
            <span className="flex items-center gap-1 text-red-700 font-bold">
              <AlertTriangle size={12} />
              {elapsed - targetMin}분 초과
            </span>
          ) : targetMin === 0 ? (
            <span className="text-blue-700 font-bold">소생 — 즉시 처치</span>
          ) : (
            <span className="text-emerald-700 font-bold">잔여 {remaining}분</span>
          )}
        </div>
      </div>
    </Panel>
  );
}

// ── 응급실 미니 보드 (EMResource 스타일) ────────────────────
function ERStatusBoardPanel() {
  // ALL_PATIENTS에서 실시간 통계 산출
  const inED = ALL_PATIENTS.filter((p) => p.status !== "discharged");
  const ktasDist: Record<KTAS, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  inED.forEach((p) => (ktasDist[p.ktas as KTAS] = (ktasDist[p.ktas as KTAS] || 0) + 1));

  const over6h = inED.filter(
    (p) => Math.floor((Date.now() - new Date(p.arrived_at).getTime()) / 60000) > 360
  ).length;

  const totalBeds = 30;
  const occupied = inED.length;

  return (
    <Panel
      title="응급실 현황"
      headerRight={
        <span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">
          실시간
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-2 mb-2">
        <BoardStat
          icon={BedDouble}
          label="병상"
          value={`${occupied}/${totalBeds}`}
          highlight={occupied / totalBeds > 0.8 ? "amber" : "default"}
        />
        <BoardStat icon={Activity} label="입실" value={`${inED.length}명`} />
        <BoardStat
          icon={AlertTriangle}
          label="6h↑"
          value={`${over6h}명`}
          highlight={over6h > 0 ? "red" : "default"}
        />
      </div>

      {/* KTAS 분포 미니 막대 */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-gray-600 font-bold mb-1">
          KTAS 분포
        </p>
        <div className="space-y-1">
          {([1, 2, 3, 4, 5] as KTAS[]).map((k) => {
            const count = ktasDist[k];
            const meta = KTAS_META[k];
            const max = Math.max(...Object.values(ktasDist), 1);
            const pct = (count / max) * 100;
            return (
              <div key={k} className="flex items-center gap-1.5 text-[11px]">
                <span className={`w-5 h-4 flex items-center justify-center text-[10px] font-bold ${meta.bg} ${meta.text}`}>
                  {k}
                </span>
                <span className="w-10 text-gray-700">{meta.label}</span>
                <div className="flex-1 bg-gray-100 border border-gray-300 h-3 relative">
                  <div
                    className={`h-full ${meta.bg}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <span className="font-mono text-gray-900 w-6 text-right font-bold">{count}</span>
              </div>
            );
          })}
        </div>
      </div>
    </Panel>
  );
}

function BoardStat({
  icon: Icon,
  label,
  value,
  highlight = "default",
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  highlight?: "default" | "red" | "amber";
}) {
  const cls =
    highlight === "red"
      ? "bg-red-50 border-red-400 text-red-700"
      : highlight === "amber"
      ? "bg-amber-50 border-amber-400 text-amber-700"
      : "bg-white border-gray-300 text-gray-800";
  return (
    <div className={`border ${cls} px-2 py-1.5`}>
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-gray-600">
        <Icon size={11} />
        {label}
      </div>
      <p className={`font-mono font-bold text-[14px] mt-0.5`}>{value}</p>
    </div>
  );
}

// ── Bahmni Resource Timeline — 유형별 아이콘 + 작성자 ───────
type ResourceEventType = "arrival" | "triage" | "order" | "medication" | "imaging" | "ai" | "diagnosis";

const RESOURCE_META: Record<ResourceEventType, { icon: LucideIcon; color: string; ko: string }> = {
  arrival:    { icon: UserPlus,     color: "text-gray-700",     ko: "도착" },
  triage:     { icon: Stethoscope,  color: "text-blue-700",     ko: "트리아지" },
  order:      { icon: FileText,     color: "text-orange-700",   ko: "오더" },
  medication: { icon: Pill,         color: "text-emerald-700",  ko: "처방" },
  imaging:    { icon: ImageIcon,    color: "text-cyan-700",     ko: "영상" },
  ai:         { icon: Sparkles,     color: "text-purple-700",   ko: "AI" },
  diagnosis:  { icon: CheckCircle2, color: "text-red-700",      ko: "진단" },
};

// 백엔드 modal_events 의 event_type → UI 표시 메타
const TIMELINE_EVENT_MAP: Record<string, { type: ResourceEventType; verb: string }> = {
  encounter_created:   { type: "arrival",    verb: "응급실 도착 / 트리아지 등록" },
  initial_proposal:    { type: "ai",         verb: "AI 1차 권고" },
  next_proposal:       { type: "ai",         verb: "AI 후속 권고" },
  order_placed:        { type: "order",      verb: "오더 발행" },
  modal_started:       { type: "imaging",    verb: "모달 분석 시작" },
  modal_completed:     { type: "diagnosis",  verb: "모달 분석 완료" },
  modal_failed:        { type: "diagnosis",  verb: "모달 분석 실패" },
  ready_for_report:    { type: "ai",         verb: "종합 판단 준비 완료" },
  report_generated:    { type: "diagnosis",  verb: "통합 소견서 생성" },
  report_signed:       { type: "diagnosis",  verb: "의사 서명 / EMR 전송" },
};

interface TimelineEvent {
  time: string;
  type: ResourceEventType;
  text: string;
  author: string;
}

function BahmniTimelinePanel({
  encounterId,
}: {
  encounterId: string | null;
}) {
  const [events, setEvents] = useState<TimelineEvent[]>([]);

  // 백엔드 modal_events 폴링 (2초)
  useEffect(() => {
    if (!encounterId) {
      setEvents([]);
      return;
    }
    let stopped = false;
    const poll = async () => {
      if (stopped) return;
      try {
        const res = await fetch(`/encounters/${encounterId}/timeline`);
        if (res.ok) {
          const data = await res.json();
          const raw = (data.events || []) as Array<{
            event_type: string;
            payload: Record<string, unknown>;
            created_at: string;
          }>;
          // 시간 오름차순 → 최신이 위에 오도록 reverse
          const mapped: TimelineEvent[] = raw
            .map((e) => mapTimelineEvent(e))
            .filter((e): e is TimelineEvent => e !== null);
          mapped.reverse();
          setEvents(mapped);
        }
      } catch (e) {
        console.warn("[timeline] poll fail", e);
      }
      if (!stopped) setTimeout(poll, 2000);
    };
    poll();
    return () => {
      stopped = true;
    };
  }, [encounterId]);

  // 빈 timeline 일 때 mock fallback (encounter_id 없을 때만)
  const fallback: TimelineEvent[] = !encounterId
    ? [
        { time: "—", type: "arrival", text: "트리아지 진입 전", author: "—" },
      ]
    : [];

  const display = events.length > 0 ? events : fallback;

  return (
    <Panel
      title="진료 이력"
      headerRight={
        <span className="flex items-center gap-1.5 text-[10px] text-gray-700">
          <Clock size={12} />
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="font-mono">실시간</span>
        </span>
      }
    >
      <ol className="space-y-1.5 max-h-[260px] overflow-y-auto -m-1 p-1">
        {display.length === 0 && (
          <li className="text-[11px] text-gray-500 italic px-2 py-1">이벤트 대기 중…</li>
        )}
        {display.map((e, i) => {
          const meta = RESOURCE_META[e.type];
          const Icon = meta.icon;
          const isLast = i === display.length - 1;

          return (
            <li key={i} className="flex gap-2 relative">
              {!isLast && (
                <span className="absolute left-[8px] top-5 w-px h-[calc(100%+0.25rem)] bg-gray-200" />
              )}
              <span
                className={`shrink-0 w-[18px] h-[18px] flex items-center justify-center bg-white border border-gray-400 z-10 ${meta.color}`}
              >
                <Icon size={11} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-[11px] text-gray-500 shrink-0">{e.time}</span>
                  <span className={`text-[10px] font-bold uppercase tracking-wider ${meta.color}`}>
                    {meta.ko}
                  </span>
                  <span className="text-[10px] text-gray-500 ml-auto truncate">{e.author}</span>
                </div>
                <p className="text-[12px] text-gray-800 leading-tight">{e.text}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

// 백엔드 modal_events 한 건 → UI 이벤트 매핑
function mapTimelineEvent(ev: {
  event_type: string;
  payload: Record<string, unknown>;
  created_at: string;
}): TimelineEvent | null {
  const meta = TIMELINE_EVENT_MAP[ev.event_type];
  if (!meta) return null;

  const t = new Date(ev.created_at);
  const time = isNaN(t.getTime())
    ? ""
    : t.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false });

  const modality = (ev.payload?.modality as string) || "";
  const reason = (ev.payload?.reason as string) || (ev.payload?.rationale as string) || "";
  const patientName = (ev.payload?.patient_name as string) || "";
  const cc = (ev.payload?.chief_complaint as string) || "";

  let text = meta.verb;
  if (modality) text += ` — ${modality}`;
  if (ev.event_type === "encounter_created" && (patientName || cc)) {
    text = `응급실 도착 등록${patientName ? ` (${patientName})` : ""}${cc ? ` · 주호소: ${cc}` : ""}`;
  } else if (ev.event_type === "initial_proposal" || ev.event_type === "next_proposal") {
    if (modality) text = `${meta.verb} — ${modality}${reason ? ` · ${reason.slice(0, 60)}…` : ""}`;
  }

  // 작성자 추정
  let author = "system";
  if (["modal_started", "modal_completed", "modal_failed"].includes(ev.event_type)) {
    author = `${modality || "AI"} 모달`;
  } else if (["order_placed", "report_signed"].includes(ev.event_type)) {
    author = "Dr. 진료의";
  }

  return { time, type: meta.type, text, author };
}

// ════════════════════════════════════════════════════════════════════
// 우측 컬럼
// ════════════════════════════════════════════════════════════════════

function ModalityViewerPanel({
  activeTab,
  setActiveTab,
  patient,
  modalResults,
  modalLoading,
}: {
  activeTab: Modality;
  setActiveTab: (t: Modality) => void;
  patient: QueuePatient;
  modalResults: ModalResultsState;
  modalLoading: Record<Modality, boolean>;
}) {
  // 백엔드 결과가 있으면 그걸 사용, 없으면 mock fallback
  const realResult = modalResults[activeTab];
  const isLoading = modalLoading[activeTab] && !realResult;
  const report = realResult
    ? extractReportFromBackend(realResult, activeTab)
    : MOCK_REPORTS[activeTab];

  // 데모 케이스만 실제 MIMIC-CXR 이미지 사용 (백엔드 /assets/cxr/{subject_id})
  const demoSubjectId = isDemoCase(patient) ? patient.subject_id : null;
  // 캐시 버스팅 — study_id가 바뀌면 새 이미지 강제 재로드
  const cxrCacheKey = isDemoCase(patient) ? patient.cxr_study_id : "";

  // 풀스크린 확대 상태
  const [zoomed, setZoomed] = useState(false);

  // ESC 키로 확대 모달 닫기
  useEffect(() => {
    if (!zoomed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setZoomed(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [zoomed]);

  const TAB_META: Record<Modality, { ko: string; icon: LucideIcon }> = {
    CXR: { ko: "흉부X-ray", icon: ImageIcon },
    ECG: { ko: "심전도", icon: HeartPulse },
    LAB: { ko: "혈액검사", icon: FlaskConical },
  };

  return (
    <section className="bg-gray-50 border border-gray-400 flex flex-col overflow-hidden">
      {/* 헤더 (탭) */}
      <header className="bg-gray-200 border-b border-gray-400 flex items-center">
        {(["CXR", "ECG", "LAB"] as Modality[]).map((tab) => {
          const meta = TAB_META[tab];
          const Icon = meta.icon;
          const isActive = activeTab === tab;
          return (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={[
                "flex items-center gap-1.5 px-4 py-1.5 text-[13px] font-bold border-r border-gray-400 transition-colors",
                isActive
                  ? "bg-white text-blue-800 border-b-2 border-b-blue-700 -mb-px"
                  : "text-gray-600 hover:bg-gray-100",
              ].join(" ")}
            >
              <Icon size={14} />
              {tab} <span className="text-[11px] font-normal text-gray-500">· {meta.ko}</span>
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => setZoomed(true)}
          className="flex items-center gap-1 px-3 text-[11px] text-gray-600 hover:text-blue-700 h-full border-l border-gray-400"
        >
          <Maximize2 size={12} />
          확대
        </button>
      </header>

      {/* 영상 / 신호 영역 */}
      <div className="relative bg-black aspect-[4/3] w-full overflow-hidden border-b border-gray-400">
        {activeTab === "CXR" && (
          <CXRView
            subjectId={demoSubjectId}
            cacheKey={cxrCacheKey}
            cxrResult={modalResults.CXR}
            isLoading={modalLoading.CXR}
          />
        )}
        {activeTab === "ECG" && (
          <ECGView ecgResult={modalResults.ECG} isLoading={modalLoading.ECG} />
        )}
        {activeTab === "LAB" && (
          <LabView labResult={modalResults.LAB} isLoading={modalLoading.LAB} />
        )}

        {/* 분석 진행 중 오버레이 */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
            <div className="bg-gray-900 border border-gray-600 px-3 py-2 text-[12px] text-emerald-300 font-mono flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              {activeTab} 모달 분석 중...
            </div>
          </div>
        )}
      </div>

      {/* 검출 결과 요약 (Lunit 스타일) — 1줄 */}
      <div className="bg-white px-3 py-2 text-[11px] flex items-center gap-3 flex-wrap border-b border-gray-200">
        <span className="flex items-center gap-1 text-gray-600">
          <ListChecks size={12} />
          AI 검출
        </span>
        {report.aiTags && report.aiTags.length > 0 ? (
          report.aiTags.map((t, i) => (
            <span
              key={i}
              className={[
                "px-1.5 py-0.5 text-[11px] font-bold border",
                t.severity === "critical"
                  ? "bg-red-50 text-red-700 border-red-400"
                  : t.severity === "warn"
                  ? "bg-amber-50 text-amber-700 border-amber-400"
                  : "bg-emerald-50 text-emerald-700 border-emerald-400",
              ].join(" ")}
            >
              {t.label}
            </span>
          ))
        ) : realResult ? (
          <span className="text-gray-500">검출된 이상 없음</span>
        ) : (
          <span className="text-gray-400 italic">대기 중</span>
        )}
        <div className="flex-1" />
        <span className="font-mono text-gray-500">{report.findings.length}건 소견</span>
      </div>

      {/* 영상 아래 FINDINGS — IMPRESSION은 통합 소견서에 있어서 여기선 생략 */}
      <div className="bg-white p-3">
        <p className="text-[10px] uppercase tracking-widest text-gray-600 mb-1 font-bold">
          검사소견 (FINDINGS)
        </p>
        <div className="bg-gray-50 border border-gray-300 px-2 py-1.5 text-[12px] text-gray-900 leading-relaxed min-h-[5rem]">
          {realResult ? (
            report.findings.map((l, i) => (
              <p key={i}>・{l}</p>
            ))
          ) : (
            <p className="text-gray-400 italic">의사 승인 후 분석 결과가 표시됩니다</p>
          )}
        </div>
      </div>

      {/* 풀스크린 확대 모달 */}
      {zoomed && (
        <ZoomedViewerModal
          activeTab={activeTab}
          patient={patient}
          modalResults={modalResults}
          modalLoading={modalLoading}
          report={report}
          onClose={() => setZoomed(false)}
        />
      )}
    </section>
  );
}

// 풀스크린 확대 모달 — 같은 CXRView/ECG/LAB 컨텐츠를 큰 화면으로
function ZoomedViewerModal({
  activeTab,
  patient,
  modalResults,
  modalLoading,
  report,
  onClose,
}: {
  activeTab: Modality;
  patient: QueuePatient;
  modalResults: ModalResultsState;
  modalLoading: Record<Modality, boolean>;
  report: ModalReport;
  onClose: () => void;
}) {
  const demoSubjectId = isDemoCase(patient) ? patient.subject_id : null;
  const cxrCacheKey = isDemoCase(patient) ? patient.cxr_study_id : "";

  const TAB_KO = activeTab === "CXR" ? "흉부X-ray" : activeTab === "ECG" ? "심전도" : "혈액검사";

  return (
    <div className="fixed inset-0 z-50 bg-black/95 flex flex-col">
      {/* 상단 툴바 */}
      <div className="bg-gray-900 border-b border-gray-700 px-4 h-12 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <span className="text-[14px] font-bold">{TAB_KO} ({activeTab})</span>
          <span className="text-[12px] text-gray-400 font-mono">
            {patient.name} · {patient.mrn}
            {demoSubjectId ? ` · subject_id=${demoSubjectId}` : ""}
          </span>
        </div>
        <button
          onClick={onClose}
          className="px-3 py-1 text-[12px] bg-gray-800 hover:bg-gray-700 border border-gray-600 flex items-center gap-2"
        >
          <span>닫기</span>
          <span className="text-[10px] font-mono opacity-70">[ESC]</span>
        </button>
      </div>

      {/* 영상 영역 — 화면 가득 */}
      <div className="flex-1 relative overflow-hidden">
        {activeTab === "CXR" && (
          <CXRView
            subjectId={demoSubjectId}
            cacheKey={cxrCacheKey}
            cxrResult={modalResults.CXR}
            isLoading={modalLoading.CXR}
          />
        )}
        {activeTab === "ECG" && (
          <ECGView ecgResult={modalResults.ECG} isLoading={modalLoading.ECG} />
        )}
        {activeTab === "LAB" && (
          <LabView labResult={modalResults.LAB} isLoading={modalLoading.LAB} />
        )}
      </div>

      {/* 하단 검출 요약 */}
      <div className="bg-gray-900 border-t border-gray-700 px-4 py-2 flex items-center gap-3 text-[12px] text-gray-200">
        <span className="flex items-center gap-1.5">
          <ListChecks size={13} />
          AI 검출
        </span>
        {report.bboxes && report.bboxes.length > 0 ? (
          report.bboxes.map((b) => (
            <span
              key={b.label}
              className={[
                "px-2 py-0.5 text-[12px] font-bold border",
                b.severity === "critical"
                  ? "bg-red-950 text-red-300 border-red-700"
                  : "bg-emerald-950 text-emerald-300 border-emerald-700",
              ].join(" ")}
            >
              {b.label}
            </span>
          ))
        ) : (
          <span className="text-gray-500">검출된 이상 없음</span>
        )}
        <div className="flex-1" />
        <span className="font-mono text-gray-400">{report.findings.length}건 소견</span>
      </div>
    </div>
  );
}

// chest-svc-pre PredictResponse 그대로 받아서 SVG 어노테이션 오버레이를 그리는 뷰.
// 좌표는 모두 metadata.image_size 픽셀 기준 → SVG viewBox로 정합.

// ════════════════════════════════════════════════════════════════════
// 통합 의료 소견서 — 풀스크린 다이얼로그 (PDF 톤, 의사 서명, 인쇄 가능)
// ════════════════════════════════════════════════════════════════════

function IntegratedReportDialog({
  patient,
  modalResults,
  encounterId,
  onClose,
  onTransmit,
}: {
  patient: QueuePatient;
  modalResults: ModalResultsState;
  encounterId: string | null;
  onClose: () => void;
  onTransmit: () => void;
}) {
  const ccLabel = patient.chief_complaint
    ? CHIEF_COMPLAINT_LABELS[patient.chief_complaint]?.ko
    : "—";

  // 자동 초안 생성 — modalResults + patient 기반 (로컬 fallback)
  const draft = useMemo(
    () => buildReportDraft(patient, modalResults, ccLabel),
    [patient, modalResults, ccLabel]
  );

  // ── AI 종합 narrative (RAG + Claude CoT 4단계) ────────────────
  const [aiNarrative, setAiNarrative] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiModel, setAiModel] = useState<string>("");
  const [aiError, setAiError] = useState<string | null>(null);
  const [aiSimilarCases, setAiSimilarCases] = useState<
    Array<{ chunk_type?: string; hadm_id?: string; similarity?: number; snippet?: string }>
  >([]);

  // 다이얼로그 열릴 때 백엔드 /reports/{eid}/generate 호출 → narrative 받음
  useEffect(() => {
    if (!encounterId) return;
    let cancelled = false;
    (async () => {
      setAiLoading(true);
      setAiError(null);
      try {
        const res = await fetch(`/reports/${encounterId}/generate`, { method: "POST" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const narrative = (data.narrative as string) || "";
        setAiNarrative(narrative);
        setAiModel((data.model_used as string) || "");
        setAiSimilarCases((data.similar_cases as typeof aiSimilarCases) || []);
        // narrative에서 5번 권고 사항만 따로 떼어서 권고 textarea에 채워줌
        const recMatch = narrative.match(/5\.\s*권고[^]*/);
        if (recMatch) {
          setRecommendations(recMatch[0].replace(/^5\.\s*권고\s*사항?\s*[—\-·]?\s*/, "").trim());
        }
        // 진단 요약은 narrative 1~4번을 합침
        const summaryMatch = narrative.match(/^[^]*?(?=\n\s*5\.\s*권고)/);
        if (summaryMatch) {
          setDiagnosisSummary(summaryMatch[0].trim());
        } else {
          setDiagnosisSummary(narrative);
        }
      } catch (e) {
        if (!cancelled) setAiError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [encounterId]);

  // ── 의사 수정 가능한 필드 (모두 useState) ────────────────────
  const [chartNo, setChartNo] = useState(patient.mrn);
  const [serialNo, setSerialNo] = useState(`00001${String(Math.floor(Math.random() * 999) + 100).slice(-3)}`);
  // 주민등록번호 — 의료법·개인정보보호법 기준 뒷자리 6자리 마스킹 (예: 911215-1******)
  const [rrn, setRrn] = useState(draft.rrn);
  const [address, setAddress] = useState("서울특별시 ○○구 ○○로 ○○ (○○동) ○○동 ○○호");
  // 전화번호 — 가운데 4자리 마스킹 (개인정보보호위원회 가이드라인)
  const [phone, setPhone] = useState("010-****-1234");
  // 성별 — 의사가 변경 가능 (라디오)
  const [sexInDoc, setSexInDoc] = useState<"M" | "F">(patient.sex as "M" | "F");
  const [diseaseName, setDiseaseName] = useState(draft.diseaseName);
  const [clinicalSuspicion, setClinicalSuspicion] = useState(draft.clinicalSuspicion);
  const [finalDiagnosis, setFinalDiagnosis] = useState(draft.finalDiagnosis);
  const [icdCode, setIcdCode] = useState(draft.icdCode);
  const [onsetDate, setOnsetDate] = useState(draft.onsetDate);
  const [visitDate, setVisitDate] = useState(draft.visitDate);
  const [diagnosisSummary, setDiagnosisSummary] = useState(draft.diagnosisSummary);
  const [recommendations, setRecommendations] = useState(draft.recommendations);
  const [remarks, setRemarks] = useState(draft.remarks);
  const [purpose, setPurpose] = useState("진료 참고용 (응급실 초기 평가)");
  const [hospitalName, setHospitalName] = useState("한국대학교병원 응급의학과");
  const [hospitalAddress, setHospitalAddress] = useState("서울특별시 ○○구 ○○로 ○○ 한국대학교병원 응급센터 1층");
  const [hospitalPhone, setHospitalPhone] = useState("02-XXX-XXXX");
  const [licenseNo, setLicenseNo] = useState("제 XXXXX 호");
  const [doctorName, setDoctorName] = useState("");
  const [issueDate, setIssueDate] = useState(
    new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "2-digit", day: "2-digit" })
  );
  const [signedAt, setSignedAt] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(true);

  function handleSign() {
    if (!doctorName.trim()) {
      alert("의사 성명을 입력해주세요.");
      return;
    }
    setSignedAt(new Date().toLocaleString("ko-KR"));
    setEditMode(false);
  }

  function handlePrint() {
    window.print();
  }

  // 수정 가능 vs 잠금 상태에 따른 클래스
  const inputCls = editMode
    ? "bg-yellow-50/40 border-b border-dashed border-gray-400 focus:bg-white focus:border-blue-600 outline-none px-1"
    : "bg-transparent border-none px-1";
  const taCls = editMode
    ? "w-full bg-yellow-50/40 border border-dashed border-gray-400 focus:bg-white focus:border-blue-600 outline-none p-2 resize-y"
    : "w-full bg-transparent border-none p-2 resize-none";

  const [showAiRaw, setShowAiRaw] = useState(false);

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:p-0 print:bg-white">
      <div className="bg-white max-w-[860px] w-full max-h-[95vh] overflow-y-auto shadow-2xl print:shadow-none print:max-h-none">
        {/* 다이얼로그 액션 바 (인쇄 시 숨김) */}
        <div className="bg-gray-100 border-b border-gray-400 px-4 py-2 flex items-center justify-between print:hidden sticky top-0 z-10">
          <h2 className="text-sm font-bold text-gray-900 flex items-center gap-2">
            <FileText size={14} className="text-blue-700" />
            소견서 — 의사 작성·수정·서명
            {/* AI 상태 인디케이터 */}
            {aiLoading && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-blue-700 font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse" />
                AI 분석 중 (RAG + Claude CoT)
              </span>
            )}
            {!aiLoading && aiModel && !aiError && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-700 font-mono px-1.5 py-0.5 bg-emerald-50 border border-emerald-300">
                <Sparkles size={10} />
                {aiModel} · RAG {aiSimilarCases.length}건
              </span>
            )}
            {aiError && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-amber-700 font-mono">
                ⚠ AI 분석 실패 — 로컬 초안 사용
              </span>
            )}
          </h2>
          <div className="flex items-center gap-2">
            {aiNarrative && (
              <button
                onClick={() => setShowAiRaw((v) => !v)}
                className="px-3 py-1 text-[12px] bg-white border border-gray-400 text-gray-800 hover:bg-gray-50"
              >
                {showAiRaw ? "AI 원본 닫기" : "AI 원본 보기"}
              </button>
            )}
            <button
              onClick={() => setEditMode((v) => !v)}
              disabled={!!signedAt}
              className={`px-3 py-1 text-[12px] border flex items-center gap-1 ${
                signedAt
                  ? "bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed"
                  : editMode
                  ? "bg-blue-600 text-white border-blue-800 hover:bg-blue-700"
                  : "bg-white border-gray-400 text-gray-800 hover:bg-gray-50"
              }`}
            >
              {editMode ? "✎ 수정 중" : "✎ 수정"}
            </button>
            <button
              onClick={handlePrint}
              className="px-3 py-1 text-[12px] bg-white border border-gray-400 text-gray-800 hover:bg-gray-50 flex items-center gap-1"
            >
              <FileText size={12} />
              PDF / 인쇄
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 text-[12px] bg-white border border-gray-400 text-gray-800 hover:bg-gray-50"
            >
              닫기
            </button>
          </div>
        </div>

        {/* AI 원본 narrative + RAG 사례 — 토글 패널 (인쇄 시 숨김) */}
        {showAiRaw && aiNarrative && (
          <div className="bg-blue-50 border-b border-blue-200 px-6 py-3 print:hidden">
            <div className="flex items-center gap-2 mb-2">
              <Sparkles size={12} className="text-blue-700" />
              <p className="text-[11px] font-bold text-blue-900">
                AI 종합 분석 원본 — Claude {aiModel} (RAG 사례 {aiSimilarCases.length}건 참조)
              </p>
            </div>
            <pre className="text-[11.5px] text-gray-800 whitespace-pre-wrap leading-relaxed bg-white border border-blue-200 px-3 py-2 max-h-[320px] overflow-y-auto">
              {aiNarrative}
            </pre>
            {aiSimilarCases.length > 0 && (
              <div className="mt-2 space-y-1">
                <p className="text-[10px] font-bold text-blue-800 uppercase tracking-widest">유사 사례 (MIMIC RAG)</p>
                {aiSimilarCases.map((c, i) => (
                  <div key={i} className="text-[10.5px] text-gray-700 font-mono">
                    [{i + 1}] {c.chunk_type ?? "?"} · hadm={c.hadm_id ?? "?"} · sim=
                    {typeof c.similarity === "number" ? c.similarity.toFixed(3) : "?"}
                    <span className="text-gray-500"> · {(c.snippet ?? "").slice(0, 120)}…</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* PDF 영역 — A4 톤, 한국 표준 소견서 양식 */}
        <article
          className="px-12 py-10 print:px-16 print:py-12 text-gray-900 text-[12.5px] leading-relaxed"
          style={{ fontFamily: '"Dotum", "돋움", "Malgun Gothic", sans-serif' }}
        >
          {/* 1) 타이틀 — "소 견 서" 중앙, [원본대조필인] 우측 */}
          <div className="relative mb-6">
            <h1
              className="text-center text-[28px] font-bold"
              style={{ letterSpacing: "0.6em", paddingLeft: "0.6em" }}
            >
              소 견 서
            </h1>
            <p className="absolute right-0 top-2 text-[10.5px] text-red-700 font-bold">
              [ 원본대조필인 (印) ]
            </p>
          </div>

          {/* 2) 환자 인적사항 표 */}
          <table className="w-full border-collapse mb-0 text-[12px]">
            <tbody>
              <tr>
                <th className={thLabel}>차트번호</th>
                <td className={tdData}>
                  <input value={chartNo} onChange={(e) => setChartNo(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-full`} />
                </td>
                <th className={thLabel}>연번호</th>
                <td className={tdData}>
                  <input value={serialNo} onChange={(e) => setSerialNo(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-full`} />
                </td>
                <th className={thLabel}>주민등록번호</th>
                <td className={tdData}>
                  <input value={rrn} onChange={(e) => setRrn(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-full`} />
                </td>
              </tr>
              <tr>
                <th className={thLabel}>환자의 성명</th>
                <td className={tdData}>
                  <span className="font-bold">{patient.name}</span>
                </td>
                <th className={thLabel}>성별</th>
                <td className={tdData}>
                  <label className="inline-flex items-center gap-1 cursor-pointer mr-3">
                    <input
                      type="radio"
                      name="sexInDoc"
                      checked={sexInDoc === "M"}
                      onChange={() => setSexInDoc("M")}
                      disabled={!editMode}
                      className="accent-gray-800"
                    />
                    <span>남</span>
                  </label>
                  <label className="inline-flex items-center gap-1 cursor-pointer">
                    <input
                      type="radio"
                      name="sexInDoc"
                      checked={sexInDoc === "F"}
                      onChange={() => setSexInDoc("F")}
                      disabled={!editMode}
                      className="accent-gray-800"
                    />
                    <span>여</span>
                  </label>
                </td>
                <th className={thLabel}>생년월일 / 연령</th>
                <td className={tdData}>
                  <span className="font-mono">{draft.dob}</span> · 만 {patient.age}세
                </td>
              </tr>
              <tr>
                <th className={thLabel}>주 소</th>
                <td className={tdData} colSpan={5}>
                  <input value={address} onChange={(e) => setAddress(e.target.value)} disabled={!editMode} className={`${inputCls} w-2/3`} />
                  <span className="ml-2">(전화)</span>
                  <input value={phone} onChange={(e) => setPhone(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-32 ml-1`} />
                </td>
              </tr>

              {/* 3) 병명 박스 (한국질병분류기호 우측) */}
              <tr>
                <th className={thLabelTall} rowSpan={3}>병 명</th>
                <td className="border border-gray-700 px-3 py-2" colSpan={4}>
                  <textarea
                    value={diseaseName}
                    onChange={(e) => setDiseaseName(e.target.value)}
                    disabled={!editMode}
                    rows={1}
                    className={`${taCls} font-bold`}
                  />
                </td>
                <th
                  className="text-center bg-gray-50 border border-gray-700 px-2 py-1.5 font-bold text-[11.5px] whitespace-nowrap"
                  style={{ width: "130px" }}
                >
                  한국질병분류기호
                </th>
              </tr>
              <tr>
                <td className="border border-gray-700 px-3 py-1.5" colSpan={4}>
                  <span className="text-[11.5px] mr-1">○ 임상적추정 :</span>
                  <input value={clinicalSuspicion} onChange={(e) => setClinicalSuspicion(e.target.value)} disabled={!editMode} className={`${inputCls} w-3/4`} />
                </td>
                <td
                  className="border border-gray-700 px-2 py-1 text-[12px] font-mono text-center align-middle"
                  rowSpan={2}
                  style={{ width: "130px" }}
                >
                  <input value={icdCode} onChange={(e) => setIcdCode(e.target.value)} disabled={!editMode} className={`${inputCls} text-center font-mono w-full whitespace-nowrap`} />
                </td>
              </tr>
              <tr>
                <td className="border border-gray-700 px-3 py-1.5" colSpan={4}>
                  <span className="text-[11.5px] mr-1">● 최종 판단 :</span>
                  <input value={finalDiagnosis} onChange={(e) => setFinalDiagnosis(e.target.value)} disabled={!editMode} className={`${inputCls} w-3/4 font-bold`} />
                </td>
              </tr>

              {/* 4) 발병일 / 초진일 */}
              <tr>
                <th className={thLabel}>발병일</th>
                <td className={tdData} colSpan={2}>
                  <input value={onsetDate} onChange={(e) => setOnsetDate(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono`} />
                </td>
                <th className={thLabel}>초진일</th>
                <td className={tdData} colSpan={2}>
                  <input value={visitDate} onChange={(e) => setVisitDate(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono`} />
                </td>
              </tr>

              {/* 5) 향후 치료 의견 */}
              <tr>
                <th className={thLabelTall} style={{ writingMode: "horizontal-tb" }}>
                  <div className="flex flex-col gap-2 items-center justify-center text-center">
                    <span>향 후</span>
                    <span>치 료</span>
                    <span>의 견</span>
                  </div>
                </th>
                <td className="border border-gray-700 px-4 py-3 align-top" colSpan={5}>
                  <p className="mb-2 text-[12.5px]">
                    상기 인은 <span className="font-bold">{visitDate}</span> 일 본원 응급실에 내원하여
                    시행한 검사 및 진찰 결과 다음과 같이 소견드립니다.
                  </p>

                  <p className="font-bold text-[12.5px] mt-3 mb-1">[ 진단 요약 ]</p>
                  <textarea
                    value={diagnosisSummary}
                    onChange={(e) => setDiagnosisSummary(e.target.value)}
                    disabled={!editMode}
                    rows={Math.max(4, Math.ceil(diagnosisSummary.length / 65))}
                    className={taCls}
                  />

                  <p className="font-bold text-[12.5px] mt-3 mb-1">[ 향후 치료 권고 ]</p>
                  <textarea
                    value={recommendations}
                    onChange={(e) => setRecommendations(e.target.value)}
                    disabled={!editMode}
                    rows={Math.max(6, recommendations.split("\n").length)}
                    className={taCls}
                  />

                  <p className="text-[10.5px] italic text-gray-700 mt-3 leading-relaxed">
                    ※ 본 소견서는 AI 보조 분석에 기반한 초안(preliminary)이며, 최종 진단 및 치료
                    결정은 담당 의사의 임상 판단에 따릅니다.
                  </p>
                </td>
              </tr>

              {/* 6) 비고 */}
              <tr>
                <th className={thLabel}>비 고</th>
                <td className={tdData} colSpan={5}>
                  <input value={remarks} onChange={(e) => setRemarks(e.target.value)} disabled={!editMode} className={`${inputCls} w-full`} />
                </td>
              </tr>

              {/* 7) 용도 */}
              <tr>
                <th className={thLabel}>용 도</th>
                <td className={tdData} colSpan={5}>
                  <input value={purpose} onChange={(e) => setPurpose(e.target.value)} disabled={!editMode} className={`${inputCls} w-full`} />
                </td>
              </tr>
            </tbody>
          </table>

          {/* 8) "위 와 같 이 소 견 함" */}
          <p
            className="text-center text-[16px] font-bold my-8"
            style={{ letterSpacing: "0.5em", paddingLeft: "0.5em" }}
          >
            위 와 같 이 소 견 함
          </p>

          {/* 9) 발행일 / 의사 서명 */}
          <div className="grid grid-cols-[110px_1fr_120px_220px] gap-y-2 gap-x-4 text-[12px] mb-3 items-center">
            <span className="font-bold">발 행 일</span>
            <span>
              <input value={issueDate} onChange={(e) => setIssueDate(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono`} />
            </span>
            <span className="font-bold">의사성명</span>
            <span className="flex items-center gap-2">
              {signedAt ? (
                <span className="font-bold text-[14px] border-b-2 border-gray-800 pb-0.5 px-2">
                  {doctorName}
                </span>
              ) : (
                <input
                  value={doctorName}
                  onChange={(e) => setDoctorName(e.target.value)}
                  placeholder="의사명 입력"
                  className={`${inputCls} text-[14px] font-bold`}
                />
              )}
              <span className="text-red-700 font-bold text-[14px]">(印)</span>
            </span>
          </div>

          {/* 10) 의료기관 정보 */}
          <div className="grid grid-cols-[110px_1fr] gap-y-1 gap-x-4 text-[12px] mb-2 items-start">
            <span className="font-bold">의 료 기 관</span>
            <input value={hospitalName} onChange={(e) => setHospitalName(e.target.value)} disabled={!editMode} className={`${inputCls} w-full`} />
            <span className="font-bold">주소및명칭</span>
            <input value={hospitalAddress} onChange={(e) => setHospitalAddress(e.target.value)} disabled={!editMode} className={`${inputCls} w-full`} />
            <span className="font-bold">전 화 번 호</span>
            <input value={hospitalPhone} onChange={(e) => setHospitalPhone(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-48`} />
            <span className="font-bold">면 허 번 호</span>
            <input value={licenseNo} onChange={(e) => setLicenseNo(e.target.value)} disabled={!editMode} className={`${inputCls} font-mono w-48`} />
          </div>

          {/* 11) 액션 버튼 (인쇄 시 숨김) */}
          {!signedAt ? (
            <div className="flex justify-end gap-2 mt-6 print:hidden">
              <button
                onClick={handleSign}
                className="px-4 py-2 text-[13px] bg-gray-800 text-white border border-gray-900 hover:bg-gray-900 flex items-center gap-2 font-bold"
              >
                <CheckCircle2 size={14} />
                의사 서명
              </button>
            </div>
          ) : (
            <div className="flex justify-end gap-2 mt-6 print:hidden">
              <span className="text-[11px] text-gray-600 self-center font-mono">서명 일시: {signedAt}</span>
              <button
                onClick={() => {
                  onTransmit();
                  alert("EMR 전송 완료. 진행 단계 바의 [전송]이 활성화됩니다.");
                  onClose();
                }}
                className="px-4 py-2 text-[13px] bg-emerald-700 text-white border border-emerald-900 hover:bg-emerald-800 flex items-center gap-2 font-bold"
              >
                <Send size={14} />
                EMR 전송 / 최종 확정
              </button>
            </div>
          )}
        </article>
      </div>
    </div>
  );
}

// 표 셀 클래스 (한국 소견서 양식 — 검정 굵은 테두리)
const thLabel =
  "text-center bg-gray-50 border border-gray-700 px-2 py-1.5 font-bold w-[90px] text-[11.5px]";
const thLabelTall =
  "text-center bg-gray-50 border border-gray-700 px-2 py-1.5 font-bold w-[90px] text-[11.5px] align-middle";
const tdData = "border border-gray-700 px-2 py-1 text-[12px]";

// 자동 초안 생성 — modalResults + patient 기반
function buildReportDraft(
  patient: QueuePatient,
  modalResults: ModalResultsState,
  ccLabel: string
): {
  rrn: string;
  dob: string;
  diseaseName: string;
  clinicalSuspicion: string;
  finalDiagnosis: string;
  icdCode: string;
  onsetDate: string;
  visitDate: string;
  diagnosisSummary: string;
  recommendations: string;
  remarks: string;
} {
  const today = new Date();
  const visitDate = today.toISOString().slice(0, 10);
  const yob = today.getFullYear() - patient.age;
  const dob = `${yob}-XX-XX`;
  // 주민등록번호 마스킹 — 의료법 시행규칙 / 개인정보보호위원회 표준
  // 형식: YYMMDD-G****** (앞 6자리 + 성별 1자리 노출, 뒤 6자리 별표)
  // 데모: 생년월일 부분도 부분 마스킹 (YY**XX)
  const rrnFront = `${String(yob).slice(2)}****`;
  const genderDigit = patient.sex === "M" ? "1" : "2"; // 2000년 이후 출생자는 3/4
  const rrnBack = `${genderDigit}******`;

  const past = patient.past_history?.join(", ") || "특이사항 없음";

  const completed = (["ECG", "CXR", "LAB"] as Modality[]).filter((m) => modalResults[m] != null);
  const highestRisk = completed
    .map((m) => modalResults[m]?.risk_level as string | undefined)
    .reduce<string>((acc, r) => {
      if (r === "critical") return "critical";
      if (r === "urgent" && acc !== "critical") return "urgent";
      return acc;
    }, "routine");

  // 핵심 소견 추출 — 진단 요약문 자동 생성
  const ecgFindings = modalResults.ECG ? extractReportFromBackend(modalResults.ECG, "ECG") : null;
  const cxrFindings = modalResults.CXR ? extractReportFromBackend(modalResults.CXR, "CXR") : null;
  const labFindings = modalResults.LAB ? extractReportFromBackend(modalResults.LAB, "LAB") : null;

  // 활력징후 텍스트
  const v = patient.vitals;
  const vitalsText = v
    ? `BP ${v.sbp}/${v.dbp}, HR ${v.hr}, RR ${v.rr}, SpO2 ${v.spo2}%, BT ${v.bt}°C`
    : "";

  // 진단 요약 (자동 초안)
  const summaryParts: string[] = [];
  summaryParts.push(
    `${patient.age}세 ${patient.sex === "M" ? "남성" : "여성"}으로 ${
      patient.complaint_detail || ccLabel
    }(을)를 주소로 내원함. 과거력: ${past}. 활력징후: ${vitalsText}.`
  );
  if (ecgFindings && ecgFindings.findings.length > 0) {
    summaryParts.push(`ECG 분석: ${ecgFindings.findings.slice(0, 2).join("; ")}.`);
  }
  if (cxrFindings && cxrFindings.findings.length > 0) {
    summaryParts.push(`흉부 X선: ${cxrFindings.findings.slice(0, 2).join("; ")}.`);
  }
  if (labFindings && labFindings.findings.length > 0) {
    summaryParts.push(`혈액검사: ${labFindings.findings.slice(0, 3).join("; ")}.`);
  }
  if (highestRisk === "critical") {
    summaryParts.push("종합 위험도 CRITICAL — 즉각적 응급 처치가 요구됨.");
  } else if (highestRisk === "urgent") {
    summaryParts.push("종합 위험도 URGENT — 신속한 평가 및 처치가 필요함.");
  }
  const diagnosisSummary = summaryParts.join(" ");

  // 향후 치료 권고 (자동 초안 — 번호 매김)
  const recList: string[] = [];
  if (ecgFindings) recList.push("12유도 심전도 즉시 시행 및 지속 모니터링");
  if (labFindings) recList.push("혈액검사 추가 시행 — 전해질·신장기능·심근표지자 재검");
  if (cxrFindings) recList.push("흉부 X선 시행 — 심비대·폐부종·폐렴 등 평가");
  if (highestRisk === "critical" || highestRisk === "urgent") {
    recList.push("산소 요법 및 활력징후 15분 간격 측정");
    recList.push("필요 시 응급 약물 투여 (담당 의사 판단)");
    recList.push("관련 진료과 즉시 협진 의뢰");
  }
  recList.push("입원 또는 추적 외래 follow-up 결정");
  const recommendations = recList.map((r, i) => `${i + 1}. ${r}`).join("\n");

  // 병명·진단 — 위험도 + 주호소 기반 초안
  let diseaseName = ccLabel;
  let clinicalSuspicion = "응급실 평가 중";
  let finalDiagnosis = "추가 평가 필요";
  let icdCode = "Z03.9";

  if (labFindings) {
    const f = labFindings.findings.join(" ");
    if (f.includes("칼륨") || f.includes("potassium")) {
      diseaseName = "중증 고칼륨혈증";
      clinicalSuspicion = "고칼륨혈증, 신부전 악화";
      finalDiagnosis = "중증 고칼륨혈증 + 만성 신부전 악화";
      icdCode = "E87.5 / N18.6";
    }
  }
  if (ecgFindings) {
    const f = ecgFindings.findings.join(" ");
    if (f.includes("심방세동") || f.includes("Atrial") || f.includes("afib")) {
      diseaseName = "신규 발현 심방세동 (Atrial Fibrillation, NEW)";
      clinicalSuspicion = "발작성 심방세동";
      finalDiagnosis = "신규 발현 심방세동";
      icdCode = "I48.91";
    }
  }

  const ragCount = completed.length;
  const remarks = `Risk: ${highestRisk.toUpperCase()} · AI 보조 분석 적용 · RAG 사례 ${ragCount}건 참조`;

  return {
    rrn: `${rrnFront}-${rrnBack}`,
    dob,
    diseaseName,
    clinicalSuspicion,
    finalDiagnosis,
    icdCode,
    onsetDate: visitDate,
    visitDate,
    diagnosisSummary,
    recommendations,
    remarks,
  };
}

// ════════════════════════════════════════════════════════════════════
// 유틸
// ════════════════════════════════════════════════════════════════════

function stageKo(status: EDStatus | undefined): string {
  switch (status) {
    case "arrived":         return "도착";
    case "triage":          return "트리아지";
    case "in_consult":      return "진료중";
    case "testing":         return "검사";
    case "results_pending": return "결과대기";
    case "admit_wait":      return "입원대기";
    case "discharged":      return "퇴실";
    default:                return "";
  }
}
