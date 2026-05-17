"""
POST /orders/{id}/approve | reject — ServiceRequest 상태 전이.

[이 파일이 하는 일]
AI가 "CXR 찍자"고 제안(ServiceRequest)하면, 의사가 승인 or 기각하는 API.

승인 흐름:
  1. ServiceRequest 상태: draft → active (FHIR PATCH)
  2. DocumentReference 등록 (원본 파일 URL을 FHIR에 기록)
  3. 모달 서비스(ECG/CXR) 호출 (백그라운드)
  4. 결과를 FHIR Observation으로 변환 후 저장
  5. ServiceRequest 상태: active → completed
  6. WebSocket으로 프론트에 결과 푸시

기각 흐름:
  1. ServiceRequest 상태: draft → revoked (FHIR PATCH)
  2. 기각 사유를 note에 기록
  3. AI Agent가 대안 모달 제안 (새 ServiceRequest 생성)
  4. WebSocket으로 프론트에 새 제안 푸시

[호출하는 곳]
프론트엔드 대시보드에서 승인/기각 버튼 클릭 시

[FHIR 설명]
ServiceRequest = "검사 오더". AI가 제안하면 draft, 의사가 승인하면 active,
모달 실행 완료하면 completed. 이 상태 전이가 FHIR 표준 방식이에요.
"""
from __future__ import annotations

import asyncio
import logging
from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
from typing import Optional

from app.fhir import client as fhir
from app.fhir.state_machine import (
    transition_service_request,
    transition_service_request_safe,
    InvalidTransitionError,
)
from app.fhir.resources import (
    build_diagnostic_report,
    build_document_reference,
)
from app.api.ws import broadcast
from app.clients.modal_http import invoke_modal, ModalCallError, MODAL_SERVICE_URLS
from app.db import modal_results as ops_modal_results
from app.db import fhir_sync_queue as ops_fhir_queue

logger = logging.getLogger(__name__)
router = APIRouter()


