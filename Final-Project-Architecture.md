# Final Project 설계 문서
## 응급 의료 멀티모달 AI 에이전트 — 프로덕션 아키텍처

작성일: 2026-04-23
버전: v1.0

---

## 목차

1. [타깃 병원 선정](#1-타깃-병원-선정)
2. [프론트엔드 페이지 설계](#2-프론트엔드-페이지-설계)
3. [중앙 백엔드 로직 분석](#3-중앙-백엔드-로직-분석)
4. [데이터베이스 아키텍처 (HAPI FHIR + AWS RDS)](#4-데이터베이스-아키텍처)
5. [보안 설계](#5-보안-설계)
6. [배포 로드맵](#6-배포-로드맵)

---

## 1. 타깃 병원 선정

### 1.1 결론: 2차 병원 (지역응급의료센터)

### 1.2 병원 등급별 비교

| 구분 | 1차 병원 | **2차 병원** ⭐ | 3차 병원 |
|---|---|---|---|
| 응급실(ED) | 없거나 소규모 | 있음 | 있음 |
| 12-Lead ECG | 기초 장비만 | 보유 | 보유 |
| CXR | 일부 보유 | 보유 | 보유 |
| Lab | 외부 위탁 | 보유 | 보유 |
| 응급의학과 전문의 | 없음 | **1-2명 (부족)** | 충분 |
| 영상의학과 야간 판독 | 없음 | **부재 빈번** | 24시간 가용 |
| AI 도입 임상적 가치 | 낮음 | **매우 높음** | 중간 |

### 1.3 2차 병원이 최적인 이유

1. **장비 인프라 충족**: ECG/CXR/Lab 3종 모두 보유 → 멀티모달 교차분석 전제조건 충족
2. **인력 부족 문제**: 야간/주말 전문의 공백 → AI 보조의 가치가 가장 큼
3. **의사결정 시간 단축**: 중증 환자 판별 지연 문제가 실제로 발생하는 구간
4. **확장성**: 전국 지역응급의료센터 254개소 → 시장 규모 확보

### 1.4 근거 자료 출처

| 출처 | 내용 | 활용 |
|---|---|---|
| 중앙응급의료센터 (NEMC) | 응급의료 통계연보 | 병원등급별 체류시간, 전원율 |
| 건강보험심사평가원 (HIRA) | 응급의료 적정성 평가 | 2차 병원 진단지연 수치 |
| NEDIS | 국가응급진료정보망 | 실시간 병상, ESI/KTAS 분포 |
| 대한응급의학회지 | 전문의 부족 관련 논문 | 야간 AI 보조 필요성 |
| 보건복지부 | 응급의료기관 평가 결과 | 인력 기준 미달 현황 |

### 1.5 발표용 프레이밍

> "3차 병원은 이미 전문의가 충분하고, 1차 병원은 장비가 없다.
> **2차 병원(지역응급의료센터 254개소)은 장비는 갖추었으나
> 야간/주말 전문의 부재율이 30% 이상**으로,
> AI 보조 진단의 임상적 가치가 가장 큰 곳이다."

---

## 2. 프론트엔드 페이지 설계

### 2.1 전체 페이지 흐름

```
/triage → /dashboard/{id} → /report/{id}
 (간호사)      (의사 메인)      (최종 소견서)
```

### 2.2 페이지별 기능

#### 2.2.1 `/triage` — 간호사 트리아지 입력

| 영역 | 기능 | 상세 |
|---|---|---|
| 환자 기본 정보 | 이름, 나이, 성별, 도착시각 | 필수, 자동 ID 생성 |
| 주증상 | 자유텍스트 + 자동완성 | "CP", "SOB" 등 약어 자동 확장 |
| KTAS 중증도 | 1~5단계 선택 | 색상 코딩 |
| 바이탈 | BP, HR, RR, SpO2, BT | 이상치 하이라이트 |
| 과거력 | 체크박스 (HTN, DM, CAD 등) | 상위 10개 + 기타 |
| **[AI 분석 시작]** | → /dashboard/{id} 이동 | Bedrock Agent 1차 라우팅 |

#### 2.2.2 `/dashboard/{id}` — 의사 메인 작업 화면 (핵심)

**레이아웃 구조**:
```
┌─────────────────────────────────────────────────────┐
│  PatientBanner (환자 정보 + KTAS + 경과시간 타이머)      │
├──────────┬──────────────────────────────────────────┤
│ 모달      │   메인 콘텐츠 영역                          │
│ 타임      │   (선택된 모달의 상세 결과)                    │
│ 라인      │                                          │
│ (좌측)    ├──────────────────────────────────────────┤
│          │   AI 종합 소견 + 다음 행동 가이드              │
├──────────┴──────────────────────────────────────────┤
│  액션 푸터 (추가 검사 / 최종 리포트 / 전문의 협진)          │
└─────────────────────────────────────────────────────┘
```

**좌측 모달 타임라인 상태**:

| 상태 | 아이콘 | 색상 | 의미 |
|---|---|---|---|
| 완료 | ✅ | 초록 | 결과 확인 가능 |
| 분석 중 | 🔄 | 파랑(애니메이션) | API 호출 중 |
| 업로드 대기 | ⏳ | 주황 | 의사 액션 필요 |
| 대기 | 🔒 | 회색 | 선행 모달 완료 후 |
| 경고 | ⚠️ | 빨강 | Critical 소견 발견 |

**탭별 기능**:

**ECG 탭** (기존 구현 + 개선):
- 12-Lead 파형 (이상 리드 하이라이트)
- Rhythm Strip (Lead II 애니메이션)
- Vitals (HR, 리듬, 감지질환 수, 추론시간)
- Findings 테이블 (severity, confidence, recommendation)
- 24개 질환 확률 차트
- ECG→Lab 교차 힌트 (NEW)

**Lab 탭** (신규):
- 검사 수치 입력 폼 (15개 항목)
- Rule Engine Critical Flags 배너
- Complaint Profile 해석
- Lab Summary 테이블 (수치 + 참조범위 + 상태)
- **6시간 악화 예측** (XGBoost 5개 모델)
- 교차검증 힌트

**CXR 탭** (신규):
- 이미지 업로드 (드래그&드롭, DICOM/JPG/PNG)
- 원본 + 세그멘테이션 오버레이 (폐/심장)
- 측정값 카드 (CTR, CP angle, 폐면적비, 종격동폭)
- 6개 질환 탐지 결과
- FINDINGS + IMPRESSION 판독문

**Note RAG 탭** (신규):
- 유사 사례 3~5건
- 사례 상세 (구조화 텍스트)
- 유사도 점수
- 감별진단 제안

**AI 종합 판단 패널** (하단 고정):
- Risk Level (CRITICAL/URGENT/ROUTINE)
- 종합 소견 (멀티모달 통합)
- 권고 조치 (번호 리스트)
- [최종 리포트 생성] 버튼

#### 2.2.3 `/report/{id}` — 최종 소견서

| 영역 | 기능 |
|---|---|
| 환자 정보 헤더 | 이름, ID, 나이/성별, 내원시각, 주증상 |
| 모달별 핵심 소견 | ECG/Lab/CXR/RAG 각 2-3줄 |
| AI 종합 판단 | Risk Level + 종합 소견 |
| 권고 조치 | 번호 리스트 |
| **의사 수정 영역** | textarea — AI 소견 수정/추가 |
| 감별진단 체크리스트 | AI 제안 + 의사 추가 |
| **[최종 서명]** | 확정, 이후 수정 불가 |
| 서명 완료 배너 | "Dr. OOO 확인 완료 - 시각" |

### 2.3 필요한 신규 컴포넌트

```
src/
├── pages/
│   ├── TriagePage.tsx          (신규)
│   ├── DashboardPage.tsx       (대폭 개편)
│   └── ReportPage.tsx          (신규)
├── components/
│   ├── ModalTimeline.tsx       (신규 - 좌측 스텝퍼)
│   ├── CriticalAlert.tsx       (신규 - 상단 긴급 배너)
│   ├── LabInputForm.tsx        (신규)
│   ├── LabResultPanel.tsx      (신규)
│   ├── LabPredictionBar.tsx    (신규 - 6시간 악화)
│   ├── CXRUploader.tsx         (신규)
│   ├── CXRResultPanel.tsx      (신규)
│   ├── CXRSegOverlay.tsx       (신규)
│   ├── NoteRAGPanel.tsx        (신규)
│   ├── IntegratedSummary.tsx   (신규 - 종합 판단)
│   ├── CrossModalHint.tsx      (신규 - 교차검증)
│   └── DoctorSignature.tsx     (신규 - 최종 서명)
└── types/
    ├── ecg.ts (기존)
    ├── lab.ts (신규)
    ├── cxr.ts (신규)
    └── common.ts (신규)
```

---

## 3. 중앙 백엔드 로직 분석

### 3.1 기술 스택

- **FastAPI + Uvicorn** (Python 3)
- **FHIR 서버 연동**: HAPI FHIR (HTTP 기반, async httpx)
- **AWS Bedrock Claude 3.5 Sonnet**: ICD-10 매핑 전용
- **SageMaker**: ECG/CXR 추론 엔드포인트
- **WebSocket**: 실시간 이벤트 브로드캐스트

### 3.2 현재 구현된 API

| 엔드포인트 | 역할 |
|---|---|
| `POST /triage/submit` | 트리아지 접수 → FHIR 리소스 생성 → 모달 추천 |
| `POST /orders/{sr_id}/approve` | 검사 승인 → 백그라운드 모달 실행 |
| `POST /orders/{sr_id}/reject` | 검사 기각 → 다음 모달 재추천 |
| `GET /encounters/{id}/*` | 환자 데이터 조회 |
| `WS /ws/encounter/{id}` | 실시간 이벤트 수신 |

### 3.3 오케스트레이션 로직

**`FusionDecisionEngine`** — 하드코딩 룰 엔진 (Bedrock Agent 아님)

**주호소 → 모달리티 매핑**:
```python
CHIEF_COMPLAINT_MODALITY_MAP = {
    'chest pain': ['CXR', 'ECG'],
    'shortness of breath': ['CXR', 'ECG'],
    'abdominal pain': ['LAB', 'CXR'],
    'fever': ['LAB', 'CXR'],
    'trauma': ['CXR', 'LAB'],
    'altered mental status': ['LAB', 'ECG'],
    'syncope': ['ECG', 'LAB'],
    'headache': ['LAB'],
    'weakness': ['LAB', 'ECG']
}
```

**의사결정 플로우**:
1. 주호소 매칭 → 초기 모달리티 선정
2. 고위험 패턴 감지 (CXR+LAB, CXR+ECG, ECG+LAB 조합)
3. 신뢰도 체크 (confidence < 0.60 → 추가 모달)
4. 소견 기반 제안 (Cardiomegaly → ECG, ST elevation → LAB)
5. 복잡도 체크 (≥2 모달에서 이상 → NEED_REASONING)
6. 최대 3 iteration 제한

### 3.4 WebSocket 이벤트

| 이벤트 | 용도 |
|---|---|
| `initial_proposals` | 트리아지 완료 후 첫 모달 제안 |
| `modal_completed` | 모달 분석 완료 |
| `modal_failed` | 모달 실행 실패 |
| `new_proposal` | 재기각 후 새 제안 |
| `ready_for_report` | 모든 모달 완료 → 리포트 생성 가능 |
| `agent_error` | 에이전트 오류 |

### 3.5 미구현 기능 (Final까지 추가 필요)

| 기능 | 현황 | 필요 조치 |
|---|---|---|
| CXR 업로드 API | ❌ S3 URL 하드코딩 | `POST /encounters/{id}/cxr/upload` 구현 |
| Lab 수치 입력 API | ❌ SageMaker만 있음 | `POST /encounters/{id}/lab/submit` 구현 |
| AI 종합 소견 API | ❌ 별도 Lambda만 존재 | `POST /reports/{id}/generate` 구현 |
| 인증/권한 | ❌ 없음 | JWT 기반 의사 로그인 추가 |
| 감사 로깅 | ❌ 없음 | AuditEvent 자동 생성 |

---

## 4. 데이터베이스 아키텍처

### 4.1 최종 선택: HAPI FHIR + AWS RDS PostgreSQL

### 4.2 3-Layer 구조

```
┌─────────────┐
│  프론트엔드   │   React (CloudFront + S3)
└──────┬──────┘
       │ HTTPS
       ▼
┌─────────────┐
│  중앙백엔드   │   FastAPI (ECS Fargate)
│  (관제탑)    │   - 프론트와 통신
│             │   - 비즈니스 로직
└──────┬──────┘   - AI 라우팅
       │ HTTP + Basic Auth
       ▼
┌─────────────┐
│  HAPI FHIR  │   Java 오픈소스 서버 (ECS Fargate)
│  (번역기)    │   - FHIR 표준 → SQL 번역
│             │   - 상태머신 검증
└──────┬──────┘   - 검색/버전관리
       │ JDBC
       ▼
┌─────────────┐
│ RDS         │   AWS 관리형 DB
│ PostgreSQL  │   - 실제 데이터 저장
│ (실제 금고)   │   - 암호화, 백업
└─────────────┘
```

### 4.3 각 컴포넌트 역할

| 컴포넌트 | 정체 | 우리가 만드는가? |
|---|---|---|
| 중앙백엔드 | FastAPI 코드 | ✅ 직접 작성 |
| HAPI FHIR | 오픈소스 Docker 이미지 | ❌ 그대로 사용 |
| RDS PostgreSQL | AWS 관리형 서비스 | ❌ AWS가 운영 |

### 4.4 저장되는 FHIR 리소스

| 리소스 | 용도 | 생성 시점 |
|---|---|---|
| `Patient` | 환자 기본 정보 | 트리아지 접수 |
| `Encounter` | 응급실 방문 1건 | 트리아지 접수 |
| `Observation` | 바이탈, ECG/CXR/Lab 결과 | 검사 완료 시 |
| `Condition` | 주증상, 과거력, 진단 | 트리아지 + 리포트 |
| `ServiceRequest` | 검사 오더 (draft→active→completed) | AI 추천 시 |
| `DocumentReference` | CXR 이미지 S3 링크 | 이미지 업로드 |
| `DiagnosticReport` | 최종 소견서 (preliminary→final) | 리포트 생성/서명 |

### 4.5 데이터 흐름 예시 (트리아지 1건)

```
1. POST /triage/submit
   프론트 → 중앙백엔드
   Body: {patient, vitals, chief_complaint}

2. 중앙백엔드가 FHIR JSON 변환 후 순차 호출
   POST http://hapi-fhir:8080/fhir/Patient        → Patient 생성
   POST http://hapi-fhir:8080/fhir/Encounter      → Encounter 생성
   POST http://hapi-fhir:8080/fhir/Observation ×6 → 바이탈 저장
   POST http://hapi-fhir:8080/fhir/Condition      → 주증상 저장
   POST http://hapi-fhir:8080/fhir/ServiceRequest → 검사 오더 draft

3. HAPI FHIR가 SQL로 번역해 RDS에 저장
   INSERT INTO HFJ_RESOURCE ...
   INSERT INTO HFJ_RES_VER ...
   INSERT INTO HFJ_SPIDX_STRING ...

4. 응답 역방향 반환
   RDS → HAPI FHIR → 중앙백엔드 → 프론트

5. 프론트 최종 응답
   {
     "patient_id": "1234",
     "encounter_id": "5678",
     "proposed_modalities": ["CXR", "ECG"],
     "service_request_ids": ["sr-1", "sr-2"]
   }
```

### 4.6 핵심 개념: "우리는 SQL을 짜지 않는다"

```python
# ❌ 일반 백엔드 방식 (우리는 안 함)
cursor.execute("INSERT INTO patients (name, age) VALUES (?, ?)", ...)

# ✅ 우리 방식: FHIR 리소스를 POST
await httpx.post(
    "http://hapi-fhir:8080/fhir/Patient",
    json={"resourceType": "Patient", "gender": "male", ...}
)
```

HAPI FHIR가 자동으로:
- 환자 검색 (`?name=홍길동&birthdate=1978`) 제공
- 상태 전이 검증 (draft→active만 허용)
- 의료 표준 코드 (ICD-10, LOINC) 내장
- 리소스 버전 관리
- FHIR R4 표준 준수

### 4.7 비용 예상 (데모 규모)

| 서비스 | 사양 | 월 비용 |
|---|---|---|
| RDS PostgreSQL | db.t3.micro, 20GB | ~$15 |
| HAPI FHIR (ECS Fargate) | 0.5 vCPU, 1GB | ~$15 |
| 중앙백엔드 (ECS Fargate) | 0.5 vCPU, 1GB | ~$15 |
| ALB | 1개 | ~$20 |
| **합계** | | **~$65/월** |

---

## 5. 보안 설계

### 5.1 HAPI FHIR 기본 보안 수준

**결론: 기본 상태는 보안 취약** → 반드시 인프라 레벨 보완 필요

- 기본 설정: 누구나 `GET /fhir/Patient`로 모든 환자 조회 가능
- 현재 코드: `FHIR_BASE_URL`만 있고 인증 정보 없음

### 5.2 3-Layer 보안 전략

#### Layer 1: 네트워크 격리 (가장 중요)

**Security Group 구성**:
```
HAPI FHIR Security Group:
  Inbound: 8080 포트 ← 중앙백엔드 SG만 허용
  Outbound: RDS SG로만

RDS Security Group:
  Inbound: 5432 포트 ← HAPI FHIR SG만 허용
  Outbound: 없음
```

**결과**: 외부 공격자가 HAPI FHIR나 RDS에 직접 접근 불가능

#### Layer 2: 인증/인가

HAPI FHIR Basic Auth 활성화:
```yaml
# HAPI FHIR application.yaml
hapi:
  fhir:
    basic_auth:
      enabled: true
      username: ${HAPI_USER}
      password: ${HAPI_PASSWORD}
```

중앙백엔드 코드 수정:
```python
# fhir/client.py
async with httpx.AsyncClient(
    auth=(FHIR_USER, FHIR_PASSWORD)  # Basic Auth
) as client:
    response = await client.post(url, json=body)
```

자격증명은 **AWS Secrets Manager**에 저장:
```
AWS Secrets Manager
  └─ drai/fhir-credentials
     ├─ username: admin
     └─ password: (32자 자동 생성)
```

#### Layer 3: 암호화

| 구간 | 방식 |
|---|---|
| 사용자 ↔ CloudFront | HTTPS (ACM 인증서) |
| 프론트 ↔ 중앙백엔드 | HTTPS (ALB + ACM) |
| 중앙백엔드 ↔ HAPI FHIR | Basic Auth + 내부 TLS |
| HAPI FHIR ↔ RDS | TLS + 디스크 암호화 (KMS) |
| 중앙백엔드 ↔ Bedrock/SageMaker | IAM Role + HTTPS |

**RDS 암호화**: 생성 시 "Encryption enabled" 체크박스 한 번으로 AES-256 적용

### 5.3 의료 데이터 특화 보안

| 요구사항 | HAPI FHIR 대응 |
|---|---|
| 접근 로그 | Interceptor 기능으로 모든 API 호출 로깅 |
| 감사 추적 | FHIR AuditEvent 리소스 자동 생성 |
| 버전 관리 | `_history` 엔드포인트로 모든 수정 이력 |
| 삭제 불가 | 기본: Soft Delete (deleted 마킹만) |
| 최소 권한 | 역할별 접근 제어 구현 가능 |

### 5.4 최소 보안 체크리스트 (데모/발표용)

- [ ] HAPI FHIR를 **VPC Private Subnet**에 배치
- [ ] **Security Group**으로 중앙백엔드만 HAPI 접근 허용
- [ ] **RDS 암호화** 활성화
- [ ] HAPI FHIR **Basic Auth** 활성화
- [ ] **AWS Secrets Manager**에 credentials 저장
- [ ] 프론트 ↔ 중앙백엔드 **HTTPS** (ACM 인증서)

### 5.5 프로덕션 추가 보안 (Final 이후)

- [ ] SMART on FHIR OAuth2 (의사별 인증)
- [ ] HAPI AuditEvent Interceptor 활성화
- [ ] WAF (Web Application Firewall)
- [ ] VPC Flow Logs
- [ ] CloudTrail
- [ ] RDS Multi-AZ 이중화
- [ ] 자동 백업 (7일 이상)
- [ ] GuardDuty 침해 탐지

### 5.6 최종 AWS 아키텍처

```
┌─────────────────────────────────────────────────────┐
│ 인터넷                                                │
└──────────────────────┬──────────────────────────────┘
                       │ HTTPS (443)
                       ▼
┌─────────────────────────────────────────────────────┐
│  CloudFront + WAF                                   │
│  - DDoS 방어, SQL Injection 차단                      │
└──────────────────────┬──────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────┐
│  VPC (서울 리전)                                      │
│                                                     │
│  ┌── Public Subnet ──────────────────────┐          │
│  │  ALB (HTTPS, ACM 인증서)                │          │
│  └───────────────┬──────────────────────┘          │
│                  │                                  │
│  ┌── Private Subnet (App) ─────────────────┐        │
│  │  ┌─────────┐        ┌──────────┐        │        │
│  │  │중앙백엔드 │───────▶│HAPI FHIR │        │        │
│  │  │ ECS     │Basic   │ ECS      │        │        │
│  │  │         │Auth    │          │        │        │
│  │  └─────────┘        └────┬─────┘        │        │
│  └────────────────────────────┼────────────┘        │
│                               │                     │
│  ┌── Private Subnet (DB) ─────┼────────────┐        │
│  │                            ▼            │        │
│  │                     ┌──────────┐        │        │
│  │                     │   RDS    │        │        │
│  │                     │암호화 활성 │        │        │
│  │                     └──────────┘        │        │
│  └──────────────────────────────────────────┘        │
│                                                     │
│  + Secrets Manager: 자격증명 관리                     │
│  + CloudWatch: 로그 수집                              │
│  + S3: 이미지/파형 자산                                │
│  + SageMaker: ECG/CXR 추론                          │
│  + Bedrock: Claude 종합 소견                         │
└─────────────────────────────────────────────────────┘
```

---

## 6. 배포 로드맵

### 6.1 단계별 작업 계획

| 단계 | 작업 | 담당 | 상태 |
|---|---|---|---|
| 1 | 프론트 UI/UX 설계 | 프론트팀 | 진행 중 |
| 2 | 프론트 컴포넌트 구현 | 프론트팀 | 대기 |
| 3 | 백엔드 추가 API 3개 구현 | 백엔드팀 | 대기 |
| 4 | HAPI FHIR Docker 이미지 준비 | DevOps | 대기 |
| 5 | AWS 인프라 프로비저닝 (VPC/RDS/ECS) | DevOps | 대기 |
| 6 | 보안 설정 (Security Group, Secrets) | DevOps | 대기 |
| 7 | 통합 테스트 (E2E) | 전팀 | 대기 |
| 8 | 데모 환경 배포 | DevOps | 대기 |

### 6.2 백엔드 추가 필요 API

1. **`POST /encounters/{id}/cxr/upload`**
   - 이미지 업로드 + S3 저장 + CXR 서비스 호출 + FHIR Observation 저장

2. **`POST /encounters/{id}/lab/submit`**
   - Lab 수치 입력 + Rule Engine 호출 + 6시간 악화 예측 + FHIR Observation 저장

3. **`POST /reports/{encounter_id}/generate`**
   - 모든 모달 결과 aggregation + Bedrock Claude 종합 소견 + DiagnosticReport 생성

### 6.3 프론트 개발 우선순위

1. **Phase 1 (Week 1)**: TriagePage, DashboardPage 레이아웃, ModalTimeline
2. **Phase 2 (Week 2)**: Lab 탭, CXR 탭, NoteRAG 탭
3. **Phase 3 (Week 3)**: IntegratedSummary, ReportPage, DoctorSignature
4. **Phase 4 (Week 4)**: 통합 테스트, 버그 수정, 데모 시나리오

### 6.4 발표 강조 포인트

1. **타깃 명확성**: 2차 병원 (지역응급의료센터) — 임상 수요 구체화
2. **FHIR 표준 준수**: 실제 의료 현장 연동 가능성
3. **AWS 클라우드 네이티브**: RDS + ECS + Bedrock + SageMaker
4. **보안**: VPC 격리 + 암호화 + Secrets Manager
5. **멀티모달 통합**: ECG + CXR + Lab + RAG → AI 종합 판단
6. **XAI**: 설명 가능한 AI (Rule Engine + Findings + 판독문)

---

## 부록: 주요 참고 자료

### 기술 문서
- [DB-Architecture.md](DB-Architecture.md)
- [Infra-Architecture.md](Infra-Architecture.md)
- [Blood-Modal-Design.md](Blood-Modal-Design.md)
- [ECG-Modal-Pipeline-Overview.md](ECG-Modal-Pipeline-Overview.md)

### 외부 참조
- HAPI FHIR: https://hapifhir.io
- FHIR R4 Spec: https://hl7.org/fhir/R4
- AWS RDS PostgreSQL: https://aws.amazon.com/rds/postgresql
- AWS HealthLake: https://aws.amazon.com/healthlake

### 데이터셋
- MIMIC-IV: https://physionet.org/content/mimiciv
- MIMIC-CXR: https://physionet.org/content/mimic-cxr
- MIMIC-ECG: https://physionet.org/content/mimic-iv-ecg

---

**문서 버전**: v1.0
**최종 수정**: 2026-04-23
**작성**: 6팀 프로젝트 설계 정리
