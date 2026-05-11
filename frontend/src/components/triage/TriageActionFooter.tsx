// 트리아지 액션 푸터 — 슬레이트/블루 톤
import { Save, Sparkles, RotateCcw } from "lucide-react";

interface Props {
  canSubmit: boolean;
  submitting?: boolean;
  onReset: () => void;
  onSave: () => void;
  onSubmit: () => void;
}

export default function TriageActionFooter({ canSubmit, submitting = false, onReset, onSave, onSubmit }: Props) {
  return (
    <footer className="border-t border-gray-400 bg-white px-3 py-2 flex items-center justify-between">
      <div className="flex items-center gap-1 text-[10px] text-gray-500">
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-400 rounded font-mono">F1</span>
        <span>환자정보</span>
        <span className="mx-0.5">·</span>
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-400 rounded font-mono">F2</span>
        <span>활력징후</span>
        <span className="mx-0.5">·</span>
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-400 rounded font-mono">F3</span>
        <span>주증상</span>
        <span className="mx-0.5">·</span>
        <span className="px-1.5 py-0.5 bg-gray-100 border border-gray-400 rounded font-mono">Ctrl+Enter</span>
        <span>AI 분석</span>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onReset}
          className="px-3 py-1.5 text-[12px] border border-gray-400 rounded-md bg-white text-gray-600 hover:bg-gray-100 flex items-center gap-1.5 transition-colors"
        >
          <RotateCcw size={12} /> 초기화
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={!canSubmit}
          className="px-3 py-1.5 text-[12px] border border-gray-400 rounded-md bg-gray-200 text-gray-700 hover:bg-gray-300 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5 transition-colors"
        >
          <Save size={12} /> 저장
        </button>
        <button
          type="button"
          onClick={onSubmit}
          disabled={!canSubmit || submitting}
          className="px-4 py-1.5 text-[12px] font-bold border border-gray-800 bg-gray-700 text-white hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed rounded-md flex items-center gap-1.5 shadow-sm transition-colors"
        >
          <Sparkles size={13} className={submitting ? "animate-spin" : ""} />
          {submitting ? "AI 분석 시작 중..." : "AI 분석 시작"}
          {!submitting && (
            <span className="ml-1 text-[10px] font-mono opacity-80">[Ctrl+Enter]</span>
          )}
        </button>
      </div>
    </footer>
  );
}
