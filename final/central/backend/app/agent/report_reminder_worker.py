"""
미서명 소견서 리마인더 워커.

생성된 지 5분이 지났는데도 의사가 서명 안 한 소견서를 찾아
의사 폰에 FCM 조용한 알림(silent) 푸시.

[정책]
- 5분 경과 + 미서명(status != 'signed') → 첫 리마인더
- 마지막 리마인더로부터 10분 경과 → 다시 리마인더 (스팸 방지 간격)
- silent=True (소리·진동 X, 뱃지·알림 센터에만 표시)

[활성화 조건]
- FCM 자격증명(GOOGLE_APPLICATION_CREDENTIALS) 있을 때만 의미 있음
- 미설정 시 fcm.send_critical_alert가 no-op이라 워커는 돌아도 무해
"""
from __future__ import annotations

import asyncio
import logging

from app.clients import fcm
from app.db import client as db

logger = logging.getLogger(__name__)

LOOP_INTERVAL_SEC = 60       # 1분마다 큐 점검
UNSIGNED_THRESHOLD_MIN = 5   # 생성 후 5분 경과 시 첫 리마인더
RESEND_GAP_MIN = 10          # 마지막 리마인더로부터 10분 후 재발송
BATCH_SIZE = 50              # 한 사이클당 처리량 (FCM 부하 제어)


async def report_reminder_loop() -> None:
    """앱 startup 시 띄워두는 영구 백그라운드 태스크."""
    logger.info(
        "[report-reminder] 시작 — %ds 주기, 미서명 %d분 경과 시 리마인더",
        LOOP_INTERVAL_SEC, UNSIGNED_THRESHOLD_MIN,
    )
    while True:
        try:
            await _process_due_reports()
        except Exception:
            logger.exception("[report-reminder] 루프 자체 에러")
        await asyncio.sleep(LOOP_INTERVAL_SEC)


async def _process_due_reports() -> None:
    """미서명 + 시간 경과한 소견서를 찾아 FCM 발송 + 발송 시각 마킹."""
    rows = await db.fetch(
        f"""
        SELECT id, encounter_id, ai_diagnosis, ai_risk_level
        FROM diagnostic_reports
        WHERE status <> 'signed'
          AND created_at < NOW() - INTERVAL '{UNSIGNED_THRESHOLD_MIN} minutes'
          AND (last_reminder_at IS NULL
               OR last_reminder_at < NOW() - INTERVAL '{RESEND_GAP_MIN} minutes')
        ORDER BY created_at
        LIMIT {BATCH_SIZE}
        """
    )

    if not rows:
        return

    logger.info("[report-reminder] 미서명 소견서 %d건 발견 — 리마인더 발송", len(rows))

    for r in rows:
        report_id = r["id"]
        encounter_id = r["encounter_id"]
        diag = (r["ai_diagnosis"] or "").strip()
        risk = (r["ai_risk_level"] or "routine").lower()

        # 알림 본문 — 너무 길지 않게
        body_summary = diag[:120] if diag else "AI 종합소견서가 5분째 미서명 상태입니다."
        title = "⏰ 소견서 미서명 알림"

        try:
            await fcm.send_critical_alert(
                encounter_id=encounter_id,
                title=title,
                body=body_summary,
                modality=None,
                risk_level=risk,
                silent=True,     # 조용한 알림 — 소리 X
            )
        except Exception:
            logger.exception("[report-reminder] FCM 발송 실패 — report_id=%s", report_id)
            # 발송 실패해도 last_reminder_at 갱신은 함 (무한 재시도 방지)

        # 발송 시각 마킹 (성공·실패 무관하게 — 다음 사이클은 RESEND_GAP_MIN 후)
        try:
            await db.execute(
                "UPDATE diagnostic_reports SET last_reminder_at = NOW() WHERE id = $1",
                report_id,
            )
        except Exception:
            logger.exception("[report-reminder] last_reminder_at 갱신 실패 — report_id=%s", report_id)
