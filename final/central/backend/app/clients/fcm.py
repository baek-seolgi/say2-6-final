"""
FCM(Firebase Cloud Messaging) 디스패처 — critical 이벤트 → 의사 단말 푸시.

[전제]
  device_tokens 테이블에 Flutter 앱이 등록한 FCM 토큰들이 쌓여있다.
  여기서는 임상적으로 critical 이벤트가 발생했을 때
  → 토큰 목록 조회 → FCM 배치 발송 → 죽은 토큰은 DB에서 제거.

[초기화]
  GOOGLE_APPLICATION_CREDENTIALS 환경변수가 service-account.json 경로를 가리키면
  앱 startup 시 init()이 firebase_admin SDK를 초기화한다.
  변수가 없거나 SDK 로드 실패 시 → 모든 send_*()는 no-op (운영 흐름 정상 진행).

[운영 정책]
  - "infra 알림"(컨테이너 다운 등)은 SNS 이메일.
  - "임상 critical 알림"(STEMI, 중증 부정맥 등)은 여기 FCM 경로.
  - 두 트랙이 명확히 분리됨.
"""
from __future__ import annotations

import asyncio
import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

# firebase_admin 로딩은 init() 호출 시 lazy하게 — 의존성 미설치 환경에서도 백엔드 부팅 가능
_app = None
_messaging = None
_initialized = False


def init() -> None:
    """앱 startup hook에서 1회 호출. credentials 없거나 SDK 미설치 시 no-op으로 마킹."""
    global _app, _messaging, _initialized
    if _initialized:
        return
    _initialized = True  # 한 번만 시도

    cred_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    if not cred_path:
        logger.info("[fcm] GOOGLE_APPLICATION_CREDENTIALS 미설정 — 푸시 비활성화 (no-op)")
        return
    if not os.path.exists(cred_path):
        logger.warning("[fcm] credentials 파일 없음 (%s) — 푸시 비활성화", cred_path)
        return

    try:
        import firebase_admin
        from firebase_admin import credentials, messaging
        cred = credentials.Certificate(cred_path)
        _app = firebase_admin.initialize_app(cred)
        _messaging = messaging
        logger.info("[fcm] firebase-admin 초기화 완료 (project=%s)", _app.project_id)
    except ImportError:
        logger.warning("[fcm] firebase-admin 미설치 — 푸시 비활성화. pip install firebase-admin")
    except Exception as e:
        logger.warning("[fcm] 초기화 실패 (%s: %s) — 푸시 비활성화", type(e).__name__, e)


def is_enabled() -> bool:
    return _messaging is not None


# ---------------------------------------------------------------------
# 메인 API — critical 알림 1회 발송
# ---------------------------------------------------------------------
async def send_critical_alert(
    *,
    encounter_id: str,
    title: str,
    body: str,
    modality: Optional[str] = None,
    risk_level: str = "critical",
    user_id: Optional[str] = None,
    silent: bool = False,
) -> dict:
    """
    임상 이벤트 발생 시 모바일 FCM 발송.

    Args:
        encounter_id: 어느 환자(encounter) 건인지 — 알림 탭 시 딥링크에 사용
        title: 알림 제목 (예: "긴급: STEMI 의심")
        body: 알림 본문 (예: "환자 홍OO — ECG ST분절 상승")
        modality: 어떤 모달이 트리거했는지 (ECG/CXR/LAB)
        risk_level: 'critical' 등 — 모바일이 사운드/뱃지 차별화에 사용
        user_id: 특정 의사 1명만 보낼 때. None이면 전체 활성 의사에게 broadcast.
        silent: True면 조용한 알림(소리·진동 X, 뱃지·알림 센터엔 표시).
                report_generated·미서명 리마인더는 silent=True 권장.
                critical은 silent=False (기존 동작).

    Returns:
        {"sent": N, "failed": M, "pruned": K, "skipped_reason": str | None}
    """
    if not is_enabled():
        return {"sent": 0, "failed": 0, "pruned": 0, "skipped_reason": "fcm_disabled"}

    from app.db import device_tokens as _dt
    if user_id:
        rows = await _dt.list_active_for_user(user_id)
    else:
        rows = await _dt.list_all_active()

    if not rows:
        return {"sent": 0, "failed": 0, "pruned": 0, "skipped_reason": "no_tokens"}

    data = {
        "encounter_id": encounter_id,
        "risk_level": risk_level,
        "modality": modality or "",
        # 모바일에서 알림 탭 시 → /patient/{encounter_id}로 라우팅하기 위한 키
        "deep_link": f"/patient/{encounter_id}",
    }

    tokens = [r["token"] for r in rows]

    # 알림 강도 — silent 모드면 OS 알림은 뜨되 소리·진동·우선순위만 낮춤
    android_priority = "normal" if silent else "high"
    android_sound: Optional[str] = None if silent else "default"
    apns_sound: Optional[str] = None if silent else "default"

    # firebase_admin은 동기 호출 — 이벤트 루프 막지 않게 thread로
    def _send_sync() -> tuple[int, int, list[str]]:
        assert _messaging is not None
        msg = _messaging.MulticastMessage(
            tokens=tokens,
            notification=_messaging.Notification(title=title, body=body),
            data=data,
            android=_messaging.AndroidConfig(
                priority=android_priority,
                notification=_messaging.AndroidNotification(
                    channel_id="say6_critical" if not silent else "say6_normal",
                    sound=android_sound,
                ),
            ),
            apns=_messaging.APNSConfig(
                # apns-priority: 10=즉시(소리 OK), 5=조용
                headers={"apns-priority": "5" if silent else "10"},
                payload=_messaging.APNSPayload(
                    aps=_messaging.Aps(sound=apns_sound, content_available=True),
                ),
            ),
        )
        resp = _messaging.send_each_for_multicast(msg)
        dead: list[str] = []
        for idx, r in enumerate(resp.responses):
            if not r.success and r.exception is not None:
                err_code = getattr(r.exception, "code", "")
                # FCM이 토큰 무효라고 응답한 경우 → DB에서 제거 대상
                if err_code in ("registration-token-not-registered", "invalid-argument"):
                    dead.append(tokens[idx])
        return resp.success_count, resp.failure_count, dead

    try:
        sent, failed, dead = await asyncio.to_thread(_send_sync)
    except Exception as e:
        logger.exception("[fcm] 발송 실패: %s", e)
        return {"sent": 0, "failed": len(tokens), "pruned": 0, "skipped_reason": f"send_error:{type(e).__name__}"}

    # 죽은 토큰 정리 (실패해도 전체 흐름 계속)
    pruned = 0
    for t in dead:
        try:
            if await _dt.delete(t):
                pruned += 1
        except Exception:
            logger.warning("[fcm] dead token 제거 실패")

    logger.info(
        "[fcm] critical 발송 — encounter=%s sent=%d failed=%d pruned=%d",
        encounter_id, sent, failed, pruned,
    )
    return {"sent": sent, "failed": failed, "pruned": pruned, "skipped_reason": None}
