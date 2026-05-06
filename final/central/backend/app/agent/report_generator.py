"""
종합 진단 소견서 생성기 (Bedrock Claude + RAG 기반).

[이 파일이 하는 일]
운영 DB에 저장된 환자 컨텍스트(주호소/과거력/바이탈) + 4개 모달 원본 추론 결과를 읽어
Bedrock Claude에 투입하고, 구조화된 종합 소견서를 생성한다.

⭐ RAG 통합:
   - MIMIC 49,743건 노트(퇴원요약+영상보고서)에서 유사 환자 사례 검색
   - 검색된 사례를 Claude 프롬프트에 컨텍스트로 추가
   - "교과서 지식 + 유사 임상 사례" 기반 답변 생성

[호출 흐름]
POST /reports/{encounter_id}/generate
  → generate_integrated_report(encounter_id)
     ├─ 1. 운영 DB에서 환자 컨텍스트 조회 (ops_encounters)
     ├─ 2. 운영 DB에서 모달 원본 조회 (ops_modal_results: ECG/CXR/LAB)
     ├─ 3. RAG 검색 — 영문 query → ChromaDB → 유사 사례 3건            ⭐
     ├─ 4. Bedrock 프롬프트 구성 (모달 원본 + RAG 사례)               ⭐
     ├─ 5. Claude 호출
     └─ 6. 파싱 후 { diagnosis, risk_level, recommendations, similar_cases } 반환

[주의]
AI가 생성한 preliminary 소견서. 의사가 서명해야 final 상태로 전이 → EMR 연동.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.agent.bedrock_client import invoke_claude
from app.agent.rag import Retriever, FALLBACK_RESPONSE
from app.db import encounters as ops_encounters
from app.db import modal_results as ops_modal_results

logger = logging.getLogger(__name__)

# Retriever는 ChromaDB+Bedrock 자원이라 모듈 단에서 1회 초기화 (lazy).
_retriever: Retriever | None = None


def _get_retriever() -> Retriever | None:
    """Lazy 초기화. ChromaDB 누락/Bedrock 권한 부재 시 None 반환 (RAG skip)."""
    global _retriever
    if _retriever is None:
        try:
            _retriever = Retriever()
        except Exception as e:
            logger.warning("[rag] Retriever 초기화 실패 — RAG 없이 진행: %s", e)
            _retriever = None  # 명시적으로 None 유지
            return None
    return _retriever


def _build_rag_query(encounter: dict[str, Any], modal_results: dict[str, Any]) -> str:
    """
    환자 정보 + 모달 결과 → RAG 검색용 영문 query.
    MIMIC 노트가 영문이라 영문화가 검색 정합성에 유리.
    """
    age = encounter.get("patient_age", "?")
    sex = encounter.get("patient_gender", "?")
    cc = encounter.get("chief_complaint", "")

    parts = [f"{age}yo {sex} patient with chief complaint: {cc}."]

    ecg = modal_results.get("ECG") or {}
    if ecg.get("summary"):
        parts.append(f"ECG: {ecg.get('summary', '')[:200]}")

    cxr = modal_results.get("CXR") or {}
    if cxr.get("impression") or cxr.get("summary"):
        parts.append(f"CXR: {(cxr.get('impression') or cxr.get('summary') or '')[:300]}")

    lab = modal_results.get("LAB") or {}
    if lab.get("summary"):
        parts.append(f"LAB: {lab.get('summary', '')[:200]}")

    return " ".join(parts)


SYSTEM_PROMPT = """당신은 응급실 주치의를 보조하는 의료 AI입니다.
3개 모달(ECG/CXR/혈액검사) AI 추론 결과와 환자 컨텍스트를 종합하여
임상적으로 정확하고 실행 가능한 진단 소견서를 작성합니다.

