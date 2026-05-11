// 처방등록 — CPOE (약처방 작성·전송)
import { useState } from "react";
import { Pill, Send, Trash2, Plus, AlertTriangle } from "lucide-react";

import EMRPageShell from "../components/EMRPageShell";
import Panel from "../components/triage/Panel";
import { DEMO_CASES_4 } from "../data/triage_demo_cases_4";
import { DEMO_PATIENTS_50 } from "../data/triage_demo_50";
import { type QueuePatient, KTAS_META, type KTAS } from "../types/triage";

const ALL_PATIENTS: QueuePatient[] = [...DEMO_CASES_4, ...DEMO_PATIENTS_50];

interface RxItem {
  drug: string;
  dose: string;
  route: string;
  freq: string;
  duration?: string;
}

const TEMPLATES: { name: string; items: RxItem[] }[] = [
  {
    name: "흉통 (NSTEMI 의심)",
    items: [
      { drug: "Aspirin", dose: "300mg", route: "PO", freq: "1회 (loading)" },
      { drug: "Clopidogrel", dose: "300mg", route: "PO", freq: "1회 (loading)" },
      { drug: "Heparin", dose: "5000IU", route: "IV bolus", freq: "1회" },
      { drug: "Nitroglycerin", dose: "0.6mg", route: "SL", freq: "PRN, 5분 간격 ×3" },
    ],
  },
  {
    name: "고칼륨혈증 (응급)",
    items: [
      { drug: "Calcium Gluconate 10%", dose: "10ml", route: "IV", freq: "1회 (over 5min)" },
      { drug: "Insulin (Regular) + Dextrose 50%", dose: "10IU + 50ml", route: "IV", freq: "1회" },
      { drug: "Salbutamol nebulizer", dose: "10mg", route: "Inh", freq: "1회" },
      { drug: "Furosemide", dose: "40mg", route: "IV", freq: "1회" },
    ],
  },
  {
    name: "급성 천식 발작",
    items: [
      { drug: "Salbutamol + Ipratropium", dose: "2.5mg + 0.5mg", route: "Neb", freq: "20분 간격 ×3" },
      { drug: "Methylprednisolone", dose: "40mg", route: "IV", freq: "1회" },
      { drug: "Magnesium sulfate", dose: "2g", route: "IV", freq: "20분 over (severe)" },
    ],
  },
  {
    name: "통증 (중등도)",
    items: [
      { drug: "Morphine", dose: "4mg", route: "IV", freq: "PRN, 4시간 간격" },
      { drug: "Acetaminophen", dose: "1g", route: "IV", freq: "6시간 간격" },
    ],
  },
];

