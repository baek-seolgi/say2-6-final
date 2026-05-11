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


# ── 모델 라우팅 — 케이스 난이도에 따라 Haiku(기본) / Sonnet(고난도) 자동 선택 ──
import os

# Global inference profile (ap-northeast-2 region 호환)
# - Haiku 4.5: 가장 저렴·빠른 최신 모델 (일반 케이스)
# - Sonnet 4.6: 한국어 의학 reasoning 강함 (고난도 케이스)
LLM_MODEL_HAIKU = os.getenv("RAG_LLM_HAIKU", "global.anthropic.claude-haiku-4-5-20251001-v1:0")
LLM_MODEL_SONNET = os.getenv("RAG_LLM_SONNET", "global.anthropic.claude-sonnet-4-6")
LLM_MAX_TOKENS = int(os.getenv("RAG_LLM_MAX_TOKENS", "2048"))

# safety-critical 키워드 — 등장하면 Sonnet으로 자동 승격
CRITICAL_KEYWORDS = [
    "cardiac arrest", "sepsis", "shock", "intubation", "code blue",
    "massive", "emergent", "critical", "unstable", "arrest",
    "hyperkalemia", "stemi", "nstemi", "stroke", "tamponade",
    "심정지", "패혈증", "쇼크", "삽관", "고칼륨혈증", "심근경색",
]


def select_model(similar_cases: list[dict], query: str) -> str:
    """
    케이스 난이도에 따라 Haiku(기본) 또는 Sonnet(고난도) 선택.

    Sonnet 사용 조건 (하나라도 해당):
    1) critical 키워드 (심정지/쇼크/심근경색/고칼륨혈증/패혈증 등)
    2) 멀티모달 종합 (discharge_summary + radiology RAG 사례 모두 보유)
    3) 검색 유사도 낮음 (top-1 < 0.35) — 흔치 않은 케이스
    """
    # 조건 1: critical 키워드
    all_text = (query or "").lower()
    for r in (similar_cases or [])[:3]:
        all_text += " " + (r.get("document") or "").lower()[:500]
    if any(kw in all_text for kw in CRITICAL_KEYWORDS):
        return LLM_MODEL_SONNET

    # 조건 2: 멀티모달 종합 사례
    chunk_types = {
        (r.get("metadata") or {}).get("chunk_type") for r in (similar_cases or [])
    }
    if "discharge_summary" in chunk_types and "radiology" in chunk_types:
        return LLM_MODEL_SONNET

    # 조건 3: 유사도 낮음
    if similar_cases and similar_cases[0].get("similarity", 1.0) < 0.35:
        return LLM_MODEL_SONNET

    return LLM_MODEL_HAIKU


