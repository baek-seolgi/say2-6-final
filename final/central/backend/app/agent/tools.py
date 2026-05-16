"""
Agent tool 4종 — AI Agent가 FHIR 서버에 데이터를 쓰고 읽는 도구.

[이 파일이 하는 일]
AI Agent(FusionDecisionEngine)가 판단한 결과를 실제 행동으로 옮기는 함수들.

[함수 목록]
- propose_order(): AI가 "CXR 찍자"고 판단 → ServiceRequest(draft) 생성해서 FHIR에 저장
- get_encounter_context(): AI가 현재 환자 상태를 FHIR에서 읽어옴
  (어떤 검사가 완료됐는지, 결과가 뭔지 등)

[호출하는 곳]
- triage.py: 트리아지 후 초기 모달 제안 시 propose_order() 호출
- orders.py: 기각 후 대안 제안 시 propose_order() + get_encounter_context() 호출
"""
from __future__ import annotations

import logging
import uuid
from app.fhir import client as fhir
from app.fhir.resources import build_service_request
from app.fhir.codes import LOINC_MODALITY
from app.db import fhir_sync_queue as ops_fhir_queue

logger = logging.getLogger(__name__)


async def propose_order(
    patient_id: str,
    encounter_id: str,
    modality: str,
    reason_text: str,
    priority: str = "routine",
) -> dict:
    """Agent가 다음 모달을 제안 → ServiceRequest(draft) 생성.

    Graceful Degradation:
      - SR ID는 우리가 UUID로 발급 (HAPI 의존 X)
      - HAPI PUT 실패 시 fhir_sync_queue에 적재 후 ID 반환
      - 의사 화면은 HAPI 다운 모르고 정상 동작
    """
    modality_key = modality.lower()
    code_coding = {
        "system": "http://loinc.org",
        **(LOINC_MODALITY.get(modality_key, {"code": "unknown", "display": modality})),
    }
    sr_payload = build_service_request(
        patient_id, encounter_id, code_coding, reason_text, priority
    )

    sr_id = str(uuid.uuid4())  # 우리가 ID 발급
    try:
        result = await fhir.update("ServiceRequest", sr_id, sr_payload)
        logger.info(f"Agent proposed order: SR/{result['id']} for {modality}")
        return result
    except Exception as e:
        logger.warning(
            "[hapi] ServiceRequest 동기화 실패, 큐로: %s/%s err=%s",
            modality, sr_id, str(e)[:200],
        )
        await ops_fhir_queue.enqueue(
            encounter_id=encounter_id,
            patient_id=patient_id,
            resource_type="ServiceRequest",
            resource_id=sr_id,
            payload=sr_payload,
            last_error=str(e)[:500],
        )
        # 큐에 적재됐으니 ID 반환 — 의사 화면은 정상 동작
        return {"id": sr_id, "status": "draft", "_queued": True}


async def get_encounter_context(encounter_id: str) -> dict:
    """Agent가 현재 Encounter 상태를 읽어 반환."""
    encounter = await fhir.read("Encounter", encounter_id)
    observations = await fhir.search(
        "Observation", {"encounter": f"Encounter/{encounter_id}"}
    )
    conditions = await fhir.search(
        "Condition", {"encounter": f"Encounter/{encounter_id}"}
    )
    service_requests = await fhir.search(
        "ServiceRequest", {"encounter": f"Encounter/{encounter_id}"}
    )
    return {
        "encounter": encounter,
        "observations": observations,
        "conditions": conditions,
        "service_requests": service_requests,
    }
