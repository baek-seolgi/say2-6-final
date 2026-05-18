"""
진단 소견서 API.

[엔드포인트]
  POST /reports/{encounter_id}/generate  — Bedrock 기반 종합 소견서 초안 생성
  POST /reports/{dr_id}/sign             — 의사 최종 서명 (preliminary → final)

[설계]
- AI 추론 결과(ECG/CXR/Lab 원본)는 운영 DB modal_results에만 보관.
- Bedrock은 운영 DB에서 환자 컨텍스트 + 모달 원본을 직접 읽어 종합 판단.
- 생성된 초안은 운영 DB diagnostic_reports + FHIR DiagnosticReport(preliminary) 양쪽 저장.
- 의사 서명 시 FHIR status → final. 이 상태가 되어야 외부 EMR 연동 대상.
"""
from __future__ import annotations

import logging
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.fhir import client as fhir
from app.fhir.resources import build_diagnostic_report
from app.fhir.state_machine import (
    transition_diagnostic_report,
    transition_diagnostic_report_safe,
    InvalidTransitionError,
)
from app.api.ws import broadcast
from app.agent.report_generator import generate_integrated_report
from app.db import diagnostic_reports as ops_reports
from app.db import encounters as ops_encounters
from app.db import fhir_sync_queue as ops_fhir_queue

logger = logging.getLogger(__name__)
router = APIRouter()


class SignBody(BaseModel):
    signed_by: Optional[str] = None       # 의사 ID/이름
    physician_edits: Optional[str] = None # 의사 수정 내용 (선택)


class ReviewBody(BaseModel):
    physician_edits: Optional[str] = None # 의사 검토 중 본문 수정 내용 (선택)


