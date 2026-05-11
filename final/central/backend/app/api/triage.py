"""
POST /triage/submit — 트리아지 제출 엔드포인트.

[이 파일이 하는 일]
간호사가 환자 정보를 입력하면 이 API가 받아서:
1. Patient (환자 정보) → FHIR 서버에 저장
2. Encounter (이번 ED 방문) → FHIR 서버에 저장
3. Observation (바이탈 6개) → FHIR 서버에 저장
4. Condition (주호소 + 과거력) → FHIR 서버에 저장
5. FusionDecisionEngine 호출 → "어떤 검사할지" AI가 판단
6. ServiceRequest (검사 제안) → FHIR 서버에 저장
7. WebSocket으로 프론트에 "AI가 CXR, ECG를 권고합니다" 푸시

[호출하는 곳]
프론트엔드 트리아지 폼에서 POST /triage/submit 호출

[FHIR 설명]
FHIR은 의료 데이터 국제 표준 규격이에요.
이 파일에서 build_patient(), build_encounter() 등을 호출하면
resources.py가 우리 데이터를 FHIR 규격 JSON으로 변환하고,
client.py가 그 JSON을 HAPI FHIR 서버(=DB)에 저장합니다.
"""
from __future__ import annotations

import asyncio
import logging
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.fhir import client as fhir
from app.fhir.resources import (
    build_patient,
    build_encounter,
    build_vitals_bundle,
    build_chief_complaint,
    build_past_history,
    build_allergy_intolerance,
    build_medication_statement,
)
from app.agent.decision_engine import FusionDecisionEngine
from app.agent.tools import propose_order
from app.api.ws import broadcast
from app.db import encounters as ops_encounters

logger = logging.getLogger(__name__)
router = APIRouter()


# ── Request Schema (§6.1) ────────────────────────────────
class PatientForm(BaseModel):
    age: int
    gender: str  # male | female | other
    name: Optional[str] = None


class VitalsForm(BaseModel):
    hr: float
    sbp: float
    dbp: float
    spo2: float
    rr: float
    temp: float
    gcs: float


class ChiefComplaintForm(BaseModel):
    text: str
    detail: Optional[str] = None         # 자유서술 (예: "혈뇨로 내원, 투석 미시행")
    onset_minutes_ago: Optional[int] = None
    code_hint: Optional[str] = None


class PastHistoryItem(BaseModel):
    text: str
    code_hint: Optional[str] = None


class MimicIdentifier(BaseModel):
    """
    MIMIC-IV 원본 데이터 식별자 (데모용).

    ECG 서비스: data.record_path로 S3 WFDB 경로 전달 (확장자 없이)
    CXR 서비스: 중앙백엔드가 S3에서 이미지 다운로드 후 base64로 변환해 전달

    예시 경로:
      ecg_record_path:
        s3://say2-6team/mimic/ecg/waveforms/files/p1816/p18161880/s40985856/40985856
      cxr_image_path:
        s3://say2-6team/mimic/cxr/files/p18/p18161880/s12345678/abcdef.jpg
    """
    subject_id: Optional[str] = None
    ecg_record_path: Optional[str] = None   # S3 URI, ECG 서비스로 그대로 전달
    cxr_image_path: Optional[str] = None    # S3 URI, 중앙이 다운로드 → base64


class TriageSubmission(BaseModel):
    patient: PatientForm
    vitals: VitalsForm
    chief_complaint: ChiefComplaintForm
    past_history: list[PastHistoryItem] = []
    mimic: Optional[MimicIdentifier] = None   # 데모용: MIMIC 원본 데이터 식별자

    # 신규 — 환자 추가 정보 (진짜 FHIR 저장)
    allergies: Optional[str] = None      # AllergyIntolerance 리소스로 저장
    medications: Optional[str] = None    # MedicationStatement 리소스로 저장
    notes: Optional[str] = None          # Encounter.note에 첨부


