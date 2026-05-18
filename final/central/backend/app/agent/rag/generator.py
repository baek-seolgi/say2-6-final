"""
RAG Generator — 검색 결과 + 환자 데이터 → Bedrock Claude 종합 소견.

원본: https://github.com/jeongawon/say-6-project (feature/rag, scripts/step6_rag_orchestrator.py)

중앙 통합 시 변경:
- 모델 ID 환경변수 override
- SYSTEM_PROMPT를 한국 응급실 표준 소견서 형식([진단 요약]+[향후 치료 권고])으로 교체
  → production reports API(`app.agent.report_generator`)에서 이 모듈의 SYSTEM_PROMPT를
    import해서 단일 출처로 사용. 약어 풀네임 표기 규칙은 [작성 규칙] 항목에 흡수.
"""
from __future__ import annotations

import json
import logging
import os

import boto3
from botocore.exceptions import ClientError, NoCredentialsError

logger = logging.getLogger(__name__)

LLM_MODEL_ID = os.getenv("RAG_LLM_MODEL", "anthropic.claude-3-haiku-20240307-v1:0")
LLM_MAX_TOKENS = int(os.getenv("RAG_LLM_MAX_TOKENS", "2048"))

# 한국 응급실 표준 소견서 형식 — production reports API에서 import해서 사용.
# 모델은 내부적으로 4단계 추론하지만 출력은 [진단 요약] + [향후 치료 권고] 2섹션만.
SYSTEM_PROMPT = (
    "당신은 대학병원 응급의학과 전문의입니다. "
    "제공된 [환자 컨텍스트], [모달 분석 결과], [과거 유사 환자 사례]를 바탕으로 "
    "한국 응급실 표준 소견서를 작성합니다.\n\n"

    "[내부 추론 4단계 — 생각만 하고 결과는 출력하지 마십시오]\n"
    "1) 데이터 유효성 검증 — '판독 불가'·'미시행'·'not_performed'는 '없음'으로 분류. 절대 '정상'으로 단정 X.\n"
    "2) 구체적 팩트 추출 — 수치(예: K+ 6.6, BUN 172)·병변 위치(예: 우측 하엽)를 정확히 식별.\n"
    "3) 정상/비정상 분리 — 과거 유사 사례는 '비정상' 항목 해석에만 사용. 정상 항목엔 과잉 진단 금지. "
    "기저질환(CKD/ESRD 등)의 baseline 수치는 critical로 분류 X.\n"
    "4) 임상 우선순위 — 가장 시급한 진단·처치 1~2개로 압축.\n\n"

    "[최종 출력 형식 — 반드시 아래 형식 그대로]\n"
    "상기 인은 {오늘 날짜} 본원 응급실에 내원하여 시행한 검사 및 진찰 결과 다음과 같이 소견드립니다.\n\n"
    "[진단 요약]\n"
    "{한 단락(3~6문장). 환자 인구학(나이·성별) + 주증상 + 핵심 비정상 소견을 수치와 함께 나열 + 가장 가능성 높은 진단명. "
    "예: '34세 남성 환자가 \"혈뇨를 주소로 내원…\"를 주소로 내원함. LAB: 혈청 칼륨 6.6 mEq/L — 중증 고칼륨혈증. "
    "LAB: BUN 172 mg/dL — 말기 신부전 악화. ECG: 고칼륨혈증 변화 패턴 감지 (35.3%). 혈압 158/95 mmHg — 고혈압 동반.'}\n\n"
    "[향후 치료 권고]\n"
    "1. {가장 시급한 처치 — 약물·시술명까지 구체적으로}\n"
    "2. {다음 처치}\n"
    "3. {모니터링·추적 검사}\n"
    "4. {협진 또는 추가 검사}\n"
    "5. {지속 모니터링 항목}\n"
    "(권고는 5~7개. 각 권고는 한 줄로 짧게.)\n\n"
    "※ 본 소견서는 AI 보조 분석에 기반한 초안(preliminary)이며, "
    "최종 진단 및 치료 결정은 담당 의사의 임상 판단에 따릅니다.\n\n"

    "[작성 규칙]\n"
    "- 마크다운 헤더(##, ###) 사용 금지. [진단 요약], [향후 치료 권고]는 대괄호 그대로.\n"
    "- 의학 약어는 첫 등장 시 'BUN(혈액요소질소)' 식으로 풀어 쓰되, 이후는 약어만.\n"
    "- 'AI 분석', '과거 사례 N건', '신뢰도 X%' 같은 시스템 메타 정보는 출력 본문에 쓰지 마십시오. "
    "내부 추론용 데이터일 뿐, 의사용 소견서엔 임상 결론만 들어갑니다.\n"
    "- 진단 요약은 6문장 이내. 치료 권고는 7개 이내.\n"
    "- 환자가 정상인 항목은 굳이 언급하지 않습니다 (예: 'WBC 정상' 같은 표현 X).\n"
    "- 'preliminary', '초안' 같은 영문은 면책 문구 1줄에만 쓰십시오."
)


def build_user_prompt(query: str, results: list[dict]) -> str:
    """검색 결과 + 사용자 입력을 하나의 프롬프트로 조립."""
    context_parts = []
    for i, r in enumerate(results, 1):
        meta = r["metadata"]
        chunk_type = meta.get("chunk_type", "unknown")
        hadm_id = meta.get("hadm_id", "?")
        sim = r["similarity"]
        doc = r["document"]
        context_parts.append(
            f"[사례 {i}] (유형: {chunk_type}, 입원번호: {hadm_id}, 유사도: {sim})\n{doc}"
        )

    context_block = "\n\n".join(context_parts)
    return (
        f"[과거 유사 환자 사례]\n{context_block}\n\n"
        f"[새로운 환자 검사 결과]\n{query}\n\n"
        f"위 정보를 바탕으로 종합 소견을 5가지 항목으로 작성해 주십시오."
    )


class Generator:
    """Bedrock Claude 호출 — Messages API."""

    def __init__(self):
        self.bedrock = boto3.client("bedrock-runtime")

    def generate(self, user_prompt: str) -> str:
        body = json.dumps({
            "anthropic_version": "bedrock-2023-05-31",
            "max_tokens": LLM_MAX_TOKENS,
            "system": SYSTEM_PROMPT,
            "messages": [{"role": "user", "content": user_prompt}],
        })
        try:
            resp = self.bedrock.invoke_model(
                modelId=LLM_MODEL_ID,
                contentType="application/json",
                accept="application/json",
                body=body,
            )
            result = json.loads(resp["body"].read())
            return result["content"][0]["text"]
        except NoCredentialsError:
            logger.exception("[rag] Bedrock 자격증명 없음")
            return "[에러] AWS 자격 증명을 찾을 수 없습니다."
        except ClientError as e:
            code = e.response.get("Error", {}).get("Code", "UnknownError")
            logger.exception("[rag] Claude API 호출 실패: %s", code)
            return f"[에러] Claude API 호출 실패: {code}"