# ── 모달 실행 백그라운드 태스크 ───────────────────────────
async def _execute_modal_and_complete(sr_id: str, sr: dict):
    """
    승인된 ServiceRequest의 모달을 실행하고,
    결과 Observation 저장 → SR completed → WS 푸시.
    """
    encounter_ref = sr.get("encounter", {}).get("reference", "")
    patient_ref = sr.get("subject", {}).get("reference", "")
    encounter_id = encounter_ref.replace("Encounter/", "")
    patient_id = patient_ref.replace("Patient/", "")

    # SR의 code에서 모달 종류 추출
    code_coding = sr.get("code", {}).get("coding", [{}])[0]
    modality = _detect_modality(code_coding)

    try:
        # DocumentReference 등록 — graceful (HAPI 다운 시 큐로)
        docref_id = None
        docref_info = _get_docref_info(modality)
        if docref_info:
            import uuid as _uuid
            docref_id = str(_uuid.uuid4())
            docref_payload = build_document_reference(
                patient_id, encounter_id, **docref_info
            )
            try:
                await fhir.update("DocumentReference", docref_id, docref_payload)
            except Exception as e:
                logger.warning("[hapi] DocumentReference 동기화 실패, 큐로: %s", e)
                await ops_fhir_queue.enqueue(
                    encounter_id=encounter_id, patient_id=patient_id,
                    resource_type="DocumentReference",
                    resource_id=docref_id,
                    payload=docref_payload,
                    last_error=str(e)[:500],
                )

        # 타임라인용 — 모달 호출 시작 (UI: "Imaging in Progress")
        await broadcast(encounter_id, {
            "event": "modal_started",
            "service_request_id": sr_id,
            "modality": modality,
        })

        # 모달 서비스 호출 (URL 설정되어 있으면 HTTP, 아니면 mock)
        service_url = MODAL_SERVICE_URLS.get(modality, "")
        if service_url:
            payload = await _build_modal_payload(
                modality=modality,
                patient_id=patient_id,
                encounter_id=encounter_id,
                docref_info=docref_info,
            )
            try:
                modal_result = await invoke_modal(modality, payload)
            except ModalCallError as e:
                logger.warning(
                    f"[modal] {modality} 호출 실패 → mock으로 폴백: {e}"
                )
                modal_result = _mock_modal_result(modality)
        else:
            modal_result = _mock_modal_result(modality)

        # LAB 모달 추가: 6시간 후 악화 예측(blood_docker XGBoost)도 호출하여
        # raw_response.prognosis_6h 에 병합 저장. Bedrock 종합 판단 시 함께 활용.
        if modality == "LAB":
            try:
                lab_values = (payload or {}).get("data", {}).get("lab_values", {}) or {}
                if lab_values:
                    from app.clients.blood_prognosis import predict_6h
                    prognosis = await predict_6h(lab_values)
                    if prognosis:
                        modal_result["prognosis_6h"] = prognosis
                        # summary 끝에 한 줄 요약 추가
                        warnings = prognosis.get("warnings") or []
                        if warnings:
                            modal_result["summary"] = (
                                modal_result.get("summary", "")
                                + f"  [6h 예측] 악화 예상: {', '.join(warnings)}"
                            )
            except Exception as e:
                logger.warning(f"[prognosis] 통합 실패 (LAB 본 응답은 유지): {e}")

        # ⭐ 운영 DB에 원본 응답 먼저 저장 (Primary Source of Truth)
        #    FHIR 저장이 실패해도 이건 성공 → 종합 판단 가능
        try:
            await ops_modal_results.insert_modal_result(
                encounter_id=encounter_id,
                modality=modality,
                service_request_id=sr_id,
                raw_response=modal_result,
            )
        except Exception as e:
            logger.warning(
                "[ops_db] modal_result insert 실패 (FHIR 저장만 진행): %s", e
            )

        # (FHIR Observation 저장 로직 제거)
        # AI 추론 결과(확실하지 않은 원시값)는 FHIR 표준에 반영하지 않고,
        # 운영 DB의 modal_results.raw_response에만 보관한다.
        # → 종합 판단은 운영 DB에서 원본 JSON을 그대로 읽어 Bedrock에 투입.
        # → EMR 외부 연동은 의사 서명된 DiagnosticReport(final)만 수행.

        # SR: active → completed — graceful
        ok, err = await transition_service_request_safe(sr_id, "completed")
        if not ok and not isinstance(err, InvalidTransitionError):
            logger.warning("[hapi] SR transition completed 실패, 큐로: %s", err)
            await ops_fhir_queue.enqueue(
                encounter_id=encounter_id, patient_id=patient_id,
                resource_type="ServiceRequestTransition",
                resource_id=sr_id,
                payload={"new_status": "completed"},
                last_error=str(err)[:500],
            )

        # WebSocket 푸시 (모달 결과)
        # payload = 모달 서비스의 원본 응답 전체. 프론트가 풍부한 UI를 즉시 렌더링하는 데 사용.
        await broadcast(encounter_id, {
            "event": "modal_completed",
            "service_request_id": sr_id,
            "modality": modality,
            "summary": modal_result.get("summary", ""),
            "risk_level": modal_result.get("risk_level", "routine"),
            "payload": modal_result,
        })

        # 모달 완료 후 AI 재판단 → 다음 우선 모달 추천 (Proceed X 버튼 갱신용)
        # 실패해도 무관: 의사가 Order X 버튼으로 수동 오더 가능
        await _suggest_next_modality(encounter_id, patient_id)

    except Exception as e:
        logger.exception(f"Modal execution failed for SR/{sr_id}")
        # 실패 시 SR: active → revoked, note에 에러 기록 — graceful
        try:
            await fhir.patch("ServiceRequest", sr_id, {
                "status": "revoked",
                "note": [{"text": f"모달 실행 실패: {str(e)}"}],
            })
        except Exception as patch_err:
            logger.warning("[hapi] SR revoked patch 실패, 큐로: %s", patch_err)
            try:
                await ops_fhir_queue.enqueue(
                    encounter_id=encounter_id, patient_id=patient_id,
                    resource_type="ServiceRequestPatch",
                    resource_id=sr_id,
                    payload={"status": "revoked", "note": [{"text": f"모달 실행 실패: {str(e)}"}]},
                    last_error=str(patch_err)[:500],
                )
            except Exception:
                logger.exception("SR revoked 큐 적재 실패")

        # broadcast는 HAPI와 무관 (운영 DB의 modal_events 사용)
        try:
            await broadcast(encounter_id, {
                "event": "modal_failed",
                "service_request_id": sr_id,
                "error": str(e),
            })
        except Exception:
            logger.exception("modal_failed broadcast 실패")


