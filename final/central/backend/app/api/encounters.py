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
GET /encounters/{id}/modal-results    → ops_modal_results의 raw_response (대시보드용)

[호출하는 곳]
프론트엔드 대시보드에서 환자 선택 시
"""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from app.fhir import client as fhir
from app.db import client as db

router = APIRouter()


@router.get("/list")
async def list_encounters(status: str = "active", limit: int = 50):
    """
    환자 목록 (워크리스트) — 최근 encounter들을 DB에서 직접 조회.

    [용도]
    - 웹 프론트엔드 환자 목록 페이지
    - 모바일 앱 worklist 화면

    [파라미터]
    - status: 'active' (기본) | 'closed' | 'all'
    - limit: 최대 행 수 (기본 50)

    [응답]
    - report_status: 'preliminary'/'reviewed'/'signed' (소견서 있을 때만)
    - ai_risk_level: 'routine'/'urgent'/'critical' (소견서 있을 때만)
    """
    # 같은 subject_id(중복 환자)는 최신 1건만 노출.
    # subject_id가 null인 row(MIMIC ID 없는 일반 입력)는 encounter_id::text로 fallback
    # → DISTINCT-ON 키가 unique해져서 dedup이 no-op.
    rows = await db.fetch(
        """
        SELECT
            e.encounter_id,
            e.patient_id,
            e.subject_id,
            e.patient_name,
            e.patient_age,
            e.patient_gender,
            e.chief_complaint,
            e.started_at,
            e.status,
            dr.status         AS report_status,
            dr.ai_risk_level  AS ai_risk_level
        FROM (
            SELECT DISTINCT ON (COALESCE(subject_id, encounter_id::text))
                   encounter_id, patient_id, subject_id, patient_name,
                   patient_age, patient_gender, chief_complaint,
                   started_at, status
            FROM encounters
            WHERE ($1 = 'all' OR status = $1)
            ORDER BY COALESCE(subject_id, encounter_id::text), started_at DESC
        ) e
        LEFT JOIN diagnostic_reports dr ON dr.encounter_id = e.encounter_id
        ORDER BY e.started_at DESC
        LIMIT $2
        """,
        status,
        int(limit),
    )
    return [dict(r) for r in rows]


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
    """단일 Encounter 조회 (FHIR R4)."""
    try:
        return await fhir.read("Encounter", encounter_id)
    except Exception as e:
        raise HTTPException(status_code=404, detail=str(e))


@router.get("/{encounter_id}/patient-info")
async def get_encounter_patient_info(encounter_id: str):
    """
    경량 환자 정보 — 모달 검사결과지 헤더용.

    /list 와 동일한 shape를 단건으로 돌려줘 모바일·웹이 한 번에 인적사항을 받음.
    subject_id 가 있어야 /assets/cxr/{subject_id} 이미지 로드 가능.
    """
    row = await db.fetchone(
        """
        SELECT
            e.encounter_id,
            e.subject_id,
            e.patient_name,
            e.patient_age,
            e.patient_gender,
            e.chief_complaint,
            dr.ai_risk_level
        FROM encounters e
        LEFT JOIN diagnostic_reports dr ON dr.encounter_id = e.encounter_id
        WHERE e.encounter_id = $1
        """,
        encounter_id,
    )
    if not row:
        raise HTTPException(status_code=404, detail="encounter not found")
    return dict(row)


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


@router.get("/{encounter_id}/modal-results")
async def get_encounter_modal_results(encounter_id: str):
    """
    이 encounter의 모든 모달 raw_response 반환.
    프론트 대시보드가 CXR/ECG/LAB 탭별로 결과 그릴 때 사용.

    응답 예:
      {
        "encounter_id": "1152",
        "results": {
          "CXR": { ...chest-svc-pre PredictResponse... },
          "ECG": { ...ecg-svc PredictResponse... },
          "LAB": { ...lab-svc PredictResponse... }
        }
      }
    """
    from app.db import modal_results as ops_modal_results

    try:
        all_raws = await ops_modal_results.get_all_modal_results(encounter_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"modal-results 조회 실패: {e}") from e

    return {"encounter_id": encounter_id, "results": all_raws}
