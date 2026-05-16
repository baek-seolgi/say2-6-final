// say-6 — AI 종합 소견서 A4 인쇄 시트
// 화면에선 숨김(hidden), 인쇄 시에만 표시(print:block). @media print 로 A4 출력.

import type { DemoPatient } from "../../lib/v2/demoStore";
import type { AIRecommendation } from "./AIRecommendationPanel";
import { fmtDate, icdHint } from "./ReportDocument";

interface Props {
  patient: DemoPatient;
  recommendation?: AIRecommendation;
  narrative: string;                        // 향후 치료 의견 본문
  status: "preliminary" | "reviewed" | "signed" | "amended";
  signature: string;
  // screen=true: 뷰어 페이지에서 화면 표시 + 인쇄 모두 가능 (서명 완료된 소견서 보기 라우트)
  // screen=false(기본): @media print에서만 노출되는 인쇄 전용 시트
  screen?: boolean;
}

export function ReportPrintSheet({ patient, recommendation, narrative, status, signature, screen }: Props) {
  const chartNo = patient.mimic?.subject_id ?? patient.mrn ?? patient.id;
  const birthYear = new Date().getFullYear() - patient.age;
  const sexLabel = patient.sex === "M" ? "남" : "여";
  const rrn = `${String(birthYear).slice(2)}****-*******`;
  const dx = recommendation?.diagnosis ?? "AI 종합 소견 생성 대기";
  const icd = icdHint(recommendation?.diagnosis);
  const today = fmtDate(new Date().toISOString());
  const arrived = fmtDate(patient.arrivedAt);
  const risk = (recommendation?.risk ?? patient.aiVerdict?.risk ?? "—").toString().toUpperCase();
  const ragCount = recommendation?.similarCases.length ?? 0;
  const doctorName =
    status === "signed" ? (signature.trim() || "정OO") :
    status === "reviewed" ? (signature.trim() || "검토 중") : "—";

  return (
    <div
      id="report-print-sheet"
      className={
        screen
          ? "block bg-white text-black px-8 py-8 mx-auto shadow-lg"
          : "hidden print:block bg-white text-black px-2"
      }
      style={screen ? { width: "210mm", minHeight: "297mm" } : undefined}
    >
      {/* 제목 */}
      <div className="pt-1 pb-2">
        <h1 className="text-center text-[30px] font-bold tracking-[0.5em] leading-none">소 견 서</h1>
        <div className="text-right text-[12px] text-red-600 font-bold mt-1">[ 원본대조필인 (印) ]</div>
      </div>

      {/* 본문 표 */}
      <table className="w-full border-collapse text-[13px]" style={{ border: "2px solid #000" }}>
        <colgroup>
          <col style={{ width: "120px" }} />
          <col />
          <col style={{ width: "120px" }} />
          <col />
        </colgroup>
        <tbody>
          <tr>
            <Th>차트번호</Th>
            <Td>{chartNo}</Td>
            <Th>주민등록번호</Th>
            <Td>{rrn}</Td>
          </tr>
          <tr>
            <Th>환자 성명</Th>
            <Td>{patient.name}</Td>
            <Th>성별 / 연령</Th>
            <Td>{sexLabel} · 만 {patient.age}세</Td>
          </tr>
          <tr>
            <Th>주 소</Th>
            <Td colSpan={3}>응급실 내원 · 주소 비공개 (개인정보)</Td>
          </tr>
          <tr>
            <Th>병 명</Th>
            <Td>
              <span className="font-bold">{dx}</span>
            </Td>
            <Th>질병분류기호</Th>
            <Td className="font-bold">{icd}</Td>
          </tr>
          <tr>
            <Th>발병일</Th>
            <Td>{arrived}</Td>
            <Th>초진일</Th>
            <Td>{arrived}</Td>
          </tr>
          <tr>
            <Th>향후 치료 의견</Th>
            <Td colSpan={3}>
              <div className="whitespace-pre-wrap leading-relaxed py-1">{narrative}</div>
            </Td>
          </tr>
          <tr>
            <Th>비 고</Th>
            <Td colSpan={3}>
              Risk: {risk} · AI 보조 분석 적용 · RAG 유사사례 {ragCount}건 참조
            </Td>
          </tr>
          <tr>
            <Th>용 도</Th>
            <Td colSpan={3}>진료 참고용 (응급실 초기 평가)</Td>
          </tr>
        </tbody>
      </table>

      {/* 소견함 */}
      <div className="text-center text-[18px] font-bold tracking-[0.5em] py-5">
        위 와 같 이 소 견 함
      </div>

      {/* 발행 */}
      <div className="flex items-end justify-between text-[13px] px-1">
        <div>
          발 행 일 &nbsp;&nbsp;<span className="font-bold">{today}</span>
          <div className="text-[10px] text-gray-500 mt-1">say-6 · 응급실 멀티모달 AI 진단 보조 시스템</div>
        </div>
        <div className="flex items-center gap-2">
          의사 성명 &nbsp;<span className="font-bold">{doctorName}</span>
          <span className="text-red-600 font-bold text-[14px]">(印)</span>
        </div>
      </div>

      <div className="text-[9px] text-gray-400 mt-6 border-t border-gray-300 pt-1">
        ※ 본 소견서의 AI 분석 결과는 진단 보조 자료이며, 최종 진단 및 치료 결정은 담당 전문의의 임상 판단과 책임 하에 이루어집니다.
      </div>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th
      className="bg-gray-100 font-bold text-center px-2 py-2 align-middle"
      style={{ border: "1px solid #000" }}
    >
      {children}
    </th>
  );
}

function Td({ children, colSpan, className }: { children: React.ReactNode; colSpan?: number; className?: string }) {
  return (
    <td
      colSpan={colSpan}
      className={`px-3 py-2 align-top ${className ?? ""}`}
      style={{ border: "1px solid #000" }}
    >
      {children}
    </td>
  );
}
