// 응급실 트리아지 페이지
// Dr.EMR 클래식 스타일 — 좌측 대기열 / 중앙 입력 / 우측 요약
//
// [참고]
//  - Dr.EMR (한국 EMR): 정보 밀도 높은 다중 패널 레이아웃
//  - Bahmni (오픈소스 EMR): 좌측 환자 큐 + 메인 입력 영역
//  - OpenEMR: 폼 필드 그리드 배치
//
// [키보드 단축키]
//  F1: 환자정보 / F2: 활력징후 / F3: 주증상 / F4: KTAS / F5: 과거력
//  Ctrl+Enter: AI 분석 시작
import { useState, useEffect, useMemo, useRef } from "react";
import { useNavigate } from "react-router-dom";

import TriageTopBar from "../components/triage/TriageTopBar";
import TriageTableForm from "../components/triage/TriageTableForm";
import TriageQueueSidebar from "../components/triage/TriageQueueSidebar";
import TriageActionFooter from "../components/triage/TriageActionFooter";

import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { DEMO_CASES_4, type DemoCasePatient } from "../data/triage_demo_cases_4";
import { fetchMimicConditions } from "../lib/mimic-api";
import {
  KTAS_META,
  CHIEF_COMPLAINT_LABELS,
  type QueuePatient,
  type TriageInput,
  type Vitals,
  type PastHistoryCode,
} from "../types/triage";

// 시연 4 케이스를 큐 최상단에 핀, 그 아래 가짜 50명 배치
const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

const EMPTY_VITALS: Vitals = { sbp: null, dbp: null, hr: null, rr: null, spo2: null, bt: null };

const EMPTY_FORM: Partial<TriageInput> & { mrn?: string } = {
  mrn: "",
  name: "",
  age: undefined,
  sex: undefined,
  arrived_at: new Date().toISOString().slice(0, 16),
  chief_complaint: undefined,
  complaint_detail: "",
  ktas: undefined,
  vitals: { ...EMPTY_VITALS },
  past_history: [],
  allergies: "",
  medications: "",
  notes: "",
};