async def _build_modal_payload(
    modality: str,
    patient_id: str,
    encounter_id: str,
    docref_info: dict | None,
) -> dict:
    """
    모달 서비스 /predict 호출용 payload 빌드 (chest-svc-pre 스키마).

    스키마:
      {
        "patient_id": str,
        "patient_info": {age, sex, chief_complaint, history[], ...},
        "data": {image_base64 | study_id | lab_values | ...},
        "context": {}
      }

    patient_info는 FHIR Patient + Condition + Observation을 읽어 재구성한다.
    data는 모달별 입력 형태에 맞춰 docref_info/encounter에서 추출한다.
    """
    # ── Patient (age, sex) ───────────────────────────────
    patient_info: dict = {"age": 0, "sex": "U", "chief_complaint": ""}
    try:
        patient = await fhir.read("Patient", patient_id)
        gender = (patient.get("gender") or "unknown").lower()
        sex_map = {"male": "M", "female": "F"}
        patient_info["sex"] = sex_map.get(gender, "U")

        birth_date = patient.get("birthDate")
        if birth_date:
            try:
                from datetime import date
                year = int(birth_date.split("-")[0])
                patient_info["age"] = max(0, date.today().year - year)
            except (ValueError, IndexError):
                pass
    except Exception as e:
        logger.warning(f"Patient 조회 실패: {e}")

    # ── Conditions (chief_complaint, history) ────────────
    try:
        conditions = await fhir.search(
            "Condition", {"encounter": f"Encounter/{encounter_id}"}
        )
        chief_texts: list[str] = []
        history_texts: list[str] = []
        for cond in conditions:
            category = cond.get("category", [])
            is_ccp = any(
                c.get("code") == "encounter-diagnosis"
                for cat in category for c in cat.get("coding", [])
            )
            text = cond.get("code", {}).get("text") or (
                cond.get("code", {}).get("coding", [{}])[0].get("display", "")
            )
            if not text:
                continue
            if is_ccp:
                chief_texts.append(text)
            else:
                history_texts.append(text)
        if chief_texts:
            patient_info["chief_complaint"] = chief_texts[0]
        if history_texts:
            patient_info["history"] = history_texts
    except Exception as e:
        logger.warning(f"Condition 조회 실패: {e}")

    # ── Vitals (온도, 혈압, SpO2, 호흡수) ──────────────────
    try:
        observations = await fhir.search(
            "Observation", {"encounter": f"Encounter/{encounter_id}"}
        )
        vital_map = _extract_vitals(observations)
        patient_info.update(vital_map)
    except Exception as e:
        logger.warning(f"Observation(vitals) 조회 실패: {e}")

    # ── 운영 DB metadata에서 MIMIC 식별자 조회 (S3 경로용) ──
    mimic_info: dict = {}
    try:
        from app.db import encounters as ops_encounters
        enc_row = await ops_encounters.get_encounter(encounter_id)
        if enc_row:
            meta = enc_row.get("metadata") or {}
            if isinstance(meta, str):
                import json as _json
                meta = _json.loads(meta)
            mimic_info = meta.get("mimic") or {}
    except Exception as e:
        logger.warning(f"운영 DB mimic 조회 실패: {e}")

    # ── 모달별 data 필드 빌드 ─────────────────────────────
    data: dict = {}
    if modality == "CXR":
        # CXR 서비스는 image_base64 필수. S3에 이미지가 있으면 중앙이 다운로드+인코딩.
        cxr_s3 = mimic_info.get("cxr_image_path") or (docref_info or {}).get("url", "")
        image_b64 = ""
        if cxr_s3 and cxr_s3.startswith("s3://"):
            try:
                from app.clients.s3_downloader import download_as_base64
                image_b64 = download_as_base64(cxr_s3)
                logger.info(
                    f"[CXR] S3 이미지 다운로드 완료 ({cxr_s3}, {len(image_b64)} chars b64)"
                )
            except Exception as e:
                logger.warning(f"[CXR] S3 다운로드 실패 ({cxr_s3}): {e}")
        data = {
            "image_base64": image_b64,
            "image_s3_uri": cxr_s3,   # 참고용 (CXR 서비스는 안 쓰지만 로그/디버그용)
        }
    elif modality == "ECG":
        # CXR과 동일 패턴: 중앙 백엔드가 .hea + .dat 를 S3에서 받아 base64로 전송.
        # 모달 서비스는 S3 접근·자격증명 불필요. (옛 record_path 방식은 하위호환으로 함께 전송)
        record_path = mimic_info.get("ecg_record_path") or (docref_info or {}).get("url", "")
        hea_b64 = ""
        dat_b64 = ""
        if record_path and record_path.startswith("s3://"):
            try:
                from app.clients.s3_downloader import download_as_base64
                hea_b64 = download_as_base64(record_path + ".hea")
                dat_b64 = download_as_base64(record_path + ".dat")
                logger.info(
                    f"[ECG] S3 WFDB 다운로드 완료 ({record_path}, hea={len(hea_b64)}, dat={len(dat_b64)} chars b64)"
                )
            except Exception as e:
                logger.warning(f"[ECG] S3 WFDB 다운로드 실패 ({record_path}): {e}")
        if not record_path:
            # MIMIC 식별자 미제공 시 fallback (모달이 mock 폴백)
            record_path = f"mimic/ecg/{patient_id}"
        data = {
            "hea_base64": hea_b64,
            "dat_base64": dat_b64,
            "record_path": record_path,   # 하위호환 + 디버그 식별자
            "leads": 12,
        }
    elif modality == "LAB":
        # MIMIC labevents에서 환자 lab 값을 S3 Select로 즉석 조회.
        # subject_id가 있으면 데모 4명 매핑 또는 전체 시간 검색.
        sid = mimic_info.get("subject_id")
        lab_values: dict = {}
        if sid:
            try:
                from app.clients.lab_loader import fetch_lab_values
                lab_values = await fetch_lab_values(sid)
                logger.info(
                    f"[LAB] subject={sid} → {len(lab_values)}개 lab 추출 ({list(lab_values.keys())})"
                )
            except Exception as e:
                logger.warning(f"[LAB] lab_loader 실패 ({sid}): {e}")
        data = {
            "lab_values": lab_values,
        }

    return {
        "patient_id": patient_id,
        "patient_info": patient_info,
        "data": data,
        "context": {"encounter_id": encounter_id},
    }