async def _write_secondary_resources(
    patient_id: str,
    encounter_id: str,
    form: "TriageSubmission",
    cc_res: dict,
):
    """
    핵심 응답(Patient/Encounter/Condition/SR) 후에 백그라운드로 쓰는 부수 리소스.
    실패해도 핵심 흐름엔 영향 없음. asyncio.gather로 병렬 처리.
    """
    coros = []

    # Vitals Bundle
    vitals_bundle = build_vitals_bundle(
        patient_id, encounter_id, form.vitals.model_dump()
    )
    coros.append(fhir.transaction(vitals_bundle))

    # Past History Bundle
    if form.past_history:
        history_bundle = build_past_history(
            patient_id, [h.model_dump() for h in form.past_history]
        )
        coros.append(fhir.transaction(history_bundle))

    # AllergyIntolerance (NKDA가 아닐 때만)
    if form.allergies:
        allergy_res = build_allergy_intolerance(patient_id, form.allergies)
        if allergy_res:
            coros.append(fhir.create("AllergyIntolerance", allergy_res))

    # MedicationStatement
    if form.medications:
        med_res = build_medication_statement(patient_id, encounter_id, form.medications)
        if med_res:
            coros.append(fhir.create("MedicationStatement", med_res))

    # 모두 병렬 실행 (HAPI 동시 처리)
    results = await asyncio.gather(*coros, return_exceptions=True)
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"[bg] 부수 FHIR 리소스 저장 실패: {r}")

    logger.info(
        f"[bg] enc={encounter_id} 부수 리소스 {len(coros)}개 처리 완료 "
        f"(cc_id={cc_res.get('id')})"
    )


