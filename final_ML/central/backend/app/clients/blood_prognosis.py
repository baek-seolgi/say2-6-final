"""
혈액검사 6시간 후 악화 예측 서비스 클라이언트.

[이 파일이 하는 일]
Lab-svc 내부로 통합된 prognosis 모듈(XGBoost 5개 앙상블)에 환자의 현재 lab 값을
보내 6시간 후 악화 확률을 받아온다. Lab-svc :8000/predict_6h 엔드포인트.

[입력]  lab_loader가 추출한 LabValues dict 중 10개 feature
        (creatinine, glucose, hemoglobin, lactate, platelet, potassium,
         sodium, wbc, troponin_t, ntprobnp → bnp로 매핑)

[출력]  {hemoglobin_down, creatinine_up, potassium_worse, lactate_up,
         troponin_up, warnings, troponin_note}

[사용처]
orders.py가 LAB 모달 호출 직후 추가로 호출 → 응답을 raw_response.prognosis_6h에 병합.
"""
from __future__ import annotations

import logging
from typing import Any

import httpx

from app.config import BLOOD_PROGNOSIS_URL, MODAL_HTTP_TIMEOUT

logger = logging.getLogger(__name__)


# Lab-svc LabValues field → blood-prognosis API field 매핑
_FIELD_MAP: dict[str, str] = {
    "creatinine":  "creatinine_0h",
    "glucose":     "glucose_0h",
    "hemoglobin":  "hemoglobin_0h",
    "lactate":     "lactate_0h",
    "platelet":    "platelet_0h",
    "potassium":   "potassium_0h",
    "sodium":      "sodium_0h",
    "wbc":         "wbc_0h",
    "troponin_t":  "troponin_t_0h",
    "ntprobnp":    "bnp_0h",   # blood-prognosis는 'bnp'로 받음
}


def _build_payload(lab_values: dict[str, float]) -> dict[str, Any]:
    """LabValues → blood-prognosis API 입력 형식."""
    payload: dict[str, Any] = {}
    for src_key, dst_key in _FIELD_MAP.items():
        if src_key in lab_values:
            payload[dst_key] = lab_values[src_key]
    return payload


async def predict_6h(lab_values: dict[str, float]) -> dict[str, Any] | None:
    """
    혈액검사 6시간 후 악화 예측 호출.

    Returns:
        {
          "hemoglobin_down": 0.72,
          "creatinine_up": 0.94,
          "potassium_worse": 0.38,
          "lactate_up": 0.40,
          "troponin_up": 0.12,
          "warnings": ["Hemoglobin 감소", "Creatinine 증가"],
          "troponin_note": null
        }
        실패 시 None.
    """
    if not BLOOD_PROGNOSIS_URL:
        logger.info("[prognosis] BLOOD_PROGNOSIS_URL 미설정 — skip")
        return None

    payload = _build_payload(lab_values)
    if not payload:
        logger.info("[prognosis] 입력 lab 값 없음 — skip")
        return None

    endpoint = f"{BLOOD_PROGNOSIS_URL.rstrip('/')}/predict_6h"
    logger.info(f"[prognosis] POST {endpoint} (features={list(payload.keys())})")

    try:
        async with httpx.AsyncClient(timeout=MODAL_HTTP_TIMEOUT) as client:
            resp = await client.post(endpoint, json=payload)
            resp.raise_for_status()
            result = resp.json()
        logger.info(
            f"[prognosis] 6h 예측: warnings={result.get('warnings')} "
            f"creatinine_up={result.get('creatinine_up'):.2f} "
            f"hemoglobin_down={result.get('hemoglobin_down'):.2f}"
        )
        return result
    except Exception as e:
        logger.warning(f"[prognosis] 호출 실패: {e}")
        return None
