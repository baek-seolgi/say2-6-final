"""
WebSocket /ws/encounter/{id} — 실시간 상태 푸시.

[이 파일이 하는 일]
프론트엔드가 WebSocket으로 연결하면, 백엔드에서 이벤트 발생 시 즉시 알림.

[푸시되는 이벤트]
- initial_proposals: 트리아지 후 AI가 초기 모달 제안
- modal_completed: 모달 실행 완료 (결과 나옴)
- modal_failed: 모달 실행 실패
- new_proposal: AI가 새 모달 제안 (기각 후 대안)
- ready_for_report: 모든 모달 완료, 리포트 생성 가능

[호출하는 곳]
프론트엔드 대시보드에서 WS /ws/encounter/{id}로 연결
"""
from __future__ import annotations

import logging
from typing import Dict, Set
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)
router = APIRouter()

# encounter_id → set of connected websockets
_connections: Dict[str, Set[WebSocket]] = {}


@router.websocket("/ws/encounter/{encounter_id}")
async def encounter_ws(websocket: WebSocket, encounter_id: str):
    await websocket.accept()
    _connections.setdefault(encounter_id, set()).add(websocket)
    logger.info(f"WS connected: encounter={encounter_id}")

    try:
        while True:
            # 클라이언트 ping/pong 유지
            await websocket.receive_text()
    except WebSocketDisconnect:
        _connections[encounter_id].discard(websocket)
        logger.info(f"WS disconnected: encounter={encounter_id}")


async def broadcast(encounter_id: str, message: dict):
    """
    해당 encounter 구독자 전원에게 메시지 전송 + modal_events 테이블에 적재.

    DB 적재는 디버그/감사로그 + 프론트 타임라인 API의 데이터 소스로 활용된다.
    적재 실패해도 WS 푸시는 진행.

    이벤트가 critical이면 모바일 FCM 푸시도 fan-out — 의사가 앱을 안 보고 있어도
    OS 레벨 알림이 뜨도록. FCM 미설정이면 no-op.
    """
    # 1. DB 적재 (event_type은 message["event"], 나머지는 payload)
    try:
        from app.db import client as _db
        import json as _json
        event_type = str(message.get("event") or "unknown")[:40]
        await _db.execute(
            "INSERT INTO modal_events (encounter_id, event_type, payload) "
            "VALUES ($1, $2, $3::jsonb)",
            encounter_id, event_type, _json.dumps(message, ensure_ascii=False, default=str),
        )
    except Exception as e:
        logger.warning("[modal_events] insert 실패 (broadcast는 계속): %s", e)

    # 2. 구독자(웹)에게 푸시
    sockets = _connections.get(encounter_id, set())
    closed = set()
    for ws in sockets:
        try:
            await ws.send_json(message)
        except Exception:
            closed.add(ws)
    sockets -= closed

    # 3. critical 이벤트면 FCM도 fan-out (best-effort, 실패해도 흐름 유지)
    try:
        await _maybe_fcm_critical(encounter_id, message)
    except Exception as e:
        logger.warning("[fcm] critical fan-out 실패 (broadcast는 계속): %s", e)


async def _maybe_fcm_critical(encounter_id: str, message: dict) -> None:
    """
    FCM 모바일 푸시 발송 게이트키퍼.

    [발송 트리거]
    1. critical 이벤트         — risk_level=='critical' 또는 fcm_push=True
                                  → 소리+진동 (silent=False)
    2. report_generated 이벤트 — 의사한테 "검토·서명 필요" 안내
                                  → 조용한 알림 (silent=True)
       - 단 critical인 경우는 1번 트랙으로 처리됨

    [WS 활성 시 스킵]
    - 의사가 데스크탑(React)에서 해당 환자 화면을 보고 있으면 (= WS 구독 중) 중복 알림 방지.
    - 단 critical만은 무조건 발송 (안전 우선).
    """
    risk = str(message.get("risk_level") or "").lower()
    event = str(message.get("event") or "")

    is_critical = (risk == "critical") or (message.get("fcm_push") is True)
    is_report_generated = (event == "report_generated")

    if not is_critical and not is_report_generated:
        return

    from app.clients import fcm
    if not fcm.is_enabled():
        return

    # ── WS 구독 중인 데스크탑이 있으면 critical 외엔 스킵 ───────
    web_viewers = len(_connections.get(encounter_id, set()))
    if web_viewers > 0 and not is_critical:
        logger.debug(
            "[fcm] WS 구독자 %d명 — non-critical FCM 스킵 (encounter=%s, event=%s)",
            web_viewers, encounter_id, event,
        )
        return

    # ── 알림 내용 ───────────────────────────────────────────
    modality = str(message.get("modality") or "").upper() or None
    summary = str(message.get("summary") or "").strip()
    modality_ko = {"ECG": "심전도", "CXR": "흉부 X-ray", "LAB": "혈액검사"}.get(modality or "", "AI 판독")

    if is_critical:
        # 트랙 ① 긴급 (기존 동작 유지)
        if event == "modal_completed":
            title = f"🚨 긴급: {modality_ko} critical 소견"
        elif event == "triage_assessed":
            title = "🚨 긴급 환자 분류 — 즉시 확인 필요"
        else:
            title = "🚨 긴급 알림"
        body = summary[:160] if summary else "환자 상태가 critical로 평가되었습니다."
        silent = False
        risk_for_data = "critical"
    else:
        # 트랙 ② report_generated (조용한 알림)
        title = "✍️ 종합소견서 검토 필요"
        body = summary[:160] if summary else "AI 종합소견서가 생성되었습니다. 검토·서명 부탁드립니다."
        silent = True
        risk_for_data = risk or "routine"

    await fcm.send_critical_alert(
        encounter_id=encounter_id,
        title=title,
        body=body,
        modality=modality,
        risk_level=risk_for_data,
        silent=silent,
    )
