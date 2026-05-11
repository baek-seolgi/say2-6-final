"""
orchestrator/utils/bedrock_reporter.py

Bedrock 기반 임상 소견서 생성 모듈.
STOP / NEED_REASONING 두 터미널 상태에서 호출되며,
호출 이후 모달 루프는 재개되지 않음.
"""

import json
import logging
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

import boto3
from botocore.exceptions import ClientError

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# 상수 및 설정
# ---------------------------------------------------------------------------

class TerminalReason(str, Enum):
    STOP = "stop"                    # 충분한 정보 수집 완료 → 진단 요약
    NEED_REASONING = "need_reasoning"  # 복잡 케이스 → 감별 진단 포함 상세 소견


# 터미널 이유에 따라 모델 분기
# NEED_REASONING: 복잡한 감별 진단 → Sonnet
# STOP: 단순 요약 → Haiku
MODEL_MAP = {
    TerminalReason.NEED_REASONING: "anthropic.claude-sonnet-4-5",
    TerminalReason.STOP:           "anthropic.claude-haiku-4-5",
}

MAX_TOKENS = {
    TerminalReason.NEED_REASONING: 1500,
    TerminalReason.STOP:           800,
}

BEDROCK_REGION = "ap-northeast-2"  # 실제 배포 리전으로 변경


# ---------------------------------------------------------------------------
# 데이터 구조
# ---------------------------------------------------------------------------

@dataclass
class ModalityResult:
    """단일 검사 결과."""
    modality: str                          # "ECG" | "CXR" | "LAB"
    findings: dict                         # 모달리티별 결과값
    # ECG: {"icd_diagnoses": [...], "rhythm": "...", ...}
    # CXR: {"chexpert_labels": {...}, "impression": "..."}
    # LAB: {"values": {"Troponin_T": 0.05, ...}, "abnormal_flags": [...]}


@dataclass
class PatientContext:
    """소견서 생성에 필요한 환자 컨텍스트 전체."""
    patient_id: str
    age: int
    gender: str
    chief_complaint: str
    acuity: int                            # 1(최중증) ~ 5(경증)
    pain_score: Optional[int]
    elapsed_hours: float                   # 응급실 체류 시간
    modality_results: list[ModalityResult] # 시행된 검사 결과 목록
    rag_context: str                       # RAG 팀에서 넘겨준 텍스트
    terminal_reason: TerminalReason
    ml_confidence: Optional[float] = None  # 터미널 결정의 ML confidence


@dataclass
class ClinicalReport:
    """생성된 소견서."""
    patient_id: str
    terminal_reason: TerminalReason
    model_used: str
    report_text: str
    structured: dict = field(default_factory=dict)  # 파싱된 구조화 결과
    usage: dict = field(default_factory=dict)        # 토큰 사용량 (비용 추적)
    error: Optional[str] = None


# ---------------------------------------------------------------------------
# 프롬프트 빌더
# ---------------------------------------------------------------------------

