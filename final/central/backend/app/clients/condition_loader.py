"""
MIMIC diagnoses_icd에서 환자 진단 코드를 S3 Select로 즉석 조회.

[이 파일이 하는 일]
중앙 백엔드가 트리아지 페이지에서 데모 환자 선택 시 호출.
subject_id로 MIMIC diagnoses_icd.csv.gz를 S3에서 직접 SQL로 필터링해,
환자의 모든 hadm_id에 걸친 진단(ICD-9/10) 코드 목록을 반환한다.

이를 우리 PastHistoryCode enum (HTN/DM/CAD/...)으로 매핑해 트리아지 폼의
'과거력' 필드를 자동 채움.

[사용처]
api/mimic.py 의 GET /mimic/conditions/{subject_id}

[성능 메모]
S3 Select는 호출당 5~15초 소요(diagnoses_icd 압축 파일 서버 측 스캔).
"""
from __future__ import annotations

import asyncio
import csv
import io
import logging
from typing import Optional

import boto3

from app.config import AWS_REGION

logger = logging.getLogger(__name__)

MIMIC_BUCKET = "say1-pre-project-2"
MIMIC_DIAGNOSES_KEY = "mimic-iv/hosp/diagnoses_icd.csv.gz"

# MIMIC diagnoses_icd 컬럼 (FileHeaderInfo=USE 기준)
_MIMIC_DIAGNOSES_COLS = ["subject_id", "hadm_id", "seq_num", "icd_code", "icd_version"]

# ──────────────────────────────────────────────────────────
# ICD-9/10 → PastHistoryCode 매핑
# 각 카테고리에 prefix 매칭 (코드 앞 부분 일치)
# (icd_code는 점 없이 저장됨: I10 → "I10", I25.10 → "I2510")
# ──────────────────────────────────────────────────────────

ICD_TO_HISTORY: dict[str, list[tuple[str, int]]] = {
    "HTN": [
        # ICD-10: I10, I11.x, I12.x, I13.x, I15.x
        ("I10", 10), ("I11", 10), ("I12", 10), ("I13", 10), ("I15", 10),
        # ICD-9: 401.x, 402.x, 403.x, 404.x, 405.x
        ("401", 9), ("402", 9), ("403", 9), ("404", 9), ("405", 9),
    ],
    "DM": [
        # ICD-10: E08.x ~ E13.x
        ("E08", 10), ("E09", 10), ("E10", 10), ("E11", 10), ("E12", 10), ("E13", 10),
        # ICD-9: 250.x
        ("250", 9),
    ],
    "CAD": [
        # ICD-10: I20.x ~ I25.x
        ("I20", 10), ("I21", 10), ("I22", 10), ("I23", 10), ("I24", 10), ("I25", 10),
        # ICD-9: 410.x ~ 414.x
        ("410", 9), ("411", 9), ("412", 9), ("413", 9), ("414", 9),
    ],
    "AFIB": [
        # ICD-10: I48.x
        ("I48", 10),
        # ICD-9: 427.31, 427.32
        ("42731", 9), ("42732", 9),
    ],
    "CVA": [
        # ICD-10: I60.x ~ I69.x (뇌혈관 질환)
        ("I60", 10), ("I61", 10), ("I62", 10), ("I63", 10), ("I64", 10),
        ("I65", 10), ("I66", 10), ("I67", 10), ("I68", 10), ("I69", 10),
        # ICD-9: 430~438
        ("430", 9), ("431", 9), ("432", 9), ("433", 9), ("434", 9),
        ("435", 9), ("436", 9), ("437", 9), ("438", 9),
    ],
    "COPD": [
        # ICD-10: J40~J44
        ("J40", 10), ("J41", 10), ("J42", 10), ("J43", 10), ("J44", 10),
        # ICD-9: 491, 492, 496
        ("491", 9), ("492", 9), ("496", 9),
    ],
    "ASTHMA": [
        # ICD-10: J45.x
        ("J45", 10),
        # ICD-9: 493.x
        ("493", 9),
    ],
    "CKD": [
        # ICD-10: N18.x (만성신부전), N19, Z99.2 (투석 의존)
        ("N18", 10), ("N19", 10), ("Z992", 10),
        # ICD-9: 585.x, 586, V45.11 (투석)
        ("585", 9), ("586", 9), ("V4511", 9),
    ],
    "LIVER": [
        # ICD-10: K70~K77 (간질환)
        ("K70", 10), ("K71", 10), ("K72", 10), ("K73", 10),
        ("K74", 10), ("K75", 10), ("K76", 10), ("K77", 10),
        # ICD-9: 571, 572, 573
        ("571", 9), ("572", 9), ("573", 9),
    ],
    "CANCER": [
        # ICD-10: C00~C97 (악성 종양)
        *[(f"C{i:02d}", 10) for i in range(0, 98)],
        # ICD-9: 140~209
        *[(str(i), 9) for i in range(140, 210)],
    ],
    "ALLERGY": [
        # ICD-10: T78.x, Z88.x
        ("T78", 10), ("Z88", 10),
        # ICD-9: 995.0, 995.3, V14.x, V15.0
        ("9950", 9), ("9953", 9), ("V14", 9), ("V150", 9),
    ],
    "PREGNANT": [
        # ICD-10: O00~O9A (임신·산욕)
        *[(f"O{i:02d}", 10) for i in range(0, 100)], ("O9A", 10),
        ("Z33", 10), ("Z34", 10),
        # ICD-9: 630~679, V22~V23
        *[(str(i), 9) for i in range(630, 680)], ("V22", 9), ("V23", 9),
    ],
}