def _extract_vitals(observations: list[dict]) -> dict:
    """FHIR Observation 리스트에서 chest-svc-pre 용 vitals 추출."""
    vitals: dict = {}
    for obs in observations:
        code = obs.get("code", {}).get("coding", [{}])[0]
        loinc = code.get("code", "")

        # Heart rate, Respiratory rate
        if loinc == "8867-4":  # HR
            hr_val = obs.get("valueQuantity", {}).get("value")
            if hr_val is not None:
                vitals["heart_rate"] = hr_val
        elif loinc == "9279-1":  # RR
            rr_val = obs.get("valueQuantity", {}).get("value")
            if rr_val is not None:
                vitals["respiratory_rate"] = int(rr_val)
        elif loinc == "2708-6":  # SpO2
            spo2 = obs.get("valueQuantity", {}).get("value")
            if spo2 is not None:
                vitals["spo2"] = spo2
        elif loinc == "8310-5":  # Body temperature
            temp = obs.get("valueQuantity", {}).get("value")
            if temp is not None:
                vitals["temperature"] = temp
        elif loinc == "85354-9":  # Blood pressure (SBP/DBP as components)
            sbp, dbp = None, None
            for comp in obs.get("component", []):
                comp_code = comp.get("code", {}).get("coding", [{}])[0].get("code", "")
                val = comp.get("valueQuantity", {}).get("value")
                if comp_code == "8480-6":
                    sbp = val
                elif comp_code == "8462-4":
                    dbp = val
            if sbp is not None and dbp is not None:
                vitals["blood_pressure"] = f"{int(sbp)}/{int(dbp)}"
    return vitals


