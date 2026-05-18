# ⚡ 3교시 — FastAPI 비동기 파이프라인과 실시간 알림 이중화 구조

> 📚 **과목**: Emergency Multimodal Diagnostic Orchestrator (say-6)
> 👨‍💻 **담당**: Python 백엔드 성능 / 분산 알림 아키텍처
> 🎯 **이번 시간 목표**: **실제로 코드를 짤 때** 부딪히는 3가지 핵심 패턴 — `asyncio.gather` 병렬, `try/except` + 큐 기반 graceful degradation, WebSocket·FCM 이중 알림 — 을 코드 수준으로 이해
> 📌 **선수 학습**: 1교시 (전체 흐름), 0교시 (HTTP·상태 코드)

---

## 🌱 들어가며 — 코드 한 줄이 7초를 살린다

```
의사: "환자 받았어요. AI 분석 시작!"
                ↓
        백엔드 코드 한 줄 차이로
                ↓
┌──────────────────────────────────────────┐
│   직렬:  12초  ← await 줄줄이 늘어놓기      │
│   병렬:   5초  ← asyncio.gather 한 줄로     │
└──────────────────────────────────────────┘
```

오늘은 이 **7초의 차이** 가 어디서 나오는지, 그리고 **HAPI가 죽었을 때 우리 시스템이 어떻게 멈추지 않는지**, 마지막으로 **결과를 의사한테 어떻게 두 갈래(웹·모바일)로 보내는지** 코드로 봅니다.

---

## ⚡ 1. asyncio.gather — 직렬 12초를 병렬 5초로

### 1.1 같은 일을 두 가지 방법으로

응급실에 환자가 도착해서 3개 AI 모달을 다 돌려야 한다고 합시다. 각 모달의 응답 시간:
- ECG: 3초
- CXR: 5초
- LAB: 4초

#### ❌ 직렬 (Sequential) — 12초

```python
async def run_modals_sequential(payload):
    ecg = await call_ecg(payload)    # 3초 기다림
    cxr = await call_cxr(payload)    # 그리고 5초 또 기다림
    lab = await call_lab(payload)    # 그리고 4초 더 기다림
    # 총 3 + 5 + 4 = 12초
    return ecg, cxr, lab
```

각 `await` 마다 **그 줄에서 멈춰서** 모달 응답을 기다림. 한 줄이 끝나야 다음 줄 시작.

> 🤔 "어? `async/await` 자체가 비동기 아닌가? 왜 직렬이지?"
>
> `async`는 **"동시에 실행할 능력"** 을 줄 뿐, `await` 하나만 쓰면 그 시점엔 그냥 기다립니다. 그 능력을 끌어내려면 **여러 코루틴을 동시에 띄워줘야** 해요.

#### ✅ 병렬 (Parallel) — 5초

```python
import asyncio

async def run_modals_parallel(payload):
    ecg, cxr, lab = await asyncio.gather(
        call_ecg(payload),
        call_cxr(payload),
        call_lab(payload),
    )
    # 가장 느린 모달(5초)만큼만 기다림
    return ecg, cxr, lab
```

`asyncio.gather()` 가 3개 코루틴을 **동시에 출발시킨 뒤**, **셋 다 도착할 때까지** 한 번에 기다림.

### 1.2 한 줄 차이의 시각화

```
직렬 (await 줄줄이):
   t=0  ────[ECG: 3초]────────────────────────────► t=3
                            ────[CXR: 5초]──────► t=8
                                                  ────[LAB: 4초]──► t=12 ❌

병렬 (asyncio.gather):
   t=0  ────[ECG: 3초]──► t=3   완료
        ────[CXR: 5초]──────► t=5   완료 ⭐ 전체 끝
        ────[LAB: 4초]────► t=4   완료
                                          ↑ t=5에 셋 다 결과 받음 ✅
```

### 1.3 이게 어떻게 가능해? — 이벤트 루프 한 줄 이해

> "스레드를 3개 만든 거예요?" — **아니에요.**

`asyncio`는 **단일 스레드** 위에서 도는 **이벤트 루프(event loop)** 가 핵심:

