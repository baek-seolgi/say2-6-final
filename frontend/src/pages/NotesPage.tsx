// 진료노트 — SOAP 형식 자유서술 메모 작성/저장
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { Save, Printer, ChevronRight, Stethoscope } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { CHIEF_COMPLAINT_LABELS, KTAS_META, type QueuePatient, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

interface SOAP {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
}

const EMPTY_SOAP: SOAP = { subjective: "", objective: "", assessment: "", plan: "" };

export default function NotesPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const initialMrn = params.get("mrn");

  const [selectedMrn, setSelectedMrn] = useState<string | null>(initialMrn);
  const [soap, setSoap] = useState<SOAP>(EMPTY_SOAP);
  const [savedNotes, setSavedNotes] = useState<Array<{ at: string; soap: SOAP }>>([]);

  const patient = ALL_PATIENTS.find((p) => p.mrn === selectedMrn) ?? null;

  function handleSave() {
    if (!patient) {
      alert("환자를 선택하세요.");
      return;
    }
    const isEmpty = !soap.subjective && !soap.objective && !soap.assessment && !soap.plan;
    if (isEmpty) {
      alert("작성된 내용이 없습니다.");
      return;
    }
    setSavedNotes((prev) => [
      { at: new Date().toLocaleString("ko-KR"), soap: { ...soap } },
      ...prev,
    ]);
    setSoap(EMPTY_SOAP);
    alert("저장됨 (TODO: FHIR DocumentReference 저장 연동)");
  }

  return (
    <EMRPageShell
      title="진료노트 (SOAP)"
      subtitle={patient ? `${patient.name} · #${patient.mrn}` : "환자 미선택"}
      headerRight={
        <button
          onClick={() => window.print()}
          className="px-2 py-1 text-[11px] bg-gray-700 text-white border border-gray-900 hover:bg-gray-600 flex items-center gap-1"
        >
          <Printer size={12} /> 인쇄
        </button>
      }
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측 — 환자 선택 */}
        <aside className="col-span-3 space-y-3">
          <Panel title="환자 선택">
            <button
              onClick={() => navigate("/patients")}
              className="w-full text-[12px] py-1.5 bg-blue-50 border border-blue-300 text-blue-800 font-bold hover:bg-blue-100 flex items-center justify-center gap-1"
            >
              환자조회 페이지에서 선택 <ChevronRight size={12} />
            </button>
            <div className="mt-2 max-h-[240px] overflow-y-auto -m-3 border-t border-gray-200">
              {ALL_PATIENTS.slice(0, 14).map((p) => {
                const ktas = KTAS_META[p.ktas as KTAS];
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setSelectedMrn(p.mrn);
                      setSavedNotes([]);
                    }}
                    className={[
                      "w-full text-left px-2 py-1 text-[12px] border-b border-gray-100 flex items-center gap-2",
                      selectedMrn === p.mrn ? "bg-yellow-100" : "hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <span className={`w-5 h-5 inline-flex items-center justify-center text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
                      {p.ktas}
                    </span>
                    <span className="font-bold">{p.name}</span>
                    <span className="text-[10px] font-mono text-gray-500 ml-auto">#{p.mrn}</span>
                  </button>
                );
              })}
            </div>
          </Panel>

          {patient && (
            <Panel title="환자 요약">
              <ul className="text-[11px] text-gray-700 space-y-1">
                <li><b>{patient.name}</b> ({patient.sex === "M" ? "남" : "여"}/{patient.age})</li>
                <li>주호소: <b className="text-red-700">{patient.chief_complaint ? CHIEF_COMPLAINT_LABELS[patient.chief_complaint]?.ko : "—"}</b></li>
                <li>과거력: {patient.past_history?.join(", ") || "없음"}</li>
                <li>알레르기: {patient.allergies || "NKDA"}</li>
              </ul>
            </Panel>
          )}
        </aside>

        {/* 중앙 — SOAP 폼 */}
        <section className="col-span-6 space-y-3">
          <Panel
            title="SOAP 노트"
            headerRight={
              <span className="flex items-center gap-1 text-[10px] text-blue-700 font-bold">
                <Stethoscope size={11} /> Clinical Note
              </span>
            }
          >
            <div className="space-y-2">
              <SoapField
                label="S — Subjective (주관적 증상)"
                value={soap.subjective}
                onChange={(v) => setSoap((s) => ({ ...s, subjective: v }))}
                placeholder="환자 호소 / 증상 시작 / 양상 / 동반증상"
              />
              <SoapField
                label="O — Objective (객관적 소견)"
                value={soap.objective}
                onChange={(v) => setSoap((s) => ({ ...s, objective: v }))}
                placeholder="활력, 신체검사, 영상/혈액 결과 요약"
              />
              <SoapField
                label="A — Assessment (평가/진단)"
                value={soap.assessment}
                onChange={(v) => setSoap((s) => ({ ...s, assessment: v }))}
                placeholder="감별진단 / 잠정 진단"
              />
              <SoapField
                label="P — Plan (계획)"
                value={soap.plan}
                onChange={(v) => setSoap((s) => ({ ...s, plan: v }))}
                placeholder="추가 검사 / 처방 / 입원·퇴실 계획"
              />
              <div className="flex justify-end gap-2 pt-2">
                <button
                  onClick={() => setSoap(EMPTY_SOAP)}
                  className="px-3 py-1 text-[12px] border border-gray-400 text-gray-700 bg-white hover:bg-gray-50"
                >
                  지우기
                </button>
                <button
                  onClick={handleSave}
                  className="px-3 py-1 text-[12px] bg-gray-800 text-white border border-gray-900 hover:bg-gray-900 flex items-center gap-1"
                >
                  <Save size={12} /> 저장
                </button>
              </div>
            </div>
          </Panel>
        </section>

        {/* 우측 — 저장된 노트 목록 */}
        <aside className="col-span-3">
          <Panel title="저장된 노트" headerRight={<span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">{savedNotes.length}</span>}>
            {savedNotes.length === 0 ? (
              <p className="text-[11px] text-gray-500 italic">저장된 노트 없음</p>
            ) : (
              <ul className="space-y-2 max-h-[320px] overflow-y-auto -m-1 p-1">
                {savedNotes.map((n, i) => (
                  <li key={i} className="border border-gray-300 bg-white px-2 py-1.5 text-[11px]">
                    <p className="font-mono text-gray-500 mb-1">{n.at}</p>
                    {n.soap.subjective && <p><b>S:</b> {n.soap.subjective.slice(0, 60)}</p>}
                    {n.soap.assessment && <p><b>A:</b> {n.soap.assessment.slice(0, 60)}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>
    </EMRPageShell>
  );
}

function SoapField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
}) {
  return (
    <div>
      <p className="text-[10px] font-bold tracking-widest text-gray-700 mb-1 uppercase">{label}</p>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={3}
        className="w-full bg-gray-50 border border-gray-300 px-2 py-1.5 text-[12px] resize-y outline-none focus:border-blue-500"
      />
    </div>
  );
}
