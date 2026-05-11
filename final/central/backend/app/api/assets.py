"""
자산 프록시 — S3 이미지를 브라우저에서 직접 표시 가능한 jpg로 스트리밍.

[이 파일이 하는 일]
프론트가 <img src="/assets/cxr/{subject_id}"> 로 가져갈 때, 중앙백엔드가
S3에서 jpg를 boto3로 받아 그대로 응답한다. 버킷은 비공개로 두고 백엔드만
IAM 권한으로 접근 → 의료데이터 보안 OK.

[엔드포인트]
GET /assets/cxr/{subject_id}
    데모 4명의 MIMIC-CXR jpg를 반환. subject_id가 매핑에 없으면 404.

[사용처]
DashboardPage.tsx 의 CXR 탭이 <img src=...> 로 호출.
모달 분석 자체는 정식 흐름인 /orders/{encounter_id}/run 사용.
"""
from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

from app.clients.s3_downloader import download_bytes

logger = logging.getLogger(__name__)
router = APIRouter()


# 시연용 데모 4명 — subject_id → MIMIC-CXR S3 경로 매핑
# (lab_loader.DEMO_SUBJECT_TO_DATE 와 동일 4명, study_id 1개 고정)
DEMO_SUBJECT_TO_CXR: dict[str, str] = {
    # 응급실 도착일(lab_loader.DEMO_SUBJECT_TO_DATE)의 첫 PA
    # — say2-6team/mimic/cxr/cxr_final_dataset.csv의 ViewPosition='PA' + cxr_time 기준 검증
    "19041043": "s3://say1-pre-project-5/data/mimic-cxr-jpg/files/p19/p19041043/s55653653/93fb38fb-c721d253-e194385f-61c955d3-f9a90736.jpg",
    "13715870": "s3://say1-pre-project-5/data/mimic-cxr-jpg/files/p13/p13715870/s53940823/a3fd0c8a-75e1b24c-12028360-df56d3d4-42ee122e.jpg",
    "15638163": "s3://say1-pre-project-5/data/mimic-cxr-jpg/files/p15/p15638163/s53577003/9f64814d-438562ea-6e1930ec-a7713602-c61d382e.jpg",
    "18230098": "s3://say1-pre-project-5/data/mimic-cxr-jpg/files/p18/p18230098/s58964529/ef582e36-fe63fc3f-a5d512ae-9e2828c0-88d3b59d.jpg",
}



@router.get("/cxr/{subject_id}")
async def get_cxr_image(subject_id: str):
    """데모 환자의 MIMIC-CXR jpg를 그대로 스트리밍."""
    s3_uri = DEMO_SUBJECT_TO_CXR.get(subject_id)
    if not s3_uri:
        raise HTTPException(
            status_code=404,
            detail=f"subject_id={subject_id} 의 CXR 매핑을 찾을 수 없습니다.",
        )

    try:
        data = download_bytes(s3_uri)
    except Exception as e:
        logger.warning(f"[assets] CXR 다운로드 실패 ({s3_uri}): {e}")
        raise HTTPException(status_code=502, detail=f"S3 다운로드 실패: {e}") from e

    return Response(
        content=data,
        media_type="image/jpeg",
        headers={
            # 시연/iter 단계 — 매핑 갱신 즉시 반영. 운영 시 max-age=3600으로 조정.
            "Cache-Control": "no-store",
        },
    )