```
이벤트 루프 = 효율적인 비서 1명

비서: "ECG 호출 시작. 응답 기다리는 동안 CXR 호출도 시작.
       그동안 LAB 호출도 시작. 셋 다 네트워크에서 응답 오면
       그때 처리할게요."

→ 한 명이지만 '기다리는 시간'을 다른 일에 씀
→ 멀티스레드처럼 동시 작업 진행
→ GIL(Python의 멀티스레드 제약)과 무관
```

비유: 식당 종업원 1명이 손님 3 테이블에 주문 받아서 주방에 다 넘기고, 음식 나오는 동안 손님 옆에 서서 기다리지 않고 다른 일 하다가 음식 나오면 가져다주는 식.

### 1.4 실전 — 우리 [orchestrator의 진짜 코드](../final/central/backend/app/api/orders.py) 형태

```python
# final/central/backend/app/api/orders.py 의 핵심 패턴 (단순화)

async def execute_modals(encounter_id: str, patient_data: dict):
    """승인된 모달들을 병렬로 실행."""
    payload = await _build_modal_payload(patient_data)

    # 3개 모달 동시 출발
    results = await asyncio.gather(
        call_modal("ECG", payload),
        call_modal("CXR", payload),
        call_modal("LAB", payload),
        return_exceptions=True,   # ⭐ 중요! (다음 챕터에서)
    )

    # 결과 분류 및 저장
    for modality, result in zip(["ECG", "CXR", "LAB"], results):
        if isinstance(result, Exception):
            await handle_modal_failure(modality, result)
        else:
            await save_modal_result(encounter_id, modality, result)
            await broadcast(encounter_id, {
                "event": "modal_completed",
                "modality": modality,
                "risk_level": result["risk_level"],
                ...
            })
```

### 1.5 ⚠️ 흔한 실수 모음 — 이거 알면 시니어

#### 실수 1: `await`를 빠뜨림

```python
# ❌ 잘못
ecg = call_ecg(payload)        # 코루틴 객체만 받음, 실행 안 됨!
# ✅ 정확
ecg = await call_ecg(payload)
```

#### 실수 2: `time.sleep()` 을 async 함수 안에서 씀

```python
# ❌ 잘못 — 이벤트 루프 전체가 멈춤
async def call_modal():
    time.sleep(3)   # 동기 sleep → 다른 코루틴도 같이 멈춤

# ✅ 정확
async def call_modal():
    await asyncio.sleep(3)   # 비동기 sleep
```

#### 실수 3: `requests` 라이브러리를 async 코드에서 사용

```python
# ❌ 잘못 — requests는 동기 라이브러리. 이벤트 루프 블록.
async def call_modal():
    r = requests.post(url, json=payload)

# ✅ 정확
async def call_modal():
    async with httpx.AsyncClient() as client:
        r = await client.post(url, json=payload)
```

#### 실수 4: `gather()` 결과 순서를 헷갈림

```python
# gather는 인자 순서대로 결과를 돌려줍니다 — 도착 순서가 아님
ecg, cxr, lab = await asyncio.gather(
    call_ecg(payload),    # 결과는 → ecg
    call_cxr(payload),    # 결과는 → cxr
    call_lab(payload),    # 결과는 → lab
)
# LAB이 먼저 끝나도 결과 변수 매핑은 호출 순서대로!
```

### 1.6 성능 측정 — 실제 우리 시스템 숫자

운영 데이터 (`modal_events` 테이블에서 측정):

| 모달 | 평균 응답 시간 |
|------|--------------|
| ECG | 1.8 ~ 3.5초 |
| CXR | 3.2 ~ 5.8초 |
| LAB | 0.5 ~ 1.2초 (룰 기반이라 빠름) + 6h 예측 +2초 |

직렬 호출 시 평균: **8.5초**
병렬 호출 시 평균: **4.2초**
실측 절감: **약 4.3초 / 환자 1명**

응급실 일일 환자 100명 기준 → **하루 7분 절약, 1년 약 43시간**.

---

## 🛡️ 2. Graceful Degradation — HAPI 다운 시나리오

### 2.1 문제 — 외부 의존성은 언젠가 다운된다

우리 시스템은 외부 시스템에 많이 의존:
- HAPI FHIR 서버 (의무기록실)
- 3개 AI 모달 컨테이너
- AWS Bedrock (LLM)
- Firebase FCM
- S3

이 중 하나라도 응답 안 하면 **전체가 멈춰야 할까요?** **절대 아니에요.**

### 2.2 나쁜 설계 — Fail Fast

