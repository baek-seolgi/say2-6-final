// 환자호출 — 대기실 전광판 톤 화면 (현재 호출 + 대기 큐)
import { useState } from "react";
import { Phone, Megaphone, ChevronRight } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { type QueuePatient, KTAS_META, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

const ROOMS = ["1진료실", "2진료실", "3진료실", "초진실 A", "초진실 B"];

export default function PatientCallPage() {
  const queue = ALL_PATIENTS
    .filter((p) => p.status === "arrived" || p.status === "triage")
    .sort((a, b) => (a.ktas ?? 5) - (b.ktas ?? 5))
    .slice(0, 12);

  const [calledIdx, setCalledIdx] = useState<number | null>(0);
  const [room, setRoom] = useState(ROOMS[0]);

  const calledPatient = calledIdx !== null ? queue[calledIdx] : null;

  function callNext() {
    if (calledIdx === null) {
      setCalledIdx(0);
    } else if (calledIdx + 1 < queue.length) {
      setCalledIdx(calledIdx + 1);
    } else {
      alert("대기 환자가 없습니다.");
    }
  }

  function callSpecific(i: number) {
    setCalledIdx(i);
  }

  return (
    <EMRPageShell
      title="환자 호출"
      subtitle={`대기 ${queue.length}명 / 진료실: ${room}`}
      headerRight={
        <select
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          className="text-[11px] border border-gray-500 bg-gray-700 text-white px-2 py-0.5"
        >
          {ROOMS.map((r) => <option key={r}>{r}</option>)}
        </select>
      }
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측 — 전광판 (현재 호출) */}
        <section className="col-span-7">
          <div className="bg-black border-4 border-gray-700 rounded-md overflow-hidden">
            <div className="bg-gradient-to-b from-gray-900 to-black px-4 py-3 border-b border-gray-700 flex items-center justify-between">
              <span className="text-amber-400 text-[12px] font-bold tracking-widest font-mono flex items-center gap-2">
                <Megaphone size={14} />
                현재 호출 — {room}
              </span>
              <span className="text-emerald-400 text-[10px] font-mono animate-pulse">● LIVE</span>
            </div>
            <div className="p-8 text-center min-h-[300px] flex flex-col items-center justify-center">
              {calledPatient ? (
                <>
                  <p className="text-amber-400 text-[14px] mb-3 font-mono tracking-widest">
                    KTAS {calledPatient.ktas} ({KTAS_META[calledPatient.ktas as KTAS].label})
                  </p>
                  <h2 className="text-white text-[60px] font-bold tracking-wide leading-none mb-3">
                    {calledPatient.name}
                  </h2>
                  <p className="text-gray-300 text-[18px] font-mono mb-2">
                    #{calledPatient.mrn}
                  </p>
                  <p className="text-emerald-300 text-[20px] font-bold mt-4 animate-pulse">
                    {room}으로 이동해주세요
                  </p>
                </>
              ) : (
                <p className="text-gray-500 text-[20px]">호출된 환자가 없습니다</p>
              )}
            </div>
            <div className="bg-gray-900 px-4 py-2 border-t border-gray-700 flex justify-between items-center">
              <span className="text-gray-400 text-[10px] font-mono">
                {new Date().toLocaleString("ko-KR")}
              </span>
              <button
                onClick={callNext}
                className="px-4 py-1.5 bg-amber-500 text-black text-[12px] font-bold border-2 border-amber-700 hover:bg-amber-400 flex items-center gap-1.5"
              >
                <Phone size={12} />
                다음 환자 호출
                <ChevronRight size={12} />
              </button>
            </div>
          </div>

          <div className="mt-3 text-[11px] text-gray-600">
            <p className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              전광판 송출 중 — 음성 호출 시스템과 연동되어야 합니다 (TTS API)
            </p>
          </div>
        </section>

        {/* 우측 — 대기 큐 */}
        <aside className="col-span-5">
          <Panel
            title="대기 환자"
            headerRight={
              <span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">
                {queue.length}명
              </span>
            }
          >
            <ul className="space-y-1">
              {queue.map((p, i) => {
                const ktas = KTAS_META[p.ktas as KTAS];
                const isCalled = calledIdx === i;
                return (
                  <li
                    key={p.id}
                    onClick={() => callSpecific(i)}
                    className={[
                      "flex items-center gap-2 px-2 py-1.5 cursor-pointer border",
                      isCalled
                        ? "bg-amber-50 border-amber-500"
                        : "bg-white border-gray-200 hover:bg-gray-50",
                    ].join(" ")}
                  >
                    <span className={`w-6 h-6 inline-flex items-center justify-center text-[11px] font-bold ${ktas.bg} ${ktas.text}`}>
                      {p.ktas}
                    </span>
                    <span className="font-bold text-[13px]">{p.name}</span>
                    <span className="text-[10px] font-mono text-gray-500">#{p.mrn}</span>
                    <span className="ml-auto text-[10px] text-gray-500 font-mono">
                      {new Date(p.arrived_at).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}
                    </span>
                    {isCalled && (
                      <span className="ml-1 px-1 py-0 bg-amber-500 text-white text-[9px] font-bold animate-pulse">
                        호출 중
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Panel>
        </aside>
      </div>
    </EMRPageShell>
  );
}