export default function PrescriptionPage() {
  const [patient, setPatient] = useState<QueuePatient | null>(null);
  const [items, setItems] = useState<RxItem[]>([]);
  const [draftItem, setDraftItem] = useState<RxItem>({ drug: "", dose: "", route: "PO", freq: "" });

  function applyTemplate(t: typeof TEMPLATES[number]) {
    setItems([...items, ...t.items]);
  }
  function addItem() {
    if (!draftItem.drug || !draftItem.dose) {
      alert("약품명과 용량은 필수입니다.");
      return;
    }
    setItems([...items, draftItem]);
    setDraftItem({ drug: "", dose: "", route: "PO", freq: "" });
  }
  function removeItem(i: number) {
    setItems(items.filter((_, idx) => idx !== i));
  }
  function handleSubmit() {
    if (!patient) {
      alert("환자를 선택하세요.");
      return;
    }
    if (items.length === 0) {
      alert("처방 항목이 없습니다.");
      return;
    }
    alert(`${patient.name}에게 ${items.length}개 처방 전송됨\n(TODO: FHIR MedicationRequest 연동)`);
    setItems([]);
  }

  return (
    <EMRPageShell
      title="처방등록 (CPOE)"
      subtitle={patient ? `${patient.name} · #${patient.mrn}` : "환자 미선택"}
      headerRight={
        <span className="px-2 py-1 text-[10px] bg-emerald-700 text-white border border-emerald-900 font-bold tracking-widest">
          MEDICATION ORDER ENTRY
        </span>
      }
    >
      <div className="grid grid-cols-12 gap-3">
        {/* 좌측 — 환자 선택 + 템플릿 */}
        <aside className="col-span-3 space-y-3">
          <Panel title="환자 선택">
            <select
              value={patient?.id ?? ""}
              onChange={(e) => setPatient(ALL_PATIENTS.find((p) => p.id === e.target.value) ?? null)}
              className="w-full text-[12px] border border-gray-400 px-2 py-1 bg-white"
            >
              <option value="">— 선택 —</option>
              {ALL_PATIENTS.slice(0, 20).map((p) => (
                <option key={p.id} value={p.id}>
                  KTAS {p.ktas} · {p.name} (#{p.mrn})
                </option>
              ))}
            </select>
            {patient && (
              <div className="mt-2 text-[11px] text-gray-700 border-t border-gray-200 pt-2 space-y-0.5">
                <p>
                  <b>알레르기:</b>{" "}
                  <span className={patient.allergies && patient.allergies !== "NKDA" ? "text-red-700 font-bold" : ""}>
                    {patient.allergies || "NKDA"}
                  </span>
                </p>
                <p><b>과거력:</b> {patient.past_history?.join(", ") || "없음"}</p>
                <p>
                  <b>KTAS:</b>{" "}
                  <span className={`px-1 py-0 text-[10px] ${KTAS_META[patient.ktas as KTAS].bg} ${KTAS_META[patient.ktas as KTAS].text}`}>
                    {patient.ktas} · {KTAS_META[patient.ktas as KTAS].label}
                  </span>
                </p>
              </div>
            )}
          </Panel>

          <Panel title="응급실 처방 템플릿">
            <div className="space-y-1">
              {TEMPLATES.map((t) => (
                <button
                  key={t.name}
                  onClick={() => applyTemplate(t)}
                  className="w-full text-left px-2 py-1.5 text-[11px] border border-gray-300 bg-white hover:bg-blue-50 hover:border-blue-400 flex items-center justify-between"
                >
                  <span className="font-bold text-gray-900">{t.name}</span>
                  <span className="text-[10px] text-gray-500">{t.items.length}개</span>
                </button>
              ))}
            </div>
          </Panel>
        </aside>

        {/* 중앙 — 처방 작성 */}
        <section className="col-span-9 space-y-3">
          <Panel
            title="처방 항목"
            headerRight={
              <span className="text-[10px] font-mono text-gray-700 border border-gray-400 bg-white px-1.5">
                {items.length}건
              </span>
            }
          >
            <table className="w-full text-[12px] border-collapse mb-2">
              <thead>
                <tr className="border-b border-gray-300 bg-gray-100 text-gray-800">
                  <th className="text-left px-2 py-1 w-8">#</th>
                  <th className="text-left px-2 py-1">약품명</th>
                  <th className="text-left px-2 py-1 w-24">용량</th>
                  <th className="text-left px-2 py-1 w-20">투여경로</th>
                  <th className="text-left px-2 py-1 w-32">빈도</th>
                  <th className="text-left px-2 py-1 w-12"></th>
                </tr>
              </thead>
              <tbody>
                {items.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-2 py-3 text-center text-gray-500 italic">
                      처방 항목 없음 — 템플릿 선택 또는 직접 추가
                    </td>
                  </tr>
                )}
                {items.map((it, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-500">{i + 1}</td>
                    <td className="px-2 py-1 font-bold">{it.drug}</td>
                    <td className="px-2 py-1 font-mono">{it.dose}</td>
                    <td className="px-2 py-1">{it.route}</td>
                    <td className="px-2 py-1 text-gray-700">{it.freq}</td>
                    <td className="px-2 py-1">
                      <button onClick={() => removeItem(i)} className="text-red-600 hover:text-red-800">
                        <Trash2 size={12} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* 직접 추가 폼 */}
            <div className="grid grid-cols-12 gap-1 items-end pt-2 border-t border-gray-200">
              <div className="col-span-4">
                <p className="text-[10px] uppercase text-gray-600 font-bold mb-0.5">약품명</p>
                <input
                  value={draftItem.drug}
                  onChange={(e) => setDraftItem({ ...draftItem, drug: e.target.value })}
                  placeholder="예: Aspirin"
                  className="w-full border border-gray-400 px-2 py-1 text-[12px]"
                />
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase text-gray-600 font-bold mb-0.5">용량</p>
                <input
                  value={draftItem.dose}
                  onChange={(e) => setDraftItem({ ...draftItem, dose: e.target.value })}
                  placeholder="100mg"
                  className="w-full border border-gray-400 px-2 py-1 text-[12px]"
                />
              </div>
              <div className="col-span-2">
                <p className="text-[10px] uppercase text-gray-600 font-bold mb-0.5">경로</p>
                <select
                  value={draftItem.route}
                  onChange={(e) => setDraftItem({ ...draftItem, route: e.target.value })}
                  className="w-full border border-gray-400 px-2 py-1 text-[12px] bg-white"
                >
                  {["PO", "IV", "IM", "SC", "SL", "Inh", "Top"].map((r) => (
                    <option key={r}>{r}</option>
                  ))}
                </select>
              </div>
              <div className="col-span-3">
                <p className="text-[10px] uppercase text-gray-600 font-bold mb-0.5">빈도</p>
                <input
                  value={draftItem.freq}
                  onChange={(e) => setDraftItem({ ...draftItem, freq: e.target.value })}
                  placeholder="QD / Q6H / PRN"
                  className="w-full border border-gray-400 px-2 py-1 text-[12px]"
                />
              </div>
              <div className="col-span-1">
                <button
                  onClick={addItem}
                  className="w-full bg-blue-700 text-white text-[12px] py-1 hover:bg-blue-800 flex items-center justify-center gap-1"
                >
                  <Plus size={12} />
                </button>
              </div>
            </div>
          </Panel>

          <div className="flex justify-end gap-2">
            {patient?.allergies && patient.allergies !== "NKDA" && items.length > 0 && (
              <span className="flex items-center gap-1 px-2 py-1 bg-red-50 border border-red-400 text-red-700 text-[11px] font-bold">
                <AlertTriangle size={12} />
                알레르기 확인 필수: {patient.allergies}
              </span>
            )}
            <button
              onClick={() => setItems([])}
              disabled={items.length === 0}
              className="px-3 py-1.5 text-[12px] border border-gray-400 text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
            >
              초기화
            </button>
            <button
              onClick={handleSubmit}
              disabled={items.length === 0 || !patient}
              className="px-4 py-1.5 text-[12px] bg-emerald-700 text-white border border-emerald-900 hover:bg-emerald-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 font-bold"
            >
              <Send size={12} />
              처방 전송 ({items.length}건)
            </button>
          </div>
        </section>
      </div>
    </EMRPageShell>
  );
}

// 미사용 경고 회피
const _Pill = Pill;
void _Pill;