```python
# ❌ 나쁜 패턴
async def submit_triage(triage_data):
    patient = await hapi.create_patient(triage_data)   # HAPI 다운 시 예외
    encounter = await hapi.create_encounter(...)        # 여기 못 옴
    await db.insert_encounter(encounter.id, ...)        # 여기도 못 옴
    return {"encounter_id": encounter.id}
```

HAPI 5분 다운 → 그 5분간 의사들은 **트리아지 자체를 못 함**.
응급실 운영 마비. **임상 영향 = 환자 위험.**

### 2.3 우리 설계 — 큐 + 백그라운드 워커

```python
# ✅ 좋은 패턴
async def submit_triage(triage_data):
    # 1. central_db 우선 저장 (우리가 직접 관리하니 신뢰 가능)
    encounter_id = await db.insert_encounter(triage_data)

    # 2. HAPI 동기화 시도 — 실패해도 흐름은 계속
    try:
        await hapi.create_patient(triage_data)
        await hapi.create_encounter(encounter_id, triage_data)
    except (httpx.HTTPError, asyncio.TimeoutError) as e:
        logger.warning("[hapi] 동기화 실패 — 큐로 보냄: %s", e)
        await fhir_sync_queue.enqueue(
            encounter_id=encounter_id,
            resource_type="Patient+Encounter",
            payload=triage_data,
            last_error=str(e)[:500],
        )

    # 3. 의사한테는 정상 응답
    return {"encounter_id": encounter_id}
```

핵심 포인트:
- 우리가 신뢰하는 운영 DB(`central_db`)에 **먼저 저장**
- HAPI 동기화는 **best-effort** (실패해도 OK)
- 실패하면 **큐에 적재** (지금은 못 보냈지만 나중에 보낼 거)
- 의사한테는 **정상 응답** (`201 Created`)

### 2.4 `fhir_sync_queue` 테이블 구조

```sql
CREATE TABLE fhir_sync_queue (
    id            BIGSERIAL PRIMARY KEY,
    encounter_id  UUID,
    resource_type VARCHAR(40),         -- 'Patient' / 'Encounter' / 'ServiceRequestTransition'
    payload       JSONB NOT NULL,      -- HAPI에 다시 보낼 데이터
    retry_count   INT DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMP DEFAULT NOW(),
    next_attempt  TIMESTAMP DEFAULT NOW()
);
```

### 2.5 백그라운드 워커 — 5분 주기

```python
# final/central/backend/app/agent/fhir_retry_worker.py (단순화)

async def fhir_retry_loop():
    """앱 startup 시 띄워둠. 영원히 도는 백그라운드 태스크."""
    while True:
        try:
            await _process_due_items()
        except Exception:
            logger.exception("[fhir-retry] 루프 자체 에러")
        await asyncio.sleep(300)   # 5분


async def _process_due_items():
    """큐에서 재시도 시점이 된 항목들 가져와 HAPI 재전송 시도."""
    rows = await db.fetch(
        """
        SELECT id, encounter_id, resource_type, payload, retry_count
        FROM fhir_sync_queue
        WHERE next_attempt <= NOW()
        ORDER BY id
        LIMIT 100
        """
    )

    for r in rows:
        try:
            await hapi.replay(r["resource_type"], r["payload"])
            # 성공 → 큐에서 제거
            await db.execute("DELETE FROM fhir_sync_queue WHERE id = $1", r["id"])
            logger.info("[fhir-retry] ✅ 복구: id=%d", r["id"])
        except Exception as e:
            # 또 실패 → retry_count++, 다음 시도 지연(지수 백오프)
            new_count = r["retry_count"] + 1
            delay_min = min(2 ** new_count, 60)   # 2, 4, 8, 16, 32, 60분 캡
            await db.execute(
                """
                UPDATE fhir_sync_queue
                SET retry_count  = $1,
                    last_error   = $2,
                    next_attempt = NOW() + ($3 || ' minutes')::interval
                WHERE id = $4
                """,
                new_count, str(e)[:500], str(delay_min), r["id"],
            )
            logger.warning("[fhir-retry] ❌ 재실패: id=%d (count=%d)", r["id"], new_count)
```

### 2.6 시나리오 — HAPI 7분 다운 → 자동 복구

