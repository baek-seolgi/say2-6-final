"""
모달 서비스(ECG/CXR/Lab) HTTP 호출 클라이언트.

[이 파일이 하는 일]
SageMaker 대신 각 모달 서비스의 REST API(/predict)를 직접 호출한다.

[호출 구조]
모든 모달은 chest-svc-pre 스키마를 따른다:
  POST {MODAL_URL}/predict
  Request: {patient_id, patient_info{...}, data{...}, context{...}}
  Response: {status, modal, findings[], risk_level, ...}

[사용처]
orders.py의 _execute_modal_and_complete()에서 invoke_modal() 호출.
endpoint 미설정 시 호출부에서 mock으로 폴백.
"""
from __future__ import annotations

import asyncio
import logging
import time
from typing import Any

import httpx

from app.config import (
    CXR_SERVICE_URL,
    ECG_SERVICE_URL,
    LAB_SERVICE_URL,
    MODAL_HTTP_TIMEOUT,
)
from app.clients import cw_metrics

logger = logging.getLogger(__name__)

# 모달 → 서비스 URL 매핑
MODAL_SERVICE_URLS: dict[str, str] = {
    "CXR": CXR_SERVICE_URL,
    "ECG": ECG_SERVICE_URL,
    "LAB": LAB_SERVICE_URL,
}


class ModalCallError(RuntimeError):
    """모달 호출 실패 (네트워크/스키마/응답 오류 공통)."""


async def invoke_modal(modality: str, payload: dict[str, Any]) -> dict[str, Any]:
    """
    모달 서비스의 POST /predict 호출.

    Args:
        modality: "ECG" | "CXR" | "LAB"
        payload: chest-svc-pre PredictRequest 포맷
                 {patient_id, patient_info{}, data{}, context{}}

    Returns:
        chest-svc-pre PredictResponse dict
        {status, modal, findings[], risk_level, summary, ...}

    Raises:
        ModalCallError: URL 미설정, HTTP 오류, JSON 파싱 실패 등
    """
    url = MODAL_SERVICE_URLS.get(modality.upper(), "")
    if not url:
        raise ModalCallError(f"{modality} 서비스 URL이 설정되지 않았습니다.")

    endpoint = f"{url.rstrip('/')}/predict"
    logger.info(f"[modal] POST {endpoint} (patient_id={payload.get('patient_id')})")

    t0 = time.perf_counter()
    try:
        async with httpx.AsyncClient(timeout=MODAL_HTTP_TIMEOUT) as client:
            response = await client.post(endpoint, json=payload)
            response.raise_for_status()
            result = response.json()
    except (httpx.TimeoutException, httpx.HTTPStatusError, httpx.HTTPError, ValueError) as e:
        # 모든 실패 → CloudWatch InferenceErrorCount 메트릭 +1 (fire-and-forget)
        # ModalInferenceErrorSpikeAlarm(5분 3건+) 발동 트리거
        asyncio.create_task(cw_metrics.emit_modal_inference_error(modality))
        if isinstance(e, httpx.TimeoutException):
            raise ModalCallError(f"{modality} 타임아웃 ({MODAL_HTTP_TIMEOUT}s): {e}") from e
        if isinstance(e, httpx.HTTPStatusError):
            body_preview = (e.response.text or "")[:500]
            raise ModalCallError(
                f"{modality} HTTP {e.response.status_code}: {body_preview}"
            ) from e
        if isinstance(e, ValueError):
            raise ModalCallError(f"{modality} JSON 파싱 실패: {e}") from e
        raise ModalCallError(f"{modality} 네트워크 오류: {e}") from e

    duration_ms = (time.perf_counter() - t0) * 1000.0

    # 모달 자체가 status="error"를 응답한 경우도 InferenceError로 간주
    if str(result.get("status") or "").lower() == "error":
        asyncio.create_task(cw_metrics.emit_modal_inference_error(modality))

    # 응답이 5초 초과면 HighLatencyCount 메트릭 발행 (임계치는 cw_metrics 안에서 비교)
    asyncio.create_task(cw_metrics.emit_modal_high_latency(modality, duration_ms))

    logger.info(
        f"[modal] {modality} response: "
        f"status={result.get('status')} risk={result.get('risk_level')} "
        f"findings={len(result.get('findings', []))} "
        f"latency={duration_ms:.0f}ms"
    )
    return result


async def check_modal_health(modality: str) -> bool:
    """
    모달 서비스 헬스체크. /health 또는 /healthz 둘 다 시도.

    Returns:
        True if 200 OK, else False
    """
    url = MODAL_SERVICE_URLS.get(modality.upper(), "")
    if not url:
        return False

    for path in ("/health", "/healthz", "/ready", "/readyz"):
        try:
            async with httpx.AsyncClient(timeout=5.0) as client:
                response = await client.get(f"{url.rstrip('/')}{path}")
                if response.status_code == 200:
                    return True
        except httpx.HTTPError:
            continue
    return False
