// 주증상 — 슬레이트/블루 톤
import Panel from "./Panel";
import { CHIEF_COMPLAINT_LABELS, type ChiefComplaint } from "../../types/triage";

interface Props {
  value: ChiefComplaint | undefined;
  detail: string | undefined;
  onChange: (cc: ChiefComplaint) => void;
  onDetailChange: (d: string) => void;
}

const COMPLAINT_ORDER: ChiefComplaint[] = [
  "chest_pain", "dyspnea", "abdominal_pain", "fever", "trauma",
  "altered_mental", "syncope", "headache", "weakness", "palpitation",
  "back_pain", "nausea_vomiting", "other",
];

const COMPLAINT_DANGER: Record<ChiefComplaint, "high" | "mid" | "low"> = {
  chest_pain: "high", dyspnea: "high", altered_mental: "high",
  syncope: "high", trauma: "high", headache: "high",
  abdominal_pain: "mid", fever: "mid", weakness: "mid",
  palpitation: "mid", back_pain: "mid", nausea_vomiting: "mid",
  other: "low",
};

export default function ChiefComplaintCard({ value, detail, onChange, onDetailChange }: Props) {
  return (
    <Panel title="주증상 (Chief Complaint)" hotkey="F3">
      <div className="flex flex-wrap gap-1.5 mb-3">
        {COMPLAINT_ORDER.map((cc) => {
          const meta = CHIEF_COMPLAINT_LABELS[cc];
          const danger = COMPLAINT_DANGER[cc];
          const selected = value === cc;
          return (
            <button
              key={cc}
              type="button"
              onClick={() => onChange(cc)}
              className={`px-2.5 py-1 rounded-md text-[12px] border transition-colors ${
                selected
                  ? danger === "high"
                    ? "bg-red-600 text-white border-red-600"
                    : danger === "mid"
                    ? "bg-amber-500 text-white border-amber-500"
                    : "bg-gray-700 text-white border-gray-700"
                  : `bg-white text-gray-700 border-gray-400 hover:bg-gray-100 ${
                      danger === "high" ? "border-l-2 border-l-red-500" :
                      danger === "mid"  ? "border-l-2 border-l-amber-500" : ""
                    }`
              }`}
            >
              <span className="font-medium">{meta.ko}</span>
              <span className="ml-1 text-[10px] font-mono opacity-70">{meta.en}</span>
            </button>
          );
        })}
      </div>

      <div>
        <label className="text-[11px] text-gray-600 font-medium">상세 기술 (HPI)</label>
        <textarea
          rows={2}
          value={detail ?? ""}
          onChange={(e) => onDetailChange(e.target.value)}
          className="w-full mt-1 px-2.5 py-1.5 border border-gray-400 rounded-md font-mono text-[13px] leading-tight resize-none focus:outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-500/20"
          placeholder="예: 30분 전 시작된 좌측 흉통, 좌측 어깨로 방사. 식은땀 동반."
        />
      </div>
    </Panel>
  );
}