def _get_docref_info(modality: str) -> dict | None:
    """모달별 DocumentReference 정보 반환."""
    if modality == "CXR":
        return {
            "content_type": "image/png",
            "url": "s3://dr-ai-assets/sample/cxr.png",
            "loinc_code": "36643-5",
            "display": "Chest X-ray",
        }
    if modality == "ECG":
        return {
            "content_type": "application/x-wfdb",
            "url": "s3://dr-ai-assets/sample/ecg",
            "loinc_code": "11524-6",
            "display": "EKG study",
        }
    return None


def _detect_modality(code_coding: dict) -> str:
    """LOINC 코드에서 모달 종류 추출."""
    code = code_coding.get("code", "")
    display = code_coding.get("display", "").lower()
    if code == "36643-5" or "cxr" in display or "chest" in display:
        return "CXR"
    if code == "11524-6" or "ecg" in display or "ekg" in display:
        return "ECG"
    if "lab" in display:
        return "LAB"
    return "UNKNOWN"


def _mock_modal_result(modality: str) -> dict:
    """개발/데모용 mock — 실제 서비스 아웃풋 포맷과 동일."""
    if modality == "ECG":
        return {
            "status": "ok",
            "modal": "ecg",
            "findings": [
                {
                    "name": "stemi",
                    "confidence": 0.92,
                    "detail": "ST분절 상승 심근경색 (신뢰도 92.0%)",
                    "severity": "critical",
                    "recommendation": "즉시 심도자실 활성화",
                }
            ],
            "summary": "[위험] ST분절 상승 심근경색 이상 소견 감지",
            "risk_level": "critical",
            "ecg_vitals": {
                "heart_rate": 88.0,
                "bradycardia": False,
                "tachycardia": False,
                "irregular_rhythm": False,
            },
            "all_probs": {"stemi": 0.92, "normal_ecg": 0.05},
        }
    elif modality == "CXR":
        return {
            "status": "success",
            "modal": "chest",
            "findings": [
                {
                    "name": "Cardiomegaly",
                    "detected": True,
                    "confidence": 0.82,
                    "detail": "심비대 소견",
                    "severity": "moderate",
                    "location": "bilateral",
                    "recommendation": "심초음파 추가 검사 권고",
                    "evidence": ["Enlarged cardiac silhouette", "CTR > 0.5"],
                    "impression_text": "Cardiomegaly with possible pulmonary edema",
                }
            ],
            "summary": "Cardiomegaly with possible pulmonary edema",
            "risk_level": "urgent",
            "findings_text": "The cardiac silhouette is enlarged.",
            "impression": "1. Cardiomegaly",
            "measurements": {"ctr": 0.58},
        }
    elif modality == "LAB":
        return {
            "status": "ok",
            "modal": "lab",
            "risk_level": "critical",
            "complaint_profile": "CARDIAC",
            "findings": [
                {
                    "name": "critical_potassium_high",
                    "category": "critical",
                    "severity": "critical",
                    "confidence": 1.0,
                    "detail": "칼륨 6.8 mEq/L — 고칼륨혈증으로 심정지 위험",
                    "recommendation": "즉시 ECG + calcium gluconate 준비",
                    "measurement": {
                        "value": 6.8,
                        "unit": "mEq/L",
                        "reference_low": 3.5,
                        "reference_high": 5.0,
                        "status": "critical_high",
                    },
                },
                {
                    "name": "unmeasured_troponin_t",
                    "category": "primary",
                    "severity": "mild",
                    "confidence": 1.0,
                    "detail": "Troponin T 미측정 — ACS 배제 불가",
                    "recommendation": "Troponin T 검사 시행 권고",
                    "measurement": None,
                },
            ],
            "summary": "[critical] K+ 심정지 위험, Troponin 미측정(ACS 배제 불가)",
            "lab_summary": [
                {"feature": "wbc",        "value": 11.2, "unit": "K/uL",  "reference_low": 4.5,  "reference_high": 11.0, "status": "high",          "measured": True},
                {"feature": "hemoglobin", "value": 10.5, "unit": "g/dL",  "reference_low": 12.0, "reference_high": 17.5, "status": "low",           "measured": True},
                {"feature": "potassium",  "value": 6.8,  "unit": "mEq/L", "reference_low": 3.5,  "reference_high": 5.0,  "status": "critical_high", "measured": True},
                {"feature": "creatinine", "value": 1.8,  "unit": "mg/dL", "reference_low": 0.7,  "reference_high": 1.2,  "status": "high",          "measured": True},
                {"feature": "troponin_t", "value": None, "unit": "ng/mL", "status": "not_measured", "measured": False},
                {"feature": "bnp",        "value": None, "unit": "pg/mL", "status": "not_measured", "measured": False},
            ],
            "measurements": {"critical_count": 1, "primary_count": 1, "total_findings": 2},
            "suggested_next_actions": [
                {"target_modal": "ECG", "reason": "K+ 6.8 — 전해질 이상 심전도 변화 확인", "urgency": "urgent", "priority": 10},
            ],
            "metadata": {"engine": "rule_engine_mock", "latency_ms": 5.0, "num_findings": 2},
        }
    else:
        return {
            "status": "success",
            "modal": modality.lower(),
            "findings": [],
            "summary": f"{modality} analysis completed (mock)",
            "risk_level": "routine",
        }


