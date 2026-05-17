# Monitoring — 모니터링 설계

> **이 폴더가 하는 일**: DRAI 시스템의 AWS 모니터링 설정을 문서화한다.
> Phase 1은 **CloudWatch + SNS(이메일)** 최소 구성. Phase 2에 CloudTrail / Config /
> EventBridge 추가.

---

## 📌 Phase 1 (현재) — 최소 구성

```
Phase 1: CloudWatch + SNS(email) 만 배포
├── cloudwatch.yaml  ← 로그 그룹 + 메트릭 + 대시보드
├── alarms.yaml      ← 인프라 알람 + SNS 이메일
└── logging.yaml     ← 앱 로그 표준 (문서)

⏸️ Phase 2 보류:
   ├── cloudtrail.yaml   (의료법 6년 audit — 운영 진입 시 활성화)
   ├── aws-config.yaml   (인프라 규정 자동 검사)
   └── eventbridge.yaml  (이벤트 기반 자동화)
```

## 🚨 알림 라우팅 — 두 갈래로 분리

| 종류 | 예시 | 받는 사람 | 채널 | 처리 위치 |
|---|---|---|---|---|
| **인프라 알람** | Aurora CPU 80%, ECS 다운, ALB 5xx | DevOps / 운영팀 | 📧 SNS → 이메일 | `alarms.yaml` (CloudWatch) |
| **임상 알람** | CRITICAL 환자 감지, STEMI 패턴 | 의사 (응급실) | 📱 FCM/APNs 푸시 + WebSocket | **백엔드 코드** (CloudWatch 거치지 않음) |

→ 응급실 의사는 이메일 안 봄. 임상 알림은 푸시 1~3초 SLA가 필수라 CloudWatch 우회.
→ 백엔드의 `fcm_dispatcher` (TODO)가 `device_tokens` 테이블의 의사 토큰들에 직접 발송.

---

## 모니터링이 왜 필요한가

응급 의료 시스템은 24시간 운영된다. 문제가 생겼을 때 빠르게 감지하지 못하면:
- AI 추론 서비스가 다운되어 의사가 결과를 못 받음
- DB 장애로 환자 데이터 접근 불가
- 보안 침해로 환자 개인정보 유출

모니터링은 이런 상황을 **사람이 발견하기 전에 자동으로 감지하고 알림**을 보낸다.

---

## 파일 구조

```
monitoring/
├── README.md          ← 지금 읽고 있는 파일 (전체 개요)
├── cloudwatch.yaml    ← 로그 수집 + 메트릭 + 대시보드
├── alarms.yaml        ← 이상 감지 시 알림 규칙
├── cloudtrail.yaml    ← AWS API 호출 감사 추적
├── aws-config.yaml    ← 인프라 보안 규정 준수 검사
├── eventbridge.yaml   ← 이벤트 기반 자동화 규칙
└── logging.yaml       ← 애플리케이션 로그 포맷/수집/보관
```

---

## 각 파일이 하는 일

| 파일 | AWS 서비스 | 핵심 질문 | 언제 필요한가 |
|------|-----------|----------|-------------|
| `cloudwatch.yaml` | CloudWatch | "지금 시스템 상태가 어떤가?" | 항상 (기본 모니터링) |
| `alarms.yaml` | CloudWatch Alarms + SNS | "문제 생기면 누가 알림 받나?" | 항상 (이상 감지) |
| `cloudtrail.yaml` | CloudTrail | "누가 언제 뭘 변경했나?" | 보안/감사 필요 시 |
| `aws-config.yaml` | AWS Config | "인프라가 보안 기준을 충족하나?" | 규정 준수 필요 시 |
| `eventbridge.yaml` | EventBridge | "특정 이벤트 발생 시 뭘 할까?" | 자동화 필요 시 |
| `logging.yaml` | 애플리케이션 레벨 | "어떤 형식으로 로그를 남기나?" | 개발 시작 전 |

---

## 모니터링 계층 구조

```
┌─────────────────────────────────────────────────────────┐
│  Layer 4: 규정 준수 (aws-config.yaml)                     │
│  "인프라가 보안 기준을 지속적으로 충족하는가?"                  │
│  → 위반 시 자동 교정 또는 알림                               │
├─────────────────────────────────────────────────────────┤
│  Layer 3: 감사 추적 (cloudtrail.yaml)                     │
│  "누가 언제 어떤 AWS 리소스를 변경했는가?"                    │
│  → 모든 API 호출 기록, 고위험 이벤트 즉시 알림                 │
├─────────────────────────────────────────────────────────┤
│  Layer 2: 알림 & 자동화 (alarms.yaml + eventbridge.yaml)  │
│  "임계값 초과 또는 이벤트 발생 시 즉시 대응"                   │
│  → SNS → 이메일/Slack 알림                                │
├─────────────────────────────────────────────────────────┤
│  Layer 1: 관측 (cloudwatch.yaml + logging.yaml)          │
│  "로그 수집, 메트릭 시각화, 실시간 현황 파악"                  │
│  → 대시보드, Logs Insights 쿼리                            │
└─────────────────────────────────────────────────────────┘
```

