# Emergency Multimodal Diagnostic Orchestrator (say-6)

> 응급실 멀티모달 AI 진단 보조 시스템 — **AWS ECS Fargate** 운영 기준 통합 문서.

[![AWS](https://img.shields.io/badge/AWS-ECS%20Fargate-orange)](https://aws.amazon.com/ecs/)
[![ECR](https://img.shields.io/badge/ECR-4%20Images-blue)](https://aws.amazon.com/ecr/)
[![Aurora](https://img.shields.io/badge/DB-Aurora%20Serverless%20v2-teal)](https://aws.amazon.com/rds/aurora/serverless/)
[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://www.python.org/)
[![Flutter](https://img.shields.io/badge/Mobile-Flutter-blue)](https://flutter.dev/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 🎯 프로젝트 개요

### 핵심 목적
- 🚑 **응급 환자의 골든타임 확보** — ML 기반 능동적 검사 선택 + 멀티모달 병렬 추론
- 👨‍⚕️ **의료진 간 경험 편차 최소화** — 데이터 기반 AI 의사결정 지원
- 🔬 **멀티모달 통합 판독** — ECG / CXR / Blood Lab + 6h 악화 예측
- 📋 **자동 종합 소견서** — RAG + Bedrock Claude로 한국어 임상 리포트 생성
- 📟 **실시간 알림** — WebSocket(웹) + FCM(모바일 critical) 이중 채널

### 주요 특징
- ⚡ **3개 모달 병렬 호출** — 직렬 대비 약 2.4배 빠른 응답 (12s → 5s)
- 🧠 **ML 의사결정 엔진** — MIMIC-IV 학습 LightGBM 8개 (Initial 3 + Followup 5)
- 🔁 **Graceful Degradation** — HAPI FHIR 일시 다운 시 `fhir_sync_queue`로 재시도, 모달 1개 죽어도 나머지 정상 진행
- 📲 **실시간 푸시** — 의사 데스크탑 WebSocket + 모바일 OS-레벨 FCM 알림
- 🔒 **자격증명 격리** — 모달 컨테이너는 AWS 키 없음 (base64 위탁 다운로드 패턴)
- 🛰️ **Cloud Map 서비스 디스커버리** — 컨테이너 IP 변경 시 자동 라우팅

---

## 🏗️ 시스템 아키텍처 (AWS 운영 기준)

```
┌────────────── 의사 데스크탑 ──────────────┐    ┌──── 의사 모바일(갤럭시/iPhone) ────┐
│   React Frontend (CloudFront + S3)     │    │  Flutter say6_doctor (Firebase FCM) │
└──────────┬───────────────────▲─────────┘    └─────────────▲────────▲──────────────┘
           │ HTTPS              │ WebSocket                  │ FCM    │ HTTPS
           │                    │ (실시간 LIVE 푸시)            │ Push   │ (/devices/register)
           ▼                    │                            │        │
    ┌──────────────────── ALB / API Gateway ─────────────────────────┐
    │                                                                │
    │  ┌───────────────────────────────────────────────────────────┐ │
    │  │   ECS Fargate 클러스터 (say2-6team)                          │ │
    │  │                                                           │ │
    │  │   Service: orchestrator (ECR: say2-6team-orchestrator)    │ │
    │  │   ┌─────────────────────────────────────────────────────┐ │ │
    │  │   │  FastAPI Backend                                    │ │ │
    │  │   │   • ML Decision Engine (LightGBM 8개)               │ │ │
    │  │   │   • RAG (ChromaDB) + Bedrock Claude (소견 생성)      │ │ │
    │  │   │   • WebSocket /ws/encounter/{id}                    │ │ │
    │  │   │   • FCM Dispatcher (critical 이벤트)                 │ │ │
    │  │   │   • FHIR Sync Queue Worker                          │ │ │
    │  │   └─────────────────────────────────────────────────────┘ │ │
    │  │                                                           │ │
    │  │   3개 모달 서비스 (병렬 호출, Cloud Map 디스커버리)               │ │
    │  │   ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐ │ │
    │  │   │ ecg-svc     │  │ cxr-svc     │  │ lab-svc          │ │ │
    │  │   │ ECG ONNX    │  │ DenseNet+   │  │ 룰기반 + 6h 예측   │ │ │
    │  │   │ (12-Lead)   │  │ UNet 세그   │  │ (BNP, K+, Cr)    │ │ │
    │  │   │ ECR push    │  │ ECR push    │  │ ECR push         │ │ │
    │  │   └─────────────┘  └─────────────┘  └─────────────────┘ │ │
    │  │                                                           │ │
    │  │   Service: hapi-fhir (R4 표준 서버)                          │ │
    │  └───────────────────────────────────────────────────────────┘ │
    └────────────────────────────────────────────────────────────────┘
                              │           │            │
              ┌───────────────┘           │            └───────────────┐
              ▼                            ▼                            ▼
    ┌─────────────────┐        ┌────────────────────┐        ┌──────────────────┐
    │ Aurora Serverless│       │ AWS Bedrock         │       │ S3 (MIMIC 데이터)   │
    │   v2 (PostgreSQL)│       │ • Claude Haiku 4.5  │       │ • ECG waveforms   │
    │                  │       │   / Sonnet 4.6      │       │                   │
    │                  │       │   (자동 선택)        │       │                   │
    │ ┌─────────────┐ │        │ • Titan Embeddings  │       │ • CXR images      │
    │ │ central_db  │ │        │   (RAG용)            │       │ • Lab labevents   │
    │ │  (운영 DB)   │ │        └────────────────────┘       └──────────────────┘
    │ │ 6개 테이블   │ │
    │ ├─────────────┤ │        ┌────────────────────┐        ┌──────────────────┐
    │ │   hapi      │ │        │ Firebase (FCM)      │       │ AWS Cognito       │
    │ │ (FHIR R4)   │ │        │ • say2-6-ad3dd      │       │ (의사 OAuth)        │
    │ └─────────────┘ │        │ • SA: firebase-     │       └──────────────────┘
    └─────────────────┘        │   adminsdk-fbsvc    │
                                └────────────────────┘
```

### 컴포넌트 한 줄 요약

| 컴포넌트 | 역할 | 어디서 도나 |
|----------|------|------------|
| **orchestrator** | 트리아지 받음 → 모달 병렬 호출 → Bedrock 종합 → WebSocket/FCM 푸시 | ECS Fargate (ECR `say2-6team-orchestrator`) |
| **ecg-svc** | 12-Lead ECG 24개 질환 분류 (ONNX) | ECS Fargate (ECR `say2-6team-ecg-svc`) |
| **cxr-svc** | 흉부 X-ray 6개 소견 분류 + UNet 세그멘테이션 | ECS Fargate (ECR `say2-6team-cxr-svc`) |
| **lab-svc** | 혈액검사 룰 기반 해석 + 6시간 악화 예측 (`/predict_6h`) | ECS Fargate (ECR `say2-6team-lab-svc`) |
| **hapi-fhir** | FHIR R4 표준 서버 (외부 EMR 호환) | ECS Fargate (퍼블릭 이미지 또는 미러) |
| **Aurora v2** | 운영 DB (`central_db`) + FHIR DB (`hapi`) | 관리형 RDS, ECR 불필요 |
| **Bedrock Claude** | LLM 소견 생성 + 복잡 케이스 추론 | AWS 매니지드 |
| **S3** | MIMIC 데이터 (.hea/.dat ECG, CXR 이미지, labevents) | AWS 매니지드 |
| **Firebase FCM** | 모바일 critical 푸시 알림 | 외부 (`say2-6-ad3dd`) |
| **CloudWatch + SNS** | 인프라 알람 (이메일) | AWS 매니지드 |

---

## 📦 ECS에 배포할 컨테이너 (ECR 이미지 4종)

```
ECR Repositories (ap-northeast-2, account 666803869796)
├─ say2-6team-orchestrator   ← FastAPI 백엔드 (메인)
├─ say2-6team-ecg-svc        ← ECG 모달 (1.06 GB)
├─ say2-6team-cxr-svc        ← CXR 모달 (309 MB)
└─ say2-6team-lab-svc        ← LAB 모달 (611 MB)
```

### 현재 단계 — EC2 단일 인스턴스에서 3개 모달 분리 가동 (중간 상태)

운영 ECS로 가기 전, 3개 모달 ECR 이미지를 EC2 한 대(`52.79.251.216`)에 띄워 검증 중:
- `ecg-svc` → 호스트 포트 `8003` → 컨테이너 `8000`
- `cxr-svc` → 호스트 포트 `8002` → 컨테이너 `8000`
- `lab-svc` → 호스트 포트 `8000` → 컨테이너 `8000`

ECS 전환 시 같은 ECR 이미지로 Fargate Task 4개 실행 + Cloud Map 서비스 디스커버리(`ecg-svc.local:8000`, `cxr-svc.local:8000` ...)로 통일.

### 모달 공통 패턴 — 자격증명 X, base64 위탁 다운로드

모달 컨테이너는 **AWS 자격증명을 갖지 않아요**. 백엔드가 S3에서 원본을 받아 `base64`로 인코딩해서 모달에 전달:

```
orchestrator   ──S3 다운로드──▶ .hea/.dat (ECG) | .png (CXR) | labevents
       │
       └─ base64 → POST /predict (모달은 단순 추론만 수행)
```

이 패턴 덕분에 모달 ECS Task에 IAM Role 권한 부여 불필요 → 보안 단순화.

---

## 🗃️ 데이터 영속성

### Aurora Serverless v2 — 한 클러스터에 DB 2개

`AWS/aurora-serverless/` 에 SQL/IaC 정의.

```
Aurora Cluster: say2-6team-aurora-cluster
├─ central_db (운영 DB — 6개 테이블)
│   ├─ patients              인적 정보
│   ├─ encounters            방문 ID, 진료 컨텍스트
│   ├─ modal_results         3개 모달 원본 응답 (waveform 포함)
│   ├─ modal_events          타임라인 (modal_started/completed/...)
│   ├─ diagnostic_reports    Bedrock 생성 종합 소견서
│   ├─ fhir_sync_queue       HAPI 다운 시 재시도 큐 (graceful degradation)
│   └─ device_tokens         FCM 푸시 토큰
│
└─ hapi (FHIR DB — HAPI가 자동 관리, 사람 손 X)
    └─ Patient · Encounter · ServiceRequest · DiagnosticReport · Observation
```

### 왜 DB가 두 개인가?

- `central_db` → AI 원본·waveform 같은 **비표준 데이터**를 자유롭게 저장. 우리 시스템 전용 빠른 작업 메모장.
- `hapi` → **FHIR R4 표준**으로 외부 EMR과 호환. 의사 서명된 final 소견서만 여기로.

자세한 설계 의도는 [`AWS/aurora-serverless/README.md`](../AWS/aurora-serverless/README.md) 참조.

### S3 (MIMIC 원본)

| Prefix | 내용 |
|--------|------|
| `say2-6team/mimic/ecg/waveforms/files/.../{record}.hea` `.dat` | ECG 12-Lead waveform (WFDB 포맷) |
| `say2-6team/mimic/cxr/...` | 흉부 X-ray 이미지 |
| `say2-6team/mimic/labevents/...` | 혈액검사 결과 (S3 Select로 환자별 필터링) |

---

## 🔄 데이터 흐름 — 의사 클릭부터 화면 갱신까지

```
1. 의사: 트리아지 폼 제출 ─POST /api/triage─▶ orchestrator
2. orchestrator: HAPI(Patient/Encounter) + central_db.encounters INSERT
                 → encounter_id (UUID) 발급, 200 OK
3. orchestrator: ML Decision Engine으로 우선 모달 선정
   (ChiefComplaint + Vitals → initial 모델 3개 점수 → top-K)
4. orchestrator: 3개 모달 **병렬 호출** (asyncio.gather)
   ├─ ECG: S3 .hea/.dat → base64 → ecg-svc /predict
   ├─ CXR: S3 .png      → base64 → cxr-svc /predict
   └─ LAB: labevents    → JSON   → lab-svc /predict (+ /predict_6h)
5. 각 모달 결과 도착:
   ├─ central_db.modal_results 저장 (waveform 포함 원본 JSON)
   ├─ HAPI ServiceRequest 상태 변경
   ├─ WebSocket broadcast "modal_completed"  ──▶ 웹 LIVE 갱신
   └─ risk_level=critical 이면 FCM fan-out    ──▶ 모바일 OS 알림
6. orchestrator: Bedrock Claude 호출
   (3개 결과 + RAG 유사 케이스 → 한국어 종합 소견)
7. orchestrator: central_db.diagnostic_reports INSERT
                 → WebSocket "report_generated" 푸시
8. 의사: 화면에서 검토 → 서명 → HAPI DiagnosticReport.status=final
```

> 💡 시각화된 시퀀스 다이어그램은 [`docs/lecture_01_architecture.md`](../docs/lecture_01_architecture.md) (1교시 강의자료)에서 Mermaid로 제공.

---

## 🧠 AI 컴포넌트

### 1) ML Decision Engine (LightGBM 8개)

| 모델 | 그룹 | 목적 | AUC |
|------|------|------|-----|
| `order_ecg` | initial | 첫 ECG 필요? | 0.92 |
| `order_cxr` | initial | 첫 CXR 필요? | 0.91 |
| `order_lab` | initial | 첫 LAB 필요? | 0.88 |
| `order_ecg` | followup | 추가 ECG? | — |
| `order_cxr` | followup | 추가 CXR? | — |
| `order_lab` | followup | 추가 LAB? | — |
| `stop` | followup | 검사 충분 — 종료 | 0.85 |
| `need_reasoning` | followup | 복잡 케이스 — Bedrock 호출 | 0.83 |

- **학습 데이터**: MIMIC-IV ED
- **피처**: 환자 정보, 바이탈, 랩 결과, Chief Complaint 매핑
- **위치**: [`final/central/backend/app/agent/models_stratified/`](central/backend/app/agent/models_stratified/)

### 2) 3개 모달 (ECS 별도 Task)

| 모달 | 모델 | 입력 | 출력 |
|------|------|------|------|
| **ECG** | ECG-S6 ONNX (PTB-XL pretrained) | `.hea` + `.dat` (base64) | 24개 질환 확률 + ECG vitals (HR, 부정맥 플래그) |
| **CXR** | DenseNet (분류) + UNet (세그) | 이미지 base64 | 6개 소견 + CTR 측정선 + 마스크 |
| **LAB** | 룰 엔진 + LightGBM (6h 악화) | 혈액검사 값 JSON | 즉시 소견 + 6시간 악화 예상 분석물 |

### 3) Bedrock Claude (종합 소견 + 복잡 추론)

- 모델: 자동 선택 — 기본 `claude-haiku-4-5` / critical·고난도 시 `claude-sonnet-4-6` (`select_model()` 함수)
- 입력: 3개 모달 결과 + RAG 유사 케이스 (ChromaDB)
- 출력: 한국어 의사용 종합 소견서 (Markdown)
- 위치: [`final/central/backend/app/agent/orchestrator_utils/bedrock_reporter.py`](central/backend/app/agent/orchestrator_utils/bedrock_reporter.py)

### 4) RAG (ChromaDB)

- 인덱싱: MIMIC-IV-NOTE 임상 노트
- 임베딩: Bedrock Titan
- 검색: 환자 chief complaint + 발견 사항 → top-5 유사 케이스 → Bedrock 컨텍스트에 주입

---

## 🔔 실시간 알림 — 두 트랙 분리 구조

| 트랙 | 채널 | 대상 | 발송 조건 |
|------|------|------|----------|
| **클라이언트 실시간 갱신** | WebSocket `/ws/encounter/{id}` | 의사 데스크탑 (React) | 모든 이벤트 (`modal_completed`, `ready_for_report`, `report_generated` 등) |
| **임상 critical 푸시** | Firebase FCM | 의사 모바일 (Flutter) | `risk_level=critical` 이벤트만 (STEMI, severe pneumothorax 등) |
| **인프라 알람** | CloudWatch + SNS Email | DevOps | 컨테이너 다운, Aurora CPU > 80%, 5xx 비율 ↑ 등 |

```
risk_level=critical 모달 결과
        │
        ▼
broadcast() → DB 적재 + WebSocket fan-out + FCM fan-out
                          │                    │
                  ┌───────┴──────┐      ┌──────┴──────────┐
                  ▼              ▼      ▼                 ▼
              웹 LIVE 뱃지   타임라인     device_tokens   의사 폰 OS 알림
              ● 초록 펄스     자동 갱신    조회 → 멀티캐스트  + 딥링크 /patient/{id}
```

자세한 설계는 [`AWS/monitoring/README.md`](../AWS/monitoring/README.md) 참조.

---

## 📁 프로젝트 구조

```
say-6-project/
├── AWS/                                  # AWS 인프라 설계 문서 (운영 진입용)
│   ├── AWS_Compute_Design_v1.md         # ECS Fargate 컴퓨팅 설계
│   ├── AWS_DB_Design_v3.md              # Aurora + ChromaDB 설계
│   ├── AWS_Network_Design_v1.md         # VPC, ALB, Cloud Map
│   ├── AWS_Security_Design_v1.md        # Cognito, IAM, KMS
│   ├── AWS_Observability_Design_v1.md   # CloudWatch, X-Ray, 알람
│   ├── aurora-serverless/               # Aurora v2 IaC (SQL 마이그레이션 7~8)
│   └── monitoring/                      # CloudWatch + SNS 알람 yaml
│
├── final/                                # 중앙 시스템 (이 README의 위치)
│   └── central/
│       ├── backend/                     # FastAPI orchestrator (ECR push 대상)
│       │   ├── app/
│       │   │   ├── agent/               # ML 의사결정 + RAG + Bedrock
│       │   │   ├── api/                 # 라우터 (triage, orders, reports, ws, devices)
│       │   │   ├── clients/             # fcm.py, s3_downloader.py, modal_http.py 등
│       │   │   ├── db/                  # asyncpg 풀, device_tokens, fhir_sync_queue
│       │   │   ├── fhir/                # HAPI FHIR 호출
│       │   │   └── main.py              # FastAPI 앱 (lifespan에서 ML/RAG/FCM init)
│       │   ├── data/                    # CC map .parquet 등
│       │   ├── fcm-sa.json              # 🔒 Firebase Admin SDK 키 (gitignored)
│       │   ├── Dockerfile
│       │   └── requirements.txt
│       │
│       ├── infra/                       # docker-compose.yml (로컬 개발용)
│       └── tests/
│
├── frontend/                             # ⭐ React 데스크탑 (의사용) — 루트에 위치
│   └── src/
│       ├── lib/v2/ws.ts                  # WebSocket 클라이언트
│       └── pages/v2/PatientDetailPage.tsx # LIVE 뱃지
│
├── ecg-svc/                              # ECG 모달 서비스 (ECR push 대상)
│   ├── layer1_preprocessing/            # WFDB → (1, 12, 1000) 정규화
│   ├── layer2_inference/                # ONNX 추론 엔진
│   ├── layer3_clinical_logic/           # 임상 해석 + risk_level 산정
│   ├── shared/schemas.py                # PredictRequest/Response (base64 지원)
│   ├── pipeline.py
│   ├── Dockerfile
│   └── deploy.sh                        # ECR 빌드+푸시 자동화
│
├── chest-svc-pre/                        # CXR 모달 서비스 (ECR push 대상)
│   └── ...
│
├── lab-svc/                              # LAB 모달 서비스 (ECR push 대상)
│   ├── /predict                         # 룰 기반 즉시 해석
│   └── /predict_6h                      # 6시간 악화 예측 (LightGBM)
│
├── mobile/                               # Flutter 의사용 모바일 앱
│   ├── lib/
│   │   ├── main.dart                    # Firebase 초기화 + PushService 부트스트랩
│   │   ├── router.dart                  # go_router + FCM 딥링크
│   │   ├── firebase_options.dart        # flutterfire configure 생성
│   │   ├── core/services/push_service.dart  # FCM 토큰 등록·핸들러
│   │   └── features/                    # auth, worklist, patient, report
│   ├── android/app/google-services.json
│   └── ios/Runner/GoogleService-Info.plist
│
└── docs/                                 # 강의·교재
    └── lecture_01_architecture.md       # 1교시: 전체 흐름 (병원 비유)
```

---

## 🚀 빠른 시작

### A. 로컬 개발 (Docker Compose)

```bash
# 1. 백엔드 + DB + HAPI 띄우기
cd final/central/infra
docker compose up -d --build

# 2. 프론트엔드 (별도 터미널) — 루트 frontend/ 가 본체
cd frontend
npm install && npm run dev   # → http://localhost:3000

# 3. (선택) 모바일 앱
cd mobile
~/development/flutter/bin/flutter pub get
~/development/flutter/bin/flutter run        # 폰 USB 연결 시
```

**접속 URL**
- Backend API: http://localhost:8000/docs
- Frontend: http://localhost:3000
- HAPI FHIR: http://localhost:8080/fhir
- PgWeb (DB GUI): http://localhost:8081

3개 모달은 EC2 (`52.79.251.216:8000/8002/8003`)에서 가동 중이라 로컬에서 띄울 필요 없음.

### B. 운영 — ECS Fargate

전체 IaC는 `AWS/` 폴더 참조. 압축 핵심 절차:

```bash
# 1. 4개 ECR 이미지 빌드 + 푸시
for repo in orchestrator ecg-svc cxr-svc lab-svc; do
  cd .../$repo  # 각 서비스 디렉토리
  aws ecr get-login-password --region ap-northeast-2 | docker login ...
  docker buildx build --platform linux/amd64 -t say2-6team-$repo --load .
  docker tag say2-6team-$repo:latest \
    666803869796.dkr.ecr.ap-northeast-2.amazonaws.com/say2-6team-$repo:latest
  docker push 666803869796.dkr.ecr.ap-northeast-2.amazonaws.com/say2-6team-$repo:latest
done

# 2. Aurora v2 클러스터 생성 + 마이그레이션 실행
cd AWS/aurora-serverless
# aurora-stack.yaml (정식 CloudFormation) 한 줄 배포:
#   aws cloudformation deploy --stack-name say2-6team-aurora \
#     --template-file aurora-stack.yaml --capabilities CAPABILITY_IAM
# 그 후 migrations.yaml (SQL 9개) 순서대로 RDS Data API 또는 psql 실행

# 3. 모니터링 알람 배포 (Aurora 메트릭 알람 + SNS 이메일)
#   aws cloudformation deploy --stack-name say2-6team-monitoring-alarms \
#     --template-file ../monitoring/monitoring-alarms-stack.yaml \
#     --parameter-overrides CriticalAlertEmail=oncall@example.com WarningAlertEmail=dev@example.com

# 4. ECS 서비스 생성 (Cloud Map 등록 포함)
# (AWS/ 안의 compute/ecs-services.yaml — 작성 예정)
```

자세한 단계는 [`AWS/AWS_Compute_Design_v1.md`](../AWS/AWS_Compute_Design_v1.md) 참조.

---

## 🔧 환경 변수

### 백엔드 (orchestrator)

| 변수 | 로컬 | 운영(ECS) |
|------|------|----------|
| `FHIR_BASE_URL` | `http://hapi-fhir:8080/fhir` | `http://hapi-fhir.local:8080/fhir` |
| `OPS_DB_URL` | `postgresql://admin:secret@postgres:5432/central_db` | Aurora 엔드포인트 (Secrets Manager) |
| `AWS_REGION` | `ap-northeast-2` | (Task Role이 자동 인식) |
| `RAG_LLM_HAIKU` | `global.anthropic.claude-haiku-4-5-20251001-v1:0` | 동일 (기본 모델) |
| `RAG_LLM_SONNET` | `global.anthropic.claude-sonnet-4-6` | 동일 (critical·고난도 케이스) |
| `ECG_SERVICE_URL` | `http://52.79.251.216:8003` | `http://ecg-svc.local:8000` |
| `CXR_SERVICE_URL` | `http://52.79.251.216:8002` | `http://cxr-svc.local:8000` |
| `LAB_SERVICE_URL` | `http://52.79.251.216:8000` | `http://lab-svc.local:8000` |
| `BLOOD_PROGNOSIS_URL` | `http://52.79.251.216:8000` | `http://lab-svc.local:8000` (같은 LAB의 `/predict_6h`) |
| `GOOGLE_APPLICATION_CREDENTIALS` | `/app/fcm-sa.json` (마운트) | Secrets Manager → 컨테이너 마운트 |

### 모바일 (Flutter)

| 변수 | 용도 |
|------|------|
| `API_BASE_URL` | 백엔드 ALB 도메인 (`--dart-define`로 빌드 시 주입) |

---

## 📚 문서 인덱스

### 강의·교재 (`docs/`)
- [1교시 — 전체 시스템 그림 (병원 비유)](../docs/lecture_01_architecture.md)
- 2교시 (예정) — HAPI FHIR vs central_db 이중 저장

### AWS 운영 설계 (`AWS/`)
- [Compute Design — ECS Fargate](../AWS/AWS_Compute_Design_v1.md)
- [DB Design — Aurora v2 + ChromaDB](../AWS/AWS_DB_Design_v3.md)
- [Network Design — VPC, ALB, Cloud Map](../AWS/AWS_Network_Design_v1.md)
- [Security Design — Cognito, IAM, KMS](../AWS/AWS_Security_Design_v1.md)
- [Observability Design — CloudWatch + X-Ray](../AWS/AWS_Observability_Design_v1.md)
- [Aurora v2 README](../AWS/aurora-serverless/README.md)
- [Monitoring README](../AWS/monitoring/README.md)

### 서브 컴포넌트
- [중앙 백엔드 QUICKSTART](central/QUICKSTART.md)
- [중앙 백엔드 DEPLOYMENT](central/DEPLOYMENT.md)
- [중앙 백엔드 ARCHITECTURE](central/docs/ARCHITECTURE.md)
- [중앙 백엔드 DECISION_LOGIC](central/docs/DECISION_LOGIC.md)
- [중앙 백엔드 UPGRADE_GUIDE](central/docs/UPGRADE_GUIDE.md)
- [FHIR 통합 가이드](central/FHIR-GUIDE.md)

---

## 🧪 테스트

### 단위·통합
```bash
cd final/central/backend
pytest tests/
```

### 모달 헬스 체크
```bash
curl http://52.79.251.216:8000/ready   # LAB
curl http://52.79.251.216:8002/readyz  # CXR
curl http://52.79.251.216:8003/ready   # ECG
```

### End-to-End — 환자 등록 → 종합소견 도착까지
```bash
# 백엔드 컨테이너 안에서
docker exec infra-backend-1 python -c "..."  # (테스트 스크립트는 tests/ 하위)
```

### FCM 발송 테스트
```bash
docker exec infra-backend-1 python -c "
import asyncio
from app.clients import fcm
asyncio.run(fcm.send_critical_alert(
    encounter_id='test-demo',
    title='🚨 데모 알림',
    body='FCM 연결 확인'))
"
```

---

## 👥 팀

| 이름 | 역할 |
|------|------|
| 원정아 | 중앙 백엔드 / AWS 운영 |
| 박현우 | 모달 ML 학습·서빙 |
| 홍경태 | 프론트엔드 (React) |
| 양정인 | 모바일 (Flutter) |
| 이정인 | 데이터 / RAG |

---

## 📄 라이선스

MIT License — [LICENSE](LICENSE) 참조

---

## 🙏 감사의 말

- **MIMIC-IV** (PhysioNet) — 학습·평가 데이터
- **PTB-XL** — ECG 사전학습 모델
- **AWS** — Bedrock, ECS, Aurora 인프라
- **Firebase (Google)** — FCM 푸시 게이트웨이
- **HAPI FHIR** — FHIR R4 표준 서버
- **LightGBM / ONNX Runtime / FastAPI / Flutter** — 핵심 오픈소스

---

**Last Updated**: 2026-05-18
**Version**: 2.0.0 (AWS ECS · WebSocket + FCM 통합)
**Status**: 🚧 ECS 전환 진행 중 (모달 3종 ECR 배포 완료, orchestrator 전환 대기)