반드시 다음 JSON 형식으로만 응답하세요:
{
  "diagnosis": "주 진단 (한글, 1~3문장)",
  "risk_level": "critical" | "urgent" | "routine",
  "differential_diagnosis": ["감별진단 1", "감별진단 2", ...],
  "recommendations": [
    {"action": "권고 조치 1", "priority": 1, "rationale": "근거"},
    ...
  ],
  "clinical_reasoning": "종합 판단 근거 (한글, 3~5문장)"
}

원칙:
- AI 추론 결과의 신뢰도를 절대적으로 믿지 말고 교차 검증하세요.
- Critical 수치(K+>6.5, Troponin 상승, ST elevation 등)는 즉각 조치를 권고하세요.
- 미측정 검사는 "의사 판단으로 추가 검사 고려" 형태로 표현하세요.
- 환자 과거력(history)을 반드시 임상 판단에 반영하세요.
- 최종 결정은 의사가 내림을 전제로 "초안"임을 고려한 신중한 표현을 쓰세요.
"""


def _format_similar_cases(similar_cases: list[dict]) -> str:
    """RAG 검색 결과를 Claude 프롬프트용 텍스트로 변환."""
    if not similar_cases:
        return "(유사 사례를 찾지 못함 — 일반 임상 지식만으로 판단)"
    parts = []
    for i, r in enumerate(similar_cases, 1):
        meta = r.get("metadata", {})
        chunk_type = meta.get("chunk_type", "unknown")
        hadm_id = meta.get("hadm_id", "?")
        sim = r.get("similarity", 0)
        doc = r.get("document", "")
        parts.append(
            f"[사례 {i}] (유형: {chunk_type}, hadm_id: {hadm_id}, 유사도: {sim:.3f})\n{doc}"
        )
    return "\n\n".join(parts)


def _build_user_prompt(
    encounter: dict[str, Any],
    modal_results: dict[str, Any],
    similar_cases: list[dict] | None = None,
) -> str:
    """Bedrock 사용자 프롬프트 구성."""
    meta = encounter.get("metadata") or {}
    if isinstance(meta, str):
        meta = json.loads(meta)

    # 환자 컨텍스트
    patient_ctx = {
        "age": encounter.get("patient_age"),
        "gender": encounter.get("patient_gender"),
        "chief_complaint": encounter.get("chief_complaint"),
        "past_history": meta.get("past_history", []),
        "vitals": meta.get("vitals", {}),
        "onset_minutes_ago": meta.get("onset_minutes_ago"),
    }

    rag_block = _format_similar_cases(similar_cases or [])

    return f"""[환자 컨텍스트]
{json.dumps(patient_ctx, indent=2, ensure_ascii=False)}

[ECG 모달 분석 결과 — 원본]
{json.dumps(modal_results.get("ECG", {"status": "not_performed"}), indent=2, ensure_ascii=False)}

[CXR 모달 분석 결과 — 원본]
{json.dumps(modal_results.get("CXR", {"status": "not_performed"}), indent=2, ensure_ascii=False)}

[Lab 모달 분석 결과 — 원본 (현재 + 6시간 후 예측 prognosis_6h 포함 가능)]
{json.dumps(modal_results.get("LAB", {"status": "not_performed"}), indent=2, ensure_ascii=False)}

[과거 유사 환자 사례 — MIMIC RAG 검색 결과]
{rag_block}

