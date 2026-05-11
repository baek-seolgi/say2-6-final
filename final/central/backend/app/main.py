"""FastAPI application entry point."""
import logging
import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api import triage, orders, encounters, reports, ws, mimic, assets
from app.config import APP_HOST, APP_PORT
from app.db import client as db

# 우리 코드의 logger.info도 보이도록 INFO 레벨로 root 로거 초기화.
logging.basicConfig(
    level=os.getenv("LOG_LEVEL", "INFO"),
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """앱 시작 시 DB 풀 초기화, 종료 시 정리."""
    # Startup
    try:
        await db.init_pool()
    except Exception as e:
        # DB 연결 실패해도 앱은 떠야 함 (FHIR 단독 동작 가능)
        logger.warning("Ops DB pool init 실패 (FHIR만 사용됨): %s", e)

    yield

    # Shutdown
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