export default function TriagePage() {
  const navigate = useNavigate();
  const [patients, setPatients] = useState<QueuePatient[]>(ALL_PATIENTS);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<typeof EMPTY_FORM>(EMPTY_FORM);
  const [mimicLoading, setMimicLoading] = useState(false);
  const mimicAbortRef = useRef<AbortController | null>(null);

  // 대기열에서 환자 선택 → 폼에 자동 채움
  // 시연 4 케이스(`is_demo + subject_id`) 선택 시 MIMIC diagnoses_icd 자동 조회
  function handleSelect(p: QueuePatient) {
    setSelectedId(p.id);
    setForm({
      mrn: p.mrn,
      name: p.name,
      age: p.age,
      sex: p.sex,
      arrived_at: p.arrived_at.slice(0, 16),
      chief_complaint: p.chief_complaint,
      complaint_detail: p.complaint_detail,
      ktas: p.ktas,
      vitals: { ...p.vitals },
      past_history: [...p.past_history],
      allergies: p.allergies,
      medications: p.medications,
      notes: p.notes,
    });

    // 시연 케이스면 MIMIC 진단 자동 조회 (S3 Select)
    const demo = p as QueuePatient & { is_demo?: boolean; subject_id?: string };
    if (demo.is_demo && demo.subject_id) {
      // 이전 요청 취소 (다른 환자 빠르게 클릭 시)
      mimicAbortRef.current?.abort();
      const ctrl = new AbortController();
      mimicAbortRef.current = ctrl;

      setMimicLoading(true);
      fetchMimicConditions(demo.subject_id, ctrl.signal)
        .then((res) => {
          // 기존 하드코딩 + MIMIC 결과 합집합 (과거력)
          const merged = Array.from(
            new Set([...p.past_history, ...res.history_codes])
          ) as PastHistoryCode[];

          setForm((prev) => ({
            ...prev,
            past_history: merged,
            // 알레르기: MIMIC에서 발견되면 자동 채움. 없으면 기존 값 유지.
            allergies:
              res.mimic_allergies.length > 0
                ? res.allergy_text
                : prev.allergies,
          }));
          console.log(
            `[MIMIC] subject=${demo.subject_id} 진단 ${res.total}건 조회`,
            `→ 과거력 ${res.history_codes.length}개`,
            `+ 알레르기 ${res.mimic_allergies.length}개`,
            { history: res.history_codes, allergies: res.mimic_allergies }
          );
        })
        .catch((e) => {
          if (e.name !== "AbortError") {
            console.warn(`[MIMIC] 조회 실패 (백엔드 미연결?): ${e.message}`);
          }
        })
        .finally(() => setMimicLoading(false));
    }
  }

  function handlePatientChange(patch: Partial<TriageInput> & { mrn?: string }) {
    setForm((prev) => ({ ...prev, ...patch }));
  }

  function handleVitalsChange(v: Vitals) {
    setForm((prev) => ({ ...prev, vitals: v }));
  }

  function handleHistoryToggle(code: PastHistoryCode) {
    setForm((prev) => {
      const cur = prev.past_history ?? [];
      return {
        ...prev,
        past_history: cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code],
      };
    });
  }

  function handleReset() {
    setForm(EMPTY_FORM);
    setSelectedId(null);
  }

  // 로컬 큐 상태만 갱신 (UI 즉시 반영)
  function applyLocalQueueUpdate() {
    if (!selectedId) return;
    setPatients((prev) =>
      prev.map((p) =>
        p.id === selectedId
          ? {
              ...p,
              ...form,
              vitals: form.vitals ?? p.vitals,
              past_history: form.past_history ?? p.past_history,
              status: "triage",
            }
          : p
      )
    );
  }

  // /triage/submit POST 페이로드 빌더
  function buildSubmissionPayload() {
    // 데모 케이스 선택 시 MIMIC 식별자(S3 경로) 포함 → 백엔드가 모달 호출 시 사용
    const selected = patients.find((p) => p.id === selectedId);
    const demo = (selected as DemoCasePatient | undefined)?.is_demo
      ? (selected as DemoCasePatient)
      : null;

    // FHIR R4는 gender가 male/female/other/unknown 소문자만 허용
    const fhirGender = form.sex === "M" ? "male" : form.sex === "F" ? "female" : "unknown";

    return {
      patient: {
        name: form.name ?? "",
        age: form.age ?? 0,
        gender: fhirGender,
      },
      vitals: {
        // 백엔드 VitalsForm 스키마: hr, sbp, dbp, spo2, rr, temp, gcs (모두 float, 필수)
        hr:   form.vitals?.hr   ?? 0,
        sbp:  form.vitals?.sbp  ?? 0,
        dbp:  form.vitals?.dbp  ?? 0,
        spo2: form.vitals?.spo2 ?? 0,
        rr:   form.vitals?.rr   ?? 0,
        temp: form.vitals?.bt   ?? 36.5,  // 프론트는 bt, 백엔드는 temp
        gcs: 15,                          // 폼에 GCS 입력 없음 — 기본 정상치
      },
      chief_complaint: {
        text: form.chief_complaint ?? "other",
        detail: form.complaint_detail ?? null,
        onset_minutes_ago: 0,
      },
      past_history: (form.past_history ?? []).map((code) => ({ text: code })),
      allergies: form.allergies || null,
      medications: form.medications || null,
      notes: form.notes || null,
      // 데모 케이스 → MIMIC 원본 식별자 (모달 호출 시 S3 경로로 사용됨)
      mimic: demo
        ? {
            subject_id: demo.subject_id,
            cxr_image_path: demo.cxr_s3_uri,
            ecg_record_path: demo.ecg_record_path ?? null,
          }
        : null,
    };
  }

  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit() {
    console.log("[triage] handleSubmit 시작 - selectedId:", selectedId);
    applyLocalQueueUpdate();

    if (!selectedId) {
      alert("환자를 먼저 선택해주세요.");
      return;
    }

    setSubmitting(true);
    const payload = buildSubmissionPayload();
    console.log("[triage] payload:", payload);

    try {
      const res = await fetch("/triage/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      console.log("[triage] /triage/submit 응답:", res.status);
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status} ${text.slice(0, 200)}`);
      }
      const data = await res.json();
      console.log("[triage] 응답 데이터:", data);

      const encounterId: string | undefined = data?.encounter_id;
      const patientId: string | undefined = data?.patient_id;
      const primaryModality: string | undefined = data?.primary_modality;
      const primarySrId: string | undefined = data?.service_request_id;

      // 중복 환자 가드 — backend가 기존 active encounter 반환한 경우
      if (data?.duplicate === true && encounterId) {
        alert("이미 진료 중인 환자입니다. 기존 진료 화면으로 이동합니다.");
        const params = new URLSearchParams();
        params.set("encounter_id", encounterId);
        if (patientId) params.set("patient_id", patientId);
        if (selectedId) params.set("patient", selectedId);
        navigate(`/dashboard?${params.toString()}`);
        return;
      }

      if (encounterId) {
        const params = new URLSearchParams();
        params.set("encounter_id", encounterId);
        if (patientId) params.set("patient_id", patientId);
        if (selectedId) params.set("patient", selectedId);
        if (primaryModality) params.set("primary_modality", primaryModality);
        if (primarySrId) params.set("primary_sr", primarySrId);
        console.log("[triage] 대시보드로 이동:", `/dashboard?${params.toString()}`);
        navigate(`/dashboard?${params.toString()}`);
      } else {
        navigate(`/dashboard?patient=${selectedId}`);
      }
    } catch (e: unknown) {
      console.error("[triage] submit 실패:", e);
      alert(
        "백엔드 연동 실패 — 시연 모드로 대시보드 이동.\n" +
          (e instanceof Error ? e.message : String(e))
      );
      navigate(`/dashboard?patient=${selectedId}`);
    } finally {
      setSubmitting(false);
    }
  }

  function handleSave() {
    applyLocalQueueUpdate();
    alert("저장됨 (대기열 갱신 — 정식 제출은 'AI 분석 시작' 버튼)");
  }

  // 폼 유효성 — 필수 항목 체크
  const canSubmit = useMemo(() => {
    return Boolean(
      form.name &&
      form.age !== undefined &&
      form.sex &&
      form.chief_complaint &&
      form.ktas &&
      form.vitals?.sbp !== null && form.vitals?.sbp !== undefined &&
      form.vitals?.hr !== null && form.vitals?.hr !== undefined
    );
  }, [form]);

  // 키보드 단축키
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Enter") {
        e.preventDefault();
        if (canSubmit) handleSubmit();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canSubmit]); // eslint-disable-line react-hooks/exhaustive-deps

  // 우측 요약용
  const ccMeta = form.chief_complaint ? CHIEF_COMPLAINT_LABELS[form.chief_complaint] : null;
  const ktasMeta = form.ktas ? KTAS_META[form.ktas] : null;

  return (
    <div className="h-screen flex flex-col bg-gray-200">
      {/* 의사랑 EMR 스타일 상단 아이콘 툴바 */}
      <TriageTopBar />

      {/* MIMIC 조회중일 때만 작은 인디케이터 (헤더 없음) */}
      {mimicLoading && (
        <div className="bg-amber-50 border-b border-amber-300 px-4 py-1 text-[11px] text-amber-800 flex items-center gap-2 animate-pulse">
          <span className="material-symbols-outlined text-sm">hourglass_top</span>
          MIMIC 진단·알레르기 자동 조회중…
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* 좌측 — 대기열 사이드바 */}
        <TriageQueueSidebar
          patients={patients}
          selectedId={selectedId}
          onSelect={handleSelect}
        />

        {/* 중앙 — EMR 표 스타일 입력 폼 */}
        <main className="flex-1 overflow-y-auto">
          <TriageTableForm
            value={form}
            vitals={form.vitals ?? EMPTY_VITALS}
            onChange={handlePatientChange}
            onVitalsChange={handleVitalsChange}
            onHistoryToggle={handleHistoryToggle}
          />
        </main>

        {/* 우측 — 입력 요약 패널 */}
        <aside className="w-64 bg-gray-100 border-l border-gray-400 p-3 overflow-y-auto">
          <div className="mb-3">
            <div className="text-[10px] font-bold tracking-widest text-gray-600 uppercase mb-0.5">Summary</div>
            <h3 className="text-[14px] font-bold text-gray-900">입력 요약</h3>
          </div>

          <div className="space-y-2 text-[12px]">
            {/* 환자 */}
            <div className="border border-gray-400 bg-white p-2.5">
              <div className="text-[10px] text-gray-600 font-medium mb-1 uppercase tracking-wide">환자</div>
              <div className="font-bold text-gray-900">
                {form.name || "—"}
                {form.age && <span className="ml-1 text-[11px] text-gray-600 font-normal">({form.sex ?? "?"}/{form.age})</span>}
              </div>
              <div className="font-mono text-[10px] text-gray-500 mt-0.5">{form.mrn || "MRN: —"}</div>
            </div>

            {/* KTAS */}
            {ktasMeta && (
              <div className="border border-gray-400 bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <div className={`w-9 h-9 ${ktasMeta.bg} text-white flex items-center justify-center font-bold text-[16px]`}>
                    {form.ktas}
                  </div>
                  <div>
                    <div className="font-bold text-gray-900 text-[13px]">{ktasMeta.label}</div>
                    <div className="text-[10px] text-gray-600">{ktasMeta.desc}</div>
                  </div>
                </div>
              </div>
            )}

            {/* 주증상 */}
            {ccMeta && (
              <div className="border border-gray-400 bg-white p-2.5">
                <div className="text-[10px] text-gray-600 font-medium mb-1 uppercase tracking-wide">주증상</div>
                <div className="font-bold text-gray-900">{ccMeta.ko}</div>
                <div className="text-[10px] font-mono text-gray-500">{ccMeta.en}</div>
                {form.complaint_detail && (
                  <div className="mt-1 text-[11px] text-gray-800 leading-tight">
                    {form.complaint_detail}
                  </div>
                )}
              </div>
            )}

            {/* 활력징후 */}
            <div className="border border-gray-400 bg-white p-2.5">
              <div className="text-[10px] text-gray-600 font-medium mb-1 uppercase tracking-wide">활력징후</div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-mono text-[11px] text-gray-800">
                <span>BP: {form.vitals?.sbp ?? "—"}/{form.vitals?.dbp ?? "—"}</span>
                <span>HR: {form.vitals?.hr ?? "—"}</span>
                <span>RR: {form.vitals?.rr ?? "—"}</span>
                <span>SpO₂: {form.vitals?.spo2 ?? "—"}</span>
                <span>BT: {form.vitals?.bt ?? "—"}</span>
              </div>
            </div>

            {/* 과거력 */}
            {(form.past_history?.length ?? 0) > 0 && (
              <div className="border border-gray-400 bg-white p-2.5">
                <div className="text-[10px] text-gray-600 font-medium mb-1 uppercase tracking-wide">과거력</div>
                <div className="flex flex-wrap gap-1">
                  {(form.past_history ?? []).map((h) => (
                    <span key={h} className="px-1.5 py-0.5 bg-gray-200 text-gray-800 text-[10px] font-mono border border-gray-400">
                      {h}
                    </span>
                  ))}
                </div>
              </div>
            )}

          </div>
        </aside>
      </div>

      {/* 푸터 */}
      <TriageActionFooter
        canSubmit={canSubmit}
        submitting={submitting}
        onReset={handleReset}
        onSave={handleSave}
        onSubmit={handleSubmit}
      />
    </div>
  );
}
