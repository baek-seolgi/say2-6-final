"""RAG (Retrieval-Augmented Generation) 모듈.

종합 진단서 생성 시 49,743건의 MIMIC 노트(퇴원요약 + 영상보고서)에서
유사 환자 사례를 검색하여 Claude의 답변 품질을 보강한다.
"""
from app.agent.rag.retriever import Retriever, FALLBACK_RESPONSE
from app.agent.rag.generator import Generator, build_user_prompt, SYSTEM_PROMPT

__all__ = [
    "Retriever",
    "Generator",
    "build_user_prompt",
    "SYSTEM_PROMPT",
    "FALLBACK_RESPONSE",
]
