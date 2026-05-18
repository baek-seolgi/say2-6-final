"""
encounters 테이블 CRUD 헬퍼.

[이 파일이 하는 일]
트리아지로 시작된 응급실 방문 1건을 운영 DB에 기록.
FHIR Encounter와 1:1 매핑되며, fhir_encounter_id로 상호 참조한다.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.db import client as db

logger = logging.getLogger(__name__)


async def insert_encounter(
    patient_id: str,
    fhir_encounter_id: str | None = None,
    fhir_patient_id: str | None = None,   # 호환용 — 사용 안 함
    chief_complaint: str = "",
    patient_name: str | None = None,
    patient_age: int | None = None,
    patient_gender: str | None = None,
    metadata: dict[str, Any] | None = None,
) -> str:
    """새 응급실 방문 생성. encounter_id 반환.

    encounter_id는 FHIR Encounter ID를 그대로 PK로 사용.
    subject_id는 metadata.mimic.subject_id에서 자동 추출하여 별도 컬럼에 저장.
    """
    enc_pk = fhir_encounter_id or patient_id
    meta = metadata or {}
    subject_id = (meta.get("mimic") or {}).get("subject_id")
    row = await db.fetchone(
        """
        INSERT INTO encounters (
            encounter_id, patient_id, subject_id,
            chief_complaint, patient_name, patient_age, patient_gender,
            metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING encounter_id
        """,
        enc_pk,
        patient_id,
        subject_id,
        chief_complaint,
        patient_name,
        patient_age,
        patient_gender,
        json.dumps(meta, ensure_ascii=False),
    )
    assert row is not None
    enc_id = str(row["encounter_id"])
    logger.info(
        "[encounters] created: enc=%s patient=%s subject=%s",
        enc_id, patient_id, subject_id,
    )
    return enc_id


async def get_encounter(encounter_id: str) -> dict[str, Any] | None:
    """encounter_id로 조회."""
    row = await db.fetchone(
        "SELECT * FROM encounters WHERE encounter_id = $1",
        encounter_id,
    )
    return dict(row) if row else None


async def get_by_subject(subject_id: str) -> dict[str, Any] | None:
    """MIMIC subject_id로 가장 최근 방문 조회."""
    row = await db.fetchone(
        "SELECT * FROM encounters WHERE subject_id = $1 ORDER BY started_at DESC LIMIT 1",
        subject_id,
    )
    return dict(row) if row else None


async def get_active_by_subject(subject_id: str) -> dict[str, Any] | None:
    """MIMIC subject_id로 활성(status='active') 방문 조회 — 중복 입력 가드용."""
    row = await db.fetchone(
        """
        SELECT * FROM encounters
        WHERE subject_id = $1 AND status = 'active'
        ORDER BY started_at DESC LIMIT 1
        """,
        subject_id,
    )
    return dict(row) if row else None


async def close_encounter(encounter_id: str) -> None:
    """응급실 방문 종료."""
    await db.execute(
        """
        UPDATE encounters
        SET status = 'closed', closed_at = NOW()
        WHERE encounter_id = $1
        """,
        encounter_id,
    )


async def list_active(limit: int = 50) -> list[dict[str, Any]]:
    """현재 활성 방문 목록 — subject_id가 있으면 그 환자당 최신 1건만 노출.

    subject_id가 null인 row(MIMIC ID 없는 일반 입력)는 encounter_id로 fallback
    → DISTINCT-ON 키가 항상 unique해져서 dedup이 no-op이 됨.
    """
    rows = await db.fetch(
        """
        SELECT encounter_id, patient_id, subject_id, chief_complaint,
               patient_name, patient_age, patient_gender, started_at
        FROM (
            SELECT DISTINCT ON (COALESCE(subject_id, encounter_id::text))
                   encounter_id, patient_id, subject_id, chief_complaint,
                   patient_name, patient_age, patient_gender, started_at
            FROM encounters
            WHERE status = 'active'
            ORDER BY COALESCE(subject_id, encounter_id::text), started_at DESC
        ) latest
        ORDER BY started_at DESC
        LIMIT $1
        """,
        limit,
    )
    return [dict(r) for r in rows]
