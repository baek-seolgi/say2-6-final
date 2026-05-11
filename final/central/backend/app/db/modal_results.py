"""
modal_results 테이블 CRUD 헬퍼.

[이 파일이 하는 일]
모달 서비스(ECG/CXR/LAB)의 원본 응답을 운영 DB에 저장/조회.
Bedrock 종합 판단 시 원본 구조 그대로 꺼내 쓸 수 있게 해준다.
"""
from __future__ import annotations

import json
import logging
from typing import Any
from uuid import UUID

from app.db import client as db

logger = logging.getLogger(__name__)


async def insert_modal_result(
    encounter_id: str,
    modality: str,
    service_request_id: str | None,
    raw_response: dict[str, Any],
) -> str:
    """
    모달 원본 응답 저장. 같은 encounter+modality 조합은 덮어쓴다 (UPSERT).

    Returns:
        저장된 row의 id (UUID 문자열)
    """
    risk_level = raw_response.get("risk_level", "routine")
    summary = raw_response.get("summary", "")

    row = await db.fetchone(
        """
        INSERT INTO modal_results
            (encounter_id, modality, service_request_id, raw_response, risk_level, summary)
        VALUES ($1, $2, $3, $4::jsonb, $5, $6)
        ON CONFLICT (encounter_id, modality) DO UPDATE SET
            service_request_id = EXCLUDED.service_request_id,
            raw_response = EXCLUDED.raw_response,
            risk_level = EXCLUDED.risk_level,
            summary = EXCLUDED.summary,
            created_at = NOW(),
            synced_to_fhir = FALSE
        RETURNING id
        """,
        encounter_id,
        modality.upper(),
        service_request_id,
        json.dumps(raw_response, ensure_ascii=False),
        risk_level,
        summary,
    )
    assert row is not None
    result_id = str(row["id"])
    logger.info(
        "[modal_results] saved: enc=%s modality=%s risk=%s",
        encounter_id, modality, risk_level,
    )
    return result_id


async def get_modal_result(
    encounter_id: str, modality: str,
) -> dict[str, Any] | None:
    """특정 encounter + modality의 원본 응답 조회."""
    row = await db.fetchone(
        """
        SELECT raw_response
        FROM modal_results
        WHERE encounter_id = $1 AND modality = $2
        """,
        encounter_id, modality.upper(),
    )
    if row is None:
        return None
    raw = row["raw_response"]
    # asyncpg는 JSONB를 str로 반환하므로 파싱 필요
    if isinstance(raw, str):
        return json.loads(raw)
    return raw


async def get_all_modal_results(encounter_id: str) -> dict[str, dict[str, Any]]:
    """
    해당 encounter의 모든 모달 결과를 dict로 반환.
    반환 예: {"ECG": {...원본...}, "CXR": {...}, "LAB": {...}}
    (종합 판단 시 Bedrock에 그대로 투입)
    """
    rows = await db.fetch(
        """
        SELECT modality, raw_response, risk_level, created_at
        FROM modal_results
        WHERE encounter_id = $1
        ORDER BY created_at
        """,
        encounter_id,
    )
    results: dict[str, dict[str, Any]] = {}
    for r in rows:
        modality = r["modality"]
        raw = r["raw_response"]
        if isinstance(raw, str):
            raw = json.loads(raw)
        results[modality] = raw
    return results


async def list_recent(limit: int = 20) -> list[dict[str, Any]]:
    """최근 모달 실행 기록 (디버그/관리자용)."""
    rows = await db.fetch(
        """
        SELECT id, encounter_id, modality, risk_level, summary, created_at, synced_to_fhir
        FROM modal_results
        ORDER BY created_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]