# ── 모달 완료 후 AI 재판단 (다음 우선 모달 추천) ──────────
async def _suggest_next_modality(encounter_id: str, patient_id: str) -> None:
    """
    모달 하나 완료 후 AI가 '다음에 뭘 해야 할지' 재판단.
    남은 모달 중 최우선 1개에 대해 SR(draft) 생성 → Proceed 버튼용.
    필요 없으면 ready_for_report 이벤트 푸시.

    재판단 시 운영 DB에서 환자 컨텍스트(주호소·나이·성별·vitals) +
    완료된 모달의 raw 결과를 함께 가져와 FusionDecisionEngine에 주입한다.
    """
    try:
        from app.agent.tools import propose_order, get_encounter_context
        from app.agent.decision_engine import HybridDecisionEngine
        from app.db import encounters as ops_encounters
        from app.db import modal_results as ops_modal_results
        from app.main import app

        # Get ML models from app state
        ml_models_initial = getattr(app.state, 'ml_models_initial', None)
        ml_models_followup = getattr(app.state, 'ml_models_followup', None)
        ml_metadata_initial = getattr(app.state, 'ml_metadata_initial', None)
        ml_metadata_followup = getattr(app.state, 'ml_metadata_followup', None)
        cc_map = getattr(app.state, 'cc_map', None)
        feature_extractor = getattr(app.state, 'feature_extractor', None)

        # 현재 encounter 상태 수집 (FHIR — SR 목록만 필요)
        context = await get_encounter_context(encounter_id)

        # 완료된 모달 목록 수집 (FHIR ServiceRequest 기준)
        completed_modalities: list[str] = []
        for sr in context.get("service_requests", []):
            if sr.get("status") == "completed":
                code_coding = sr.get("code", {}).get("coding", [{}])[0]
                mod = _detect_modality(code_coding)
                if mod != "UNKNOWN" and mod not in completed_modalities:
                    completed_modalities.append(mod)

        # 운영 DB에서 환자 컨텍스트 (주호소/나이/성별/vitals)
        enc_row = await ops_encounters.get_encounter(encounter_id) or {}
        meta = enc_row.get("metadata") or {}
        if isinstance(meta, str):
            import json as _json
            meta = _json.loads(meta)
        patient_ctx = {
            "chief_complaint": enc_row.get("chief_complaint") or "",
            "complaint_detail": meta.get("complaint_detail") or enc_row.get("chief_complaint") or "",
            "past_history": meta.get("past_history") or [],
            "age": enc_row.get("patient_age") or 0,
            "sex": (enc_row.get("patient_gender") or "U")[:1].upper(),
            "vitals": meta.get("vitals") or {},
        }

        # 운영 DB에서 완료된 모달의 raw 결과 수집 → HybridDecisionEngine 입력 형식으로 변환
        # get_all_modal_results는 {"CXR": {...raw...}, "ECG": {...raw...}} 형태 반환.
        # ⚠ finding은 top-1만 보내면 ECG가 [afib, heart_failure, htn] 동시 검출 시 top1만 룰 매칭됨.
        #    감지된 모든 finding 이름을 공백 구분으로 합쳐서 substring 매칭이 누락 안 되게 함.
        inference_results: list[dict] = []
        all_raws = await ops_modal_results.get_all_modal_results(encounter_id)
        for modality, raw in all_raws.items():
            if isinstance(raw, str):
                import json as _json
                raw = _json.loads(raw)
            findings = raw.get("findings") or []
            # detected=True 우선, detected 필드 없으면 confidence ≥ 0.5 (ECG는 detected 필드가 없음)
            detected_names = []
            for f in findings:
                flag = f.get("detected")
                if flag is True:
                    detected_names.append(str(f.get("name", "")))
                elif flag is None and f.get("confidence", 0) >= 0.5:
                    detected_names.append(str(f.get("name", "")))
            if not detected_names:
                top = max(findings, key=lambda f: f.get("confidence", 0), default=None)
                if top:
                    detected_names = [str(top.get("name", ""))]
            combined_finding = " ".join(detected_names) or raw.get("summary", "")
            top_conf = max(
                (f.get("confidence", 0) for f in findings if f.get("detected")),
                default=0,
            )
            inference_results.append({
                "modality": modality.upper(),
                "finding": combined_finding,
                "confidence": top_conf,
                "risk_level": raw.get("risk_level"),
                "summary": raw.get("summary", ""),
            })

        engine = HybridDecisionEngine(
            patient=patient_ctx,
            modalities_completed=completed_modalities,
            inference_results=inference_results,
            iteration=len(completed_modalities) + 1,
            ml_models_initial=ml_models_initial,
            ml_models_followup=ml_models_followup,
            ml_metadata_initial=ml_metadata_initial,
            ml_metadata_followup=ml_metadata_followup,
            cc_map=cc_map,
            feature_extractor=feature_extractor,
        )
        decision = engine.decide()
        next_modalities = decision.get("next_modalities", [])

        logger.info(
            "[suggest_next] enc=%s chief=%r completed=%s inference=%s decision=%s next=%s",
            encounter_id,
            patient_ctx.get("chief_complaint"),
            completed_modalities,
            [(r["modality"], r["finding"], r.get("confidence")) for r in inference_results],
            decision.get("decision"),
            next_modalities,
        )

        # 이미 완료/진행중인 모달 제외, 아직 안 한 것 중 최우선 1개
        pending = [m for m in next_modalities if m not in completed_modalities]

        if pending:
            next_mod = pending[0]
            new_sr = await propose_order(
                patient_id=patient_id,
                encounter_id=encounter_id,
                modality=next_mod,
                reason_text=decision.get("rationale", f"{next_mod} 추가 필요"),
                priority="urgent" if decision.get("risk_level") == "high" else "routine",
            )
            await broadcast(encounter_id, {
                "event": "next_proposal",
                "service_request_id": new_sr["id"],
                "modality": next_mod,
                "reason": decision.get("rationale", ""),
            })
            # 타임라인용 — 추가 오더 생성됨
            await broadcast(encounter_id, {
                "event": "order_placed",
                "service_request_id": new_sr["id"],
                "modality": next_mod,
            })
        else:
            # 추가 모달 불필요 → 소견서 생성 가능 신호
            await broadcast(encounter_id, {
                "event": "ready_for_report",
                "message": "추가 모달 불필요. 종합 판단 생성 가능.",
            })

    except Exception as e:
        logger.exception(f"AI re-evaluation failed for encounter/{encounter_id}")
        # 실패해도 서비스는 계속 — 의사가 수동으로 Order X 버튼 누르면 됨


