"""
asyncpg 커넥션 풀 관리.

[이 파일이 하는 일]
앱 시작 시 PostgreSQL 커넥션 풀을 만들고, 앱 종료 시 정리.
각 API 엔드포인트/백그라운드 태스크가 이 풀을 공유해 쿼리 실행.

[왜 풀을 쓰나]
매 요청마다 커넥션을 새로 만들면 비용이 큼 (연결 수립 100ms+).
풀을 미리 만들어두고 빌려 쓰는 게 수십 배 빠름.

[사용 예]
from app.db import client as db
await db.execute("INSERT INTO encounters ...")
row = await db.fetchone("SELECT ...")
rows = await db.fetch("SELECT ...")
"""
from __future__ import annotations

import logging
from typing import Any

import asyncpg

from app.config import OPS_DB_URL, OPS_DB_POOL_MIN, OPS_DB_POOL_MAX

logger = logging.getLogger(__name__)

# 전역 풀 (startup에서 초기화)
_pool: asyncpg.Pool | None = None


async def init_pool() -> None:
    """앱 startup 시 호출 — 커넥션 풀 생성."""
    global _pool
    if _pool is not None:
        logger.warning("DB pool already initialized")
        return

    logger.info(
        "Initializing ops DB pool (min=%d, max=%d)",
        OPS_DB_POOL_MIN, OPS_DB_POOL_MAX,
    )
    _pool = await asyncpg.create_pool(
        dsn=OPS_DB_URL,
        min_size=OPS_DB_POOL_MIN,
        max_size=OPS_DB_POOL_MAX,
        command_timeout=30,
    )
    logger.info("Ops DB pool ready")


async def close_pool() -> None:
    """앱 shutdown 시 호출 — 커넥션 풀 정리."""
    global _pool
    if _pool is None:
        return
    await _pool.close()
    _pool = None
    logger.info("Ops DB pool closed")


def _get_pool() -> asyncpg.Pool:
    if _pool is None:
        raise RuntimeError(
            "Ops DB pool not initialized. init_pool()을 먼저 호출하세요."
        )
    return _pool


# ── 쿼리 래퍼 ────────────────────────────────────────────

async def execute(query: str, *args: Any) -> str:
    """INSERT/UPDATE/DELETE. 결과 상태 문자열 반환 ('INSERT 0 1' 등)."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.execute(query, *args)


async def fetchone(query: str, *args: Any) -> asyncpg.Record | None:
    """단일 행 조회. 없으면 None."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchrow(query, *args)


async def fetch(query: str, *args: Any) -> list[asyncpg.Record]:
    """여러 행 조회."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetch(query, *args)


async def fetchval(query: str, *args: Any) -> Any:
    """단일 값 조회 (COUNT, EXISTS 등)."""
    pool = _get_pool()
    async with pool.acquire() as conn:
        return await conn.fetchval(query, *args)


async def transaction():
    """
    트랜잭션용 컨텍스트 매니저.

    사용:
        async with db.transaction() as conn:
            await conn.execute("INSERT ...")
            await conn.execute("UPDATE ...")
    """
    pool = _get_pool()
    return pool.acquire()  # 이후 `async with conn.transaction():` 로 래핑


async def healthcheck() -> bool:
    """DB 연결 헬스체크. SELECT 1 실행."""
    try:
        pool = _get_pool()
        async with pool.acquire() as conn:
            result = await conn.fetchval("SELECT 1")
        return result == 1
    except Exception as e:
        logger.warning("Ops DB healthcheck failed: %s", e)
        return False
