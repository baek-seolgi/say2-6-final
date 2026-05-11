"""
Lab 서비스 FastAPI 진입점

엔드포인트:
  POST /predict     — 혈액검사 해석 요청 (룰 엔진)
  POST /predict_6h  — 6시간 후 악화 확률 예측 (XGBoost 5-앙상블)
  GET  /health      — 헬스체크 (ALB / k8s probe)
  GET  /ready       — readiness probe
"""

import logging
import sys
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse

from config import HOST, PORT, LOG_LEVEL
from shared.schemas import PredictRequest, PredictResponse
from pipeline import LabPipeline
from prognosis.model import load_models as load_prognosis_models, predict as predict_prognosis
from prognosis.schema import BloodTestInput, PredictionResult

# ------------------------------------------------------------------
# 로깅 설정
# ------------------------------------------------------------------
logging.basicConfig(
    level=LOG_LEVEL.upper(),
    format="%(asctime)s %(levelname)s %(name)s — %(message)s",
    handlers=[logging.StreamHandler(sys.stdout)],
)
logger = logging.getLogger("lab-svc")

# ------------------------------------------------------------------
# 파이프라인 싱글톤
# ------------------------------------------------------------------
pipeline = LabPipeline()

# 6시간 예측 모델 (lifespan에서 로드)
prognosis_models: dict = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("prognosis 모델 로딩 중...")
    prognosis_models["final"] = load_prognosis_models()
    logger.info("prognosis 모델 로딩 완료 (n=%d)", len(prognosis_models["final"]))
    yield
    prognosis_models.clear()


# ------------------------------------------------------------------
# FastAPI 앱
# ------------------------------------------------------------------
app = FastAPI(
    title="Lab 혈액검사 해석 서비스",
    description="Rule Engine 해석 + 6시간 후 악화 예측 통합 서비스",
    version="1.1.0",
    lifespan=lifespan,
)


# ------------------------------------------------------------------
# 엔드포인트
# ------------------------------------------------------------------
@app.post("/predict", response_model=PredictResponse)
async def predict(req: PredictRequest) -> PredictResponse:
    """혈액검사 수치 해석 및 리포트 반환"""
    if not pipeline.ready:
        raise HTTPException(status_code=503, detail="서비스가 준비되지 않았습니다.")

    response = pipeline.predict(req)

    if response.status == "error":
        raise HTTPException(status_code=500, detail="내부 서버 오류")

    return response


@app.post("/predict_6h", response_model=PredictionResult)
async def predict_6h(input_data: BloodTestInput) -> PredictionResult:
    """6시간 후 혈액검사 악화 확률 예측 (XGBoost 5-앙상블)"""
    if "final" not in prognosis_models:
        raise HTTPException(status_code=503, detail="prognosis 모델이 로드되지 않았습니다.")

    result = predict_prognosis(prognosis_models["final"], input_data.model_dump())
    return result


@app.get("/health")
async def health():
    """ALB 헬스체크 — 항상 200"""
    return {"status": "healthy"}


@app.get("/ready")
async def ready():
    """Readiness probe"""
    if not pipeline.ready:
        return JSONResponse(status_code=503, content={"status": "not_ready"})
    if "final" not in prognosis_models:
        return JSONResponse(status_code=503, content={"status": "prognosis_not_loaded"})
    return {"status": "ready"}


# ------------------------------------------------------------------
# 전역 예외 핸들러
# ------------------------------------------------------------------
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("처리되지 않은 예외: %s", exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "내부 서버 오류"},
    )


# ------------------------------------------------------------------
# 직접 실행
# ------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=HOST,
        port=PORT,
        log_level=LOG_LEVEL.lower(),
        reload=False,
    )
