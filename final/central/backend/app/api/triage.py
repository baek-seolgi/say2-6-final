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

import logging
from fastapi import APIRouter, HTTPException
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


@router.post("/submit")
async def submit_triage(form: TriageSubmission):
    """
    §7.1 POST 순서:
    1. Patient (참조 없음)
    2. Encounter (Patient 참조)
    3. 나머지 (Observation, Condition)
    """
    try:
        # 1) Patient
        patient_res = await fhir.create(
            "Patient", build_patient(form.patient.model_dump())
        )
        patient_id = patient_res["id"]

        # 2) Encounter (notes 있으면 Encounter.note에 첨부)
        encounter_res = await fhir.create(
            "Encounter",
            build_encounter(
                patient_id,
                form.chief_complaint.model_dump(),
                notes=form.notes,
            ),
        )
        encounter_id = encounter_res["id"]

        # ⭐ 운영 DB에도 encounter 등록 (이후 모달 결과/리포트가 참조)
        #   FHIR 쓰기는 이미 완료된 시점이므로 여기서 실패해도 프론트엔 영향 없음
        #   Bedrock 종합 판단 시 환자 컨텍스트(바이탈+과거력)를 한 번에 읽도록 metadata에 포함
        try:
            await ops_encounters.insert_encounter(
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
                    "onset_minutes_ago": form.chief_complaint.onset_minutes_ago,
                    # MIMIC 원본 데이터 식별자 (모달 호출 시 S3 경로로 사용)
                    "mimic": form.mimic.model_dump() if form.mimic else None,
                },
            )
        except Exception as e:
            logger.warning("[ops_db] encounter insert 실패: %s", e)

        # 타임라인용 — 환자 도착 & 트리아지 단계 시작
        await broadcast(encounter_id, {
            "event": "encounter_created",
            "patient_name": form.patient.name,
            "chief_complaint": form.chief_complaint.text,
        })

        # 3-a) Vitals Bundle (transaction)
        vitals_bundle = build_vitals_bundle(
            patient_id, encounter_id, form.vitals.model_dump()
        )
        await fhir.transaction(vitals_bundle)

        # 3-b) Chief Complaint (Condition)
        cc_res = await fhir.create(
            "Condition",
            build_chief_complaint(
                patient_id, encounter_id, form.chief_complaint.model_dump()
            ),
        )

        # 3-c) Past History (Bundle)
        if form.past_history:
            history_bundle = build_past_history(
                patient_id,
                [h.model_dump() for h in form.past_history],
            )
            await fhir.transaction(history_bundle)

        # 3-d) AllergyIntolerance (NKDA가 아닐 때만)
        if form.allergies:
            allergy_res = build_allergy_intolerance(patient_id, form.allergies)
            if allergy_res:
                try:
                    await fhir.create("AllergyIntolerance", allergy_res)
                    logger.info(f"[fhir] AllergyIntolerance 저장: {form.allergies}")
                except Exception as e:
                    logger.warning(f"[fhir] AllergyIntolerance 저장 실패: {e}")

        # 3-e) MedicationStatement (복용약물)
        if form.medications:
            med_res = build_medication_statement(
                patient_id, encounter_id, form.medications
            )
            if med_res:
                try:
                    await fhir.create("MedicationStatement", med_res)
                    logger.info(f"[fhir] MedicationStatement 저장: {form.medications[:50]}…")
                except Exception as e:
                    logger.warning(f"[fhir] MedicationStatement 저장 실패: {e}")

        # ── 4) FusionDecisionEngine 호출 → 초기 모달 제안 ──
        central_patient = {
            "age": form.patient.age,
            "sex": form.patient.gender.capitalize(),
            "chief_complaint": form.chief_complaint.text,
            "vitals": form.vitals.model_dump(),
        }

        engine = FusionDecisionEngine(
            patient=central_patient,
            modalities_completed=[],
            inference_results=[],
            iteration=1,
        )
        decision = engine.decide()

        # AI 우선 모달 1개만 SR(draft) 생성 — 프론트 [Proceed X] 버튼에 바인딩
        # 의사가 필요하면 [Order ECG]/[Order LAB] 버튼으로 다른 모달을 직접 오더 가능.
        next_modalities = decision.get("next_modalities", [])
        primary_modality = next_modalities[0] if next_modalities else None

        primary_sr_id: str | None = None
        if primary_modality:
            sr_res = await propose_order(
                patient_id=patient_id,
                encounter_id=encounter_id,
                modality=primary_modality,
                reason_text=decision.get("rationale", ""),
                priority="urgent" if decision.get("risk_level") == "high" else "routine",
            )
            primary_sr_id = sr_res["id"]

            # 타임라인용 — 오더(ServiceRequest) 생성됨 (UI: "ECG/CXR/LAB Order Placed")
            await broadcast(encounter_id, {
                "event": "order_placed",
                "service_request_id": primary_sr_id,
                "modality": primary_modality,
            })

        # WebSocket으로 프론트에 푸시 (AI 최우선 추천 + 판단 근거)
        await broadcast(encounter_id, {
            "event": "initial_proposal",
            "service_request_id": primary_sr_id,
            "modality": primary_modality,
            "rationale": decision.get("rationale", ""),
            "risk_level": decision.get("risk_level", "unknown"),
            "all_suggested": next_modalities,  # 참고용 — 프론트는 primary만 Proceed 버튼으로
        })

        return {
            "patient_id": patient_id,
            "encounter_id": encounter_id,
            "chief_complaint_id": cc_res["id"],
            "primary_modality": primary_modality,
            "service_request_id": primary_sr_id,
            "rationale": decision.get("rationale", ""),
            "risk_level": decision.get("risk_level", "unknown"),
            "status": "created",
        }

    except Exception as e:
        logger.exception("Triage submit failed")
        raise HTTPException(status_code=500, detail=str(e))