# ── API 엔드포인트 ───────────────────────────────────────
@router.post("/{sr_id}/approve")
async def approve_order(sr_id: str, background_tasks: BackgroundTasks):
    """
    의사 [Proceed X] 클릭: AI 추천 모달을 그대로 실행.
    draft → active → 모달 실행 → completed.

    Graceful Degradation:
      - HAPI 다운 시 SR 상태 전이는 큐로 우회
      - SR 정보는 운영 DB(또는 메모리)에서 복구하여 모달 실행 계속
      - 의사 [승인] 버튼은 절대 막히지 않음
    """
    try:
        # Tier 1: SR 상태 전이 graceful
        ok, err = await transition_service_request_safe(sr_id, "active")
        if not ok:
            if isinstance(err, InvalidTransitionError):
                # 정당한 거부 (이미 active/completed 등) — 그대로 반환
                raise HTTPException(status_code=409, detail=str(err))
            # HAPI 다운 → 큐로 적재, 모달 실행은 계속
            logger.warning("[hapi] SR transition active 실패, 큐로: %s", err)
            await ops_fhir_queue.enqueue(
                encounter_id="(from-sr)",  # SR 정보 없으니 (from-sr) 마커
                patient_id=None,
                resource_type="ServiceRequestTransition",
                resource_id=sr_id,
                payload={"new_status": "active"},
                last_error=str(err)[:500],
            )

        # SR 정보 조회 — HAPI 다운 시 비어있을 수 있어 graceful
        try:
            sr = await fhir.read("ServiceRequest", sr_id)
        except Exception as e:
            logger.warning("[hapi] SR read 실패, 모달 실행은 계속: %s", e)
            sr = {"id": sr_id}  # 최소 정보만으로 진행

        # 모달 실행을 백그라운드로 (HAPI 다운 무관)
        background_tasks.add_task(_execute_modal_and_complete, sr_id, sr)

        return {"service_request_id": sr_id, "status": "active"}
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Order approve failed")
        raise HTTPException(status_code=500, detail=str(e))


