// 환자 기본 정보 — 슬레이트/블루 톤
import { User, IdCard, Calendar } from "lucide-react";
import Panel from "./Panel";
import type { Sex, TriageInput } from "../../types/triage";

interface Props {
  value: Partial<TriageInput> & { mrn?: string };
  onChange: (patch: Partial<TriageInput> & { mrn?: string }) => void;
}

const inputBase =
  "px-2.5 py-1.5 border border-gray-400 rounded-md bg-white text-[13px] text-gray-900 " +
  "focus:outline-none focus:border-gray-700 focus:ring-2 focus:ring-gray-500/20 transition-colors";

function Field({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center gap-1 text-[11px] font-medium text-gray-600">
        {icon}
        {label}
      </label>
      {children}
    </div>
  );
}

export default function PatientInfoCard({ value, onChange }: Props) {
  return (
    <Panel title="환자 기본 정보" hotkey="F1">
      <div className="grid grid-cols-2 gap-3">
        <Field label="MRN" icon={<IdCard size={12} />}>
          <input
            className={`${inputBase} font-mono bg-gray-100 text-gray-500`}
            value={value.mrn ?? ""}
            onChange={(e) => onChange({ mrn: e.target.value })}
            placeholder="자동 생성"
            readOnly
          />
        </Field>

        <Field label="도착시각" icon={<Calendar size={12} />}>
          <input
            type="datetime-local"
            className={`${inputBase} font-mono bg-amber-50/50`}
            value={value.arrived_at?.slice(0, 16) ?? ""}
            onChange={(e) => onChange({ arrived_at: e.target.value })}
          />
        </Field>

        <Field label="이름" icon={<User size={12} />}>
          <input
            className={`${inputBase} font-bold text-[14px]`}
            value={value.name ?? ""}
            onChange={(e) => onChange({ name: e.target.value })}
            placeholder="환자 성명"
            autoFocus
          />
        </Field>

        <div className="grid grid-cols-2 gap-3">
          <Field label="나이">
            <input
              type="number"
              min={0}
              max={120}
              className={`${inputBase} text-center font-mono`}
              value={value.age ?? ""}
              onChange={(e) => onChange({ age: Number(e.target.value) })}
            />
          </Field>
          <Field label="성별">
            <div className="grid grid-cols-2 gap-1">
              {(["M", "F"] as Sex[]).map((s) => {
                const active = value.sex === s;
                return (
                  <button
                    key={s}
                    type="button"
                    onClick={() => onChange({ sex: s })}
                    className={`py-1.5 rounded-md text-[12px] font-medium transition-colors ${
                      active
                        ? s === "M"
                          ? "bg-gray-700 text-white"
                          : "bg-blue-900 text-white"
                        : "bg-gray-200 text-gray-600 hover:bg-gray-300"
                    }`}
                  >
                    {s === "M" ? "남" : "여"}
                  </button>
                );
              })}
            </div>
          </Field>
        </div>

        <div className="col-span-2">
          <Field label="복용약물">
            <input
              className={inputBase}
              value={value.medications ?? ""}
              onChange={(e) => onChange({ medications: e.target.value })}
              placeholder="예: Aspirin, Metformin, Amlodipine"
            />
          </Field>
        </div>

        <div className="col-span-2">
          <Field label="알레르기 (Allergy)">
            <input
              className={`${inputBase} border-gray-400 focus:border-gray-700 focus:ring-gray-500/20`}
              value={value.allergies ?? ""}
              onChange={(e) => onChange({ allergies: e.target.value })}
              placeholder="알레르기 약물·식품 (없으면 NKDA)"
            />
          </Field>
        </div>
      </div>
    </Panel>
  );
}
