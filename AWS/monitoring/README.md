# Monitoring — 모니터링 설계

> **이 폴더가 하는 일**: DRAI 시스템의 AWS 모니터링을 단순화한 단일 CFN 스택으로 관리.
> **CloudWatch Alarms + SNS(이메일)** 만 사용. 그 외 CloudTrail/Config/EventBridge 등은
> 운영 안정화 이후로 보류.

---

## 📁 파일 구조

```
monitoring/
├── README.md                       ← 지금 읽고 있는 파일
├── monitoring-alarms-stack.yaml    ⭐ 정식 CloudFormation 템플릿 (그대로 배포)
│                                       SNS 토픽 2개(critical/warning) + 알람 23개
│                                       (always-on 7 + EnableEcsAlarms 12 + EnableAlbAlarms 4)
└── _archive/                       ← 옛 설계 yaml (참고용, 배포 안 함)
    ├── alarms.yaml                     (현재는 monitoring-alarms-stack.yaml 로 흡수됨)
    ├── cloudwatch.yaml                 (운영 안정화 이후 도입)
    ├── cloudtrail.yaml                 (의료법 6년 audit — 운영 진입 시 활성화)
    ├── aws-config.yaml                 (인프라 규정 자동 검사 — Phase 2)
    ├── eventbridge.yaml                (이벤트 기반 자동화 — Phase 2)
    └── logging.yaml                    (앱 로그 표준 — 코드에 직접 반영됨)
```

> 💡 **배포에 쓸 파일은 `monitoring-alarms-stack.yaml` 하나**입니다.
> 옛 6개 yaml(cloudwatch / cloudtrail / aws-config / eventbridge / logging / alarms)은 설계 의도를 보존하기 위해 `_archive/` 에 남겨뒀어요.

## 🚨 알림 라우팅 — 두 갈래로 분리

| 종류 | 예시 | 받는 사람 | 채널 | 처리 위치 |
|---|---|---|---|---|
| **인프라 알람** | Aurora CPU 80%, ECS 다운, ALB 5xx | DevOps / 운영팀 | 📧 SNS → 이메일 | `monitoring-alarms-stack.yaml` (CloudWatch) |
| **임상 알람** | CRITICAL 환자 감지, STEMI 패턴, 미서명 소견서 5분 경과 | 의사 (응급실) | 📱 FCM 푸시 + WebSocket | **백엔드 코드** (CloudWatch 거치지 않음) |

→ 응급실 의사는 이메일 안 봄. 임상 알림은 푸시 1~3초 SLA가 필수라 CloudWatch 우회.

## 🚀 배포 방법

```bash
# 1단계 (사전): aurora 스택이 이미 떠있어야 함 (Aurora 알람이 ImportValue로 참조)
# 2단계: 알람 스택 배포

aws cloudformation deploy \
  --stack-name say2-6team-monitoring-alarms \
  --template-file monitoring-alarms-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      ProjectName=say2-6team \
      Environment=dev \
      CriticalAlertEmail=oncall@your-domain.com \
      WarningAlertEmail=dev@your-domain.com
```

→ 배포 후 입력한 이메일로 SNS 구독 확인 메일 도착 → 클릭해서 confirm 해야 알람 수신 시작.

### Phase 2 ECS·ALB 알람 활성화 (ECS 스택 떴을 때)

```bash
aws cloudformation deploy \
  --stack-name say2-6team-monitoring-alarms \
  --template-file monitoring-alarms-stack.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      EnableEcsAlarms=true \
      EcsClusterName=say2-6team-ecs-cluster \
      EnableAlbAlarms=true \
      AlbFullName=app/say2-6team-alb/abcd1234 \
      TargetGroupFullName=targetgroup/say2-6team-orchestrator-tg/efgh5678
```
→ 백엔드의 `fcm_dispatcher` (TODO)가 `device_tokens` 테이블의 의사 토큰들에 직접 발송.

---

## 모니터링이 왜 필요한가

응급 의료 시스템은 24시간 운영된다. 문제가 생겼을 때 빠르게 감지하지 못하면:
- AI 추론 서비스가 다운되어 의사가 결과를 못 받음
- DB 장애로 환자 데이터 접근 불가
- 보안 침해로 환자 개인정보 유출

모니터링은 이런 상황을 **사람이 발견하기 전에 자동으로 감지하고 알림**을 보낸다.

---

## 알림 흐름 — 단순화된 트랙

