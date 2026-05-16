"""
HAPI 동기화 백로그 큐 (Graceful Degradation).

HAPI 일시 다운 시 운영 DB INSERT는 정상 진행되고,
HAPI 동기화는 이 큐에 적재 → retry worker가 5분마다 백필.

[흐름]
  triage.py가 HAPI 호출 실패 → enqueue() → fhir_sync_queue.status='pending'
  retry worker가 fetch_pending() → HAPI 호출 시도
    성공 → mark_synced()
    실패 → increment_retry()
    3회 초과 → mark_failed() (수동 점검 필요)
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.db import client as db

logger = logging.getLogger(__name__)

MAX_RETRY = 5  # 5회 초과 시 'failed'로 마킹


async def enqueue(
    *,
    encounter_id: str,
    patient_id: str | None,
    resource_type: str,
    resource_id: str,
    payload: dict[str, Any],
    last_error: str | None = None,
) -> int:
    """HAPI 동기화 실패 시 큐에 적재."""
    row = await db.fetchone(
        """
        INSERT INTO fhir_sync_queue (
            encounter_id, patient_id, resource_type, resource_id, payload, status, last_error
        ) VALUES ($1, $2, $3, $4, $5::jsonb, 'pending', $6)
        RETURNING id
        """,
        encounter_id, patient_id, resource_type, resource_id,
        json.dumps(payload, default=str), last_error,
    )
    queue_id = int(row["id"])
    logger.info(
        "[fhir-queue] enqueued #%d %s/%s for enc=%s",
        queue_id, resource_type, resource_id, encounter_id,
    )
    return queue_id


async def fetch_pending(limit: int = 50) -> list[dict[str, Any]]:
    """대기 중 row을 가장 오래된 순으로 가져옴."""
    rows = await db.fetch(
        """
        SELECT id, encounter_id, patient_id, resource_type, resource_id,
               payload, retry_count, created_at
        FROM fhir_sync_queue
        WHERE status = 'pending'
        ORDER BY created_at
        LIMIT $1
        """,
        limit,
    )
    result = []
    for r in rows:
        d = dict(r)
        # payload는 JSONB → asyncpg가 dict로 변환해줌. str이면 디코드.
        if isinstance(d["payload"], str):
            d["payload"] = json.loads(d["payload"])
        result.append(d)
    return result


async def mark_synced(queue_id: int) -> None:
    """HAPI 동기화 성공 → synced 마킹."""
    await db.execute(
        """
        UPDATE fhir_sync_queue
        SET status = 'synced', synced_at = NOW(), last_error = NULL
        WHERE id = $1
        """,
        queue_id,
    )


async def increment_retry(queue_id: int, error: str) -> None:
    """재시도 실패 → retry_count 증가, MAX 초과 시 failed."""
    await db.execute(
        """
        UPDATE fhir_sync_queue
        SET retry_count = retry_count + 1,
            last_error = $2,
            status = CASE
                WHEN retry_count + 1 >= $3 THEN 'failed'
                ELSE 'pending'
            END
        WHERE id = $1
        """,
        queue_id, error[:500], MAX_RETRY,
    )


async def pending_count() -> int:
    """현재 대기 중 row 수 (모니터링/알람용)."""
    row = await db.fetchone(
        "SELECT COUNT(*)::int AS c FROM fhir_sync_queue WHERE status = 'pending'"
    )
    return int(row["c"]) if row else 0