class PromptBuilder:
    """터미널 이유에 따라 다른 프롬프트 생성."""

    @staticmethod
    def build(ctx: PatientContext) -> tuple[str, str]:
        """
        Returns:
            (system_prompt, user_prompt)
        """
        system = PromptBuilder._system_prompt(ctx.terminal_reason)
        user = PromptBuilder._user_prompt(ctx)
        return system, user

    @staticmethod
    def _system_prompt(reason: TerminalReason) -> str:
        base = (
            "You are an experienced emergency medicine physician assistant. "
            "Your task is to write a structured clinical report based on "
            "the patient information and test results provided. "
            "Always respond in Korean. "
            "Be concise, clinically accurate, and avoid speculation beyond the evidence."
        )

        if reason == TerminalReason.NEED_REASONING:
            return base + (
                "\n\nThis is a COMPLEX CASE flagged for detailed reasoning. "
                "Include differential diagnoses ranked by likelihood, "
                "highlight any conflicting findings, and suggest next clinical steps. "
                "Structure: [임상 요약] → [주요 검사 소견] → [감별 진단] → [권고 사항]"
            )
        else:  # STOP
            return base + (
                "\n\nSufficient information has been collected for this case. "
                "Write a concise diagnostic summary. "
                "Structure: [임상 요약] → [주요 검사 소견] → [추정 진단] → [권고 사항]"
            )

    @staticmethod
    def _user_prompt(ctx: PatientContext) -> str:
        lines = []

        # --- 환자 기본 정보 ---
        lines.append("## 환자 정보")
        lines.append(f"- 나이/성별: {ctx.age}세 / {ctx.gender}")
        lines.append(f"- 주 호소: {ctx.chief_complaint}")
        lines.append(f"- 중증도(acuity): {ctx.acuity}등급")
        if ctx.pain_score is not None:
            lines.append(f"- 통증 점수: {ctx.pain_score}/10")
        lines.append(f"- 응급실 체류 시간: {ctx.elapsed_hours:.1f}시간")
        lines.append("")

        # --- 검사 결과 ---
        lines.append("## 시행된 검사 및 결과")
        if not ctx.modality_results:
            lines.append("- 시행된 검사 없음")
        else:
            for result in ctx.modality_results:
                lines.append(f"\n### {result.modality}")
                lines.append(PromptBuilder._format_findings(result))
        lines.append("")

        # --- RAG 컨텍스트 ---
        if ctx.rag_context and ctx.rag_context.strip():
            lines.append("## 참고 임상 지식 (RAG)")
            lines.append(ctx.rag_context.strip())
            lines.append("")

        # --- 생성 지시 ---
        reason_label = (
            "복잡 케이스 (상세 감별 진단 필요)"
            if ctx.terminal_reason == TerminalReason.NEED_REASONING
            else "충분한 정보 수집 완료 (진단 요약)"
        )
        lines.append(f"## 소견서 작성 요청")
        lines.append(f"종료 사유: {reason_label}")
        lines.append("위 정보를 바탕으로 임상 소견서를 작성해 주세요.")

        return "\n".join(lines)

    @staticmethod
    def _format_findings(result: ModalityResult) -> str:
        """모달리티별 findings를 읽기 좋게 포맷."""
        findings = result.findings

        if result.modality == "ECG":
            icd = findings.get("icd_diagnoses", [])
            rhythm = findings.get("rhythm", "N/A")
            hr = findings.get("heart_rate", "N/A")
            out = [f"  - 리듬: {rhythm}", f"  - 심박수: {hr}"]
            if icd:
                out.append(f"  - ICD 진단: {', '.join(icd)}")
            return "\n".join(out)

        elif result.modality == "CXR":
            labels = findings.get("chexpert_labels", {})
            impression = findings.get("impression", "")
            positive = [k for k, v in labels.items() if v == 1]
            out = []
            if positive:
                out.append(f"  - 양성 소견: {', '.join(positive)}")
            else:
                out.append("  - 양성 소견 없음")
            if impression:
                out.append(f"  - 판독 소견: {impression}")
            return "\n".join(out)

        elif result.modality == "LAB":
            values = findings.get("values", {})
            abnormal = findings.get("abnormal_flags", [])
            out = []
            if values:
                val_str = ", ".join(f"{k}: {v}" for k, v in values.items())
                out.append(f"  - 검사값: {val_str}")
            if abnormal:
                out.append(f"  - 비정상 항목: {', '.join(abnormal)}")
            return "\n".join(out) if out else "  - 결과 없음"

        else:
            return f"  - {json.dumps(findings, ensure_ascii=False)}"


# ---------------------------------------------------------------------------
# Bedrock 클라이언트
# ---------------------------------------------------------------------------

