"""Lab Modal Connector — Lab_Service POST /predict 호출 + fallback."""
import json
import logging
import os
from datetime import datetime

import requests

logger = logging.getLogger()
logger.setLevel(logging.INFO)

LAB_SERVICE_URL = os.environ.get("LAB_SERVICE_URL", "http://lab-svc:8000")
LAB_TIMEOUT = int(os.environ.get("LAB_TIMEOUT", "10"))


def _build_predict_payload(event: dict) -> dict:
    """event에서 Lab_Service POST /predict 요청 본문을 구성한다."""
    patient = event.get("patient", {})
    return {
        "patient_id": event.get("case_id", "unknown"),
        "patient_info": {
            "chief_complaint": patient.get("chief_complaint", ""),
        },
        "data": {
            "lab_values": patient.get("lab_values", {}),
        },
        "context": patient.get("context", {}),
    }


def _transform_response(resp_json: dict) -> dict:
    """Lab_Service 응답을 오케스트레이터 통일 스키마로 변환한다."""
    return {
        "modality": "LAB",
        "finding": resp_json.get("summary", ""),
        "confidence": 1.0,
        "details": {
            "findings": resp_json.get("findings", []),
            "risk_level": resp_json.get("risk_level", "routine"),
            "suggested_next_actions": resp_json.get("suggested_next_actions", []),
            "complaint_profile": resp_json.get("complaint_profile", "GENERAL"),
            "lab_summary": resp_json.get("lab_summary", []),
            "measurements": resp_json.get("measurements", {}),
        },
        "rationale": resp_json.get("summary", ""),
        "timestamp": resp_json.get("metadata", {}).get(
            "timestamp", datetime.utcnow().isoformat()
        ),
        "mock": False,
    }


def _fallback_response(case_id: str, error_msg: str) -> dict:
    """Lab_Service 호출 실패 시 fallback 응답을 반환한다."""
    logger.warning("Lab_Service 호출 실패, fallback 응답 반환: %s", error_msg)
    return {
        "modality": "LAB",
        "finding": "Lab 서비스 연결 실패 — fallback 응답",
        "confidence": 0.0,
        "details": {"error": error_msg},
        "rationale": "Lab 서비스에 연결할 수 없어 분석을 수행하지 못했습니다.",
        "timestamp": datetime.utcnow().isoformat(),
        "mock": True,
    }


def handler(event, context):
    """Lab Modal Connector — Lab_Service 호출 또는 fallback."""
    case_id = event.get("case_id", "unknown")
    logger.info("Lab connector invoked for case %s", case_id)

    try:
        payload = _build_predict_payload(event)
        url = f"{LAB_SERVICE_URL}/predict"

        resp = requests.post(url, json=payload, timeout=LAB_TIMEOUT)
        resp.raise_for_status()

        resp_json = resp.json()
        result = _transform_response(resp_json)
        logger.info(
            "Lab_Service 응답 수신: case=%s risk=%s",
            case_id, resp_json.get("risk_level"),
        )
        return result

    except requests.exceptions.ConnectionError as e:
        return _fallback_response(case_id, f"연결 실패: {e}")
    except requests.exceptions.Timeout as e:
        return _fallback_response(case_id, f"타임아웃: {e}")
    except requests.exceptions.HTTPError as e:
        return _fallback_response(case_id, f"HTTP 오류: {e}")
    except Exception as e:
        return _fallback_response(case_id, f"예상치 못한 오류: {type(e).__name__}: {e}")
