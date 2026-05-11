"""
MIMIC labevents에서 환자 lab 값을 S3 Select로 즉석 조회.

[이 파일이 하는 일]
중앙 백엔드가 LAB 모달 호출 직전에 호출.
subject_id + lab_date로 MIMIC labevents.csv.gz(2.6GB)을 S3에서 직접 SQL로
필터링해, Lab-svc가 요구하는 LabValues 형식의 dict를 만들어 반환한다.

[사용처]
orders.py의 _build_modal_payload("LAB", ...)에서 호출.

[성능 메모]
S3 Select는 호출당 10~30초 소요(2.6GB 압축 파일 서버 측 스캔).
시연 시 의사 [Order LAB] 클릭 후 약간 대기 발생 — 정상 동작.
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
MIMIC_LABEVENTS_KEY = "mimic-iv/hosp/labevents.csv.gz"

# MIMIC d_labitems itemid → Lab-svc LabValues 필드명
# 같은 lab도 fluid/method 따라 itemid 여러 개. ED에서 가장 흔한 것만 매핑.
ITEMID_TO_FEATURE: dict[str, str] = {
    "51301": "wbc",          # White Blood Cells
    "51222": "hemoglobin",   # Hemoglobin
    "51265": "platelet",     # Platelet Count
    "50912": "creatinine",   # Creatinine
    "51006": "bun",          # Urea Nitrogen
    "50983": "sodium",       # Sodium
    "50971": "potassium",    # Potassium
    "50931": "glucose",      # Glucose
    "50878": "ast",          # Asparate Aminotransferase (AST)
    "50862": "albumin",      # Albumin
    "50813": "lactate",      # Lactate
    "50893": "calcium",      # Calcium, Total
    # 심장 마커
    "51003": "troponin_t",   # Troponin T
    "50963": "ntprobnp",     # NTproBNP
    "50911": "ck_mb",        # Creatine Kinase, MB Isoenzyme
}

# 데모 4명 환자 → MIMIC 응급실 방문 일자 매핑 (lab charttime 매칭용)
# subject_id가 이 map에 있으면 자동으로 해당 날짜 lab 조회.
DEMO_SUBJECT_TO_DATE: dict[str, str] = {
    "19041043": "2189-06-21",  # Case 1 (Afib)
    "13715870": "2174-01-04",  # Case 2 (CHF)
    "15638163": "2136-09-27",  # Case 3 (Hyperkalemia)
    "18230098": "2151-08-18",  # Case 4 (NSTEMI + CHF + AKI)
}

_MIMIC_LABEVENTS_COLS = [
    "labevent_id", "subject_id", "hadm_id", "specimen_id", "itemid",
    "order_provider_id", "charttime", "storetime", "value", "valuenum",
    "valueuom", "ref_range_lower", "ref_range_upper", "flag",
    "priority", "comments",
]

_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=AWS_REGION)
    return _s3_client


def _fetch_lab_values_sync(
    subject_id: str,
    charttime_date: Optional[str] = None,
) -> dict[str, float]:
    """동기 구현 — boto3는 동기 라이브러리라 별도 thread에서 실행 필요."""
    client = _get_client()

    # SQL 쿼리 빌드 — date filter 있으면 LIKE로 좁힘
    if charttime_date:
        sql = (
            f"SELECT * FROM s3object s "
            f"WHERE s.subject_id = '{subject_id}' "
            f"AND s.charttime LIKE '{charttime_date}%'"
        )
    else:
        sql = f"SELECT * FROM s3object s WHERE s.subject_id = '{subject_id}'"

    logger.info(f"[lab_loader] S3 Select 시작: subject={subject_id} date={charttime_date}")

    try:
        resp = client.select_object_content(
            Bucket=MIMIC_BUCKET,
            Key=MIMIC_LABEVENTS_KEY,
            Expression=sql,
            ExpressionType="SQL",
            InputSerialization={
                "CSV": {"FileHeaderInfo": "USE", "FieldDelimiter": ","},
                "CompressionType": "GZIP",
            },
            OutputSerialization={"CSV": {}},
        )

        rows: list[str] = []
        for event in resp["Payload"]:
            if "Records" in event:
                rows.append(event["Records"]["Payload"].decode("utf-8"))
    except Exception as e:
        logger.exception(f"[lab_loader] S3 Select 실패: subject={subject_id}")
        return {}

    # CSV 파싱 → itemid 매핑 → 필드별 첫번째 측정값
    result: dict[str, float] = {}
    earliest_time: dict[str, str] = {}  # 같은 feature 여러개면 가장 이른 시간 채택

    for chunk in rows:
        for row in csv.reader(io.StringIO(chunk)):
            if len(row) < len(_MIMIC_LABEVENTS_COLS):
                continue
            d = dict(zip(_MIMIC_LABEVENTS_COLS, row))
            feature = ITEMID_TO_FEATURE.get(d["itemid"])
            if not feature:
                continue
            try:
                val = float(d["valuenum"])
            except (ValueError, TypeError):
                continue
            ct = d.get("charttime", "")
            # 첫 측정 또는 더 이른 시간이면 갱신
            if feature not in result or (ct and ct < earliest_time.get(feature, "9999")):
                result[feature] = val
                earliest_time[feature] = ct

    logger.info(
        f"[lab_loader] subject={subject_id} → {len(result)}개 lab 추출: {list(result.keys())}"
    )
    return result


async def fetch_lab_values(
    subject_id: str,
    charttime_date: Optional[str] = None,
) -> dict[str, float]:
    """
    MIMIC labevents에서 환자 lab 값 비동기 조회.

    Args:
        subject_id: MIMIC subject_id (예: "18230098")
        charttime_date: 조회 날짜 (예: "2151-08-18"). None이면 환자 전체.
                        데모 환자(DEMO_SUBJECT_TO_DATE)는 date 자동 매핑.

    Returns:
        {"wbc": 8.6, "hemoglobin": 8.2, "troponin_t": 0.25, ...}
        측정값 없거나 조회 실패 시 빈 dict.
    """
    if not subject_id:
        return {}

    # 데모 환자면 자동으로 응급실 방문일 적용
    if charttime_date is None:
        charttime_date = DEMO_SUBJECT_TO_DATE.get(subject_id)

    return await asyncio.to_thread(
        _fetch_lab_values_sync, subject_id, charttime_date
    )
