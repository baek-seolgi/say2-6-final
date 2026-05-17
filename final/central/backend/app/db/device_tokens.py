"""
모바일 푸시 알림 토큰 — FCM / APNs / Web Push.

[흐름]
  Flutter 앱 시작 → POST /devices/register {token, platform, user_id?, app_version?}
    → register_or_refresh() UPSERT
  critical 이벤트 발생 (ex. STEMI patient triage)
    → list_active_for_user(user_id) 또는 list_all_active()
    → FCM/APNs API로 push 발송 (별도 dispatcher 모듈에서)
  토큰이 더 이상 유효하지 않다는 응답을 받으면 → delete(token)
"""
from __future__ import annotations

import logging

from app.db import client as db

logger = logging.getLogger(__name__)


async def register_or_refresh(
    *,
    token: str,
    platform: str,
    user_id: str | None = None,
    app_version: str | None = None,
) -> int:
    """
    UPSERT — 같은 token이 이미 있으면 last_seen_at·platform·app_version·user_id 갱신.

    user_id가 NULL로 들어와도 기존 값을 보존(COALESCE) — 익명 등록 후 로그인 시
    user_id가 채워지면 그때부터 그 사용자 토큰으로 인식.
    """
    row = await db.fetchone(
        """
        INSERT INTO device_tokens (user_id, token, platform, app_version)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (token) DO UPDATE SET
            user_id      = COALESCE(EXCLUDED.user_id, device_tokens.user_id),
            platform     = EXCLUDED.platform,
            app_version  = COALESCE(EXCLUDED.app_version, device_tokens.app_version),
            last_seen_at = NOW()
        RETURNING id
        """,
        user_id, token, platform, app_version,
    )
    assert row is not None
    return int(row["id"])


async def list_active_for_user(user_id: str, *, days: int = 30) -> list[dict]:
    """특정 사용자의 활성 토큰들 (기본 30일 내 last_seen)."""
    rows = await db.fetch(
        f"""
        SELECT id, token, platform, app_version, last_seen_at
        FROM device_tokens
        WHERE user_id = $1 AND last_seen_at > NOW() - INTERVAL '{int(days)} days'
        ORDER BY last_seen_at DESC
        """,
        user_id,
    )
    return [dict(r) for r in rows]


async def list_all_active(*, days: int = 30) -> list[dict]:
    """모든 활성 토큰 (브로드캐스트 알림용)."""
    rows = await db.fetch(
        f"""
        SELECT id, user_id, token, platform, last_seen_at
        FROM device_tokens
        WHERE last_seen_at > NOW() - INTERVAL '{int(days)} days'
        """
    )
    return [dict(r) for r in rows]


async def delete(token: str) -> bool:
    """FCM/APNs로부터 invalid token 응답 받으면 호출."""
    result = await db.execute(
        "DELETE FROM device_tokens WHERE token = $1", token
    )
    return result.endswith(" 1")
