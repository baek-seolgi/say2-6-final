"""
MIMIC 데이터 조회 엔드포인트 (시연 데이터용).

[엔드포인트]
  GET /mimic/conditions/{subject_id}
    → 환자의 MIMIC diagnoses_icd 자동 조회 + PastHistoryCode 매핑

[사용처]
프론트엔드 트리아지 페이지가 데모 환자(4 시연 케이스) 선택 시 호출.
폼의 '과거력' 필드를 진짜 MIMIC 데이터로 자동 채움.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException

from app.clients.condition_loader import fetch_conditions

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/conditions/{subject_id}")
async def get_mimic_conditions(subject_id: str):
    """
    MIMIC diagnoses_icd 자동 조회 → PastHistoryCode 매핑 결과 반환.

    Args:
        subject_id: MIMIC subject_id (예: "19041043")

    Returns:
        {
          "subject_id": "19041043",
          "history_codes": ["HTN", "DM", "CAD"],
          "raw_icd": [...],
          "total": 12
        }

    Errors:
        400: subject_id 형식 오류
        500: S3 Select 실패
    """
    if not subject_id or not subject_id.isdigit():
        raise HTTPException(400, "subject_id는 숫자여야 합니다.")

    try:
        result = await fetch_conditions(subject_id)
    except Exception as e:
        logger.error(f"MIMIC 진단 조회 실패: {e}")
        raise HTTPException(500, f"MIMIC 조회 실패: {e}")

    return result
