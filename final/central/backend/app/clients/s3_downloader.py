"""
S3 객체 다운로드 유틸.

[이 파일이 하는 일]
CXR 서비스가 image_base64만 받으므로, 중앙백엔드가 S3 이미지를
다운로드 → base64 인코딩하여 CXR 서비스로 전달한다.

ECG 서비스는 자체적으로 S3에서 WFDB를 로드하므로 여기서 다루지 않는다
(record_path를 그대로 ECG 서비스에 전달).

[사용처]
orders.py의 _build_modal_payload("CXR", ...)에서 호출.
"""
from __future__ import annotations

import base64
import logging

import boto3
from botocore.exceptions import ClientError

from app.config import AWS_REGION

logger = logging.getLogger(__name__)

_s3_client = None


def _get_client():
    global _s3_client
    if _s3_client is None:
        _s3_client = boto3.client("s3", region_name=AWS_REGION)
    return _s3_client


def parse_s3_uri(uri: str) -> tuple[str, str] | None:
    """s3://bucket/key → (bucket, key). 잘못된 형식이면 None."""
    if not uri or not uri.startswith("s3://"):
        return None
    rest = uri[len("s3://"):]
    if "/" not in rest:
        return None
    bucket, key = rest.split("/", 1)
    if not bucket or not key:
        return None
    return bucket, key


def download_bytes(s3_uri: str) -> bytes:
    """S3 객체 → bytes. 실패 시 예외."""
    parsed = parse_s3_uri(s3_uri)
    if parsed is None:
        raise ValueError(f"잘못된 S3 URI: {s3_uri}")

    bucket, key = parsed
    client = _get_client()
    try:
        obj = client.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read()
    except ClientError as e:
        raise RuntimeError(f"S3 다운로드 실패 ({bucket}/{key}): {e}") from e


def download_as_base64(s3_uri: str) -> str:
    """S3 객체 → base64 인코딩 문자열. CXR image_base64 필드용."""
    data = download_bytes(s3_uri)
    return base64.b64encode(data).decode("ascii")