```
[인프라 알람]                              [임상 알람 — 별도 트랙]
─────────────────                          ──────────────────
CloudWatch Alarm                           Backend 코드 (FastAPI)
   메트릭 임계값 초과                          critical 환자, STEMI 패턴,
        │                                    미서명 소견서 5분 경과 등
        ▼                                       │
 SNS Topic                                      │
   ├── critical-alerts                          │
   └── warning-alerts                           │
        │                                       │
        ▼                                       ▼
   📧 이메일                              📱 FCM 푸시
   oncall@hospital                       device_tokens 테이블의
   dev@hospital                          의사 폰 토큰들
                                              +
                                         🔔 WebSocket 푸시
                                         의사 PC 브라우저 즉시
```

→ 같은 "알람"이라도 **받는 사람·SLA에 따라 채널 완전 분리**.

---

## 알람 23개 — 카테고리별 매트릭스

| 카테고리 | 개수 | 활성 조건 | 메트릭 출처 |
|---------|:---:|---------|----------|
| Aurora (RDS) | 4 | 항상 활성 | AWS 기본 (`AWS/RDS`) |
| ECS Orchestrator | 3 | `EnableEcsAlarms=true` | AWS 기본 (`AWS/ECS`, `ECS/ContainerInsights`) |
| ECS 모달 3종 (ECG/CXR/LAB) | 9 | `EnableEcsAlarms=true` | AWS 기본 |
| ALB | 4 | `EnableAlbAlarms=true` | AWS 기본 (`AWS/ApplicationELB`) |
| Modal 커스텀 | 2 | 항상 활성 | 백엔드 `DRAI/Modal` 발행 |
| FHIR Sync Queue | 1 | 항상 활성 | 백엔드 `DRAI/FhirSync` 발행 |
| **합계** | **23** | | |

### 🔴 CRITICAL (즉시 대응) — `say2-6team-critical-alerts` 토픽 8개

| 알람 | 조건 | 의미 |
|------|------|------|
| Aurora-ACU-Max | ACU > 3.6 (max 4.0의 90%) | DB 스케일 한계 임박 |
| Aurora-FreeableMemory-Low | 여유 메모리 < 256MB | DB 메모리 부족 |
| EcsOrchestrator-TaskDown | Running Task = 0 | 중앙 백엔드 완전 다운 |
| EcsEcg-TaskDown / EcsCxr-TaskDown / EcsLab-TaskDown | Running Task = 0 | 해당 모달 서비스 다운 |
| ALB-ELB-5xx-High | ELB_5xx > 10건/5분 | ALB가 백엔드 도달 못 함 |
| ALB-Target-5xx-High | Target_5xx > 10건/5분 | 백엔드 코드 5xx 응답 |
| ALB-UnhealthyHosts | UnHealthy ≥ 1 (1분) | 타겟 헬스체크 실패 |
| ModalInferenceErrorSpike | 추론 에러 ≥ 3건/5분 | AI 추론 실패 누적 |
| FhirSyncQueueBacklog | 큐 적체 > 100 (10분) | HAPI 장기 다운 또는 워커 정지 |

### ⚠️ WARNING (모니터링) — `say2-6team-warning-alerts` 토픽 11개

| 알람 | 조건 | 의미 |
|------|------|------|
| Aurora-CPU-High | CPU > 80% (10분) | DB 과부하 |
| Aurora-Connections-High | 연결 > 100 (10분) | 커넥션 풀 누수 의심 |
| EcsOrchestrator-CPU/Memory-High | CPU > 80% / Memory > 85% | 백엔드 스케일아웃 검토 |
| EcsEcg/Cxr/Lab-CPU-High | CPU > 80% | 모달별 과부하 |
| EcsEcg/Cxr/Lab-Memory-High | Memory > 85% | 모달별 메모리 압박 |
| ALB-TargetResponseTime-High | 평균 응답 > 3초 | 응답 지연 |
| ModalHighLatencySpike | 추론 > 5초 ≥ 5건/5분 | AI 추론 느림 |

> ❗ **임상 알람** (`Critical-Risk-Detected`, STEMI 등) — 이 표에 없음.
> CloudWatch 거치지 않고 백엔드 `fcm.send_critical_alert()`가 의사 폰 FCM으로 직접 발송.
> 이유: 응급실 의사가 이메일 안 봄. 1~3초 SLA 필수.

---

## 커스텀 메트릭 — 백엔드가 직접 발행

AWS 기본 메트릭으로 잡을 수 없는 우리 시스템 고유 메트릭은 백엔드가 `boto3.put_metric_data`로 직접 CloudWatch에 push.

### `DRAI/Modal` (모달 호출 계측)
- **InferenceErrorCount** — 모달 호출 예외 또는 `status="error"` 응답 시 +1
- **HighLatencyCount** — 모달 응답 시간 5초 초과 시 +1
- 발행 위치: [`app/clients/modal_http.py`](../../final/central/backend/app/clients/modal_http.py) `invoke_modal()`
- 발행 방식: `asyncio.create_task` 로 fire-and-forget — 임상 흐름 지연 0ms

