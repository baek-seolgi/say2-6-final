"""
diagnostic_reports 테이블 CRUD 헬퍼.

[이 파일이 하는 일]
Bedrock이 생성한 종합 진단 소견서를 운영 DB에 저장/조회.
의사가 서명하면 status: preliminary → signed 로 전이되고,
이때 FHIR DiagnosticReport.status도 final로 바뀌어 EMR 외부 연동 대상이 된다.
"""
from __future__ import annotations

import json
import logging
from typing import Any

from app.db import client as db

logger = logging.getLogger(__name__)


async def insert_report(
    encounter_id: str,
    ai_diagnosis: str,
    ai_recommendations: list[dict[str, Any]] | None = None,
    ai_risk_level: str | None = None,
    fhir_report_id: str | None = None,
) -> str:
    """
    AI 소견서 초안(preliminary) UPSERT. report_id 반환.

    - 동일 encounter에 preliminary가 이미 있으면 덮어씀(재생성 케이스).
    - 이미 signed면 에러 — 서명된 소견서는 덮어쓰지 않음.
    """
    row = await db.fetchone(
        """
        INSERT INTO diagnostic_reports (
            encounter_id, fhir_report_id, ai_diagnosis,
            ai_recommendations, ai_risk_level, status
        )
        VALUES ($1, $2, $3, $4::jsonb, $5, 'preliminary')
        ON CONFLICT (encounter_id) DO UPDATE SET
            fhir_report_id     = COALESCE(EXCLUDED.fhir_report_id, diagnostic_reports.fhir_report_id),
            ai_diagnosis       = EXCLUDED.ai_diagnosis,
            ai_recommendations = EXCLUDED.ai_recommendations,
            ai_risk_level      = EXCLUDED.ai_risk_level,
            physician_edits    = NULL,
            status             = 'preliminary'
        WHERE diagnostic_reports.status <> 'signed'
        RETURNING id
        """,
        encounter_id,
        fhir_report_id,
        ai_diagnosis,
        json.dumps(ai_recommendations or [], ensure_ascii=False),
        ai_risk_level,
    )
    if row is None:
        raise ValueError(
            f"Cannot regenerate report: encounter {encounter_id} already has a signed report"
        )
    report_id = str(row["id"])
    logger.info(
        "[diagnostic_reports] upserted: %s (enc=%s, risk=%s)",
        report_id, encounter_id, ai_risk_level,
    )
    return report_id


async def get_report(report_id: int) -> dict[str, Any] | None:
    row = await db.fetchone(
        "SELECT * FROM diagnostic_reports WHERE id = $1", report_id,
    )
    if row is None:
        return None
    d = dict(row)
    if isinstance(d.get("ai_recommendations"), str):
        d["ai_recommendations"] = json.loads(d["ai_recommendations"])
    return d


async def get_by_encounter(encounter_id: str) -> dict[str, Any] | None:
    """해당 encounter의 최신 소견서 조회."""
    row = await db.fetchone(
        """
        SELECT * FROM diagnostic_reports
        WHERE encounter_id = $1
        ORDER BY created_at DESC
        LIMIT 1
        """,
        encounter_id,
    )
    if row is None:
        return None
    d = dict(row)
    if isinstance(d.get("ai_recommendations"), str):
        d["ai_recommendations"] = json.loads(d["ai_recommendations"])
    return d


async def update_physician_edits(
    report_id: int,
    physician_edits: str,
) -> None:
    """의사 수정 내용 반영."""
    await db.execute(
        """
        UPDATE diagnostic_reports
        SET physician_edits = $2
        WHERE id = $1
        """,
        report_id, physician_edits,
    )


async def mark_reviewed(
    report_id: int,
    physician_edits: str | None = None,
) -> None:
    """
    의사 검토 — status: preliminary → reviewed.
    이미 signed 인 소견서는 상태를 되돌리지 않는다.
    physician_edits가 주어지면 본문 수정 내용도 함께 저장 (검토 중 재저장 허용).
    """
    await db.execute(
        """
        UPDATE diagnostic_reports
        SET status = CASE WHEN status = 'signed' THEN status ELSE 'reviewed' END,
            physician_edits = COALESCE($2, physician_edits)
        WHERE id = $1
        """,
        report_id, physician_edits,
    )


async def mark_signed(
    report_id: int,
    signed_by: str,
    fhir_report_id: str | None = None,
) -> None:
    """의사 서명 → status: preliminary → signed. 이후 EMR 연동 대상."""
    if fhir_report_id:
        await db.execute(
            """
            UPDATE diagnostic_reports
            SET status = 'signed',
                signed_by = $2,
                signed_at = NOW(),
                fhir_report_id = $3
            WHERE id = $1
            """,
            report_id, signed_by, fhir_report_id,
        )
    else:
        await db.execute(
            """
            UPDATE diagnostic_reports
            SET status = 'signed',
                signed_by = $2,
                signed_at = NOW()
            WHERE id = $1
            """,
            report_id, signed_by,
        )


async def list_recent(
    limit: int = 20,
    status: str | None = None,
) -> list[dict[str, Any]]:
    """소견서 목록 + encounters JOIN으로 subject_id 동봉.

    프론트(WorklistPage/ReportListPage)가 데모 환자(P-{subject_id})와 backend
    encounter_id를 매칭할 키가 없어서 subject_id를 함께 내려준다.
    """
    if status:
        rows = await db.fetch(
            """
            SELECT dr.id, dr.encounter_id, e.subject_id,
                   e.patient_name, e.chief_complaint,
                   dr.ai_risk_level, dr.status, dr.created_at, dr.signed_at
            FROM diagnostic_reports dr
            LEFT JOIN encounters e ON e.encounter_id = dr.encounter_id
            WHERE dr.status = $2
            ORDER BY dr.created_at DESC
            LIMIT $1
            """,
            limit, status,
        )
    else:
        rows = await db.fetch(
            """
            SELECT dr.id, dr.encounter_id, e.subject_id,
                   e.patient_name, e.chief_complaint,
                   dr.ai_risk_level, dr.status, dr.created_at, dr.signed_at
            FROM diagnostic_reports dr
            LEFT JOIN encounters e ON e.encounter_id = dr.encounter_id
            ORDER BY dr.created_at DESC
            LIMIT $1
            """,
            limit,
        )
    return [dict(r) for r in rows]
