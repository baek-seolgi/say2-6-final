"""Application configuration — environment variables."""
import os


# FHIR Server
FHIR_BASE_URL = os.getenv("FHIR_BASE_URL", "http://localhost:8080/fhir")

# 운영 DB (central_db) — HAPI FHIR가 쓰는 hapi DB와 같은 RDS 인스턴스의 별도 database
# 로컬: docker-compose의 postgres 컨테이너
# 운영: AWS RDS PostgreSQL (db.t3.micro)
OPS_DB_URL = os.getenv(
    "OPS_DB_URL",
    "postgresql://admin:secret@localhost:5432/central_db",
)
OPS_DB_POOL_MIN = int(os.getenv("OPS_DB_POOL_MIN", "2"))
OPS_DB_POOL_MAX = int(os.getenv("OPS_DB_POOL_MAX", "10"))

# AWS
AWS_REGION = os.getenv("AWS_REGION", "ap-northeast-2")
BEDROCK_MODEL_ID = os.getenv(
    "BEDROCK_MODEL_ID",
    # Claude Sonnet 4.6 (Global inference profile)
    # 한국어 의학 reasoning 품질 ↑, 1회 진단서 ~30원
    "global.anthropic.claude-sonnet-4-6",
)

# Modal services — HTTP 엔드포인트 (ECS Service Discovery / EC2 직접 호출)
# ECS 내부: http://{service}.drai.internal:8000
# 로컬 개발: docker-compose로 같은 네트워크 (http://{service}:8000)
# 공인 IP 직접 호출 (fallback): http://13.124.117.190:8000 등
ECG_SERVICE_URL = os.getenv("ECG_SERVICE_URL", "http://52.79.251.216:8003")
CXR_SERVICE_URL = os.getenv("CXR_SERVICE_URL", "http://52.79.251.216:8002")
LAB_SERVICE_URL = os.getenv(
    "LAB_SERVICE_URL",
    "http://52.79.251.216:8000",
)

# 6시간 후 악화 예측 (XGBoost 5-앙상블)
# Lab-svc 내부로 통합됨 — 동일 컨테이너 8000 포트의 /predict_6h 엔드포인트.
# (이전: 별도 blood-prognosis 컨테이너 8001 포트)
BLOOD_PROGNOSIS_URL = os.getenv("BLOOD_PROGNOSIS_URL", "http://52.79.251.216:8000")

# 모달 호출 타임아웃 (초)
MODAL_HTTP_TIMEOUT = float(os.getenv("MODAL_HTTP_TIMEOUT", "60.0"))

# (레거시) SageMaker endpoints — HTTP 전환 후 사용 안 함. 하위호환용 유지.
SAGEMAKER_CXR_ENDPOINT = os.getenv("SAGEMAKER_CXR_ENDPOINT", "")
SAGEMAKER_ECG_ENDPOINT = os.getenv("SAGEMAKER_ECG_ENDPOINT", "")

# S3
S3_ASSET_BUCKET = os.getenv("S3_ASSET_BUCKET", "say2-6team")

# App
APP_HOST = os.getenv("APP_HOST", "0.0.0.0")
APP_PORT = int(os.getenv("APP_PORT", "8000"))