# ──────────────────────────────────────────────────────────
# 알레르기 ICD 코드 → 약물명 매핑
# Z88.x (ICD-10) / V14.x, 9950, 9953 (ICD-9) 약물 알레르기 history
# ──────────────────────────────────────────────────────────
ALLERGY_ICD_DESCRIPTIONS: dict[tuple[str, int], str] = {
    # ICD-10 Z88.x — 약물 알레르기 history
    ("Z880", 10): "Penicillin",
    ("Z881", 10): "기타 항생제",
    ("Z882", 10): "Sulfonamides",
    ("Z883", 10): "기타 항감염제",
    ("Z884", 10): "마취제",
    ("Z885", 10): "마약성 진통제",
    ("Z886", 10): "진통제",
    ("Z887", 10): "혈청·백신",
    ("Z888", 10): "기타 약물",
    ("Z889", 10): "약물 (특정 안 됨)",
    # ICD-10 T78.x — 알레르기 반응
    ("T780",  10): "음식 아나필락시스",
    ("T781",  10): "기타 음식 알레르기",
    ("T782",  10): "아나필락시스 NOS",
    ("T783",  10): "혈관부종",
    ("T784",  10): "알레르기 (특정 안 됨)",
    # ICD-9 V14.x — 약물 알레르기 history
    ("V140",  9): "Penicillin",
    ("V141",  9): "기타 항생제",
    ("V142",  9): "Sulfonamides",
    ("V143",  9): "기타 항감염제",
    ("V144",  9): "마취제",
    ("V145",  9): "마약성 진통제",
    ("V146",  9): "진통제",
    ("V147",  9): "혈청·백신",
    ("V148",  9): "기타 약물",
    ("V149",  9): "약물 (특정 안 됨)",
    ("V150",  9): "기타 알레르기 history",
    # ICD-9 알레르기 반응
    ("9950",  9): "아나필락시스",
    ("9953",  9): "알레르기 NOS",
}

ALLERGY_PREFIXES: list[tuple[str, int]] = [
    ("Z88", 10), ("T78", 10),
    ("V14", 9), ("V150", 9), ("995", 9),
]


def _extract_allergies(rows: list[dict]) -> list[dict]:
    """
    Z88.x / T78.x / V14.x / 995.x 코드에서 알레르기 추출.

    매칭 순서:
      1. 정확 매칭 (Z880 → "Penicillin")
      2. prefix 정확 매칭 (V1508 → V150 prefix → "기타 알레르기 history")
      3. prefix 일반 fallback (예측 못한 prefix는 카테고리 이름)
    """
    # prefix → 의미 있는 설명 (fallback용)
    PREFIX_FALLBACK = {
        "Z88":  "약물 알레르기",
        "T78":  "알레르기 반응",
        "V14":  "약물 알레르기 (history)",
        "V150": "알레르기 (history)",
        "995":  "아나필락시스/알레르기 반응",
    }

    results: list[dict] = []
    seen: set[tuple] = set()

    for r in rows:
        icd = (r.get("icd_code") or "").strip()
        ver = int(r.get("icd_version") or 0)
        if not icd or ver not in (9, 10):
            continue

        # 1) 정확 매칭
        desc = ALLERGY_ICD_DESCRIPTIONS.get((icd, ver))

        # 2) prefix 매칭 (정확하면 prefix의 설명, 없으면 fallback)
        if desc is None:
            for prefix, prefix_ver in ALLERGY_PREFIXES:
                if ver == prefix_ver and icd.startswith(prefix):
                    # prefix의 정확한 설명 우선
                    desc = ALLERGY_ICD_DESCRIPTIONS.get((prefix, prefix_ver))
                    # 없으면 카테고리 fallback
                    if desc is None:
                        desc = PREFIX_FALLBACK.get(prefix, f"알레르기 (코드 {icd})")
                    break

        if desc is None:
            continue

        key = (icd, ver, desc)
        if key in seen:
            continue
        seen.add(key)

        results.append({
            "icd_code": icd,
            "icd_version": ver,
            "description": desc,
            "hadm_id": r.get("hadm_id", ""),
            "display_text": f"{desc} ({icd})",
        })

    return results


_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=AWS_REGION)
    return _s3_client