```
[ 12:00 ]
   🩺 의사 A: POST /api/triage (환자 1)
   🏛️ orchestrator:
      ├─ central_db INSERT ✅
      ├─ HAPI 호출 ✅ (HAPI 정상)
      └─ 201 Created 의사한테 응답

[ 12:03 ] HAPI 서버 다운 시작 (배포 중이거나 OOM 등)

[ 12:04 ]
   🩺 의사 B: POST /api/triage (환자 2)
   🏛️ orchestrator:
      ├─ central_db INSERT ✅
      ├─ HAPI 호출 ❌ (timeout)
      ├─ fhir_sync_queue INSERT (encounter_id=환자2, resource_type=Patient+Encounter)
      └─ 201 Created 의사한테 응답  ⭐ 의사는 다운 사실 모름!

[ 12:05 ]
   🩺 의사 C: POST /api/triage (환자 3)
   🏛️ → 똑같이 큐로 적재 (큐에 row 2개)

[ 12:08 ] HAPI 복구 ✅

[ 12:09 ] 5분 워커 트리거
   🤖 fhir_retry_loop:
      ├─ 큐에서 환자 2, 3 row 가져옴 (retry_count=0, next_attempt <= now)
      ├─ 환자 2 HAPI 재전송 ✅ → 큐에서 DELETE
      ├─ 환자 3 HAPI 재전송 ✅ → 큐에서 DELETE
      └─ 로그: "[fhir-retry] ✅ 복구: id=N, id=N+1"

[ 12:09 ]
   ✅ 외부에서 보기엔 7분 다운 동안에도 아무 일 없었음.
   ✅ HAPI 복구 후 자동으로 다 따라잡음.
   ✅ 의사·환자에게 가시적 영향 0.
```

### 2.7 같은 패턴 — 모달 1개 실패

```python
# orders.py — return_exceptions=True 가 핵심
results = await asyncio.gather(
    call_modal("ECG", payload),
    call_modal("CXR", payload),
    call_modal("LAB", payload),
    return_exceptions=True,   # ⭐ 하나가 예외 던져도 다른 건 진행
)

for modality, result in zip(["ECG", "CXR", "LAB"], results):
    if isinstance(result, Exception):
        # 이 모달만 실패 처리, 다른 모달은 정상 진행
        await broadcast(encounter_id, {
            "event": "modal_failed",
            "modality": modality,
            "error": str(result),
        })
        await fhir.patch_service_request(modality, status="revoked", note=str(result))
    else:
        await save_and_broadcast(modality, result)
```

> 💡 **return_exceptions=True 의 의미**
> 기본값 (False)에선 코루틴 하나가 예외 던지면 `gather()` 전체가 즉시 중단 + 예외 전파.
> True로 두면 예외도 "결과의 일종"으로 취급 → 나머지 모달은 정상 완료까지 기다림 → **graceful**.

### 2.8 Graceful Degradation 원칙 한 줄

> **"외부 시스템은 언젠가 죽는다. 우리 시스템은 그때도 계속 돌아야 한다."**
>
> 임상 영향이 있는 코드는 모든 외부 호출을 `try/except` 로 감싸고, 실패 시 무엇으로 우회할지(큐·기본값·일부 결과 무시) 미리 정해두자.

---

## 🔔 3. 알림 채널 이중화 — WebSocket vs FCM

### 3.1 두 채널을 굳이 나누는 이유

| 채널 | 대상 | 발송 조건 | 왜 분리? |
|------|------|----------|---------|
| **WebSocket** `/ws/encounter/{id}` | 의사 데스크탑 (React) | **모든 이벤트** (10종) | 화면 켜둔 상태에서 실시간 갱신용 |
| **Firebase FCM** | 의사 모바일 (Flutter) | **risk_level=critical 만** | 화면 꺼진 폰도 깨워야 하는 응급 알림 |

**왜 모바일도 WebSocket 으로 하면 안 되나?**
- 폰 화면이 꺼지면 OS가 백그라운드 WS 연결을 끊음
- 앱이 살아있어도 OS의 power management가 네트워크 차단
- **응급 critical 알림이 안 도착함**

**왜 데스크탑도 FCM 으로 하면 안 되나?**
- 브라우저 푸시는 별도 권한 필요 + 사용자 거부 가능
- WebSocket이 훨씬 가볍고 즉시 양방향 통신 가능
- 데스크탑은 어차피 항상 켜져있음

