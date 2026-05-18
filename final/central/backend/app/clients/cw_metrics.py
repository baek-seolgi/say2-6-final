"""
CloudWatch 커스텀 메트릭 emitter.

[발행하는 메트릭]
Namespace: DRAI/Modal
  - InferenceErrorCount  (Value=1, Dimension=Modality)  → 모달 추론 실패 시
  - HighLatencyCount     (Value=1, Dimension=Modality)  → 모달 응답 > 5s 시

[알람과의 연결]
AWS/monitoring/monitoring-alarms-stack.yaml 의
ModalInferenceErrorSpikeAlarm / ModalHighLatencySpikeAlarm
이 5분 합계 임계치 초과 시 발동.

[안전 정책]
- AWS 자격증명 없거나 boto3 호출 실패 시 graceful no-op
- 메트릭 발행은 fire-and-forget — 실패해도 임상 흐름 영향 없음
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

NAMESPACE = "DRAI/Modal"
FHIR_NAMESPACE = "DRAI/FhirSync"
LATENCY_THRESHOLD_MS = 5000   # 5초 초과 시 HighLatencyCount 발행

_cw_client = None
_init_attempted = False


def _get_client():
    """boto3 cloudwatch 클라이언트 — lazy init, 실패 시 None."""
    global _cw_client, _init_attempted
    if _init_attempted:
        return _cw_client
    _init_attempted = True
    try:
        import boto3
        region = os.environ.get("AWS_REGION", "ap-northeast-2")
        _cw_client = boto3.client("cloudwatch", region_name=region)
        logger.info("[cw_metrics] CloudWatch 클라이언트 초기화 (region=%s)", region)
    except Exception as e:
        logger.warning("[cw_metrics] boto3 초기화 실패 — 메트릭 비활성화: %s", e)
        _cw_client = None
    return _cw_client


def _put_sync(metric_name: str, modality: Optional[str]) -> None:
    """동기 put_metric_data — asyncio.to_thread 로 호출됨."""
    client = _get_client()
    if client is None:
        return
    try:
        client.put_metric_data(
            Namespace=NAMESPACE,
            MetricData=[{
                "MetricName": metric_name,
                "Value": 1.0,
                "Unit": "Count",
                "Dimensions": (
                    [{"Name": "Modality", "Value": modality.upper()}]
                    if modality else []
                ),
            }],
        )
    except Exception as e:
        # 메트릭 발행 실패는 임상 흐름에 영향 없음 — 로그만 남기고 무시
        logger.warning("[cw_metrics] put_metric_data 실패 (%s): %s", metric_name, e)


async def emit_modal_inference_error(modality: str) -> None:
    """모달 추론 실패 → InferenceErrorCount=1."""
    try:
        await asyncio.to_thread(_put_sync, "InferenceErrorCount", modality)
    except Exception:
        logger.exception("[cw_metrics] InferenceErrorCount 발행 중 예상치 못한 예외")


async def emit_modal_high_latency(modality: str, duration_ms: float) -> None:
    """모달 응답이 LATENCY_THRESHOLD_MS 초과 → HighLatencyCount=1."""
    if duration_ms < LATENCY_THRESHOLD_MS:
        return
    try:
        logger.info(
            "[cw_metrics] HighLatency: modality=%s duration=%.0fms",
            modality, duration_ms,
        )
        await asyncio.to_thread(_put_sync, "HighLatencyCount", modality)
    except Exception:
        logger.exception("[cw_metrics] HighLatencyCount 발행 중 예상치 못한 예외")


def _put_fhir_queue_sync(depth: int) -> None:
    """동기 put_metric_data — FhirSync.QueueDepth 게이지."""
    client = _get_client()
    if client is None:
        return
    try:
        client.put_metric_data(
            Namespace=FHIR_NAMESPACE,
            MetricData=[{
                "MetricName": "QueueDepth",
                "Value": float(depth),
                "Unit": "Count",
            }],
        )
    except Exception as e:
        logger.warning("[cw_metrics] FhirSync QueueDepth 발행 실패: %s", e)


async def emit_fhir_queue_depth(depth: int) -> None:
    """fhir_sync_queue 의 현재 row count (game)를 CloudWatch에 발행.

    fhir_retry_worker 가 5분 주기로 호출.
    DRAI/FhirSync.QueueDepth > 100 (10분 지속) → FhirSyncQueueBacklogAlarm 발동.
    """
    try:
        await asyncio.to_thread(_put_fhir_queue_sync, depth)
    except Exception:
        logger.exception("[cw_metrics] QueueDepth 발행 중 예상치 못한 예외")
