"""
§6.2 빌더 함수 — 폼 → FHIR 리소스 변환.

[이 파일이 하는 일 — 가장 핵심 파일]
우리 데이터를 FHIR 규격 JSON으로 변환하는 함수 모음.
FHIR 서버는 FHIR 규격 JSON만 받기 때문에 이 변환이 필수.

[빌더 함수 목록]
- build_patient()           → 환자 정보 → FHIR Patient
- build_encounter()         → ED 방문 → FHIR Encounter
- build_vitals_bundle()     → 바이탈(HR,BP 등) → FHIR Observation 묶음
- build_chief_complaint()   → 주호소 → FHIR Condition
- build_past_history()      → 과거력 → FHIR Condition 묶음
- build_service_request()   → AI 검사 제안 → FHIR ServiceRequest
- build_diagnostic_report() → 최종 리포트 → FHIR DiagnosticReport
- build_document_reference()→ 원본 파일 URL → FHIR DocumentReference

[모달 결과 변환 함수]
- convert_ecg_to_observations() → ECG 서비스 아웃풋 → FHIR Observation 리스트
- convert_cxr_to_observations() → CXR 서비스 아웃풋 → FHIR Observation 리스트

[FHIR 설명]
예: build_patient({"age": 65, "gender": "male"})
→ {"resourceType": "Patient", "gender": "male", "birthDate": "1961-01-01", ...}
이 JSON이 FHIR 서버에 저장되는 형태.
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone, timedelta

from app.fhir.codes import (
    LOINC_VITALS, OBS_CATEGORY_VITAL, ENCOUNTER_CLASS_EMER,
)
from app.fhir.code_mapper import map_text_to_icd10

KST = timezone(timedelta(hours=9))


def _now_iso() -> str:
    return datetime.now(KST).isoformat()


def _gen_id(prefix: str = "") -> str:
    short = str(uuid.uuid4())[:8]
    return f"{prefix}-{short}" if prefix else short


# ── Patient ──────────────────────────────────────────────
def build_patient(patient_form: dict) -> dict:
    gender = patient_form["gender"]
    age = patient_form["age"]
    birth_year = datetime.now().year - age
    birth_date = f"{birth_year}-01-01"
    name_text = patient_form.get("name") or "Anonymous"

    return {
        "resourceType": "Patient",
        "identifier": [
            {
                "system": "http://hospital.example.org/mrn",
                "value": f"MRN-{_gen_id()}",
            }
        ],
        "name": [{"use": "official", "text": name_text}],
        "gender": gender,
        "birthDate": birth_date,
    }


# ── Encounter ────────────────────────────────────────────
def build_encounter(
    patient_id: str,
    chief_complaint_form: dict,
    notes: str | None = None,
) -> dict:
    reason_coding = map_text_to_icd10(chief_complaint_form.get("text", ""))
    reason_code = []
    if reason_coding:
        reason_code = [{"coding": [reason_coding]}]

    enc: dict = {
        "resourceType": "Encounter",
        "status": "in-progress",
        "class": ENCOUNTER_CLASS_EMER,
        "subject": {"reference": f"Patient/{patient_id}"},
        "period": {"start": _now_iso()},
        "reasonCode": reason_code,
    }

    # 환자 메모 (특이사항·가족력·사회력 등 자유 텍스트)
    if notes and notes.strip():
        enc["note"] = [{"text": notes.strip(), "time": _now_iso()}]

    return enc


# ── Vitals Bundle ────────────────────────────────────────
def build_vitals_bundle(
    patient_id: str, encounter_id: str, vitals_form: dict
) -> dict:
    """각 vitals 필드마다 Observation 1개 (BP만 component 묶음)."""
    entries: list[dict] = []
    now = _now_iso()

    # BP — component 방식
    if "sbp" in vitals_form and "dbp" in vitals_form:
        bp_obs = _build_bp_observation(
            patient_id, encounter_id, vitals_form["sbp"], vitals_form["dbp"], now
        )
        entries.append(_bundle_entry(bp_obs))

    # 나머지 단일 vitals
    single_keys = {"hr", "spo2", "rr", "temp", "gcs"}
    for key in single_keys:
        if key not in vitals_form:
            continue
        loinc = LOINC_VITALS[key]
        obs = {
            "resourceType": "Observation",
            "status": "final",
            "category": [{"coding": [OBS_CATEGORY_VITAL]}],
            "code": {"coding": [{"system": "http://loinc.org", **loinc}]},
            "subject": {"reference": f"Patient/{patient_id}"},
            "encounter": {"reference": f"Encounter/{encounter_id}"},
            "effectiveDateTime": now,
            "valueQuantity": {
                "value": vitals_form[key],
                "unit": loinc["unit"],
                "system": "http://unitsofmeasure.org",
                "code": loinc["unit"],
            },
        }
        entries.append(_bundle_entry(obs))

    return {
        "resourceType": "Bundle",
        "type": "transaction",
        "entry": entries,
    }


def _build_bp_observation(
    patient_id: str, encounter_id: str, sbp: float, dbp: float, effective: str
) -> dict:
    bp_loinc = LOINC_VITALS["bp"]
    sbp_loinc = LOINC_VITALS["sbp"]
    dbp_loinc = LOINC_VITALS["dbp"]
    return {
        "resourceType": "Observation",
        "status": "final",
        "category": [{"coding": [OBS_CATEGORY_VITAL]}],
        "code": {"coding": [{"system": "http://loinc.org", **bp_loinc}]},
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "effectiveDateTime": effective,
        "component": [
            {
                "code": {"coding": [{"system": "http://loinc.org", **sbp_loinc}]},
                "valueQuantity": {"value": sbp, "unit": "mm[Hg]",
                                  "system": "http://unitsofmeasure.org", "code": "mm[Hg]"},
            },
            {
                "code": {"coding": [{"system": "http://loinc.org", **dbp_loinc}]},
                "valueQuantity": {"value": dbp, "unit": "mm[Hg]",
                                  "system": "http://unitsofmeasure.org", "code": "mm[Hg]"},
            },
        ],
    }


def _bundle_entry(resource: dict) -> dict:
    rtype = resource["resourceType"]
    return {
        "resource": resource,
        "request": {"method": "POST", "url": rtype},
    }


# ── Chief Complaint (Condition) ──────────────────────────
def build_chief_complaint(
    patient_id: str, encounter_id: str, cc_form: dict
) -> dict:
    code_hint = cc_form.get("code_hint")
    text = cc_form.get("text", "")

    coding = []
    if code_hint:
        coding = [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": code_hint}]
    else:
        mapped = map_text_to_icd10(text)
        if mapped:
            coding = [mapped]

    return {
        "resourceType": "Condition",
        "clinicalStatus": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                         "code": "active"}]
        },
        "verificationStatus": {
            "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                         "code": "provisional"}]
        },
        "category": [
            {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-category",
                          "code": "encounter-diagnosis"}]}
        ],
        "code": {"coding": coding, "text": text},
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "recordedDate": _now_iso(),
    }


# ── Past History (Bundle[Condition]) ─────────────────────
def build_past_history(patient_id: str, history_list: list[dict]) -> dict:
    entries = []
    for item in history_list:
        text = item.get("text", "")
        code_hint = item.get("code_hint")

        coding = []
        if code_hint:
            coding = [{"system": "http://hl7.org/fhir/sid/icd-10-cm", "code": code_hint}]
        else:
            mapped = map_text_to_icd10(text)
            if mapped:
                coding = [mapped]

        cond = {
            "resourceType": "Condition",
            "clinicalStatus": {
                "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-clinical",
                             "code": "active"}]
            },
            "verificationStatus": {
                "coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-ver-status",
                             "code": "confirmed"}]
            },
            "category": [
                {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/condition-category",
                              "code": "problem-list-item"}]}
            ],
            "code": {"coding": coding, "text": text},
            "subject": {"reference": f"Patient/{patient_id}"},
            "recordedDate": _now_iso(),
        }
        entries.append(_bundle_entry(cond))

    return {"resourceType": "Bundle", "type": "transaction", "entry": entries}


# ── ServiceRequest (Agent 제안) ──────────────────────────
def build_service_request(
    patient_id: str,
    encounter_id: str,
    code_coding: dict,
    reason_text: str = "",
    priority: str = "routine",
) -> dict:
    return {
        "resourceType": "ServiceRequest",
        "status": "draft",
        "intent": "proposal",
        "priority": priority,
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "code": {"coding": [code_coding]},
        "requester": {"display": "Dr.AI Agent"},
        "authoredOn": _now_iso(),
        "reasonCode": [{"text": reason_text}] if reason_text else [],
        "note": [{"text": reason_text}] if reason_text else [],
    }


# ── DiagnosticReport (SOAP) ──────────────────────────────
def build_diagnostic_report(
    patient_id: str,
    encounter_id: str,
    observation_ids: list[str],
    conclusion: str,
) -> dict:
    return {
        "resourceType": "DiagnosticReport",
        "status": "preliminary",
        "category": [
            {"coding": [{"system": "http://terminology.hl7.org/CodeSystem/v2-0074",
                          "code": "OTH", "display": "Other"}]}
        ],
        "code": {"coding": [{"system": "http://loinc.org",
                              "code": "11488-4", "display": "Consultation note"}]},
        "subject": {"reference": f"Patient/{patient_id}"},
        "encounter": {"reference": f"Encounter/{encounter_id}"},
        "effectiveDateTime": _now_iso(),
        "issued": _now_iso(),
        "performer": [{"display": "Dr.AI Agent"}],
        "result": [{"reference": f"Observation/{oid}"} for oid in observation_ids],
        "conclusion": conclusion,
    }




# ── AllergyIntolerance (알레르기) ────────────────────────
def build_allergy_intolerance(patient_id: str, allergy_text: str) -> dict | None:
    """
    알레르기 텍스트 → FHIR AllergyIntolerance 리소스.
    "NKDA"(No Known Drug Allergy)면 None 반환 (저장 스킵).
    """
    if not allergy_text or not allergy_text.strip():
        return None
    if allergy_text.strip().upper() in ("NKDA", "NONE", "NO", "N/A"):
        return None

    return {
        "resourceType": "AllergyIntolerance",
        "clinicalStatus": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical",
                "code": "active",
                "display": "Active",
            }],
        },
        "verificationStatus": {
            "coding": [{
                "system": "http://terminology.hl7.org/CodeSystem/allergyintolerance-verification",
                "code": "unconfirmed",
                "display": "Unconfirmed",
            }],
        },
        "type": "allergy",
        "category": ["medication"],     # 대부분 약물 알레르기
        "patient": {"reference": f"Patient/{patient_id}"},
        "code": {"text": allergy_text.strip()},
        "recordedDate": _now_iso(),
        "note": [{"text": f"환자 트리아지 시 보고: {allergy_text.strip()}"}],
    }


# ── MedicationStatement (복용 약물) ──────────────────────
def build_medication_statement(patient_id: str, encounter_id: str, med_text: str) -> dict | None:
    """
    복용 약물 텍스트 → FHIR MedicationStatement.
    예: "Aspirin, Metformin, Amlodipine"
    """
    if not med_text or not med_text.strip():
        return None

    return {
        "resourceType": "MedicationStatement",
        "status": "active",
        "medicationCodeableConcept": {"text": med_text.strip()},
        "subject": {"reference": f"Patient/{patient_id}"},
        "context": {"reference": f"Encounter/{encounter_id}"},
        "dateAsserted": _now_iso(),
        "note": [{"text": f"트리아지 시 환자 보고: {med_text.strip()}"}],
    }


# ── DocumentReference (원본 파일 포인터) ─────────────────
def build_document_reference(
    patient_id: str,
    encounter_id: str,
    content_type: str,
    url: str,
    loinc_code: str,
    display: str,
) -> dict:
    """외부 파일(CXR PNG, ECG WFDB 등)의 위치를 FHIR에 등록."""
    return {
        "resourceType": "DocumentReference",
        "status": "current",
        "type": {"coding": [{"system": "http://loinc.org", "code": loinc_code, "display": display}]},
        "subject": {"reference": f"Patient/{patient_id}"},
        "context": {"encounter": [{"reference": f"Encounter/{encounter_id}"}]},
        "date": _now_iso(),
        "content": [{
            "attachment": {
                "contentType": content_type,
                "url": url,
            }
        }],
    }