### 3.2 WebSocket 채널 — 10종 이벤트 broadcast

#### `/ws/encounter/{id}` 핵심 구현

```python
# final/central/backend/app/api/ws.py (단순화)

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter()
_connections: dict[str, set[WebSocket]] = {}

@router.websocket("/ws/encounter/{encounter_id}")
async def encounter_ws(websocket: WebSocket, encounter_id: str):
    await websocket.accept()
    _connections.setdefault(encounter_id, set()).add(websocket)
    try:
        while True:
            # 클라이언트 ping 받아주기 (연결 유지)
            await websocket.receive_text()
    except WebSocketDisconnect:
        _connections[encounter_id].discard(websocket)


async def broadcast(encounter_id: str, message: dict):
    """이 encounter 구독자 전원에게 메시지 전송 + DB 적재 + FCM fan-out."""
    # 1) DB 적재 (감사 로그)
    await db.execute(
        "INSERT INTO modal_events (encounter_id, event_type, payload) "
        "VALUES ($1, $2, $3::jsonb)",
        encounter_id, message["event"], json.dumps(message),
    )

    # 2) 웹 구독자 전원에게 send_json
    for ws in list(_connections.get(encounter_id, set())):
        try:
            await ws.send_json(message)
        except Exception:
            _connections[encounter_id].discard(ws)  # 죽은 소켓 정리

    # 3) critical 이벤트면 FCM 도 fan-out
    await _maybe_fcm_critical(encounter_id, message)
```

#### 10종 이벤트 목록

| # | event 타입 | 발생 시점 | 페이로드 핵심 |
|---|-----------|----------|-------------|
| 1 | `triage_assessed` | 트리아지 직후 ML decision | acuity, risk_level |
| 2 | `initial_proposals` | 초기 모달 권고 도출 | proposed_modalities |
| 3 | `order_placed` | 의사가 모달 승인 | sr_id, modality |
| 4 | `modal_started` | 모달 호출 시작 | modality |
| 5 | `modal_completed` | 모달 결과 도착 | modality, summary, risk_level, payload |
| 6 | `modal_failed` | 모달 호출 실패 | modality, error |
| 7 | `new_proposal` | followup ML → 추가 모달 제안 | modality, ml_scores |
| 8 | `ready_for_report` | 모든 모달 완료 | completed_modalities |
| 9 | `report_generated` | Bedrock 종합소견 생성 완료 | report_id, summary, risk_level |
| 10 | `report_signed` | 의사 서명 완료 | report_id, signed_at |

> 💡 모든 이벤트에 `risk_level` 필드를 가능한 한 포함시키면 FCM fan-out 판단 코드가 단순해집니다 (`message.get("risk_level") == "critical"` 한 줄).

### 3.3 FCM 채널 — critical 만 골라서

#### `_maybe_fcm_critical()` 의 게이트키핑

```python
# final/central/backend/app/api/ws.py (관련 부분)

async def _maybe_fcm_critical(encounter_id: str, message: dict):
    """
    'critical' 이벤트만 FCM으로 fan-out.
    - 발송 조건: risk_level == 'critical' 또는 명시적 fcm_push=True
    - 타깃: device_tokens 테이블의 모든 활성 의사 단말
    """
    risk = str(message.get("risk_level") or "").lower()
    is_critical = (risk == "critical") or (message.get("fcm_push") is True)
    if not is_critical:
        return                          # 99%의 이벤트는 여기서 컷

    if not fcm.is_enabled():
        return                          # FCM 자격증명 미설정 시 graceful no-op

    modality = (message.get("modality") or "").upper() or None
    summary  = (message.get("summary")  or "").strip()
    title    = _format_title(message.get("event"), modality)

    await fcm.send_critical_alert(
        encounter_id=encounter_id,
        title=title,
        body=summary[:160] or "환자 상태가 critical로 평가되었습니다.",
        modality=modality,
        risk_level="critical",
    )
```

#### `fcm.send_critical_alert()` — 멀티캐스트 + 딥링크

