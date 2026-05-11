// 협진 — 다른 과 의사에게 협진 요청 / 응답 큐
import { useState } from "react";
import { Stethoscope, Send, Clock, CheckCircle2, MessageSquare } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { type QueuePatient, KTAS_META, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

const DEPARTMENTS = ["순환기내과", "신장내과", "소화기내과", "신경과", "흉부외과", "정형외과", "산부인과", "소아과"];

interface ConsultRequest {
  id: string;
  patient: QueuePatient;
  fromDept: string;
  toDept: string;
  urgency: "routine" | "urgent" | "stat";
  reason: string;
  status: "pending" | "responded";
  response?: string;
  createdAt: Date;
  respondedAt?: Date;
}

function buildSeed(): ConsultRequest[] {
  const now = Date.now();
  const ps = ALL_PATIENTS.slice(0, 6);
  return [
    {
      id: "C1", patient: ps[0], fromDept: "응급의학과", toDept: "신장내과", urgency: "stat",
      reason: "ESRD 환자 K+ 6.6 — 응급 투석 필요",
      status: "responded",
      response: "30분 내 응급 투석실 입실. CRRT 준비 완료.",
      createdAt: new Date(now - 25 * 60000),
      respondedAt: new Date(now - 18 * 60000),
    },
    {
      id: "C2", patient: ps[1], fromDept: "응급의학과", toDept: "순환기내과", urgency: "urgent",
      reason: "NSTEMI 의심 (Tropo 0.25, NT-proBNP 23,468)",
      status: "responded",
      response: "PCI 검토 중. 30분 내 카테터실 호출.",
      createdAt: new Date(now - 18 * 60000),
      respondedAt: new Date(now - 9 * 60000),
    },
    {
      id: "C3", patient: ps[2], fromDept: "응급의학과", toDept: "순환기내과", urgency: "urgent",
      reason: "Afib 새로 발현 — 항응고제 검토 필요",
      status: "pending",
      createdAt: new Date(now - 12 * 60000),
    },
    {
      id: "C4", patient: ps[3], fromDept: "응급의학과", toDept: "흉부외과", urgency: "routine",
      reason: "ADHF 악화 — Echocardiography 후 의뢰 검토",
      status: "pending",
      createdAt: new Date(now - 5 * 60000),
    },
  ];
}

const URGENCY_META: Record<ConsultRequest["urgency"], { ko: string; bg: string; text: string }> = {
  stat:    { ko: "STAT (즉시)", bg: "bg-red-100",    text: "text-red-700" },
  urgent:  { ko: "URGENT",      bg: "bg-amber-100",  text: "text-amber-700" },
  routine: { ko: "ROUTINE",     bg: "bg-emerald-100",text: "text-emerald-700" },
};

export default function ConsultPage() {
  const [tab, setTab] = useState<"sent" | "received" | "new">("sent");
  const [list, setList] = useState<ConsultRequest[]>(buildSeed);

  const [draft, setDraft] = useState({
    patientId: "",
    toDept: DEPARTMENTS[0],
    urgency: "routine" as ConsultRequest["urgency"],
    reason: "",
  });

  function handleSend() {
    const patient = ALL_PATIENTS.find((p) => p.id === draft.patientId);
    if (!patient) {
      alert("환자를 선택하세요.");
      return;
    }
    if (!draft.reason.trim()) {
      alert("협진 사유를 입력하세요.");
      return;
    }
    const newReq: ConsultRequest = {
      id: `C${Date.now()}`,
      patient,
      fromDept: "응급의학과",
      toDept: draft.toDept,
      urgency: draft.urgency,
      reason: draft.reason,
      status: "pending",
      createdAt: new Date(),
    };
    setList([newReq, ...list]);
    setDraft({ patientId: "", toDept: DEPARTMENTS[0], urgency: "routine", reason: "" });
    setTab("sent");
    alert(`${draft.toDept}에 협진 요청 전송됨`);
  }

  return (
    <EMRPageShell
      title="협진 (Consultation)"
      subtitle={`보낸: ${list.length}건 / 응답 대기: ${list.filter((c) => c.status === "pending").length}건`}
    >
      <div className="grid grid-cols-12 gap-3">
        <aside className="col-span-3">
          <Panel title="탭">
            <div className="space-y-1">
              <TabButton active={tab === "sent"} onClick={() => setTab("sent")} icon={Send}>
                보낸 협진 ({list.length})
              </TabButton>
              <TabButton active={tab === "received"} onClick={() => setTab("received")} icon={MessageSquare}>
                받은 협진 (0)
              </TabButton>
              <TabButton active={tab === "new"} onClick={() => setTab("new")} icon={Stethoscope}>
                새 협진 작성
              </TabButton>
            </div>
          </Panel>
        </aside>

        <section className="col-span-9">
          {tab === "sent" && (
            <Panel title="응급실에서 보낸 협진">
              <ul className="space-y-2">
                {list.map((c) => {
                  const um = URGENCY_META[c.urgency];
                  const ktas = KTAS_META[c.patient.ktas as KTAS];
                  return (
                    <li key={c.id} className="bg-white border border-gray-300 px-3 py-2">
                      <div className="flex items-center gap-2 flex-wrap mb-1.5">
                        <span className={`inline-block w-5 h-5 leading-5 text-center text-[10px] font-bold ${ktas.bg} ${ktas.text}`}>
                          {c.patient.ktas}
                        </span>
                        <span className="font-bold text-[13px]">{c.patient.name}</span>
                        <span className="text-[10px] font-mono text-gray-500">#{c.patient.mrn}</span>
                        <span className="text-[11px] text-gray-700">→ <b>{c.toDept}</b></span>
                        <span className={`px-1.5 py-0 text-[10px] font-bold ${um.bg} ${um.text}`}>{um.ko}</span>
                        <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-gray-500">
                          <Clock size={10} />
                          {c.createdAt.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-[12px] text-gray-800 mb-1">
                        <b>요청:</b> {c.reason}
                      </p>
                      {c.status === "responded" ? (
                        <div className="bg-emerald-50 border border-emerald-300 px-2 py-1 text-[11px] text-emerald-800 flex items-start gap-1">
                          <CheckCircle2 size={11} className="mt-0.5 shrink-0" />
                          <span><b>응답({c.respondedAt?.toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}):</b> {c.response}</span>
                        </div>
                      ) : (
                        <div className="bg-amber-50 border border-amber-300 px-2 py-1 text-[11px] text-amber-800 flex items-center gap-1">
                          <Clock size={11} />
                          <span>응답 대기 중…</span>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {tab === "received" && (
            <Panel title="받은 협진">
              <p className="text-[12px] text-gray-500 italic px-2 py-3">받은 협진 없음</p>
            </Panel>
          )}

          {tab === "new" && (
            <Panel title="새 협진 작성">
              <div className="space-y-2">
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-700 font-bold mb-0.5">환자</p>
                  <select
                    value={draft.patientId}
                    onChange={(e) => setDraft({ ...draft, patientId: e.target.value })}
                    className="w-full text-[12px] border border-gray-400 px-2 py-1 bg-white"
                  >
                    <option value="">— 선택 —</option>
                    {ALL_PATIENTS.slice(0, 20).map((p) => (
                      <option key={p.id} value={p.id}>
                        KTAS {p.ktas} · {p.name} (#{p.mrn})
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-700 font-bold mb-0.5">의뢰 진료과</p>
                    <select
                      value={draft.toDept}
                      onChange={(e) => setDraft({ ...draft, toDept: e.target.value })}
                      className="w-full text-[12px] border border-gray-400 px-2 py-1 bg-white"
                    >
                      {DEPARTMENTS.map((d) => <option key={d}>{d}</option>)}
                    </select>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-widest text-gray-700 font-bold mb-0.5">긴급도</p>
                    <select
                      value={draft.urgency}
                      onChange={(e) => setDraft({ ...draft, urgency: e.target.value as ConsultRequest["urgency"] })}
                      className="w-full text-[12px] border border-gray-400 px-2 py-1 bg-white"
                    >
                      <option value="routine">ROUTINE</option>
                      <option value="urgent">URGENT</option>
                      <option value="stat">STAT (즉시)</option>
                    </select>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-gray-700 font-bold mb-0.5">협진 사유</p>
                  <textarea
                    value={draft.reason}
                    onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
                    placeholder="환자 상태 요약 + 협진 요청 내용"
                    rows={4}
                    className="w-full bg-gray-50 border border-gray-300 px-2 py-1.5 text-[12px] resize-y outline-none focus:border-blue-500"
                  />
                </div>
                <div className="flex justify-end">
                  <button
                    onClick={handleSend}
                    className="px-4 py-1.5 text-[12px] bg-gray-800 text-white border border-gray-900 hover:bg-gray-900 flex items-center gap-1.5 font-bold"
                  >
                    <Send size={12} />
                    협진 요청 전송
                  </button>
                </div>
              </div>
            </Panel>
          )}
        </section>
      </div>
    </EMRPageShell>
  );
}

function TabButton({
  active,
  onClick,
  icon: Icon,
  children,
}: {
  active: boolean;
  onClick: () => void;
  icon: typeof Stethoscope;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "w-full text-left px-2 py-1.5 text-[12px] font-bold border flex items-center gap-1.5",
        active
          ? "bg-blue-50 border-blue-500 text-blue-800"
          : "bg-white border-gray-300 text-gray-700 hover:bg-gray-50",
      ].join(" ")}
    >
      <Icon size={12} />
      {children}
    </button>
  );
}