# ── CoT 4단계 SYSTEM_PROMPT (Evidence-based 추론 + 과잉 진단 방지) ──
SYSTEM_PROMPT = (
    "당신은 철저하게 증거 기반(Evidence-based)으로 사고하는 대학병원 응급의학과 전문의입니다. "
    "제공된 [환자 컨텍스트], [모달 분석 결과], [과거 유사 환자 사례]를 바탕으로 최종 소견을 작성합니다. "
    "단, 곧바로 글을 쓰지 말고 반드시 아래의 4단계를 순서대로 속으로 생각한 뒤, "
    "그 결과만을 바탕으로 최종 5가지 항목을 도출하십시오.\n\n"

    "1단계 (데이터 유효성 검증): "
    "현재 환자의 각 검사 결과가 실제로 유효한지 확인하십시오. "
    "'판독 불가', '기록 없음', '검사 미시행', 'not_performed' 등의 표현이 있다면 "
    "해당 검사는 '데이터 없음'으로 엄격히 분류하고, "
    "이를 절대 '정상'으로 취급하여 질병이 없다고 단정 짓지 마십시오. "
    "미시행된 검사 중 현재 소견에 비추어 필요하다고 판단되는 것이 있다면, "
    "어떤 검사가 왜 필요한지 근거와 함께 권고 사항에 포함하십시오.\n\n"

    "2단계 (구체적 팩트 추출): "
    "현재 환자의 기록에서 구체적인 수치(예: WBC 18,500, Troponin T 0.25, K+ 6.6)와 "
    "병변의 정확한 위치(예: 우측 하엽 폐경화)를 빠짐없이 추출하십시오. "
    "최종 소견 작성 시 두리뭉실한 표현(예: '수치 상승')을 피하고 "
    "이 구체적인 수치와 위치를 반드시 명시하십시오.\n\n"

    "3단계 (정상과 비정상의 철저한 분리 및 과거 기록 적용): "
    "현재 환자의 검사 결과 중 '정상'인 항목과 '비정상'인 항목을 분리하십시오. "
    "[가장 중요한 규칙] 과거 유사 환자들의 소견은 "
    "오직 현재 환자의 '비정상' 항목을 해석할 때만 참고하십시오. "
    "현재 환자가 정상인 항목에 대해 과거 환자의 병을 끌고 와서 "
    "경고하거나 예측하는 과잉 진단(Overdiagnosis)을 절대 하지 마십시오. "
    "환자의 기저질환(CKD/ESRD 등)이 있다면 baseline 수치를 고려하여 "
    "단순 수치 상승을 critical로 판단하지 마십시오.\n\n"

    "4단계 (최종 소견 작성): "
    "위 1~3단계를 철저히 준수한 상태에서, 아래 5가지 항목으로 번호를 매겨 한국어로 작성하십시오. "
    "각 항목은 명확한 단락(2~5문장)으로 작성하고, JSON 같은 구조가 아닌 자연어 서술로 답하십시오:\n"
    "1. 주요 소견 분석 — 비정상 검사 결과의 구체적 수치와 임상적 의미\n"
    "2. 과거 사례 비교 — 유사 환자와의 공통점/차이점 (구체적 근거 포함, 사례 없으면 '해당 없음')\n"
    "3. 예상 진단 — 가장 가능성 높은 진단명과 감별 진단 (환자의 기저질환·치료 이력 반영)\n"
    "4. 위험도 평가 — 긴급 조치 필요 여부, 합병증 위험\n"
    "5. 권고 사항 — 추가 검사, 치료 방향, 전문과 협진 필요 여부 (구체적 약물/용량은 담당 의사 판단으로 표현)\n\n"

    "의학 약어가 등장하면 반드시 '약어 (풀네임: 한글 설명)' 형식으로 기재하십시오. "
    "최종 결정은 담당 의사가 내리며, 본 소견서는 임상 판단 보조용 초안(preliminary)임을 인지하고 "
    "신중한 표현을 쓰십시오."
)


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
[작성 형식]에 명시된 5항목 한국어 자연어 서술을 작성하십시오.
- 유사 사례에서 임상적으로 도움이 되는 패턴(처치 흐름, 예후 등)을 적극 반영하십시오.
- 유사도가 낮거나 사례가 없으면 '2. 과거 사례 비교'에 '해당 없음'으로 명시하고 일반 임상 지식만으로 판단하십시오.
- 위험도 라벨(critical/urgent/routine)은 별도로 산정되므로 본문에서는 '긴급도가 높음/중간/낮음' 같은 자연어로만 서술하십시오.
"""


async def generate_integrated_report(encounter_id: str) -> dict[str, Any]:
    """
    운영 DB에서 환자 컨텍스트 + 3개 모달 원본을 읽고 Bedrock으로 종합 소견서 생성.

    Returns:
        {
          "narrative": str,        # Claude의 5항목 자연어 서술
          "model_used": str,       # 실제 사용된 모델 ID (Haiku / Sonnet)
          "similar_cases": list,   # RAG 검색 결과 메타데이터
        }

    risk_level은 여기서 결정하지 않는다.
    각 모달(ECG/CXR/LAB)의 risk_level을 max-aggregation 하여 클라이언트가 결정.
    """
    # 1. 환자 컨텍스트 조회
    encounter = await ops_encounters.get_encounter(encounter_id)
    if encounter is None:
        raise ValueError(f"Encounter not found in ops DB: {encounter_id}")

    # 2. 모달 원본 조회 (ECG/CXR/LAB)
    modal_results = await ops_modal_results.get_all_modal_results(encounter_id)

    # 3. RAG 검색용 query는 RAG 가용성과 무관하게 항상 빌드
    #    (RAG 실패해도 select_model의 critical keyword 검출이 동작해야 함)
    rag_query = _build_rag_query(encounter, modal_results)

    similar_cases: list[dict] = []
    rag = _get_retriever()
    if rag is not None:
        try:
            search = rag.search(rag_query)
            if not search.get("fallback"):
                similar_cases = search.get("results", [])
            logger.info(
                "[rag] enc=%s query=%r → cases=%d",
                encounter_id, rag_query[:120], len(similar_cases),
            )
        except Exception as e:
            logger.warning("[rag] 검색 실패 (RAG 없이 진행): %s", e)

    # 4. 모델 라우팅 — 케이스 난이도 기반 Haiku/Sonnet 자동 선택
    model_id = select_model(similar_cases, rag_query)
    model_name = "Sonnet" if "sonnet" in model_id else "Haiku"

    # 5. Bedrock 프롬프트 구성 (모달 + RAG 사례)
    user_prompt = _build_user_prompt(encounter, modal_results, similar_cases)

    logger.info(
        "[report_generator] Bedrock invoke (enc=%s, modals=%s, rag_cases=%d, model=%s)",
        encounter_id, list(modal_results.keys()), len(similar_cases), model_name,
    )

    # 6. Claude 호출 — narrative 자유서술 출력
    narrative = invoke_claude(
        system=SYSTEM_PROMPT,
        user=user_prompt,
        max_tokens=LLM_MAX_TOKENS,
        temperature=0.3,
        model_id=model_id,
    )

    return {
        "narrative": narrative,
        "model_used": model_name,
        "similar_cases": [
            {
                "chunk_type": (c.get("metadata") or {}).get("chunk_type"),
                "hadm_id": (c.get("metadata") or {}).get("hadm_id"),
                "similarity": c.get("similarity"),
                "snippet": (c.get("document") or "")[:300],
            }
            for c in similar_cases
        ],
        "_modal_results": modal_results,
        "_patient_context": {
            "age": encounter.get("patient_age"),
            "gender": encounter.get("patient_gender"),
            "chief_complaint": encounter.get("chief_complaint"),
        },
    }