```python
# final/central/backend/app/clients/fcm.py (요약)

async def send_critical_alert(*, encounter_id, title, body, modality, risk_level):
    # 1) 활성 의사 단말 토큰 전부 조회 (30일 내 last_seen)
    rows = await device_tokens.list_all_active()
    if not rows:
        return {"sent": 0, "skipped_reason": "no_tokens"}

    tokens = [r["token"] for r in rows]

    # 2) 딥링크 데이터 — 모바일이 알림 탭하면 어느 화면으로 갈지
    data = {
        "encounter_id": encounter_id,
        "risk_level":   risk_level,
        "modality":     modality or "",
        "deep_link":    f"/patient/{encounter_id}",   # Flutter go_router 경로
    }

    # 3) 멀티캐스트 발송 (Firebase Admin SDK는 동기라 thread로)
    def _send_sync():
        msg = messaging.MulticastMessage(
            tokens=tokens,
            notification=messaging.Notification(title=title, body=body),
            data=data,
            android=messaging.AndroidConfig(
                priority="high",
                notification=messaging.AndroidNotification(
                    channel_id="say6_critical", sound="default",
                ),
            ),
            apns=messaging.APNSConfig(payload=messaging.APNSPayload(
                aps=messaging.Aps(sound="default", content_available=True),
            )),
        )
        resp = messaging.send_each_for_multicast(msg)
        # 무효 토큰은 DB에서 제거 대상으로 분리
        dead = [tokens[i] for i, r in enumerate(resp.responses)
                if not r.success and _is_invalid(r.exception)]
        return resp.success_count, resp.failure_count, dead

    sent, failed, dead = await asyncio.to_thread(_send_sync)

    # 4) 죽은 토큰 자동 정리 (FCM이 invalid라고 응답한 것들)
    for t in dead:
        await device_tokens.delete(t)

    return {"sent": sent, "failed": failed, "pruned": len(dead)}
```

### 3.4 동선 — 한 환자의 critical 알림이 모바일까지

```
[ ECG 모달 결과 도착 — STEMI 감지 ]
        ↓
orchestrator: modal_results INSERT
        ↓
broadcast(encounter_id, {
    "event":      "modal_completed",
    "modality":   "ECG",
    "risk_level": "critical",     ⭐ 이 한 줄이 분기점
    "summary":    "ST 분절 상승 감지, STEMI 의심"
})
        ↓
   ┌─────────────────┴─────────────────┐
   │                                   │
   ▼ WS 채널 (즉시)                    ▼ _maybe_fcm_critical() 트리거
[ 의사 데스크탑 React ]              [ FCM 멀티캐스트 ]
  - LIVE 💚 카드 갱신                  ├─ device_tokens 조회 (예: 5명 등록)
  - ECG 결과 즉시 표시                  ├─ Firebase Admin SDK → APNs/FCM 게이트웨이
                                       │
                                       ▼
                                  [ 의사 5명 폰 OS 알림 ]
                                    "🚨 긴급: 심전도 critical 소견"
                                       │
                                       ▼ 탭
                                  [ Flutter 앱 ]
                                    go_router.go('/patient/<encounter_id>')
```

### 3.5 트래픽 비교 — 왜 분리가 효율적인가

응급실 일일 환자 100명 가정:

| 채널 | 발송 트리거 | 일일 메시지 수 |
|------|-----------|--------------|
| WebSocket | 모든 이벤트 (환자당 평균 8개) | **~800개** (가벼움, in-memory) |
| FCM | risk_level=critical (환자 중 ~10%) | **~10개** (외부 API 호출) |

만약 모든 이벤트를 FCM으로도 보냈다면:
- 800 × 등록 단말 수 (예: 의사 5명) = **4000회/일 FCM API 호출**
- 의사 폰에 알림 800개 폭격 → 진동·소리 피로 → 결국 다 꺼버림 → **critical도 못 받음**

> 💡 **시그널 vs 노이즈**
> FCM은 "정말 봐야 할 알림"만 보내야 의사가 알림을 신뢰합니다. 우리 시스템은 critical 한 종류로만 좁혀서 **시그널 100% 보존**.

### 3.6 ⚠️ 흔한 실수 — broadcast 호출 누락

```python
# ❌ 모달 결과 저장은 했는데 broadcast 안 함
await save_modal_result(encounter_id, modality, result)
# (broadcast 빠뜨림)

# 결과: DB엔 들어있지만 의사 화면이 갱신 안 됨.
#       10초 fallback polling이 잡아내긴 하지만 실시간 효과 X.
#       Critical이어도 FCM 안 감.

# ✅ 항상 짝꿍처럼
await save_modal_result(encounter_id, modality, result)
await broadcast(encounter_id, {
    "event": "modal_completed",
    "modality": modality,
    "risk_level": result["risk_level"],
    "summary": result["summary"],
    "payload": result,
})
```

