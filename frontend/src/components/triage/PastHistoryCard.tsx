// 과거력 — 슬레이트/블루 톤
import Panel from "./Panel";
import { PAST_HISTORY_LABELS, type PastHistoryCode } from "../../types/triage";

interface Props {
  value: PastHistoryCode[];
  onToggle: (code: PastHistoryCode) => void;
  notes: string | undefined;
  onNotesChange: (n: string) => void;
}

const HISTORY_ORDER: PastHistoryCode[] = [
  "HTN", "DM", "CAD", "AFIB", "CVA",
  "COPD", "ASTHMA", "CKD", "LIVER", "CANCER",
  "ALLERGY", "PREGNANT",
];

export default function PastHistoryCard({ value, onToggle, notes, onNotesChange }: Props) {
  return (
    <Panel title="과거력 / 동반질환" hotkey="F5">
      <div className="grid grid-cols-4 gap-1.5">
        {HISTORY_ORDER.map((code) => {
          const checked = value.includes(code);
          return (
            <label
              key={code}
              className={`flex items-center gap-1.5 px-2 py-1.5 rounded-md border cursor-pointer text-[12px] transition-colors ${
                checked
                  ? "bg-gray-200 border-gray-500 text-gray-900 font-medium"
                  : "bg-white border-gray-400 text-gray-700 hover:bg-gray-100"
              }`}
            >
              <input
                type="checkbox"
                checked={checked}
                onChange={() => onToggle(code)}
                className="w-3.5 h-3.5 accent-gray-700"
              />
              <span className="font-mono text-[10px] text-gray-500">{code}</span>
              <span>{PAST_HISTORY_LABELS[code]}</span>
            </label>
          );
        })}
      </div>

      <div className="mt-3">
        <label className="text-[11px] text-gray-600 font-medium">기타 / 메모</label>
        <input
          className="w-full mt-1 px-2.5 py-1.5 border border-gray-400 rounded-md text-[13px] focus:outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-500/20"
          value={notes ?? ""}
          onChange={(e) => onNotesChange(e.target.value)}
          placeholder="기타 과거력, 가족력, 사회력 등"
        />
      </div>
    </Panel>
  );
}
