"""
HAPI 동기화 재시도 워커 (Graceful Degradation).

5분마다 fhir_sync_queue를 폴링하여 pending row를 HAPI에 PUT 시도.
성공 시 'synced'로 마킹, 실패 시 retry_count 증가.
"""
from __future__ import annotations

import asyncio
import logging

from app.clients import cw_metrics
from app.db import fhir_sync_queue as ops_fhir_queue
from app.fhir import client as fhir

logger = logging.getLogger(__name__)

RETRY_INTERVAL_SEC = 300    # 5분
BATCH_SIZE = 50             # 한 사이클당 처리량 (HAPI 부하 제어)


async def _process_one(item: dict) -> None:
    """한 큐 row의 HAPI 동기화 시도. resource_type에 따라 분기."""
    rt = item["resource_type"]
    rid = item["resource_id"]
    payload = item["payload"]

    try:
        if rt == "ServiceRequestTransition":
            # SR 상태 전이 (active/completed/revoked)
            from app.fhir.state_machine import transition_service_request
            await transition_service_request(rid, payload["new_status"])

        elif rt == "DiagnosticReportTransition":
            # DR 상태 전이 (final/amended)
            from app.fhir.state_machine import transition_diagnostic_report
            await transition_diagnostic_report(rid, payload["new_status"])

        elif rt == "ServiceRequestPatch":
            # SR PATCH (revoked + note 등)
            await fhir.patch("ServiceRequest", rid, payload)

        else:
            # 일반 FHIR 리소스 (Patient/Encounter/Condition/Observation/...)
            # client-assigned ID로 PUT
            await fhir.update(rt, rid, payload)

        await ops_fhir_queue.mark_synced(item["id"])
        logger.info("[fhir-retry] synced #%d %s/%s", item["id"], rt, rid)
    except Exception as e:
        await ops_fhir_queue.increment_retry(item["id"], str(e))
        logger.warning(
            "[fhir-retry] still failing #%d %s: %s",
            item["id"], rt, str(e)[:200],
        )


async def fhir_retry_loop():
    """앱이 살아있는 동안 5분 주기로 큐 처리 + CloudWatch에 큐 적체 메트릭 발행."""
    logger.info("[fhir-retry] worker started (interval=%ds)", RETRY_INTERVAL_SEC)
    while True:
        try:
            pending = await ops_fhir_queue.fetch_pending(limit=BATCH_SIZE)
            if pending:
                logger.info("[fhir-retry] processing %d pending items", len(pending))
                for item in pending:
                    await _process_one(item)
            # else: pending 없으면 조용히 다음 사이클로

            # 처리 후 현재 큐 적체 수치를 CloudWatch에 게이지로 발행
            # FhirSyncQueueBacklogAlarm: 100 초과 10분 지속 시 발동
            try:
                depth = await ops_fhir_queue.pending_count()
                asyncio.create_task(cw_metrics.emit_fhir_queue_depth(depth))
            except Exception as e:
                logger.warning("[fhir-retry] queue depth 메트릭 발행 실패: %s", e)

        except Exception as e:
            # 워커 자체가 죽지 않도록 모든 예외 catch
            logger.error("[fhir-retry] worker iteration error: %s", e)

        await asyncio.sleep(RETRY_INTERVAL_SEC)
