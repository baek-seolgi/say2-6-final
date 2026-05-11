# 응급 의료 멀티모달 AI 에이전트 — AWS 아키텍처 설계 리포트

> Graph형 아키텍처 설계팀 (Infra Analyst + Security Specialist + Reporting Agent)
> 작성일: 2026-04-28

---

## 목차

1. [1단계: 인프라 분석 (Infra Analyst)](#1단계-인프라-분석-infra-analyst)
2. [2단계: 보안 및 규정 준수 (Security Specialist)](#2단계-보안-및-규정-준수-security-specialist)
3. [3단계: 통합 리포트 (Reporting Agent)](#3단계-통합-리포트-reporting-agent)
4. [필수 체크리스트](#필수-체크리스트)

---

## 1단계: 인프라 분석 (Infra Analyst)

### 1.1 핵심 데이터 흐름

```
환자 도착
  │
  ▼
트리아지 입력 (간호사)
  │
  ▼
중앙백엔드 (FastAPI / ECS Fargate)
  │
  ├── HAPI FHIR → RDS Aurora (FHIR 리소스 저장)
  │
  ├── Bedrock Agent (오케스트레이션 판단)
  │     │
  │     ├── ECG 모달 → SageMaker GPU (.npy 파형, ~0.5초)
  │     ├── CXR 모달 → SageMaker GPU (DICOM/PNG, ~0.5초)
  │     └── Lab 모달 → SageMaker CPU (JSON 수치, ~0.1초)
  │
  ├── DynamoDB (모달 결과 캐시)
  │
  └── WebSocket → 프론트엔드 실시간 업데이트
        │
        ▼
  종합 소견 → 최종 리포트 (의사 서명)
```

### 1.2 컴퓨팅 서비스

| 서비스 | 용도 | 선정 근거 |
|--------|------|-----------|
| **ECS Fargate** | 중앙백엔드 (FastAPI + Uvicorn) | 서버리스 컨테이너, 관리 부담 최소, 빠른 스케일링 |
| **ECS Fargate** | HAPI FHIR 서버 (Java) | Docker 이미지 그대로 배포, 별도 관리 불필요 |
| **SageMaker Endpoint** (ml.g4dn.xlarge) | ECG/CXR GPU 추론 | 응급 상황 실시간 추론 필수, 콜드스타트 없음, ~0.5초 응답 |
| **SageMaker Endpoint** (ml.t3.medium) | Lab 모달 CPU 추론 | GPU 불필요, XGBoost/Rule Engine 경량 처리 |
| **Lambda** | Bedrock Agent ↔ SageMaker 프록시 | 이벤트 기반, Agent Action Group 연동 |
| **Amazon Bedrock** (Claude 3.5 Sonnet) | 중앙 오케스트레이터 + ICD-10 매핑 + 종합 소견 | 의료 맥락 이해, 멀티모달 결과 통합 판단 |
| **CloudFront** | 프론트엔드 CDN + 정적 호스팅 | 글로벌 엣지, React SPA 배포 |

### 1.3 스토리지 서비스

| 서비스 | 용도 | 선정 근거 |
|--------|------|-----------|
| **S3** | ECG 파형(.npy ~48KB), CXR 이미지(DICOM/PNG), 모델 가중치, 프론트 빌드 | 내구성 11-9s, 대용량 비정형 데이터 |
| **Aurora Serverless v2** (PostgreSQL) | HAPI FHIR 백엔드 DB (Patient, Encounter, Observation 등) | FHIR 표준 준수, 자동 스케일링, 데모 시 ~$5/월 |
| **DynamoDB** | 모달별 추론 결과 캐시 (ECG/CXR/Lab JSON) | 스키마 유연, patient_id 기반 빠른 조회, TTL 자동 삭제 |
| **ElastiCache** (Redis) | WebSocket 세션 관리, 실시간 이벤트 Pub/Sub | 밀리초 응답, 다중 ECS 태스크 간 이벤트 공유 |

### 1.4 고가용성 및 속도 보장 설계

| 요구사항 | 대응 방안 |
|----------|-----------|
| ECG/CXR 추론 0.5초 이내 | SageMaker 상시 Endpoint (콜드스타트 없음) |
| 모달 간 순차 호출 지연 최소화 | Lambda 프록시 + VPC 내부 통신 |
| HAPI FHIR 장애 시 | ECS 멀티태스크 + ALB 헬스체크 자동 교체 |
| DB 장애 시 | Aurora Multi-AZ 자동 페일오버 (~30초) |
| 프론트엔드 응답 속도 | CloudFront CDN + S3 정적 호스팅 |
| 실시간 상태 업데이트 | WebSocket (ECS) + Redis Pub/Sub |

---

## 2단계: 보안 및 규정 준수 (Security Specialist)

### 2.1 암호화 전략 (전 구간 End-to-End)

| 구간 | 방식 | 상세 |
|------|------|------|
| 사용자 ↔ CloudFront | TLS 1.3 (HTTPS) | ACM 인증서, HSTS 헤더 강제 |
| CloudFront ↔ ALB | TLS 1.2+ | Origin Protocol Policy: HTTPS Only |
| ALB ↔ 중앙백엔드 (ECS) | TLS (내부) | ACM 인증서 |
| 중앙백엔드 ↔ HAPI FHIR | Basic Auth + 내부 TLS | Secrets Manager 자격증명 |
| HAPI FHIR ↔ RDS | TLS + AES-256 디스크 암호화 | KMS 관리형 키 |
| 중앙백엔드 ↔ Bedrock/SageMaker | IAM Role + HTTPS | VPC Endpoint 경유 |
| S3 저장 데이터 | SSE-KMS (AES-256) | 버킷 정책으로 암호화 강제 |
| DynamoDB 저장 데이터 | AWS 관리형 암호화 | 기본 활성화 |

### 2.2 IAM 권한 관리 (최소 권한 원칙)

| 역할 | 권한 범위 | 원칙 |
|------|-----------|------|
| ECS Task Role (중앙백엔드) | S3 R/W, DynamoDB CRUD, SageMaker Invoke, Bedrock Invoke, Secrets Manager Read | 최소 권한 |
| ECS Task Role (HAPI FHIR) | RDS 접근만 | 네트워크 + IAM 이중 격리 |
| Lambda Execution Role | SageMaker InvokeEndpoint, CloudWatch Logs | 모달별 개별 Role |
| SageMaker Execution Role | S3 모델/데이터 읽기 | 읽기 전용 |
| 프론트엔드 (Cognito) | API Gateway 인증 토큰 | JWT 기반 의사/간호사 역할 분리 |

### 2.3 네트워크 격리 (VPC 설계)

```
VPC (10.0.0.0/16) — 서울 리전 (ap-northeast-2)
│
├── Public Subnet (10.0.1.0/24, 10.0.2.0/24) — AZ-a, AZ-c
│   └── ALB (인터넷 → HTTPS 443만 허용)
│
├── Private Subnet - App (10.0.10.0/24, 10.0.11.0/24) — AZ-a, AZ-c
│   ├── 중앙백엔드 ECS
│   │   └── SG: ALB에서 8000 포트만 Inbound 허용
│   ├── HAPI FHIR ECS
│   │   └── SG: 중앙백엔드 SG에서 8080 포트만 Inbound 허용
│   └── NAT Gateway 경유 아웃바운드
│
├── Private Subnet - DB (10.0.20.0/24, 10.0.21.0/24) — AZ-a, AZ-c
│   └── RDS Aurora
│       └── SG: HAPI FHIR SG에서 5432 포트만 Inbound 허용
│
└── VPC Endpoints (프라이빗 링크 — 인터넷 미경유)
    ├── S3 Gateway Endpoint
    ├── DynamoDB Gateway Endpoint
    ├── SageMaker Runtime Interface Endpoint
    ├── Bedrock Runtime Interface Endpoint
    ├── Secrets Manager Interface Endpoint
    └── CloudWatch Logs Interface Endpoint
```

### 2.4 로깅 및 모니터링 (의료법/보안 가이드라인 준수)

| 서비스 | 용도 | 보존 기간 |
|--------|------|-----------|
| **CloudTrail** | 모든 AWS API 호출 감사 로그 | 최소 3년 (의료법) |
| **VPC Flow Logs** | 네트워크 트래픽 기록 | 1년 |
| **CloudWatch Logs** | 애플리케이션 로그 (백엔드, HAPI FHIR, Lambda) | 1년 |
| **HAPI FHIR AuditEvent** | FHIR 리소스 접근/수정 이력 (WHO, WHAT, WHEN) | 영구 (FHIR 내장) |
| **GuardDuty** | 이상 행위 탐지 (무차별 대입, 비정상 API 패턴) | 실시간 알림 |
| **AWS Config** | 리소스 구성 변경 추적 (SG 변경, 암호화 해제 등) | 1년 |
| **S3 Access Logs** | 의료 이미지/파형 접근 기록 | 1년 |

### 2.5 의료 데이터 특화 보안

| 요구사항 | 구현 방안 |
|----------|-----------|
| 환자 데이터 접근 감사 | HAPI FHIR Interceptor → AuditEvent 자동 생성 |
| 데이터 삭제 방지 | HAPI FHIR Soft Delete + S3 Object Lock |
| 버전 관리 | FHIR `_history` 엔드포인트 + S3 Versioning |
| 역할 기반 접근 | Cognito User Pool (의사/간호사/관리자 그룹) |
| 세션 타임아웃 | JWT 만료 15분 + Refresh Token 8시간 |
| 데이터 최소 수집 | 진료 목적 외 데이터 수집 금지 (개인정보보호법) |

---

## 3단계: 통합 리포트 (Reporting Agent)

### 3.1 최종 AWS 서비스 매트릭스

| 카테고리 | AWS 서비스 | 용도 | 우선순위 |
|----------|-----------|------|:--------:|
| **컴퓨팅** | ECS Fargate | 중앙백엔드 (FastAPI) | 🔴 필수 |
| | ECS Fargate | HAPI FHIR 서버 | 🔴 필수 |
| | Lambda | Bedrock Agent ↔ SageMaker 프록시 (×3 모달) | 🔴 필수 |
| | CloudFront | 프론트엔드 CDN + 정적 호스팅 | 🔴 필수 |
| **데이터베이스** | Aurora Serverless v2 (PostgreSQL) | HAPI FHIR 백엔드 (FHIR 리소스 저장) | 🔴 필수 |
| | DynamoDB | 모달 추론 결과 캐시 | 🔴 필수 |
| | ElastiCache (Redis) | WebSocket 세션 + Pub/Sub | 🟡 권장 |
| **스토리지** | S3 | ECG 파형, CXR 이미지, 모델 가중치, 프론트 빌드 | 🔴 필수 |
| | ECR | Docker 이미지 레지스트리 | 🔴 필수 |
| **네트워킹** | VPC | 네트워크 격리 (Public/Private/DB 서브넷) | 🔴 필수 |
| | ALB | HTTPS 로드밸런싱 + 헬스체크 | 🔴 필수 |
| | NAT Gateway | Private 서브넷 아웃바운드 | 🔴 필수 |
| | VPC Endpoints | S3/DynamoDB/SageMaker/Bedrock 프라이빗 접근 | 🔴 필수 |
| | Route 53 | DNS 관리 (커스텀 도메인) | 🟡 권장 |
| **보안** | IAM | 역할 기반 최소 권한 | 🔴 필수 |
| | KMS | 데이터 암호화 키 관리 | 🔴 필수 |
| | Secrets Manager | DB 자격증명, HAPI FHIR 인증 정보 | 🔴 필수 |
| | ACM | TLS 인증서 (HTTPS) | 🔴 필수 |
| | WAF | DDoS 방어, SQL Injection 차단 | 🔴 필수 |
| | Cognito | 의사/간호사 인증 (JWT) | 🔴 필수 |
| | GuardDuty | 침해 탐지 | 🟡 권장 |
| **AI 서비스** | Amazon Bedrock (Claude 3.5 Sonnet) | 중앙 오케스트레이터 + 종합 소견 생성 | 🔴 필수 |
| | SageMaker Endpoint (GPU ×2) | ECG/CXR 실시간 추론 | 🔴 필수 |
| | SageMaker Endpoint (CPU ×1) | Lab 모달 추론 | 🔴 필수 |
| **모니터링** | CloudWatch | 로그 수집 + 메트릭 + 알람 | 🔴 필수 |
| | CloudTrail | AWS API 감사 로그 (의료법 3년 보관) | 🔴 필수 |
| | AWS Config | 리소스 구성 변경 추적 | 🟡 권장 |
| | VPC Flow Logs | 네트워크 트래픽 기록 | 🟡 권장 |

### 3.2 최종 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│ 인터넷                                                           │
└───────────────────────────┬─────────────────────────────────────┘
                            │ HTTPS (443)
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  CloudFront + WAF + ACM                                         │
│  - React SPA (S3 Origin)                                        │
│  - DDoS 방어, SQL Injection 차단                                  │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                            ▼
┌─────────────────────────────────────────────────────────────────┐
│  VPC (ap-northeast-2, 서울 리전)                                  │
│                                                                 │
│  ┌── Public Subnet (AZ-a, AZ-c) ─────────────────────┐         │
│  │  ALB (HTTPS, ACM 인증서, Cognito 인증)               │         │
│  └──────────────────────┬────────────────────────────┘         │
│                         │                                       │
│  ┌── Private Subnet - App (AZ-a, AZ-c) ──────────────┐         │
│  │                                                    │         │
│  │  ┌──────────────┐         ┌──────────────┐         │         │
│  │  │ 중앙백엔드    │ Basic   │ HAPI FHIR    │         │         │
│  │  │ ECS Fargate  │──Auth──▶│ ECS Fargate  │         │         │
│  │  │ (FastAPI)    │         │ (Java)       │         │         │
│  │  └──────┬───────┘         └──────┬───────┘         │         │
│  │         │                        │                 │         │
│  │         │  ┌─────────────────────┘                 │         │
│  │         │  │                                       │         │
│  │         ▼  ▼                                       │         │
│  │  ┌──────────────┐    ┌──────────────┐              │         │
│  │  │ DynamoDB     │    │ ElastiCache  │              │         │
│  │  │ (모달 결과)   │    │ Redis (WS)   │              │         │
│  │  └──────────────┘    └──────────────┘              │         │
│  └────────────────────────────────────────────────────┘         │
│                         │                                       │
│  ┌── Private Subnet - DB (AZ-a, AZ-c) ───────────────┐         │
│  │                      ▼                             │         │
│  │               ┌──────────────┐                     │         │
│  │               │ Aurora       │                     │         │
│  │               │ Serverless v2│                     │         │
│  │               │ (PostgreSQL) │                     │         │
│  │               │ 암호화 + Multi-AZ                   │         │
│  │               └──────────────┘                     │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  ┌── VPC Endpoints ───────────────────────────────────┐         │
│  │  S3 / DynamoDB / SageMaker / Bedrock / Secrets Mgr │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  ┌── AI 서비스 (VPC Endpoint 경유) ───────────────────┐         │
│  │                                                    │         │
│  │  ┌────────────────────────────────────────┐        │         │
│  │  │         Bedrock Agent (Claude)         │        │         │
│  │  │         중앙 오케스트레이터              │        │         │
│  │  └────────┬──────────┬──────────┬─────────┘        │         │
│  │           │          │          │                  │         │
│  │     ┌─────▼───┐ ┌────▼────┐ ┌───▼─────┐           │         │
│  │     │ Lambda  │ │ Lambda  │ │ Lambda  │           │         │
│  │     │ (ECG)   │ │ (CXR)   │ │ (Lab)   │           │         │
│  │     └────┬────┘ └────┬────┘ └────┬────┘           │         │
│  │          │           │           │                │         │
│  │     ┌────▼────┐ ┌────▼────┐ ┌────▼────┐           │         │
│  │     │SageMaker│ │SageMaker│ │SageMaker│           │         │
│  │     │GPU      │ │GPU      │ │CPU      │           │         │
│  │     │(ECG)    │ │(CXR)    │ │(Lab)    │           │         │
│  │     └─────────┘ └─────────┘ └─────────┘           │         │
│  └────────────────────────────────────────────────────┘         │
│                                                                 │
│  + Secrets Manager: 자격증명 관리                                 │
│  + CloudWatch: 로그 + 메트릭 + 알람                               │
│  + CloudTrail: API 감사 로그 (3년 보관)                           │
│  + S3: 이미지/파형/모델 가중치                                     │
│  + ECR: Docker 이미지 레지스트리                                   │
│  + KMS: 암호화 키 관리                                            │
└─────────────────────────────────────────────────────────────────┘
```

### 3.3 월 비용 예상 (데모/PoC 기준)

| 카테고리 | 서비스 | 월 비용 |
|----------|--------|--------:|
| 컴퓨팅 | ECS Fargate ×2 (백엔드 + HAPI FHIR) | ~$30 |
| 컴퓨팅 | Lambda (프록시 ×3) | ~$3 |
| 컴퓨팅 | CloudFront | ~$5 |
| DB | Aurora Serverless v2 | ~$5 |
| DB | DynamoDB | ~$1 |
| 스토리지 | S3 (~10GB) | ~$1 |
| 네트워킹 | ALB | ~$20 |
| 네트워킹 | NAT Gateway | ~$35 |
| AI | SageMaker GPU ×2 (8시간/일) | ~$254 |
| AI | SageMaker CPU ×1 | ~$15 |
| AI | Bedrock (호출당 과금) | ~$10 |
| 보안 | Secrets Manager + KMS | ~$3 |
| 모니터링 | CloudWatch + CloudTrail | ~$5 |
| **합계** | | **~$387/월** |

> ※ SageMaker 24시간 상시 운영 시 ~$780/월, 8시간/일 운영 시 ~$254/월
> ※ 프로덕션 전환 시 Multi-AZ, WAF, GuardDuty 추가로 ~$500/월 증가 예상

---

## 필수 체크리스트

> AWS 상에서 구현할 때 놓쳐선 안 될 항목들

### 🔴 인프라 (놓치면 서비스 장애)

- [ ] SageMaker Endpoint 상시 가동 확인 — 응급 시스템이므로 콜드스타트 불가
- [ ] Aurora Multi-AZ 활성화 — DB 단일 장애점 제거
- [ ] ECS 서비스 최소 태스크 수 2개 이상 — 중앙백엔드 고가용성
- [ ] S3 버킷 버전 관리 활성화 — 의료 이미지 실수 삭제 방지
- [ ] CloudFront Origin Failover 설정
- [ ] NAT Gateway AZ 이중화 — 단일 AZ 장애 시 아웃바운드 차단 방지
- [ ] ECS 태스크 헬스체크 경로 설정 (`/health`)
- [ ] SageMaker Endpoint Auto Scaling 정책 설정

### 🔴 보안 (놓치면 데이터 유출)

- [ ] HAPI FHIR를 **Private Subnet**에 배치 — 외부 직접 접근 차단
- [ ] RDS를 **DB 전용 서브넷**에 격리 — HAPI FHIR SG에서만 접근
- [ ] 모든 S3 버킷 **퍼블릭 액세스 차단** + SSE-KMS 암호화
- [ ] **VPC Endpoint** 설정 — SageMaker/Bedrock 트래픽이 인터넷 경유하지 않도록
- [ ] **Cognito 또는 JWT** 기반 의사 인증 구현 — 현재 미구현 상태 ⚠️
- [ ] **WAF 규칙** 설정 — 의료 시스템 대상 공격 방어
- [ ] HAPI FHIR **Basic Auth** 활성화 + Secrets Manager 연동
- [ ] Security Group **최소 포트만 개방** (8000, 8080, 5432)

### 🔴 규정 준수 (놓치면 법적 문제)

- [ ] **CloudTrail** 전 리전 활성화 + S3 장기 보관 (의료법 최소 3년)
- [ ] HAPI FHIR **AuditEvent Interceptor** 활성화 — 누가 어떤 환자 데이터를 조회했는지
- [ ] **개인정보 영향평가(PIA)** 수행 여부 확인
- [ ] **의료기기 소프트웨어(SaMD)** 인허가 검토 — 식약처 가이드라인
- [ ] 환자 동의 절차 구현 — 개인정보보호법 제15조
- [ ] 데이터 보존/파기 정책 수립 — 의료법 시행규칙 제15조 (최소 5년)

### 🟡 운영 (놓치면 장애 대응 지연)

- [ ] CloudWatch 알람 설정
  - SageMaker 5xx 에러율 > 1%
  - ECS 태스크 실패
  - RDS CPU > 80%
  - Lambda 에러율 > 5%
  - ALB 5xx > 10건/분
- [ ] SageMaker **모델 모니터링** — Data Drift 감지
- [ ] **재해 복구(DR)** 계획 — 다른 리전 백업 전략
- [ ] **CI/CD 파이프라인** — ECR 이미지 빌드 → ECS 블루/그린 배포
- [ ] **부하 테스트** — 동시 환자 50명 기준 응답 시간 검증
- [ ] **로그 보존 정책** — CloudWatch Logs 보존 기간 설정 (기본 무기한 → 비용 폭증)
- [ ] **비용 알림** — AWS Budgets 설정 (월 $500 초과 시 알림)

### 🟡 데모/발표 특화 (놓치면 시연 실패)

- [ ] SageMaker Endpoint **사전 워밍업** — 발표 30분 전 테스트 호출
- [ ] 테스트 케이스 S3 사전 업로드 — 4개 시나리오 (심부전, 패혈증, 폐색전증, 폐렴)
- [ ] WebSocket 연결 안정성 확인 — 브라우저 호환성 테스트
- [ ] Bedrock Agent 응답 시간 측정 — 종합 소견 생성 ~3-5초 예상
- [ ] 네트워크 환경 확인 — 발표장 Wi-Fi에서 AWS 접근 가능 여부

---

## 부록: 현재 미구현 → 필수 구현 항목

프로젝트 문서 분석 결과, 현재 미구현이지만 AWS 배포 전 반드시 구현해야 하는 항목:

| 항목 | 현재 상태 | 필요 조치 | 우선순위 |
|------|-----------|-----------|:--------:|
| CXR 업로드 API | S3 URL 하드코딩 | `POST /encounters/{id}/cxr/upload` 구현 | 🔴 |
| Lab 수치 입력 API | SageMaker만 존재 | `POST /encounters/{id}/lab/submit` 구현 | 🔴 |
| AI 종합 소견 API | 별도 Lambda만 존재 | `POST /reports/{id}/generate` 구현 | 🔴 |
| 인증/권한 | 없음 | Cognito + JWT 기반 의사 로그인 | 🔴 |
| 감사 로깅 | 없음 | FHIR AuditEvent 자동 생성 | 🟡 |

---

**문서 버전**: v1.0
**작성일**: 2026-04-28
**작성**: Graph형 아키텍처 설계팀 (Infra Analyst + Security Specialist + Reporting Agent)
