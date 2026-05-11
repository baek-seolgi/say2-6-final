// MIMIC 데이터 조회 API 클라이언트
// 1순위: 로컬 백엔드 → 진짜 S3 Select 호출
// 2순위: 백엔드 없을 때 fallback — 미리 awscli로 가져온 실제 MIMIC 데이터 캐시

import type { PastHistoryCode } from "../types/triage";

const API_BASE = "";

export interface MimicCondition {
  history_code: PastHistoryCode;
  icd_code: string;
  icd_version: number;
  hadm_id: string;
}

export interface MimicAllergy {
  icd_code: string;
  icd_version: number;
  description: string;
  hadm_id: string;
  display_text: string;
}

export interface MimicConditionsResponse {
  subject_id: string;
  history_codes: PastHistoryCode[];
  raw_icd: MimicCondition[];
  mimic_allergies: MimicAllergy[];
  allergy_text: string;
  total: number;
  source?: "backend" | "fallback";   // 데이터 출처 표시
}

// ──────────────────────────────────────────────────────────
// Fallback 데이터: 실제 S3 (s3://say1-pre-project-2/mimic-iv/hosp/diagnoses_icd.csv.gz)
// 에서 awscli로 미리 가져온 4 시연 환자의 진짜 MIMIC 데이터.
// 백엔드 안 띄웠을 때만 사용.
// ──────────────────────────────────────────────────────────
const MIMIC_FALLBACK: Record<string, MimicConditionsResponse> = {
  // Case 1 — 19041043 (30M, NEW Afib)
  "19041043": {
    subject_id: "19041043",
    history_codes: ["AFIB"],
    raw_icd: [
      { history_code: "AFIB", icd_code: "42731", icd_version: 9, hadm_id: "23720029" },
    ],
    mimic_allergies: [],
    allergy_text: "NKDA",
    total: 12,
    source: "fallback",
  },

  // Case 2 — 13715870 (73M, ADHF + 다중 기저질환)
  "13715870": {
    subject_id: "13715870",
    history_codes: ["HTN", "DM", "CAD", "AFIB", "CVA", "CKD", "CANCER"],
    raw_icd: [
      { history_code: "HTN",    icd_code: "4019",  icd_version: 9,  hadm_id: "20728952" },
      { history_code: "HTN",    icd_code: "40390", icd_version: 9,  hadm_id: "20728952" },
      { history_code: "HTN",    icd_code: "I110",  icd_version: 10, hadm_id: "20728952" },
      { history_code: "CAD",    icd_code: "412",   icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CAD",    icd_code: "41400", icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CAD",    icd_code: "41401", icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CAD",    icd_code: "I2510", icd_version: 10, hadm_id: "20728952" },
      { history_code: "AFIB",   icd_code: "42731", icd_version: 9,  hadm_id: "20728952" },
      { history_code: "AFIB",   icd_code: "I4891", icd_version: 10, hadm_id: "20728952" },
      { history_code: "CVA",    icd_code: "431",   icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CVA",    icd_code: "4387",  icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CKD",    icd_code: "5853",  icd_version: 9,  hadm_id: "20728952" },
      { history_code: "CANCER", icd_code: "185",   icd_version: 9,  hadm_id: "20728952" },
    ],
    mimic_allergies: [],
    allergy_text: "NKDA",
    total: 84,
    source: "fallback",
  },

  // Case 3 — 15638163 (34M, ESRD + Hyperkalemia)
  "15638163": {
    subject_id: "15638163",
    history_codes: ["HTN", "CKD"],
    raw_icd: [
      { history_code: "HTN", icd_code: "40391", icd_version: 9, hadm_id: "20553806" },
      { history_code: "CKD", icd_code: "5856",  icd_version: 9, hadm_id: "20553806" },
      { history_code: "CKD", icd_code: "V4511", icd_version: 9, hadm_id: "20553806" },
    ],
    mimic_allergies: [],
    allergy_text: "NKDA",
    total: 57,
    source: "fallback",
  },

  // Case 4 — 18230098 (86F, NSTEMI + ADHF + ESRD)
  "18230098": {
    subject_id: "18230098",
    history_codes: ["HTN", "DM", "CAD", "AFIB", "CVA", "CKD"],
    raw_icd: [
      { history_code: "DM",   icd_code: "25080", icd_version: 9, hadm_id: "20031628" },
      { history_code: "HTN",  icd_code: "40391", icd_version: 9, hadm_id: "20183444" },
      { history_code: "CKD",  icd_code: "5856",  icd_version: 9, hadm_id: "20183444" },
      { history_code: "CKD",  icd_code: "V4511", icd_version: 9, hadm_id: "20183444" },
      { history_code: "CAD",  icd_code: "41401", icd_version: 9, hadm_id: "20183444" },
      { history_code: "AFIB", icd_code: "42731", icd_version: 9, hadm_id: "20183444" },
      { history_code: "CVA",  icd_code: "431",   icd_version: 9, hadm_id: "20183444" },
    ],
    mimic_allergies: [
      {
        icd_code: "V1508",
        icd_version: 9,
        description: "기타 약물 알레르기 history",
        hadm_id: "20183444",
        display_text: "기타 약물 알레르기 history (V1508)",
      },
    ],
    allergy_text: "기타 약물 알레르기 history",
    total: 41,
    source: "fallback",
  },
};

/**
 * MIMIC 환자 진단 + 알레르기 자동 조회.
 *
 * 1순위: 백엔드 (/mimic/conditions/{subject_id}) → 실제 S3 Select
 * 2순위: 백엔드 호출 실패 시 fallback (위 캐시 데이터, 진짜 MIMIC 기반)
 *
 * @param subject_id MIMIC subject_id (= 차트번호)
 * @param signal AbortSignal — 조회 중 다른 환자 클릭 시 취소
 */
export async function fetchMimicConditions(
  subject_id: string,
  signal?: AbortSignal,
): Promise<MimicConditionsResponse> {
  // 1) 백엔드 호출 시도 (timeout 4초)
  try {
    const ac = new AbortController();
    const timeoutId = setTimeout(() => ac.abort(), 4000);
    const combinedSignal = signal ?? ac.signal;

    const res = await fetch(`${API_BASE}/mimic/conditions/${subject_id}`, {
      signal: combinedSignal,
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeoutId);

    if (res.ok) {
      const data = await res.json();
      // JSON 응답이 아닌 HTML(Vite SPA fallback)이면 throw
      if (typeof data !== "object" || !data.subject_id) {
        throw new Error("백엔드 응답이 JSON이 아님 (SPA fallback?)");
      }
      return { ...data, source: "backend" };
    }
    throw new Error(`HTTP ${res.status}`);
  } catch (e: unknown) {
    if (e instanceof Error && e.name === "AbortError") throw e;

    // 2) Fallback — 미리 캐시된 진짜 MIMIC 데이터
    const cached = MIMIC_FALLBACK[subject_id];
    if (cached) {
      console.info(
        `[MIMIC] 백엔드 미연결 → fallback 사용 (subject=${subject_id}). ` +
        `데이터 출처: 미리 awscli로 가져온 실제 MIMIC diagnoses_icd.csv.gz`
      );
      return cached;
    }

    // 시연 환자 아니면 그냥 빈 결과
    return {
      subject_id,
      history_codes: [],
      raw_icd: [],
      mimic_allergies: [],
      allergy_text: "NKDA",
      total: 0,
      source: "fallback",
    };
  }
}