> 💡 **팁**: 모달 결과 저장 함수를 `save_and_broadcast(...)` 한 함수로 통합해서 둘이 절대 분리 안 되도록 강제하는 것도 방법.

---

## 🎯 4. 한 페이지 요약

```
1. 비동기 병렬 호출:
   ❌ await ecg → await cxr → await lab   = 12초 (직렬)
   ✅ asyncio.gather(ecg, cxr, lab)        = 5초 (병렬)
   → 이벤트 루프가 단일 스레드로 동시 진행 (스레드 X)

2. Graceful Degradation:
   외부 의존성(HAPI/모달/Bedrock)은 try/except로 감싸고,
   실패 시 fhir_sync_queue 같은 큐에 적재.
   백그라운드 워커가 5분 주기로 자동 백필.
   → asyncio.gather(return_exceptions=True) 도 같은 철학.

3. 알림 이중화:
   WebSocket: 의사 데스크탑, 10종 이벤트 모두 (실시간 화면 갱신)
   FCM:       의사 모바일, risk_level=critical 만 (응급 OS 푸시)
   broadcast() 한 함수가 양쪽 모두 fan-out + DB 적재.
```

---

## 📝 5. 마무리 퀴즈 — 백엔드 팀 자가 점검

**Q1.** 다음 코드의 총 실행 시간은? 그리고 왜 그렇게 되는가?

```python
async def run():
    a = await asyncio.sleep(3, result="a")
    b = await asyncio.sleep(5, result="b")
    c = await asyncio.sleep(4, result="c")
    return a, b, c
```

비교 코드:
```python
async def run():
    a, b, c = await asyncio.gather(
        asyncio.sleep(3, result="a"),
        asyncio.sleep(5, result="b"),
        asyncio.sleep(4, result="c"),
    )
    return a, b, c
```

---

**Q2.** 우리 시스템에서 HAPI FHIR 서버가 30분간 다운됐다고 가정하자.
이 시간 동안 의사들은 정상적으로 환자 30명을 트리아지로 등록했다.
HAPI가 복구된 직후 30분 사이에 시스템 내부적으로 어떤 일이 자동으로 일어나는가? 단계별로 서술.

---

**Q3.** ECG 모달 결과의 `risk_level`이 `urgent`로 나왔다. 다음 중 일어나야 할 일과 일어나면 안 되는 일을 분류하시오.

| 동작 | 일어나야 함 / 안 함 |
|------|------------------|
| (a) WebSocket으로 `modal_completed` 이벤트 broadcast |  |
| (b) FCM 멀티캐스트 발송 |  |
| (c) `modal_events` 테이블에 row INSERT |  |
| (d) `device_tokens` 조회 |  |
| (e) `central_db.modal_results` INSERT |  |

---

<details>
<summary>✅ 정답 + 해설 펼치기</summary>

### A1

**첫 번째 코드 (직렬)**: **약 12초**
- `await asyncio.sleep(3)` → 3초 멈춤 → `a`
- `await asyncio.sleep(5)` → 그 후 5초 또 멈춤 → `b`
- `await asyncio.sleep(4)` → 그 후 4초 또 멈춤 → `c`
- `await`는 코루틴이 끝날 때까지 그 줄에서 기다림. 한 줄씩 직렬.

**두 번째 코드 (병렬)**: **약 5초**
- `asyncio.gather()` 가 세 코루틴을 동시에 출발시킴
- 이벤트 루프가 세 sleep의 "타이머"를 동시에 돌림 (스레드 아님)
- 가장 긴 5초가 끝나는 시점에 셋 다 결과 도착
- 즉, 전체 시간 = `max(3, 5, 4) = 5초`

💡 핵심: `await` 하나로는 동시성 없음. **여러 코루틴을 동시에 띄워야** 동시성 발현 → `gather`, `as_completed`, `TaskGroup` 등.

---

### A2

**1. 다운 30분 동안 (HAPI 미응답)**
- 의사 30명 모두 `201 Created` 응답 받음 (정상으로 보임)
- `central_db.encounters` 에는 30개 row INSERT 완료
- 각 요청마다 HAPI 호출이 timeout/connection error
- orchestrator의 try/except가 잡아서 `fhir_sync_queue` 에 30개 row 적재
- 각 row의 `retry_count=0`, `next_attempt=NOW()`

