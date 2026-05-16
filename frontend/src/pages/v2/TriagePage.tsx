import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Rocket, RotateCcw, Search, FilePlus2, Save,
} from "lucide-react";
import { AppShell } from "../../components/v2/AppShell";
import { cn } from "../../lib/cn";
import { KTAS_META, type KTAS, type Sex, PAST_HISTORY_LABELS, type PastHistoryCode } from "../../types/triage";
import { DEMO_PATIENTS, registerLivePatient, type DemoPatient } from "../../lib/v2/demoStore";
import { submitTriage } from "../../lib/v2/api";

/* ─────────────────────────────────────────────────────────
   say-6 EMR Triage Workstation
   VUNO DeepCARS 톤 (다크 슬레이트 헤더 + 흰 본문 + 의료 표준 표)
   ───────────────────────────────────────────────────────── */

const PAST_HX_CODES: PastHistoryCode[] = ["HTN", "DM", "CAD", "CVA", "COPD", "ASTHMA", "CKD", "AFIB"];

export default function TriagePageV2() {
  const nav = useNavigate();

  /* ── 환자 식별 ── */
  // subjectId = 화면상 "등록번호 (MRN)" = FHIR Patient.identifier[type=MR]
  const [subjectId, setSubjectId] = useState("");
  const [name, setName] = useState("");
  const [age, setAge]   = useState<number | "">("");
  const [sex, setSex]   = useState<Sex>("M");

  /* ── 활력징후 ── */
  const [hr, setHr]     = useState<number | "">("");
  const [sbp, setSbp]   = useState<number | "">("");
  const [dbp, setDbp]   = useState<number | "">("");
  const [rr, setRr]     = useState<number | "">("");
  const [spo2, setSpo2] = useState<number | "">("");
  const [bt, setBt]     = useState<number | "">("");
  const [pain, setPain] = useState<number | "">("");

  /* ── 임상 ── */
  const [chief, setChief] = useState("");
  const [ktas, setKtas] = useState<KTAS>(3);
  const [allergies, setAllergies] = useState("");
  const [meds, setMeds] = useState("");
  const [notes, setNotes] = useState("");
  const [pastHx, setPastHx] = useState<Record<PastHistoryCode, boolean>>({
    HTN: false, DM: false, CAD: false, CVA: false, COPD: false,
    ASTHMA: false, CKD: false, AFIB: false,
    LIVER: false, CANCER: false, ALLERGY: false, PREGNANT: false,
  });

  const [search, setSearch] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  // 큐에서 선택한 환자 (데모 케이스면 MIMIC 식별자 + AI 권고 데이터 — submit 시 라이브 환자에 그대로 보존)
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedMimic, setSelectedMimic] = useState<DemoPatient["mimic"]>(null);
  const [selectedRecommendation, setSelectedRecommendation] = useState<DemoPatient["recommendation"]>(undefined);
  const [selectedAiVerdict, setSelectedAiVerdict] = useState<DemoPatient["aiVerdict"]>(undefined);

  const queueList = useMemo(() => {
    if (!search.trim()) return DEMO_PATIENTS;
    const q = search.toLowerCase();
    return DEMO_PATIENTS.filter(
      (p) => p.name.includes(search) || p.id.includes(q) || p.chief.includes(search),
    );
  }, [search]);

  const EMPTY_HX: Record<PastHistoryCode, boolean> = {
    HTN: false, DM: false, CAD: false, CVA: false, COPD: false,
    ASTHMA: false, CKD: false, AFIB: false,
    LIVER: false, CANCER: false, ALLERGY: false, PREGNANT: false,
  };

  function reset() {
    setSubjectId(""); setName(""); setAge(""); setSex("M");
    setHr(""); setSbp(""); setDbp(""); setRr(""); setSpo2(""); setBt(""); setPain("");
    setChief(""); setKtas(3); setAllergies(""); setMeds(""); setNotes("");
    setPastHx({ ...EMPTY_HX });
    setSelectedId(null);
    setSelectedMimic(null);
    setSelectedRecommendation(undefined);
    setSelectedAiVerdict(undefined);
  }

  // 큐에서 환자 클릭 → 트리아지 폼 자동 채움 (레거시 EMR과 동일한 동작)
  function selectPatient(p: DemoPatient) {
    setSelectedId(p.id);
    setSelectedMimic(p.mimic ?? null);
    setSelectedRecommendation(p.recommendation);
    setSelectedAiVerdict(p.aiVerdict);
    setSubjectId(p.mimic?.subject_id ?? p.id);
    setName(p.name);
    setAge(p.age);
    setSex(p.sex);
    setHr(p.vitals.hr ?? "");
    setSbp(p.vitals.sbp ?? "");
    setDbp(p.vitals.dbp ?? "");
    setRr(p.vitals.rr ?? "");
    setSpo2(p.vitals.spo2 ?? "");
    setBt(p.vitals.bt ?? "");
    setPain("");
    setChief(p.chief);
    setKtas(p.ktas);
    setAllergies(p.allergies ?? "");
    setMeds(p.medications ?? "");
    setNotes(p.notes ?? "");
    const hx = { ...EMPTY_HX };
    (p.pastHistory ?? []).forEach((code) => { hx[code] = true; });
    setPastHx(hx);
    setToast(`✓ ${p.name} 선택됨 — 폼이 채워졌습니다. 검토 후 Submit + AI`);
    setTimeout(() => setToast(null), 2500);
  }

  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!subjectId || !age || !chief) {
      alert("환자 ID, 나이, 주증상은 필수입니다.");
      return;
    }
    setSubmitting(true);
    const vitalsInput = {
      hr: Number(hr) || 0, sbp: Number(sbp) || 0, dbp: Number(dbp) || 0,
      spo2: Number(spo2) || 0, rr: Number(rr) || 0, bt: Number(bt) || 36.5,
    };
    const pastHistory = PAST_HX_CODES.filter((c) => pastHx[c]);

    const result = await submitTriage({
      name: name || subjectId,
      age: Number(age),
      sex,
      vitals: vitalsInput,
      chief,
      pastHistory,
      allergies,
      medications: meds,
      notes,
      mimic: selectedMimic,
    });
    setSubmitting(false);

    if (result?.encounter_id) {
      // 백엔드 encounter 생성 성공 → 라이브 환자 등록 후 환자 상세로 이동
      const live: DemoPatient = {
        id: result.encounter_id,
        mrn: subjectId,
        fhirPatientId: result.patient_id,
        name: name || subjectId,
        age: Number(age),
        sex,
        ktas,
        chief,
        registeredAt: new Date().toISOString(),
        arrivedAt: new Date().toISOString(),
        ecg: selectedRecommendation ? "done" : "pending",
        cxr: selectedRecommendation ? "done" : "pending",
        lab: selectedRecommendation ? "done" : "pending",
        aiStatus: selectedRecommendation ? "done" : "analyzing",
        vitals: {
          hr: vitalsInput.hr || null, sbp: vitalsInput.sbp || null,
          dbp: vitalsInput.dbp || null, rr: vitalsInput.rr || null,
          spo2: vitalsInput.spo2 || null, bt: vitalsInput.bt || null,
        },
        // 큐에서 선택한 환자의 식별자/임상정보 보존 — 환자 상세 사이드바 표시용
        pastHistory,
        allergies: allergies || undefined,
        medications: meds || undefined,
        notes: notes || undefined,
        mimic: selectedMimic,
        // 큐에서 선택한 데모 케이스의 AI 권고·판정 보존 → 라이브 환자에도 그대로 표시
        recommendation: selectedRecommendation,
        aiVerdict: selectedAiVerdict,
      };
      registerLivePatient(live);
      nav(`/demo/patient/${result.encounter_id}?encounter_id=${result.encounter_id}`);
      return;
    }

    // 백엔드 미연동 → 데모 모드 토스트
    setToast(`✓ 트리아지 등록 완료 (Subject ${subjectId}) · 백엔드 미연동 — 데모 모드`);
    reset();
    setTimeout(() => setToast(null), 3500);
  }

  return (
    <AppShell>
      <div className="min-h-[calc(100vh-56px)] bg-slate-100">

        {/* 액션 툴바 */}
        <div className="sticky top-14 z-10 bg-white border-b border-slate-300 px-5 h-12 flex items-center gap-3">
          <span className="inline-flex items-center gap-2 font-bold text-slate-800 text-sm">
            <span className="h-7 w-7 grid place-items-center bg-brand-600 text-white">
              <FilePlus2 className="h-4 w-4" />
            </span>
            신규 환자 등록
          </span>
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] text-slate-500">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
            <span className="font-medium">박OO 간호사 · 접속 중</span>
          </span>
          <button
            onClick={reset}
            className="inline-flex items-center gap-1.5 h-8 px-3.5 border border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100 font-bold text-xs transition-colors"
          >
            <RotateCcw className="h-3.5 w-3.5" /> 초기화
          </button>
          <button className="inline-flex items-center gap-1.5 h-8 px-3.5 border border-brand-300 bg-brand-50 text-brand-700 hover:bg-brand-100 font-bold text-xs transition-colors">
            <Save className="h-3.5 w-3.5" /> 임시저장
          </button>
        </div>

        {/* DeepCARS 스타일 환자 메타 바 (상단 라이트 회색 헤더) */}
        <div className="bg-white border-b border-slate-300 px-5 py-2.5 flex items-center gap-6 text-[11px] flex-wrap">
          <MetaCell label="MRN"        value={subjectId || "—"} mono />
          <MetaCell label="Name"       value={name || "—"} />
          <MetaCell label="Age"        value={age === "" ? "—" : String(age)} mono />
          <MetaCell label="Sex"        value={sex} />
          <MetaCell label="Admission"  value={new Date().toLocaleString("ko-KR", { hour: "2-digit", minute: "2-digit", month: "2-digit", day: "2-digit" })} mono />
          <MetaCell label="Ward"       value="응급실_2병동" />
          <MetaCell label="say-6 Score" value="—" highlight />
        </div>

        <div className="grid grid-cols-[260px_1fr] h-[calc(100vh-56px-48px-48px)] overflow-hidden">
          {/* ─────────── 좌측: 환자 대기 목록 ─────────── */}
          <aside className="border-r border-slate-300 bg-white flex flex-col min-h-0">
            <div className="px-3 py-2.5 border-b border-slate-200 bg-slate-50">
              <div className="text-[11px] font-bold text-slate-700 mb-1.5">
                환자 대기 목록 <span className="text-slate-400 font-numeric">· {DEMO_PATIENTS.length}명</span>
              </div>
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-slate-400" />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="검색 (이름/ID/증상)"
                  className="w-full h-7 pl-7 pr-2 text-xs border border-slate-300 bg-white focus:outline-none focus:border-slate-500"
                />
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {queueList.map((p) => {
                const meta = KTAS_META[p.ktas];
                return (
                  <button
                    key={p.id}
                    onClick={() => selectPatient(p)}
                    className={cn(
                      "w-full text-left px-3 py-2 border-b border-slate-200 hover:bg-slate-50 transition-colors",
                      selectedId === p.id && "bg-slate-100 ring-1 ring-inset ring-slate-400",
                    )}
                  >
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("inline-block px-1 text-[9px] font-bold text-white", meta.bg)}>
                        KTAS {p.ktas}
                      </span>
                      <span className="text-[10px] font-numeric text-slate-500">#{p.id}</span>
                      {p.mimic && (
                        <span className="ml-auto text-[8px] font-bold text-vuno-cyanDim border border-vuno-cyan/40 px-1">
                          MIMIC
                        </span>
                      )}
                    </div>
                    <div className="text-xs font-semibold text-slate-800">{p.name}</div>
                    <div className="text-[10px] text-slate-500 truncate">{p.chief}</div>
                  </button>
                );
              })}
              {queueList.length === 0 && (
                <div className="px-3 py-6 text-center text-xs text-slate-400">검색 결과 없음</div>
              )}
            </div>

            <button className="w-full inline-flex items-center justify-center gap-1.5 h-9 border-t border-slate-300 text-slate-700 hover:bg-slate-100 text-xs font-bold tracking-wider uppercase">
              <FilePlus2 className="h-3.5 w-3.5" />
              New Patient
            </button>
          </aside>

          {/* ─────────── 우측: 트리아지 폼 (EMR 표) ─────────── */}
          <main className="p-5 space-y-3 max-w-[1400px] overflow-y-auto min-h-0">

            {/* 1. Patient Identification */}
            <Section title="Patient Identification" subtitle="환자 식별 정보">
              <Row>
                <Field label="등록번호 (MRN)" required width={280}>
                  <Input value={subjectId} onChange={setSubjectId} placeholder="12345678" mono />
                </Field>
                <Field label="환자명" required width={220}>
                  <Input value={name} onChange={setName} placeholder="김OO" />
                </Field>
                <Field label="나이" required width={120} unit="세">
                  <Input value={age} onChange={(v) => setAge(v === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="성별" width={140}>
                  <Toggle value={sex} options={["M", "F"] as const} onChange={setSex} />
                </Field>
              </Row>
            </Section>

            {/* 2. Vital Signs */}
            <Section title="Vital Signs" subtitle="활력징후 (도착 시점)">
              <Row>
                <Field label="HR"   unit="bpm"  width={140} abnormal={!!hr   && (hr   < 50 || hr   > 120)}>
                  <Input value={hr}   onChange={(v) => setHr(v   === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="SBP"  unit="mmHg" width={150} abnormal={!!sbp  && (sbp  < 90 || sbp  > 160)}>
                  <Input value={sbp}  onChange={(v) => setSbp(v  === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="DBP"  unit="mmHg" width={150}>
                  <Input value={dbp}  onChange={(v) => setDbp(v  === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="RR"   unit="/min" width={140} abnormal={!!rr   && (rr   < 10 || rr   > 24)}>
                  <Input value={rr}   onChange={(v) => setRr(v   === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="SpO₂" unit="%"    width={140} abnormal={!!spo2 && spo2 < 95}>
                  <Input value={spo2} onChange={(v) => setSpo2(v === "" ? "" : Number(v))} type="number" mono />
                </Field>
                <Field label="BT"   unit="℃"    width={140} abnormal={!!bt   && (bt   < 36 || bt   > 38)}>
                  <Input value={bt}   onChange={(v) => setBt(v   === "" ? "" : Number(v))} type="number" step="0.1" mono />
                </Field>
                <Field label="Pain" unit="/10"  width={140}>
                  <Input value={pain} onChange={(v) => setPain(v === "" ? "" : Number(v))} type="number" mono />
                </Field>
              </Row>
            </Section>

            {/* 3. Triage Assessment */}
            <Section title="Triage Assessment" subtitle="KTAS 등급 + 주증상">
              <FullRow label="KTAS Level" required>
                <div className="flex items-center gap-2 flex-wrap">
                  {([1, 2, 3, 4, 5] as KTAS[]).map((k) => {
                    const meta = KTAS_META[k];
                    const active = ktas === k;
                    return (
                      <button
                        key={k}
                        type="button"
                        onClick={() => setKtas(k)}
                        className={cn(
                          "h-8 px-4 text-xs font-bold border transition-all",
                          active ? cn(meta.bg, meta.text, "border-transparent") : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        Level {k} · {meta.label}
                      </button>
                    );
                  })}
                  <span className="ml-2 text-[11px] text-slate-500">{KTAS_META[ktas].desc}</span>
                </div>
              </FullRow>
              <FullRow label="Chief Complaint" required>
                <textarea
                  value={chief}
                  onChange={(e) => setChief(e.target.value)}
                  placeholder="예: 흉통, 호흡곤란 30분 전 발생. 좌측 흉부 압박감 동반."
                  rows={2}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 bg-white focus:outline-none focus:border-slate-500 resize-y"
                />
              </FullRow>
            </Section>

            {/* 4. Medical History */}
            <Section title="Medical History" subtitle="과거력 · 알레르기 · 복용약">
              <FullRow label="Past History">
                <div className="flex flex-wrap gap-1.5">
                  {PAST_HX_CODES.map((code) => {
                    const checked = pastHx[code];
                    return (
                      <button
                        key={code}
                        type="button"
                        onClick={() => setPastHx({ ...pastHx, [code]: !checked })}
                        className={cn(
                          "inline-flex items-center gap-1.5 h-7 px-2.5 text-[11px] border font-medium transition-colors",
                          checked
                            ? "border-slate-800 bg-slate-800 text-white"
                            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
                        )}
                      >
                        <span className={cn("inline-flex items-center justify-center h-3 w-3 border", checked ? "bg-white border-white text-slate-800" : "border-slate-400")}>
                          {checked && "✓"}
                        </span>
                        <span className="font-bold">{code}</span>
                        <span className={cn("font-normal", checked ? "text-white/80" : "text-slate-500")}>· {PAST_HISTORY_LABELS[code]}</span>
                      </button>
                    );
                  })}
                </div>
              </FullRow>
              <Row>
                <Field label="Allergies" width="50%">
                  <Input value={allergies} onChange={setAllergies} placeholder="예: Penicillin, Contrast media" />
                </Field>
                <Field label="Medications" width="50%">
                  <Input value={meds} onChange={setMeds} placeholder="예: Aspirin 100mg QD, Metformin 500mg BID" />
                </Field>
              </Row>
              <FullRow label="메모 (Notes)">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="트리아지 특이사항 · 인계 메모 (예: 보호자 동반, 투석 일정, 최근 시술 이력 등)"
                  rows={2}
                  className="w-full px-2.5 py-2 text-xs border border-slate-300 bg-white focus:outline-none focus:border-slate-500 resize-y"
                />
              </FullRow>
            </Section>

            {/* 제출 — 하단 우측 버튼 */}
            <div className="pt-2 pb-8 flex items-center justify-end gap-3">
              <span className="text-[11px] text-slate-500">
                * 필수 항목(등록번호 · 나이 · 주증상) 입력 후 제출 시 ECG · CXR · LAB AI 분석이 자동 시작됩니다.
              </span>
              <button
                onClick={submit}
                disabled={submitting}
                className="inline-flex items-center gap-2 h-10 px-6 bg-vuno-cyanDim text-white hover:bg-vuno-cyan font-bold tracking-wider shadow-sm disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <Rocket className="h-4 w-4" />
                {submitting ? "전송 중…" : "Submit + AI"}
              </button>
            </div>
          </main>
        </div>

        {/* 토스트 */}
        {toast && (
          <div className="fixed bottom-6 right-6 z-50 px-4 py-3 bg-slate-800 text-white text-xs font-bold shadow-lg tracking-wider">
            {toast}
          </div>
        )}
      </div>
    </AppShell>
  );
}

/* ─────────────────────────────────────────────────────────
   상단 환자 메타 셀 (DeepCARS 스타일)
   ───────────────────────────────────────────────────────── */
function MetaCell({ label, value, mono, highlight }: { label: string; value: string; mono?: boolean; highlight?: boolean }) {
  return (
    <div className="inline-flex items-baseline gap-1.5">
      <span className="text-[10px] text-slate-500 uppercase tracking-wider">{label}</span>
      <span className={cn(
        "text-xs font-bold",
        mono && "font-numeric tabular-nums",
        highlight ? "text-red-600" : "text-slate-800",
      )}>{value}</span>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────
   EMR 폼 — Section / Row / Field / FullRow
   ───────────────────────────────────────────────────────── */
function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="bg-white border border-slate-300 shadow-sm">
      <header className="px-4 py-2 bg-slate-800 flex items-center gap-3">
        <span className="text-[11px] font-bold text-white tracking-[0.15em] uppercase">{title}</span>
        {subtitle && <span className="text-[10px] text-slate-300">{subtitle}</span>}
      </header>
      <div>{children}</div>
    </section>
  );
}

function Row({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-stretch divide-x divide-slate-200 border-b border-slate-200 last:border-b-0">{children}</div>;
}

function Field({
  label, required, unit, width, abnormal, children,
}: {
  label: string;
  required?: boolean;
  unit?: string;
  width?: number | string;
  abnormal?: boolean;
  children: React.ReactNode;
}) {
  const isPct = typeof width === "string" && width.endsWith("%");
  return (
    <div
      className="px-3 py-2.5 flex flex-col gap-1.5"
      style={{
        width: isPct ? width as string : (width ? `${width}px` : "auto"),
        flex: width && !isPct ? "0 0 auto" : "1 1 0",
        minWidth: 120,
      }}
    >
      <label className="text-[10px] font-bold text-slate-600 tracking-wider uppercase whitespace-nowrap">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
        {unit && <span className="ml-1 text-slate-400 font-normal lowercase tracking-normal">({unit})</span>}
      </label>
      <div className={cn("flex items-center gap-1", abnormal && "[&_input]:text-red-600 [&_input]:font-bold")}>
        {children}
      </div>
    </div>
  );
}

function FullRow({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="px-3 py-2.5 border-b border-slate-200 last:border-b-0 flex gap-4 items-start">
      <label className="text-[10px] font-bold text-slate-600 tracking-wider uppercase whitespace-nowrap min-w-[140px] pt-1.5">
        {label}{required && <span className="text-red-600 ml-0.5">*</span>}
      </label>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

function Input({
  value, onChange, placeholder, type = "text", mono, step,
}: {
  value: string | number;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  mono?: boolean;
  step?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      step={step}
      className={cn(
        "w-full h-8 px-2 text-xs border border-slate-300 bg-white focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-300",
        mono && "font-numeric tabular-nums",
      )}
    />
  );
}

function Toggle<T extends string>({ value, options, onChange }: { value: T; options: readonly T[]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex border border-slate-300">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          onClick={() => onChange(o)}
          className={cn(
            "h-8 px-3 text-[11px] font-bold border-r border-slate-300 last:border-r-0 transition-colors uppercase tracking-wider min-w-[40px]",
            value === o ? "bg-slate-800 text-white" : "bg-white text-slate-600 hover:bg-slate-50",
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}