@router.post("/submit")
async def submit_triage(form: TriageSubmission, background_tasks: BackgroundTasks):
    """
    핵심 응답 경로 (sync, ~1.5초):
      1. Patient → 2. Encounter → 3. ops_db insert
      4. Chief Complaint Condition (cc_id 응답에 포함)
      5. AI 결정 → Primary ServiceRequest (sr_id 응답에 포함)

    백그라운드 (응답 후, ~3-4초):
      Vitals · Past History · AllergyIntolerance · MedicationStatement
    """
    try:
        # Get ML models from app state
        from fastapi import Request
        from app.main import app
        
        ml_models_initial = getattr(app.state, 'ml_models_initial', None)
        ml_models_followup = getattr(app.state, 'ml_models_followup', None)
        ml_metadata_initial = getattr(app.state, 'ml_metadata_initial', None)
        ml_metadata_followup = getattr(app.state, 'ml_metadata_followup', None)
        cc_map = getattr(app.state, 'cc_map', None)
        feature_extractor = getattr(app.state, 'feature_extractor', None)
        
        # ── 1) Patient + Encounter (직렬, encounter_id 필요) ─
        patient_res = await fhir.create(
            "Patient", build_patient(form.patient.model_dump())
        )
        patient_id = patient_res["id"]

        encounter_res = await fhir.create(
            "Encounter",
            build_encounter(
                patient_id,
                form.chief_complaint.model_dump(),
                notes=form.notes,
            ),
        )
        encounter_id = encounter_res["id"]

        # ── 2) ops_db insert + Chief Complaint Condition (병렬) ─
        ops_insert_coro = ops_encounters.insert_encounter(
            patient_id=patient_id,
            fhir_encounter_id=encounter_id,
            fhir_patient_id=patient_id,
            chief_complaint=form.chief_complaint.text,
            patient_name=form.patient.name,
            patient_age=form.patient.age,
            patient_gender=form.patient.gender,
            metadata={
                "vitals": form.vitals.model_dump(),
                "past_history": [h.text for h in form.past_history],
                "complaint_detail": form.chief_complaint.detail,
                "onset_minutes_ago": form.chief_complaint.onset_minutes_ago,
                "mimic": form.mimic.model_dump() if form.mimic else None,
            },
        )
        cc_create_coro = fhir.create(
            "Condition",
            build_chief_complaint(
                patient_id, encounter_id, form.chief_complaint.model_dump()
            ),
        )
        ops_result, cc_res = await asyncio.gather(
            ops_insert_coro, cc_create_coro, return_exceptions=True
        )
        if isinstance(ops_result, Exception):
            logger.warning("[ops_db] encounter insert 실패: %s", ops_result)
        if isinstance(cc_res, Exception):
            raise cc_res  # cc_id가 응답에 필요하므로 실패하면 전체 실패

        # ── 3) AI 결정 + Primary SR (sync, sr_id 응답에 포함) ─
        central_patient = {
            "age": form.patient.age,
            "sex": form.patient.gender.capitalize(),
            "chief_complaint": form.chief_complaint.text,
            "complaint_detail": form.chief_complaint.detail or form.chief_complaint.text or "",
            "past_history": [h.text for h in form.past_history],
            "vitals": form.vitals.model_dump(),
        }
        
        # Use HybridDecisionEngine with ML models
        from app.agent.decision_engine import HybridDecisionEngine
        
        engine = HybridDecisionEngine(
            patient=central_patient,
            modalities_completed=[],
            inference_results=[],
            iteration=1,
            ml_models_initial=ml_models_initial,
            ml_models_followup=ml_models_followup,
            ml_metadata_initial=ml_metadata_initial,
            ml_metadata_followup=ml_metadata_followup,
            cc_map=cc_map,
            feature_extractor=feature_extractor,
        )
        decision = engine.decide()
        next_modalities = decision.get("next_modalities", [])
        is_parallel = bool(decision.get("parallel"))
        primary_modality = next_modalities[0] if next_modalities else None
        priority_level = "urgent" if decision.get("risk_level") == "high" else "routine"

        # parallel=True면 모든 modality에 SR 동시 생성 (병렬 오더 — 임상 가이드라인)
        # 그렇지 않으면 첫 번째(primary)만 SR 생성 (순차)
        primary_sr_id: str | None = None
        all_sr_ids: list[str] = []
        sr_by_modality: list[tuple[str, str]] = []  # [(modality, sr_id), ...]
        target_modalities = next_modalities if is_parallel else next_modalities[:1]

        for mod in target_modalities:
            sr_res = await propose_order(
                patient_id=patient_id,
                encounter_id=encounter_id,
                modality=mod,
                reason_text=decision.get("rationale", ""),
                priority=priority_level,
            )
            all_sr_ids.append(sr_res["id"])
            sr_by_modality.append((mod, sr_res["id"]))
            if primary_sr_id is None:
                primary_sr_id = sr_res["id"]

        # ── 4) 백그라운드: Vitals / Past History / Allergy / Medication 병렬 ─
        background_tasks.add_task(
            _write_secondary_resources, patient_id, encounter_id, form, cc_res
        )

        # ── 5) WebSocket broadcast (응답 후 어차피 캐치되므로 백그라운드로) ─
        async def _broadcast_events():
            await broadcast(encounter_id, {
                "event": "encounter_created",
                "patient_name": form.patient.name,
                "chief_complaint": form.chief_complaint.text,
            })
            # 병렬 주문 시 modality별로 모두 emit (timeline에 ECG/LAB 둘 다 보이도록)
            for mod, sr_id in sr_by_modality:
                await broadcast(encounter_id, {
                    "event": "order_placed",
                    "service_request_id": sr_id,
                    "modality": mod,
                    "parallel": is_parallel,
                })
            # initial_proposal도 modality별로 (병렬이면 N건, 순차면 1건)
            for mod, sr_id in sr_by_modality:
                await broadcast(encounter_id, {
                    "event": "initial_proposal",
                    "service_request_id": sr_id,
                    "modality": mod,
                    "rationale": decision.get("rationale", ""),
                    "risk_level": decision.get("risk_level", "unknown"),
                    "all_suggested": next_modalities,
                    "parallel": is_parallel,
                })
        background_tasks.add_task(_broadcast_events)

        return {
            "patient_id": patient_id,
            "encounter_id": encounter_id,
            "chief_complaint_id": cc_res["id"],
            "primary_modality": primary_modality,
            "service_request_id": primary_sr_id,
            "all_service_request_ids": all_sr_ids,
            "all_modalities": target_modalities,
            "parallel": is_parallel,
            "rationale": decision.get("rationale", ""),
            "risk_level": decision.get("risk_level", "unknown"),
            "status": "created",
        }

    except Exception as e:
        logger.exception("Triage submit failed")
        raise HTTPException(status_code=500, detail=str(e))