**2. HAPI 복구 직후**
- 다음 5분 워커 트리거 시점(`fhir_retry_loop`)에 큐에서 row 가져옴
- `WHERE next_attempt <= NOW() LIMIT 100` 으로 30개 다 가져옴
- 각 row의 `payload`를 HAPI에 재전송
- 성공한 row는 `DELETE FROM fhir_sync_queue WHERE id = ...`
- 30개 다 복구되면 큐 비워짐 → 시스템 외부에서 보기엔 다운 사실 흔적 없음

**3. 만약 일부 또 실패하면**
- `retry_count` 증가, 지수 백오프로 `next_attempt` 미래로 미룸 (2분 → 4분 → 8분 ...)
- 영구 실패하는 row는 retry_count로 식별 가능 → 운영팀이 수동 점검

💡 핵심: **graceful degradation의 본질은 "외부 시스템과 우리 시스템의 결합도를 비동기로 끊기"**. HAPI 다운이 우리 운영을 멈추지 않게 큐가 buffer 역할.

---

### A3

| 동작 | 분류 | 해설 |
|------|------|------|
| (a) WebSocket broadcast | ✅ 일어나야 함 | 모든 이벤트는 WS로 — risk 무관 |
| (b) FCM 멀티캐스트 | ❌ 일어나면 안 됨 | FCM은 **critical 한정**. urgent는 발송 X |
| (c) modal_events INSERT | ✅ 일어나야 함 | broadcast 함수가 항상 DB 적재 |
| (d) device_tokens 조회 | ❌ 일어나면 안 됨 | FCM 자체가 안 가니까 조회도 안 함 (조기 컷) |
| (e) modal_results INSERT | ✅ 일어나야 함 | 결과는 risk와 무관하게 저장 |

💡 핵심: `_maybe_fcm_critical()` 함수가 **"critical이 아니면 함수 진입 직후 return"** 으로 게이트키핑.
→ urgent/routine 이벤트에선 device_tokens 조회조차 안 일어남 → DB 부하 절약.

</details>

---

## 🔮 6. 다음 시간 예고

| 다음 강의 | 주제 |
|----------|------|
| **4교시 (예정)** | ML Decision Engine — LightGBM 8개 모델이 트리아지·후속 결정을 내리는 로직 |
| **5교시 (예정)** | RAG + Bedrock — 유사 케이스 검색과 한국어 종합소견 생성 |

---

## 📚 더 읽어볼 거리

| 자료 | 무엇을 배우나 |
|------|-------------|
| [Python asyncio 공식 문서](https://docs.python.org/3/library/asyncio.html) | 코루틴·이벤트 루프·gather·TaskGroup |
| [FastAPI 비동기 가이드](https://fastapi.tiangolo.com/async/) | 언제 async / 언제 sync 써야 하는지 |
| [httpx — Async HTTP Client](https://www.python-httpx.org/async/) | requests의 비동기 대체재 |
| [PostgreSQL — UPSERT (ON CONFLICT)](https://www.postgresql.org/docs/current/sql-insert.html#SQL-ON-CONFLICT) | 큐 적재·갱신 패턴 |
| [Firebase Admin SDK (Python)](https://firebase.google.com/docs/admin/setup) | `messaging.send_each_for_multicast()` 사용법 |
| [Exponential Backoff](https://en.wikipedia.org/wiki/Exponential_backoff) | 재시도 간격 설계 원칙 |

---

> 👨‍💻 **마지막 한마디**
> 오늘 다룬 3가지는 **"실서비스 백엔드가 안 죽는 비결"** 이에요.
> - `asyncio.gather` 없으면 응급실이 느려 환자가 위험해지고,
> - `try/except + 큐` 없으면 HAPI 한 번 다운에 시스템 전체가 정지하고,
> - WebSocket/FCM 분리 안 하면 의사 폰이 알림 폭격으로 무용지물이 됩니다.
>
> 작은 코드 패턴이 큰 차이를 만듭니다. 다음 시간엔 우리 LLM 두뇌(LightGBM + Bedrock) 가 어떻게 생각하는지 들어가요. 수고하셨습니다! 🩺