# ── 의사 수동 오더 (Order ECG / Order LAB 버튼) ──────────
class OrderRequestBody(BaseModel):
    encounter_id: str
    patient_id: str
    modality: str                      # "ECG" / "CXR" / "LAB"
    reason: Optional[str] = None
    priority: Optional[str] = "routine"  # routine / urgent


@router.post("/request")
async def request_order(
    body: OrderRequestBody,
    background_tasks: BackgroundTasks,
):
    """
    의사가 [Order ECG] / [Order LAB] 등 직접 버튼 클릭 시 호출.
    AI 판단과 무관하게 의사가 명시적으로 지시한 오더 → 즉시 실행.

    흐름:
      1. SR(draft) 생성
      2. 곧바로 active로 전이
      3. 모달 실행 백그라운드
    """
    try:
        from app.agent.tools import propose_order

        # 1. SR(draft) 생성 — AI 제안이 아닌 "의사 직접 오더"로 명시
        # propose_order는 이미 graceful (HAPI 실패 시 큐 적재)
        reason = body.reason or f"의사 직접 오더: {body.modality}"
        sr = await propose_order(
            patient_id=body.patient_id,
            encounter_id=body.encounter_id,
            modality=body.modality,
            reason_text=reason,
            priority=body.priority or "routine",
        )
        sr_id = sr["id"]

        # 2. 즉시 active로 전이 — graceful
        ok, err = await transition_service_request_safe(sr_id, "active")
        if not ok:
            if not isinstance(err, InvalidTransitionError):
                logger.warning("[hapi] SR transition active 실패(direct), 큐로: %s", err)
                await ops_fhir_queue.enqueue(
                    encounter_id=body.encounter_id, patient_id=body.patient_id,
                    resource_type="ServiceRequestTransition",
                    resource_id=sr_id,
                    payload={"new_status": "active"},
                    last_error=str(err)[:500],
                )

        # SR 정보 (모달 호출에 필요) — HAPI 다운 시 최소 정보로 진행
        try:
            sr_full = await fhir.read("ServiceRequest", sr_id)
        except Exception as e:
            logger.warning("[hapi] SR read 실패 (direct), 최소 정보로 진행: %s", e)
            # 모달 호출에 필요한 정보만 만들어 전달
            from app.fhir.codes import LOINC_MODALITY
            mod_key = body.modality.lower()
            sr_full = {
                "id": sr_id,
                "subject": {"reference": f"Patient/{body.patient_id}"},
                "encounter": {"reference": f"Encounter/{body.encounter_id}"},
                "code": {"coding": [{
                    "system": "http://loinc.org",
                    **LOINC_MODALITY.get(mod_key, {"code": "unknown", "display": body.modality}),
                }]},
            }

        # 3. 백그라운드에서 모달 실행
        background_tasks.add_task(_execute_modal_and_complete, sr_id, sr_full)

        return {
            "service_request_id": sr_id,
            "modality": body.modality,
            "status": "active",
        }
    except InvalidTransitionError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.exception("Order request failed")
        raise HTTPException(status_code=500, detail=str(e))