### `DRAI/FhirSync` (큐 깊이 게이지)
- **QueueDepth** — `fhir_sync_queue` 테이블의 현재 row 개수 (게이지)
- 발행 위치: [`app/agent/fhir_retry_worker.py`](../../final/central/backend/app/agent/fhir_retry_worker.py) `fhir_retry_loop` (5분 주기)
- HAPI가 장기 다운돼서 큐가 100건+ 쌓이면 알람 발동

### 발행 클라이언트
[`app/clients/cw_metrics.py`](../../final/central/backend/app/clients/cw_metrics.py) — lazy boto3 client, 자격증명 미설정 시 graceful no-op.

---

## 로그 그룹 목록

| 로그 그룹 | 서비스 | 보관 기간 |
|----------|--------|:--------:|
| `/drai/central-backend` | FastAPI 중앙백엔드 | 90일 |
| `/drai/hapi-fhir` | HAPI FHIR 서버 | 90일 |
| `/drai/aurora/postgresql` | Aurora DB 쿼리 로그 | 180일 |
| `/drai/modal/ecg` | ECG 추론 서비스 | 30일 |
| `/drai/modal/cxr` | CXR 추론 서비스 | 30일 |
| `/drai/modal/lab` | Lab 추론 서비스 | 30일 |
| `/drai/bedrock-agent` | Bedrock Agent | 90일 |
| `/drai/cloudtrail` | AWS API 감사 로그 | 365일 |

---

## 의료 규정 준수 (Compliance)

> Phase 1 현재는 단일 알람 스택만 배포. 아래 항목은 운영 안정화 이후 `_archive/` yaml 을 정식 CFN으로 부활시킬 예정.

| 요구사항 | 대응 방법 | 어디서 처리 | 상태 |
|----------|---------|-----------|------|
| 환자 데이터 접근 로그 6년 보관 | CloudTrail S3 장기 보관 | `_archive/cloudtrail.yaml` (CFN 변환 대기) | Phase 2 |
| DB 쿼리 감사 | pgaudit + CloudWatch 180일 | `aurora-stack.yaml` ClusterParamGroup (pgaudit ON) | ✅ Phase 1 |
| 인프라 변경 추적 | AWS Config 일일 스냅샷 | `_archive/aws-config.yaml` (CFN 변환 대기) | Phase 2 |
| 암호화 검증 | KMS 적용 (Aurora at-rest) + Config Rule | `aurora-stack.yaml` KMS 키 ✅ | Phase 1 ✅ (자동 검증은 Phase 2) |
| 퍼블릭 접근 차단 | Aurora `PubliclyAccessible: false` + Config Rule | `aurora-stack.yaml` ✅ | Phase 1 ✅ (자동 검증은 Phase 2) |
| PHI 로그 마스킹 | 백엔드 logger formatter | 코드(`app/main.py` logging 설정) | ✅ |

---

## 비용 예상

### Phase 1 (현재 배포 범위 — `monitoring-alarms-stack.yaml` 단일 스택)

| 서비스 | 데모/PoC | 프로덕션 |
|--------|:--------:|:--------:|
| CloudWatch Alarms (23개) | ~$2.3/월 | ~$2.3/월 |
| CloudWatch Custom Metrics (DRAI/Modal, DRAI/FhirSync) | ~$0.3/월 | ~$0.9/월 |
| SNS (2 토픽, 이메일) | ~$0.5/월 | ~$1/월 |
| **Phase 1 합계** | **~$3/월** | **~$4/월** |

> 💡 CloudWatch Logs(컨테이너 로그)·Dashboard 는 ECS 스택과 함께 배포 예정이라 이 표에서 별도 계산.

### Phase 2 추가 비용 (운영 진입 시 — _archive 부활)

| 서비스 | 데모/PoC | 프로덕션 |
|--------|:--------:|:--------:|
| CloudWatch Logs (ECS 컨테이너 로그) | ~$3/월 | ~$20/월 |
| CloudWatch Dashboard | $3/월 | $3/월 |
| CloudTrail (관리 이벤트) | 무료 | 무료 |
| CloudTrail (데이터 이벤트) | ~$1/월 | ~$5/월 |
| AWS Config (15개 리소스) | ~$3/월 | ~$3/월 |
| Config Rules (17개) | ~$2/월 | ~$2/월 |
| EventBridge | 무료 | ~$1/월 |
| **Phase 2 추가** | **+$12/월** | **+$34/월** |

→ Phase 1 + Phase 2 합산 시 ~$15/월(dev) / ~$38/월(prod)
→ Phase 1만 배포해도 의료 시스템 모니터링 기본은 충족 (audit·compliance는 Phase 2에)