# ── 종합 소견서 생성 ─────────────────────────────────────
@router.post("/{encounter_id}/generate")
async def generate_report(encounter_id: str):
    """
    운영 DB의 환자 컨텍스트 + 3개 모달 원본을 읽어
    Bedrock Claude로 종합 진단 소견서 생성.

    흐름:
      1. generate_integrated_report() → Claude 호출
      2. 운영 DB diagnostic_reports INSERT (preliminary)
      3. FHIR DiagnosticReport 생성 (preliminary)
      4. 운영 DB에 fhir_report_id 업데이트
      5. WebSocket report_generated 브로드캐스트
    """
    try:
        # Encounter 유효성 확인 (운영 DB 기준)
        encounter = await ops_encounters.get_encounter(encounter_id)
        if encounter is None:
            raise HTTPException(
                status_code=404,
                detail=f"Encounter not found: {encounter_id}",
            )
        # encounter_id/patient_id가 곧 FHIR ID (운영 DB schema 단순화 후)
        fhir_patient_id = str(encounter.get("patient_id"))
        fhir_encounter_id = encounter_id

        # 1. Bedrock 종합 판단 — narrative 자유서술 + RAG 사례 + 사용 모델
        report = await generate_integrated_report(encounter_id)
        narrative: str = report.get("narrative", "")
        model_used: str = report.get("model_used", "Haiku")
        similar_cases: list = report.get("similar_cases", [])

        # 2. 기존 소견서가 있는지 먼저 확인 (재생성 케이스 — FHIR PUT 대상)
        existing = await ops_reports.get_by_encounter(encounter_id)
        existing_fhir_id: str | None = (existing or {}).get("fhir_report_id")

        # 3. 운영 DB UPSERT — narrative를 ai_diagnosis 컬럼에 저장 (스키마 호환).
        #    risk_level은 클라이언트가 모달 max-aggregation으로 결정하므로 'routine' default.
        report_id = await ops_reports.insert_report(
            encounter_id=encounter_id,
            ai_diagnosis=narrative,
            ai_recommendations=[],   # narrative에 통합되어 있어 별도 추출 불필요
            ai_risk_level="routine",
        )

        # 4. FHIR DiagnosticReport 저장 — graceful (HAPI 다운 시 큐로)
        fhir_report_id: str | None = existing_fhir_id
        fhir_body = build_diagnostic_report(
            patient_id=fhir_patient_id,
            encounter_id=fhir_encounter_id,
            observation_ids=[],
            conclusion=narrative,
        )

        if not fhir_report_id:
            # 신규 — 우리가 UUID 발급
            import uuid as _uuid
            fhir_report_id = str(_uuid.uuid4())

        try:
            await fhir.update("DiagnosticReport", fhir_report_id, fhir_body)
            # 운영 DB에 FHIR ID 역참조 저장 (신규 생성 시에만 필요)
            if fhir_report_id != existing_fhir_id:
                from app.db import client as db
                await db.execute(
                    "UPDATE diagnostic_reports SET fhir_report_id = $2 WHERE id = $1",
                    report_id, fhir_report_id,
                )
        except Exception as e:
            logger.warning("[hapi] DiagnosticReport 동기화 실패, 큐로: %s", e)
            await ops_fhir_queue.enqueue(
                encounter_id=encounter_id, patient_id=fhir_patient_id,
                resource_type="DiagnosticReport",
                resource_id=fhir_report_id, payload=fhir_body,
                last_error=str(e)[:500],
            )
            # 운영 DB에는 우리가 발급한 fhir_report_id 그대로 저장
            if fhir_report_id != existing_fhir_id:
                try:
                    from app.db import client as db
                    await db.execute(
                        "UPDATE diagnostic_reports SET fhir_report_id = $2 WHERE id = $1",
                        report_id, fhir_report_id,
                    )
                except Exception as db_err:
                    logger.warning("[ops_db] fhir_report_id 저장 실패: %s", db_err)

        # 6. WebSocket 브로드캐스트
        await broadcast(encounter_id, {
            "event": "report_generated",
            "report_id": report_id,
            "fhir_report_id": fhir_report_id,
            "model_used": model_used,
            "payload": {"narrative": narrative},
        })

        return {
            "report_id": report_id,
            "fhir_report_id": fhir_report_id,
            "encounter_id": encounter_id,
            "subject_id": encounter.get("subject_id"),
            "patient_name": encounter.get("patient_name"),
            "status": "preliminary",
            "narrative": narrative,
            "model_used": model_used,
            "similar_cases": similar_cases,
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Report generate failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── 의사 서명 ───────────────────────────────────────────
@router.post("/{report_id}/sign")
async def sign_report(report_id: int, body: SignBody = SignBody()):
    """
    의사 최종 서명.
      - 운영 DB: status preliminary → signed
      - FHIR:    DiagnosticReport preliminary → final
      - 이 상태가 되어야 외부 EMR 연동 대상이 됨.
    """
    try:
        # 1. 운영 DB에서 소견서 조회 (fhir_report_id 획득)
        report = await ops_reports.get_report(report_id)
        if report is None:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        fhir_report_id = report.get("fhir_report_id")

        # 2. 의사 수정 사항 있으면 반영
        if body.physician_edits:
            await ops_reports.update_physician_edits(report_id, body.physician_edits)

        # 3. FHIR DiagnosticReport 상태 전이 — graceful
        if fhir_report_id:
            ok, err = await transition_diagnostic_report_safe(fhir_report_id, "final")
            if not ok:
                if isinstance(err, InvalidTransitionError):
                    raise HTTPException(status_code=409, detail=str(err))
                # HAPI 다운 → 큐로 적재, 운영 DB 서명은 계속
                logger.warning("[hapi] DR transition final 실패, 큐로: %s", err)
                await ops_fhir_queue.enqueue(
                    encounter_id=str(report.get("encounter_id", "")),
                    patient_id=None,
                    resource_type="DiagnosticReportTransition",
                    resource_id=fhir_report_id,
                    payload={"new_status": "final"},
                    last_error=str(err)[:500],
                )

        # 4. 운영 DB 서명 플래그
        await ops_reports.mark_signed(
            report_id=report_id,
            signed_by=body.signed_by or "physician",
            fhir_report_id=fhir_report_id,
        )

        # 5. WebSocket
        encounter_id = str(report.get("encounter_id", ""))
        if encounter_id:
            await broadcast(encounter_id, {
                "event": "report_signed",
                "report_id": report_id,
                "fhir_report_id": fhir_report_id,
                "signed_by": body.signed_by or "physician",
            })

        return {
            "report_id": report_id,
            "fhir_report_id": fhir_report_id,
            "encounter_id": encounter_id,
            "subject_id": report.get("subject_id"),
            "status": "signed",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Report sign failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── 의사 검토 — preliminary → reviewed ───────────────────
@router.patch("/{report_id}/review")
async def review_report(report_id: int, body: ReviewBody = ReviewBody()):
    """
    의사 검토 시작/저장.
      - 운영 DB: status preliminary → reviewed
      - physician_edits 가 있으면 본문 수정 내용도 저장 (검토 중 재저장 허용)
      - signed 상태인 소견서는 상태를 되돌리지 않음
    """
    try:
        report = await ops_reports.get_report(report_id)
        if report is None:
            raise HTTPException(status_code=404, detail=f"Report not found: {report_id}")

        await ops_reports.mark_reviewed(report_id, body.physician_edits)

        encounter_id = str(report.get("encounter_id", ""))
        if encounter_id:
            await broadcast(encounter_id, {
                "event": "report_reviewed",
                "report_id": report_id,
            })

        return {
            "report_id": report_id,
            "encounter_id": encounter_id,
            "status": "reviewed",
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Report review failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── encounter별 최신 소견서 조회 ─────────────────────────
@router.get("/by-encounter/{encounter_id}")
async def get_report_by_encounter(encounter_id: str):
    """해당 encounter의 최신 소견서 조회. 없으면 null."""
    return await ops_reports.get_by_encounter(encounter_id)


# ── 소견서 목록 (status 필터) ────────────────────────────
@router.get("/list")
async def list_reports(status: Optional[str] = None, limit: int = 50):
    """
    소견서 목록 — status 필터 가능 (preliminary / reviewed / signed).
    종합소견서 페이지 / 환자 목록의 검토·서명 대기 리스트용.
    """
    return await ops_reports.list_recent(limit=limit, status=status)


@router.get("/unsigned-count")
async def get_unsigned_count():
    """
    미서명 소견서 개수 — AppShell 상단 알림 뱃지 자동 갱신용.
    의사가 화면 어디서든 "검토·서명 대기 중인 소견서가 N건"을 한눈에 보게.
    """
    from app.db import client as _db
    row = await _db.fetchone(
        "SELECT COUNT(*)::int AS n FROM diagnostic_reports WHERE status <> 'signed'"
    )
    return {"unsigned_count": int(row["n"] if row else 0)}
