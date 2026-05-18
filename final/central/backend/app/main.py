"""FastAPI application entry point."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import triage, orders, encounters, reports, ws, mimic, assets, devices
from app.config import APP_HOST, APP_PORT
from app.db import client as db

# 우리 코드의 logger.info도 보이도록 INFO 레벨로 root 로거 초기화.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

# Global ML models and utilities for decision engine
ml_models_initial = None
ml_models_followup = None
ml_metadata_initial = None
ml_metadata_followup = None
cc_map = None
feature_extractor = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB 풀 초기화 및 ML 모델 로드, 종료 시 정리."""
    global ml_models_initial, ml_models_followup, ml_metadata_initial, ml_metadata_followup
    global cc_map, feature_extractor
    
    # Startup
    try:
        await db.init_pool()
    except Exception as e:
        # DB 연결 실패해도 앱은 떠야 함 (FHIR 단독 동작 가능)
        logger.warning("Ops DB pool init 실패 (FHIR만 사용됨): %s", e)
    
    # Load ML models for decision engine
    try:
        from app.agent.hybrid_decision_engine import load_stratified_models
        from app.agent.orchestrator_utils.cc_map import load_cc_map
        from app.agent.orchestrator_utils.feature_extractor import load_feature_extractor
        
        logger.info("Loading ML models for decision engine...")
        
        # Load stratified models
        ml_models_initial, ml_models_followup, ml_metadata_initial, ml_metadata_followup = load_stratified_models(
            initial_dir='app/agent/models_stratified/initial',
            followup_dir='app/agent/models_stratified/followup'
        )
        
        logger.info(f"✓ Loaded ML models: initial={len(ml_models_initial)}, followup={len(ml_models_followup)}")
        
        # Load CC map
        try:
            cc_map = load_cc_map('data/chief_complaint_modality_map.parquet')
            logger.info(f"✓ Loaded CC map: {cc_map.get_summary()['total_chief_complaints']} chief complaints")
        except Exception as e:
            logger.warning(f"CC map loading failed (will use fallback): {e}")
            cc_map = None
        
        # Load feature extractor
        try:
            feature_extractor = load_feature_extractor(
                cc_map_path='data/chief_complaint_modality_map.parquet',
                metadata_path='app/agent/models_stratified/followup/metadata.pkl'
            )
            logger.info("✓ Loaded feature extractor")
        except Exception as e:
            logger.warning(f"Feature extractor loading failed (will use fallback): {e}")
            feature_extractor = None
        
        # Store in app state for access in routes
        app.state.ml_models_initial = ml_models_initial
        app.state.ml_models_followup = ml_models_followup
        app.state.ml_metadata_initial = ml_metadata_initial
        app.state.ml_metadata_followup = ml_metadata_followup
        app.state.cc_map = cc_map
        app.state.feature_extractor = feature_extractor
        
    except Exception as e:
        logger.error(f"Failed to load ML models: {e}")
        logger.warning("Decision engine will use fallback mode")

    # HAPI 동기화 재시도 워커 (Graceful Degradation)
    # HAPI 일시 다운 시 fhir_sync_queue에 적재된 row를 5분마다 백필
    retry_task = None
    try:
        import asyncio
        from app.agent.fhir_retry_worker import fhir_retry_loop
        retry_task = asyncio.create_task(fhir_retry_loop())
        logger.info("✓ FHIR retry worker scheduled (interval=5min)")
    except Exception as e:
        logger.warning("FHIR retry worker 시작 실패: %s", e)

    # FCM 푸시 — credentials 없으면 graceful no-op
    try:
        from app.clients import fcm
        fcm.init()
    except Exception as e:
        logger.warning("FCM init 실패 (푸시 비활성화): %s", e)

    # 미서명 소견서 리마인더 워커 — 1분마다 폴링
    # 5분 경과 + 미서명인 소견서에 FCM 조용한 알림 발송
    reminder_task = None
    try:
        from app.agent.report_reminder_worker import report_reminder_loop
        reminder_task = asyncio.create_task(report_reminder_loop())
        logger.info("✓ Report reminder worker scheduled (interval=60s)")
    except Exception as e:
        logger.warning("Report reminder worker 시작 실패: %s", e)

    yield

    # Shutdown
    if retry_task and not retry_task.done():
        retry_task.cancel()
    if reminder_task and not reminder_task.done():
        reminder_task.cancel()
    try:
        await db.close_pool()
    except Exception as e:
        logger.warning("Ops DB pool close 실패: %s", e)


app = FastAPI(
    title="Emergency Multimodal Orchestrator — Backend",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Routers ──────────────────────────────────────────────
app.include_router(triage.router, prefix="/triage", tags=["triage"])
app.include_router(orders.router, prefix="/orders", tags=["orders"])
app.include_router(encounters.router, prefix="/encounters", tags=["encounters"])
app.include_router(reports.router, prefix="/reports", tags=["reports"])
app.include_router(mimic.router, prefix="/mimic", tags=["mimic"])
app.include_router(assets.router, prefix="/assets", tags=["assets"])
app.include_router(devices.router, prefix="/devices", tags=["devices"])
app.include_router(ws.router, tags=["websocket"])


@app.get("/health")
async def health():
    """간단 헬스체크. DB 연결 상태도 확인하려면 /ready 사용."""
    return {"status": "ok"}


@app.get("/ready")
async def ready():
    """Readiness probe — FHIR·DB 모두 준비됐을 때만 OK."""
    db_ok = await db.healthcheck()
    return {
        "status": "ready" if db_ok else "degraded",
        "ops_db": db_ok,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host=APP_HOST, port=APP_PORT, reload=True)