class BedrockReporter:
    """
    STOP / NEED_REASONING 터미널 상태에서 Bedrock을 호출해 소견서를 생성.
    이 클래스 호출 이후 모달 루프는 재개되지 않음.
    """

    def __init__(self, region: str = BEDROCK_REGION):
        self.client = boto3.client(
            "bedrock-runtime",
            region_name=region,
        )
        self.prompt_builder = PromptBuilder()

    def generate_report(self, ctx: PatientContext) -> ClinicalReport:
        """
        소견서 생성 메인 메서드.

        Args:
            ctx: 환자 컨텍스트 (검사 결과 + RAG 텍스트 포함)

        Returns:
            ClinicalReport (error 필드가 None이면 성공)
        """
        model_id = MODEL_MAP[ctx.terminal_reason]
        max_tokens = MAX_TOKENS[ctx.terminal_reason]

        system_prompt, user_prompt = self.prompt_builder.build(ctx)

        logger.info(
            "Bedrock 소견서 생성 시작 | patient=%s | reason=%s | model=%s",
            ctx.patient_id, ctx.terminal_reason.value, model_id,
        )

        try:
            response_text, usage = self._invoke(
                model_id=model_id,
                system_prompt=system_prompt,
                user_prompt=user_prompt,
                max_tokens=max_tokens,
            )

            report = ClinicalReport(
                patient_id=ctx.patient_id,
                terminal_reason=ctx.terminal_reason,
                model_used=model_id,
                report_text=response_text,
                structured=self._parse_sections(response_text),
                usage=usage,
            )

            logger.info(
                "소견서 생성 완료 | patient=%s | tokens_in=%d | tokens_out=%d",
                ctx.patient_id,
                usage.get("input_tokens", 0),
                usage.get("output_tokens", 0),
            )
            return report

        except ClientError as e:
            error_msg = f"Bedrock ClientError: {e.response['Error']['Code']} - {e.response['Error']['Message']}"
            logger.error(error_msg)
            return ClinicalReport(
                patient_id=ctx.patient_id,
                terminal_reason=ctx.terminal_reason,
                model_used=model_id,
                report_text="",
                error=error_msg,
            )

        except Exception as e:
            error_msg = f"Unexpected error: {type(e).__name__}: {str(e)}"
            logger.error(error_msg)
            return ClinicalReport(
                patient_id=ctx.patient_id,
                terminal_reason=ctx.terminal_reason,
                model_used=model_id,
                report_text="",
                error=error_msg,
            )

    def _invoke(
        self,
        model_id: str,
        system_prompt: str,
        user_prompt: str,
        max_tokens: int,
    ) -> tuple[str, dict]:
        """
        Bedrock converse API 호출.
        Returns:
            (response_text, usage_dict)
        """
        response = self.client.converse(
            modelId=model_id,
            system=[{"text": system_prompt}],
            messages=[
                {"role": "user", "content": [{"text": user_prompt}]}
            ],
            inferenceConfig={
                "maxTokens": max_tokens,
                "temperature": 0.2,   # 임상 소견서: 낮은 temperature로 일관성 확보
                "topP": 0.9,
            },
        )

        text = response["output"]["message"]["content"][0]["text"]
        usage = response.get("usage", {})
        return text, usage

    @staticmethod
    def _parse_sections(report_text: str) -> dict:
        """
        소견서 텍스트에서 섹션을 파싱해 구조화된 dict로 반환.
        섹션 헤더: [임상 요약], [주요 검사 소견], [감별 진단] or [추정 진단], [권고 사항]
        """
        import re

        sections = {}
        pattern = r"\[(임상 요약|주요 검사 소견|감별 진단|추정 진단|권고 사항)\](.*?)(?=\[|$)"
        matches = re.findall(pattern, report_text, re.DOTALL)

        for header, content in matches:
            sections[header.strip()] = content.strip()

        return sections


# ---------------------------------------------------------------------------
# 팩토리 함수 (PatientSessionManager에서 호출)
# ---------------------------------------------------------------------------

def build_patient_context_from_session(
    session,  # PatientSession dataclass instance
    rag_context: str,
    terminal_reason: TerminalReason,
) -> PatientContext:
    """
    PatientSession에서 PatientContext로 변환.

    Args:
        session: PatientSession dataclass instance
        rag_context: RAG 팀에서 전달받은 텍스트 (프롬프트에 직접 삽입)
        terminal_reason: STOP 또는 NEED_REASONING

    Returns:
        PatientContext
    """
    patient_data = session.patient_data

    # inference_results는 list[dict]
    modality_results = []
    for result in session.inference_results:
        modality = result.get('modality', '')
        # 나머지 필드를 findings로 사용
        findings = {k: v for k, v in result.items() if k != 'modality'}
        
        modality_results.append(
            ModalityResult(
                modality=modality,
                findings=findings,
            )
        )

    return PatientContext(
        patient_id=session.patient_id,
        age=patient_data.get('age', 0),
        gender=patient_data.get('gender', 'Unknown'),
        chief_complaint=patient_data.get('chief_complaint', ''),
        acuity=patient_data.get('acuity', 3),
        pain_score=patient_data.get('pain', None),
        elapsed_hours=patient_data.get('elapsed_hours', 0.0),
        modality_results=modality_results,
        rag_context=rag_context,
        terminal_reason=terminal_reason,
        ml_confidence=None,  # 호출 시 별도 전달
    )