---

## 알림 흐름 — Phase 1

```
[인프라 알람]                              [임상 알람]
─────────────────                          ──────────────────
CloudWatch Alarm                           Backend 코드 (FastAPI)
   메트릭 임계값 초과                          critical 환자 감지 / STEMI 패턴
        │                                       │
        ▼                                       │
 SNS Topic                                      │
   ├── critical-alerts                          │
   └── warning-alerts                           │
        │                                       │
        ▼                                       ▼
   📧 이메일                              📱 FCM/APNs 푸시
   oncall-team@hospital                  device_tokens 테이블의
   dev-team@hospital                     의사 폰 토큰들
                                              +
                                         🔔 WebSocket 푸시
                                         의사 PC 브라우저 즉시
```

→ 같은 "알람"이라도 **받는 사람·SLA에 따라 채널 완전 분리**.

---

## 핵심 알람 목록 (인프라 알람만 — 이메일 경유)

| 알람 이름 | 조건 | 심각도 | 의미 |
|----------|------|:------:|------|
| Aurora-ACU-Max | ACU 3.6 이상 (max 4.0의 90%) | 🔴 CRITICAL | 스케일 한계 임박 |
| Aurora-FreeableMemory-Low | 여유 메모리 256MB 미만 | 🔴 CRITICAL | 메모리 부족 |
| Backend-Task-Unhealthy | ECS Running Task 0개 | 🔴 CRITICAL | 서비스 완전 다운 |
| Modal-Inference-Error-Spike | 추론 에러 5분간 3회 이상 | 🔴 CRITICAL | AI 서비스 장애 (인프라) |
| ALB-5xx-High | 5xx 에러 5분간 10회 초과 | 🔴 CRITICAL | 서버 에러 급증 |
| Aurora-CPU-High | CPU 80% 초과 5분 지속 | ⚠️ WARNING | DB 과부하 |
| High-Latency-Spike | 추론 5초 초과 5회/5분 | ⚠️ WARNING | 성능 저하 |
| ALB-TargetResponseTime-High | 평균 응답 3초 초과 | ⚠️ WARNING | 응답 지연 |

> ❗ **임상 알람** (`Critical-Risk-Detected`, STEMI 패턴 등) — 이 표에 없음.
> CloudWatch 거치지 않고 백엔드 `fcm_dispatcher`가 의사 폰 FCM으로 직접 발송.
> 이유: 응급실 의사가 이메일 안 봄. 1~3초 SLA 필수.

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

| 요구사항 | 대응 방법 | 설정 파일 |
|----------|---------|---------|
| 환자 데이터 접근 로그 6년 보관 | CloudTrail S3 장기 보관 | `cloudtrail.yaml` |
| DB 쿼리 감사 | pgaudit + CloudWatch 180일 | `cloudwatch.yaml` |
| 인프라 변경 추적 | AWS Config 일일 스냅샷 | `aws-config.yaml` |
| 암호화 검증 | Config Rule: rds-storage-encrypted | `aws-config.yaml` |
| 퍼블릭 접근 차단 | Config Rule + 자동 교정 | `aws-config.yaml` |
| PHI 로그 마스킹 | patient_name 마스킹, patient_id 해시 | `logging.yaml` |

---

## 비용 예상

### Phase 1 (현재 배포 범위)

| 서비스 | 데모/PoC | 프로덕션 |
|--------|:--------:|:--------:|
| CloudWatch Logs | ~$3/월 | ~$20/월 |
| CloudWatch Alarms (11개, 임상 1개 제외) | ~$1.1/월 | ~$1.1/월 |
| CloudWatch Dashboard | $3/월 | $3/월 |
| SNS | ~$0.5/월 | ~$1/월 |
| **Phase 1 합계** | **~$8/월** | **~$25/월** |

### Phase 2 추가 비용 (운영 진입 시)

| 서비스 | 데모/PoC | 프로덕션 |
|--------|:--------:|:--------:|
| CloudTrail (관리 이벤트) | 무료 | 무료 |
| CloudTrail (데이터 이벤트) | ~$1/월 | ~$5/월 |
| AWS Config (15개 리소스) | ~$3/월 | ~$3/월 |
| Config Rules (17개) | ~$2/월 | ~$2/월 |
| EventBridge | 무료 | ~$1/월 |
| **Phase 2 추가** | **+$6/월** | **+$11/월** |

→ Phase 1 + Phase 2 합산 시 ~$14/월(dev) / ~$36/월(prod)
→ Phase 1만 배포해도 의료 시스템 모니터링 기본은 충족 (audit·compliance는 Phase 2에)
