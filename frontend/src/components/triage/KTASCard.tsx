// KTAS 5단계 — 한국 응급의료센터 표준 색상 (블루/빨강/주황/초록/회색)
import Panel from "./Panel";
import { KTAS_META, type KTAS } from "../../types/triage";

interface Props {
  value: KTAS | undefined;
  onChange: (k: KTAS) => void;
}

const KTAS_LIST: KTAS[] = [1, 2, 3, 4, 5];

export default function KTASCard({ value, onChange }: Props) {
  return (
    <Panel title="KTAS 중증도" hotkey="F4">
      <div className="grid grid-cols-5 gap-1.5">
        {KTAS_LIST.map((k) => {
          const meta = KTAS_META[k];
          const selected = value === k;
          return (
            <button
              key={k}
              type="button"
              onClick={() => onChange(k)}
              className={`flex flex-col items-center py-2.5 rounded-md border transition-all ${
                selected
                  ? `${meta.bg} ${meta.text} border-transparent shadow-sm`
                  : "bg-white text-gray-500 border-gray-400 hover:bg-gray-100"
              }`}
            >
              <span className={`text-2xl font-bold ${selected ? "" : "text-gray-400"}`}>{k}</span>
              <span className={`text-[11px] font-bold ${selected ? "" : "text-gray-700"}`}>{meta.label}</span>
              <span className={`text-[9px] mt-0.5 ${selected ? "opacity-90" : "text-gray-500"}`}>{meta.desc}</span>
            </button>
          );
        })}
      </div>
    </Panel>
  );
}
