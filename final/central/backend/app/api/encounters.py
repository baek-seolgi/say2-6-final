"""
GET /encounters/* — Encounter 조회.

[이 파일이 하는 일]
프론트엔드에서 환자 데이터를 가져올 때 쓰는 조회 API.
FHIR 서버에서 해당 Encounter에 속한 데이터를 검색해서 반환.

[엔드포인트]
GET /encounters/{id}                  → Encounter 자체 정보
GET /encounters/{id}/observations     → 바이탈 + 모달 결과 (ECG/CXR)
GET /encounters/{id}/conditions       → 주호소 + 과거력
GET /encounters/{id}/service-requests → AI 제안 목록 (승인/기각 대기 중인 것)
GET /encounters/{id}/timeline         → 모달 진행 타임라인 (UI Exam Progress)

[호출하는 곳]
프론트엔드 대시보드에서 환자 선택 시
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from app.fhir import client as fhir
from app.db import client as db

router = APIRouter()


# ── 타임라인 단계 매핑 ───────────────────────────────────
# event_type → (UI stage label, 정렬 우선순위)
# 같은 stage_key의 가장 최신 event 1건을 단계 상태로 노출.
_STAGE_MAP: dict[str, tuple[str, str, int]] = {
    # event_type           : (stage_key,        ui_label,                       order)
    "encounter_created":     ("triage",          "Patient Arrival & Triage",     1),
    "order_placed":          ("order",           "Order Placed",                 2),
    "next_proposal":         ("order",           "Order Placed",                 2),
    "initial_proposal":      ("order",           "Order Placed",                 2),
    "modal_started":         ("modal_running",   "Imaging in Progress",          3),
    "modal_completed":       ("modal_done",      "Result Analysis",              4),
    "modal_failed":          ("modal_done",      "Result Analysis",              4),
    "ready_for_report":      ("ready",           "Ready for Report",             5),
    "report_generated":      ("report",          "Report Generated",             6),
    "report_signed":         ("signed",          "Final Transmission",           7),
}


@router.get("/{encounter_id}")
async def get_encounter(encounter_id: str):
    """단일 Encounter 조회."""
    try:
        return await fhir.read("Encounter", encounter_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{encounter_id}/observations")
async def get_encounter_observations(encounter_id: str):
    """해당 Encounter에 속한 Observation 목록."""
    try:
        return await fhir.search(
            "Observation", {"encounter": f"Encounter/{encounter_id}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{encounter_id}/conditions")
async def get_encounter_conditions(encounter_id: str):
    """해당 Encounter에 속한 Condition 목록."""
    try:
        return await fhir.search(
            "Condition", {"encounter": f"Encounter/{encounter_id}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{encounter_id}/service-requests")
async def get_encounter_service_requests(encounter_id: str):
    """해당 Encounter에 속한 ServiceRequest 목록."""
    try:
        return await fhir.search(
            "ServiceRequest", {"encounter": f"Encounter/{encounter_id}"}
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{encounter_id}/timeline")
async def get_encounter_timeline(encounter_id: str):
    """
    Exam Progress 타임라인 — modal_events 시계열을 UI 단계로 묶어 반환.

    응답 예:
      {
        "encounter_id": "1043",
        "events":  [...],   # 원본 이벤트 시계열 (생성순)
        "stages":  [        # UI 단계별 요약 (가장 최근 동일 stage 이벤트 기준)
          {"stage_key":"triage",        "label":"Patient Arrival & Triage", "status":"completed", "at":"..."},
          {"stage_key":"order",         "label":"Order Placed",             "status":"completed", "at":"...", "modality":"CXR"},
          {"stage_key":"modal_running", "label":"Imaging in Progress",      "status":"current",   "at":"...", "modality":"CXR"},
          ...
        ]
      }
    프론트는 stages를 그대로 그리면 위 목업 같은 진행 표시가 된다.
    """
    import json as _json
    rows = await db.fetch(
        """
        SELECT id, event_type, payload, created_at
        FROM modal_events
        WHERE encounter_id = $1
        ORDER BY created_at ASC, id ASC
        """,
        encounter_id,
    )

    def _payload(p):
        # asyncpg는 JSONB를 codec 미설정 시 str로 반환 → dict로 정규화
        if p is None:
            return {}
        if isinstance(p, str):
            try:
                return _json.loads(p)
            except Exception:
                return {}
        return p

    events = [
        {
            "id":         r["id"],
            "event_type": r["event_type"],
            "payload":    _payload(r["payload"]),
            "at":         r["created_at"].isoformat() if r["created_at"] else None,
        }
        for r in rows
    ]

    # 모달 관련 stage는 (stage_key, modality)별 1행, 그 외는 stage_key별 1행
    _MODAL_STAGES = {"order", "modal_running", "modal_done"}
    latest: dict[tuple, dict] = {}

    for ev in events:
        meta = _STAGE_MAP.get(ev["event_type"])
        if not meta:
            continue
        stage_key, label, order = meta
        modality = ev["payload"].get("modality")
        group_key = (stage_key, modality) if stage_key in _MODAL_STAGES else (stage_key, None)

        # 라벨에 모달명 prefix (UI: "CXR Order Placed", "ECG Imaging in Progress" 등)
        display_label = f"{modality} {label}" if (stage_key in _MODAL_STAGES and modality) else label
        latest[group_key] = {
            "stage_key": stage_key,
            "label":     display_label,
            "order":     order,
            "at":        ev["at"],
            "modality":  modality,
            "event":     ev["event_type"],
        }

    if not latest:
        return {"encounter_id": encounter_id, "events": events, "stages": []}

    # 시간순 정렬 → 가장 마지막이 current, 나머지는 completed
    stages = sorted(latest.values(), key=lambda x: (x["order"], x["at"] or ""))
    last_at = max(s["at"] or "" for s in stages)
    for s in stages:
        s["status"] = "current" if s["at"] == last_at else "completed"

    return {"encounter_id": encounter_id, "events": events, "stages": stages}