위 환자 컨텍스트, 모달 결과, 그리고 과거 유사 환자 사례를 종합하여
JSON 형식 진단 소견서를 작성하세요.
- 유사 사례에서 임상적으로 도움이 되는 패턴(처치, 예후 등)이 있다면 clinical_reasoning에 반영하세요.
- 유사도가 낮거나 사례가 없으면 일반 임상 지식만으로 판단하세요.
"""


def _parse_claude_response(text: str) -> dict[str, Any]:
    """Claude 응답에서 JSON 블록 추출 및 파싱."""
    # ```json ... ``` 블록 제거
    t = text.strip()
    if t.startswith("```"):
        first_nl = t.find("\n")
        if first_nl > 0:
            t = t[first_nl + 1:]
        if t.endswith("```"):
            t = t[:-3]
        t = t.strip()

    try:
        data = json.loads(t)
    except json.JSONDecodeError:
        # JSON 추출 실패 시 { ... } 블록만 스캔
        start = t.find("{")
        end = t.rfind("}")
        if start >= 0 and end > start:
            data = json.loads(t[start:end + 1])
        else:
            raise ValueError(f"Claude 응답을 JSON으로 파싱 실패: {text[:200]}")

    # 필수 필드 기본값 보정
    return {
        "diagnosis": data.get("diagnosis", ""),
        "risk_level": data.get("risk_level", "routine"),
        "differential_diagnosis": data.get("differential_diagnosis", []),
        "recommendations": data.get("recommendations", []),
        "clinical_reasoning": data.get("clinical_reasoning", ""),
    }


async def generate_integrated_report(encounter_id: str) -> dict[str, Any]:
    """
    운영 DB에서 환자 컨텍스트 + 3개 모달 원본을 읽고 Bedrock으로 종합 소견서 생성.

    Returns:
        {
          "diagnosis": str,
          "risk_level": "critical" | "urgent" | "routine",
          "differential_diagnosis": list[str],
          "recommendations": list[dict],
          "clinical_reasoning": str,
          "modal_results": dict,   # 참고용: Bedrock에 투입된 모달 원본
          "patient_context": dict, # 참고용: 환자 컨텍스트
        }
    """
    # 1. 환자 컨텍스트 조회
    encounter = await ops_encounters.get_encounter(encounter_id)
    if encounter is None:
        raise ValueError(f"Encounter not found in ops DB: {encounter_id}")

    # 2. 모달 원본 조회 (ECG/CXR/LAB)
    modal_results = await ops_modal_results.get_all_modal_results(encounter_id)

    # 3. RAG 검색 — 영문 query → ChromaDB → 유사 사례 3건
    similar_cases: list[dict] = []
    rag = _get_retriever()
    if rag is not None:
        try:
            rag_query = _build_rag_query(encounter, modal_results)
            search = rag.search(rag_query)
            if not search.get("fallback"):
                similar_cases = search.get("results", [])
            logger.info(
                "[rag] enc=%s query=%r → cases=%d",
                encounter_id, rag_query[:120], len(similar_cases),
            )
        except Exception as e:
            logger.warning("[rag] 검색 실패 (RAG 없이 진행): %s", e)

    # 4. Bedrock 프롬프트 구성 (모달 + RAG 사례 포함)
    user_prompt = _build_user_prompt(encounter, modal_results, similar_cases)

    logger.info(
        "[report_generator] Bedrock invoke (enc=%s, modals=%s, rag_cases=%d)",
        encounter_id, list(modal_results.keys()), len(similar_cases),
    )

    # 5. Claude 호출
    raw_text = invoke_claude(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=4096,   # Sonnet 4.6 같은 모델은 자세히 답하므로 여유 있게
        temperature=0.3,
    )

    # 6. 파싱
    parsed = _parse_claude_response(raw_text)

    # 참고용 데이터 포함 반환 (API 레이어에서 필요 시 제외 가능)
    parsed["_modal_results"] = modal_results
    parsed["_patient_context"] = {
        "age": encounter.get("patient_age"),
        "gender": encounter.get("patient_gender"),
        "chief_complaint": encounter.get("chief_complaint"),
    }
    parsed["similar_cases"] = [
        {
            "chunk_type": (c.get("metadata") or {}).get("chunk_type"),
            "hadm_id": (c.get("metadata") or {}).get("hadm_id"),
            "similarity": c.get("similarity"),
            "snippet": (c.get("document") or "")[:300],
        }
        for c in similar_cases
    ]
    return parsed
