"""
RAG Generator — 검색 결과 + 환자 데이터 → Bedrock Claude 종합 소견.

원본: https://github.com/jeongawon/say-6-project (feature/rag, scripts/step6_rag_orchestrator.py)
중앙 통합 시 변경:
- 모델 ID 환경변수 override
- system 프롬프트는 그대로 (의학 약어 풀네임 표기 규칙 포함)
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

SYSTEM_PROMPT = (
    "당신은 전문적이고 친절한 AI 의료 보조입니다. "
    "제공된 [과거 유사 환자 사례]와 [새로운 환자 검사 결과]를 바탕으로 "
    "정확히 5가지 항목으로 번호를 매겨 종합 소견을 작성해야 합니다. "
    "도입부는 '새로운 환자의 검사 결과와 과거 유사 환자 사례를 종합하여 "
    "다음과 같은 소견을 제시드립니다:'로 시작하고, "
    "의학 약어가 등장하면 반드시 '약어 (풀네임: 한글 설명)' 형식으로 기재하십시오."
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
