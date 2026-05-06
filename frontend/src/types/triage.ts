// 트리아지 도메인 타입 정의
// FHIR R4 호환 (Patient + Encounter + Observation + Condition 매핑)

export type Sex = "M" | "F";
export type KTAS = 1 | 2 | 3 | 4 | 5;

export type ChiefComplaint =
  | "chest_pain"
  | "dyspnea"
  | "abdominal_pain"
  | "fever"
  | "trauma"
  | "altered_mental"
  | "syncope"
  | "headache"
  | "weakness"
  | "palpitation"
  | "back_pain"
  | "nausea_vomiting"
  | "other";

// 한글-영문 매핑 (UI 표시용)
export const CHIEF_COMPLAINT_LABELS: Record<ChiefComplaint, { ko: string; en: string }> = {
  chest_pain:      { ko: "흉통",       en: "Chest Pain" },
  dyspnea:         { ko: "호흡곤란",    en: "Dyspnea" },
  abdominal_pain:  { ko: "복통",       en: "Abdominal Pain" },
  fever:           { ko: "발열",       en: "Fever" },
  trauma:          { ko: "외상",       en: "Trauma" },
  altered_mental:  { ko: "의식저하",    en: "Altered Mental" },
  syncope:         { ko: "실신",       en: "Syncope" },
  headache:        { ko: "두통",       en: "Headache" },
  weakness:        { ko: "전신쇠약",    en: "Weakness" },
  palpitation:     { ko: "두근거림",    en: "Palpitation" },
  back_pain:       { ko: "요통",       en: "Back Pain" },
  nausea_vomiting: { ko: "오심·구토",   en: "N/V" },
  other:           { ko: "기타",       en: "Other" },
};

// KTAS 색상 코딩 (한국 응급의료센터 표준)
export const KTAS_META: Record<KTAS, { label: string; bg: string; text: string; ring: string; desc: string }> = {
  1: { label: "소생", bg: "bg-blue-600",   text: "text-white",  ring: "ring-blue-700",   desc: "즉각적 처치 필요" },
  2: { label: "긴급", bg: "bg-red-600",    text: "text-white",  ring: "ring-red-700",    desc: "10분 이내 처치" },
  3: { label: "응급", bg: "bg-amber-500",  text: "text-white",  ring: "ring-amber-600",  desc: "30분 이내 처치" },
  4: { label: "준응급", bg: "bg-emerald-600", text: "text-white", ring: "ring-emerald-700", desc: "1시간 이내" },
  5: { label: "비응급", bg: "bg-slate-500", text: "text-white",  ring: "ring-slate-600",  desc: "2시간 이내" },
};

export type PastHistoryCode =
  | "HTN"  // 고혈압
  | "DM"   // 당뇨
  | "CAD"  // 관상동맥질환
  | "CVA"  // 뇌졸중
  | "COPD" // 만성폐쇄성폐질환
  | "ASTHMA"
  | "CKD"  // 만성신부전
  | "LIVER" // 간질환
  | "CANCER"
  | "AFIB" // 심방세동
  | "ALLERGY"
  | "PREGNANT";

export const PAST_HISTORY_LABELS: Record<PastHistoryCode, string> = {
  HTN: "고혈압",
  DM: "당뇨",
  CAD: "관상동맥질환",
  CVA: "뇌졸중",
  COPD: "COPD",
  ASTHMA: "천식",
  CKD: "만성신부전",
  LIVER: "간질환",
  CANCER: "암",
  AFIB: "심방세동",
  ALLERGY: "약물알레르기",
  PREGNANT: "임신",
};

export interface Vitals {
  sbp: number | null;       // 수축기 혈압
  dbp: number | null;       // 이완기 혈압
  hr: number | null;        // 심박수
  rr: number | null;        // 호흡수
  spo2: number | null;      // 산소포화도
  bt: number | null;        // 체온 (℃)
}

export interface TriageInput {
  // 기본 정보
  name: string;
  age: number;
  sex: Sex;
  // 응급실 도착 시각 (ISO)
  arrived_at: string;

  // 임상 정보
  chief_complaint: ChiefComplaint;
  complaint_detail?: string;
  ktas: KTAS;
  vitals: Vitals;
  past_history: PastHistoryCode[];
  allergies?: string;
  medications?: string;

  // 트리아지 메타
  triaged_by?: string;
  notes?: string;
}

// 응급실 환자 동선 7단계 (NEDIS / 권역응급의료센터 표준 워크플로우)
export type EDStatus =
  | "arrived"           // 도착·접수 — 트리아지 대기 중
  | "triage"            // 트리아지 — KTAS 분류 진행 중
  | "in_consult"        // 진료중 — 의사 진료
  | "testing"           // 검사진행 — Lab/CXR/ECG 시행 중
  | "results_pending"   // 결과대기 — 검사 결과 대기
  | "admit_wait"        // 입원대기 — 병실 배정 대기
  | "discharged";       // 퇴실 — 귀가/전원

// 대기열 표시용 (Synthea 스타일 합성 데이터)
export interface QueuePatient extends TriageInput {
  id: string;            // P-{8자리}
  mrn: string;           // 의무기록번호 (Medical Record Number)
  status: EDStatus;
  encounter_id?: string;
  registered_at: string; // ISO
  bed?: string;          // ER-12 같은 베드 번호 (선택)
}