def _icd_to_history_codes(rows: list[dict]) -> tuple[list[str], list[dict]]:
    """
    MIMIC diagnoses_icd 행 리스트를 받아:
      - matched: 우리 PastHistoryCode 목록 (HTN/DM/...) 중복 제거
      - raw: 매핑된 원본 ICD 코드들 (디버그·표시용)
    """
    matched_codes: set[str] = set()
    raw_codes: list[dict] = []

    for r in rows:
        icd = (r.get("icd_code") or "").strip()
        ver = int(r.get("icd_version") or 0)
        if not icd:
            continue

        for hist_code, prefixes in ICD_TO_HISTORY.items():
            for prefix, prefix_ver in prefixes:
                if ver == prefix_ver and icd.startswith(prefix):
                    matched_codes.add(hist_code)
                    raw_codes.append({
                        "history_code": hist_code,
                        "icd_code": icd,
                        "icd_version": ver,
                        "hadm_id": r.get("hadm_id", ""),
                    })
                    break

    # 안정적 순서 (PastHistoryCode 정의 순서대로)
    HISTORY_ORDER = [
        "HTN", "DM", "CAD", "AFIB", "CVA",
        "COPD", "ASTHMA", "CKD", "LIVER", "CANCER",
        "ALLERGY", "PREGNANT",
    ]
    sorted_matched = [c for c in HISTORY_ORDER if c in matched_codes]
    return sorted_matched, raw_codes


def _fetch_diagnoses_sync(subject_id: str) -> list[dict]:
    """동기 구현 — boto3는 동기 라이브러리라 별도 thread에서 실행 필요."""
    client = _get_client()

    sql = (
        f"SELECT * FROM s3object s "
        f"WHERE s.subject_id = '{subject_id}'"
    )

    logger.info(f"[condition_loader] S3 Select 시작: subject={subject_id}")

    try:
        resp = client.select_object_content(
            Bucket=MIMIC_BUCKET,
            Key=MIMIC_DIAGNOSES_KEY,
            Expression=sql,
            ExpressionType="SQL",
            InputSerialization={
                "CSV": {"FileHeaderInfo": "USE", "FieldDelimiter": ","},
                "CompressionType": "GZIP",
            },
            OutputSerialization={"CSV": {}},
        )
    except Exception as e:
        logger.error(f"[condition_loader] S3 Select 호출 실패: {e}")
        return []

    # 스트리밍 응답을 모두 수집해 CSV 파싱
    payload = io.StringIO()
    for event in resp["Payload"]:
        if "Records" in event:
            payload.write(event["Records"]["Payload"].decode("utf-8"))

    payload.seek(0)
    rows: list[dict] = []
    reader = csv.reader(payload)
    for row in reader:
        if len(row) < len(_MIMIC_DIAGNOSES_COLS):
            continue
        rows.append(dict(zip(_MIMIC_DIAGNOSES_COLS, row)))

    logger.info(f"[condition_loader] {subject_id} → {len(rows)}건 진단 조회됨")
    return rows


# subject_id → 결과 in-memory 캐시 (프로세스 lifecycle 동안 유지)
# S3 Select가 호출당 0.7~15초 소요라 두 번 부르지 않도록.
_conditions_cache: dict[str, dict] = {}


async def fetch_conditions(subject_id: str) -> dict:
    """
    MIMIC diagnoses_icd에서 환자 진단 + 알레르기 비동기 조회.

    Args:
        subject_id: MIMIC subject_id (예: "19041043")

    Returns:
        {
          "subject_id": "...",
          "history_codes": ["HTN", "DM", ...],     # PastHistoryCode 매핑 결과
          "raw_icd": [
            {"history_code": "HTN", "icd_code": "I10", "icd_version": 10, "hadm_id": "..."},
            ...
          ],
          "mimic_allergies": [
            {"icd_code": "Z880", "icd_version": 10, "description": "Penicillin",
             "display_text": "Penicillin (Z880)", "hadm_id": "..."},
            ...
          ],
          "allergy_text": "Penicillin, Sulfonamides",   # 합쳐진 알레르기 표시 텍스트
          "total": <조회된 진단 행 수>,
        }
    """
    # 캐시 hit → 즉시 반환 (S3 호출 회피)
    if subject_id in _conditions_cache:
        logger.info(f"[condition_loader] 캐시 hit: subject={subject_id}")
        return _conditions_cache[subject_id]

    # boto3 동기 호출을 thread executor로 비동기화
    rows = await asyncio.to_thread(_fetch_diagnoses_sync, subject_id)

    history_codes, raw_icd = _icd_to_history_codes(rows)
    allergies = _extract_allergies(rows)

    # 알레르기 description을 합쳐 1줄 텍스트로 (UI 입력 필드용)
    if allergies:
        unique_descriptions: list[str] = []
        seen_desc: set[str] = set()
        for a in allergies:
            d = a["description"]
            if d not in seen_desc:
                seen_desc.add(d)
                unique_descriptions.append(d)
        allergy_text = ", ".join(unique_descriptions)
    else:
        allergy_text = "NKDA"

    result = {
        "subject_id": subject_id,
        "history_codes": history_codes,
        "raw_icd": raw_icd,
        "mimic_allergies": allergies,
        "allergy_text": allergy_text,
        "total": len(rows),
    }
    _conditions_cache[subject_id] = result
    return result
