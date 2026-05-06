# AWS 아키텍처 팀원별 공부 분담표

> 기준: AWS 아키텍처 설계 리포트 기반, 3명 분담
> 목표: 각자 맡은 영역을 공부 → 팀 내 발표/공유 → 전체 이해도 확보

---

## 분담 개요

```
팀원 A: 컴퓨팅 + AI 서비스     ← "모델이 어떻게 돌아가는가"
팀원 B: 네트워킹 + 보안         ← "데이터가 어떻게 보호되는가"
팀원 C: 데이터베이스 + 모니터링  ← "데이터가 어디에 어떻게 저장되는가"
```

---

## 팀원 A: 컴퓨팅 + AI 서비스

> 핵심 질문: "환자 데이터가 들어오면 AI가 어떤 경로로 추론하고 결과를 돌려주는가?"

### 담당 범위

| 카테고리 | 공부할 서비스 |
|----------|-------------|
| 컴퓨팅 | ECS Fargate, Lambda, CloudFront |
| AI 서비스 | SageMaker Endpoint (GPU/CPU), Amazon Bedrock (Claude) |
| 스토리지 | S3 (모델 가중치, 파형/이미지 저장), ECR |

### 공부 항목 체크리스트

**ECS Fargate**
- [ ] ECS vs EC2 차이, Fargate가 서버리스인 이유
- [ ] Task Definition, Service, Cluster 개념
- [ ] 중앙백엔드(FastAPI)와 HAPI FHIR이 각각 별도 서비스로 돌아가는 구조
- [ ] 헬스체크 경로 (`/health`) 설정 방법
- [ ] 오토스케일링 (최소 태스크 2개 이상)

**Lambda**
- [ ] Lambda가 Bedrock Agent ↔ SageMaker 사이에서 프록시 역할하는 이유
- [ ] Agent Action Group + OpenAPI 스키마 등록 흐름
- [ ] 콜드스타트 문제와 Provisioned Concurrency
- [ ] 모달별 Lambda 3개 (ECG/CXR/Lab) 각각의 입출력

**SageMaker Endpoint**
- [ ] model.tar.gz 패키징 구조 (model.pt + inference.py + requirements.txt)
- [ ] GPU 인스턴스(ml.g4dn.xlarge) vs CPU 인스턴스(ml.t3.medium) 선택 기준
- [ ] 실시간 Endpoint vs Serverless Endpoint 차이
- [ ] ECG/CXR는 GPU 필수(~0.5초), Lab은 CPU 충분(~0.1초)인 이유
- [ ] Auto Scaling 정책 설정

**Amazon Bedrock**
- [ ] Bedrock Agent 개념 — 3개 모달을 "tool"로 등록하는 구조
- [ ] Claude 3.5 Sonnet이 오케스트레이터 역할 (어떤 모달을 호출할지 판단)
- [ ] ICD-10 매핑 + 종합 소견 생성 흐름
- [ ] 호출당 과금 구조

**S3 + ECR**
- [ ] S3 버킷 구조 (ecg/waveforms/, cxr/images/, lab/model/, models/)
- [ ] ECR에 Docker 이미지 푸시 → ECS에서 풀하는 흐름
- [ ] S3 버전 관리 활성화 (의료 이미지 삭제 방지)

### 발표 시 설명할 수 있어야 하는 것

> "환자가 도착해서 트리아지 입력 → Bedrock Agent가 ECG 먼저 판단
> → Lambda가 SageMaker GPU Endpoint 호출 → 0.5초 만에 24개 질환 확률 반환
> → Agent가 결과 보고 Lab 추가 호출 → 최종 종합 소견 생성"
> 이 전체 흐름을 아키텍처 다이어그램 보면서 설명

### 참고 문서

- `Infra-Architecture.md` — 3개 배포 옵션 비교 (SageMaker vs Lambda vs EKS)
- `ECG-Modal-Pipeline-Overview.md` — ECG 모델 구조, inference.py
- `ECG-Training-Design.md` — 학습 파이프라인, S4 백본
- `Clinical-Report-Flow.md` — Bedrock Agent 판단 시나리오 4개

---

## 팀원 B: 네트워킹 + 보안

> 핵심 질문: "의료 데이터가 외부에 노출되지 않으려면 어떤 장치가 필요한가?"

### 담당 범위

| 카테고리 | 공부할 서비스 |
|----------|-------------|
| 네트워킹 | VPC, Subnet, ALB, NAT Gateway, VPC Endpoints, Route 53 |
| 보안 | IAM, KMS, Secrets Manager, ACM, WAF, Cognito, GuardDuty |
| 규정 준수 | 의료법, 개인정보보호법, SaMD 인허가 |

### 공부 항목 체크리스트

**VPC + Subnet**
- [ ] VPC가 뭔지, CIDR 블록 (10.0.0.0/16) 의미
- [ ] Public Subnet vs Private Subnet 차이
- [ ] 3-Tier 서브넷 구조: Public(ALB) → Private-App(ECS) → Private-DB(RDS)
- [ ] AZ-a, AZ-c 이중화 이유 (고가용성)

**ALB + NAT Gateway**
- [ ] ALB가 HTTPS 트래픽을 ECS로 라우팅하는 구조
- [ ] NAT Gateway가 Private Subnet의 아웃바운드를 처리하는 이유
- [ ] NAT Gateway AZ 이중화 필요성

**VPC Endpoints**
- [ ] Gateway Endpoint (S3, DynamoDB) vs Interface Endpoint (SageMaker, Bedrock) 차이
- [ ] VPC Endpoint가 없으면 트래픽이 인터넷을 경유하는 문제
- [ ] 비용 절감 + 보안 강화 동시 달성

**Security Group**
- [ ] SG 체이닝: ALB SG → 백엔드 SG → HAPI FHIR SG → RDS SG
- [ ] 최소 포트만 개방 원칙 (8000, 8080, 5432)
- [ ] Inbound/Outbound 규칙 설정

**IAM**
- [ ] ECS Task Role vs Execution Role 차이
- [ ] 최소 권한 원칙 — 각 서비스별 필요한 권한만 부여
- [ ] 모달별 Lambda에 개별 Role 부여하는 이유

**암호화 (KMS + ACM + Secrets Manager)**
- [ ] KMS 관리형 키로 S3/RDS 암호화
- [ ] ACM 인증서로 HTTPS 적용 (CloudFront, ALB)
- [ ] Secrets Manager에 HAPI FHIR 자격증명 저장
- [ ] 전 구간 End-to-End 암호화 흐름

**WAF + Cognito + GuardDuty**
- [ ] WAF 규칙 (SQL Injection, XSS, DDoS 방어)
- [ ] Cognito User Pool — 의사/간호사 역할 분리, JWT 발급
- [ ] GuardDuty 이상 행위 탐지

**의료법/규정 준수**
- [ ] 의료법 시행규칙 제15조 — 데이터 최소 5년 보존
- [ ] 개인정보보호법 제15조 — 환자 동의 절차
- [ ] 식약처 SaMD 가이드라인 — AI 의료기기 인허가
- [ ] 개인정보 영향평가(PIA) 개념

### 발표 시 설명할 수 있어야 하는 것

> "외부 공격자가 HAPI FHIR이나 RDS에 직접 접근할 수 없는 이유"를
> VPC 다이어그램 + Security Group 체이닝으로 설명
>
> "환자 데이터가 저장/전송되는 모든 구간에서 암호화되는 흐름"을
> End-to-End 암호화 표로 설명

### 참고 문서

- `Final-Project-Architecture.md` — 5장 보안 설계 (3-Layer 보안 전략)
- `AWS-Architecture-Checklist.md` — 2단계 보안 및 규정 준수 전체

---

## 팀원 C: 데이터베이스 + 모니터링

> 핵심 질문: "환자 데이터와 AI 결과가 어디에 어떤 형태로 저장되고, 문제가 생기면 어떻게 감지하는가?"

### 담당 범위

| 카테고리 | 공부할 서비스 |
|----------|-------------|
| 데이터베이스 | Aurora Serverless v2, DynamoDB, ElastiCache (Redis) |
| FHIR 표준 | HAPI FHIR 서버, FHIR R4 리소스 |
| 모니터링 | CloudWatch, CloudTrail, AWS Config, VPC Flow Logs |

### 공부 항목 체크리스트

**Aurora Serverless v2 (PostgreSQL)**
- [ ] Aurora Serverless v2가 일반 RDS와 다른 점 (자동 스케일링, 사용량 기반 과금)
- [ ] HAPI FHIR가 Aurora를 백엔드 DB로 사용하는 구조
- [ ] Multi-AZ 자동 페일오버 (~30초)
- [ ] 암호화 활성화 (KMS)
- [ ] 자동 백업 설정 (최소 7일)

**HAPI FHIR + FHIR R4**
- [ ] FHIR이 뭔지 — 의료 데이터 교환 표준
- [ ] 7개 핵심 리소스: Patient, Encounter, Observation, Condition, ServiceRequest, DocumentReference, DiagnosticReport
- [ ] 각 리소스가 언제 생성되는지 (트리아지 → 검사 → 리포트)
- [ ] "우리는 SQL을 짜지 않는다" — FHIR JSON POST → HAPI가 SQL 변환
- [ ] AuditEvent 리소스 — 접근 감사 로그
- [ ] `_history` 엔드포인트 — 버전 관리
- [ ] Soft Delete — 삭제 방지

**DynamoDB**
- [ ] PK(patient_id) + SK(result_id) 구조
- [ ] 모달별 결과 JSON이 스키마 없이 저장되는 유연성
- [ ] TTL 설정으로 오래된 결과 자동 삭제
- [ ] Bedrock Agent가 이전 모달 결과를 빠르게 조회하는 흐름

**ElastiCache (Redis)**
- [ ] WebSocket 세션 관리 — 다중 ECS 태스크 간 이벤트 공유
- [ ] Pub/Sub 패턴으로 실시간 이벤트 브로드캐스트
- [ ] 모달 완료/실패 이벤트가 프론트엔드에 전달되는 흐름

**CloudWatch**
- [ ] 로그 수집 (백엔드, HAPI FHIR, Lambda)
- [ ] 메트릭 (CPU, 메모리, 에러율)
- [ ] 알람 설정 기준:
  - SageMaker 5xx > 1%
  - ECS 태스크 실패
  - RDS CPU > 80%
  - Lambda 에러율 > 5%
  - ALB 5xx > 10건/분
- [ ] 로그 보존 기간 설정 (기본 무기한 → 비용 폭증 주의)

**CloudTrail**
- [ ] 모든 AWS API 호출 감사 로그
- [ ] 의료법 최소 3년 보관 → S3에 장기 저장
- [ ] 누가 언제 어떤 리소스에 접근했는지 추적

**AWS Config + VPC Flow Logs**
- [ ] AWS Config — Security Group 변경, 암호화 해제 등 구성 변경 추적
- [ ] VPC Flow Logs — 네트워크 트래픽 기록 (비정상 접근 탐지)

### 발표 시 설명할 수 있어야 하는 것

> "트리아지 1건이 접수되면 어떤 FHIR 리소스가 어떤 순서로 생성되는지"를
> 데이터 흐름 다이어그램으로 설명
>
> "SageMaker에서 5xx 에러가 터지면 CloudWatch 알람 → SNS → 슬랙 알림"
> 모니터링 파이프라인 설명

### 참고 문서

- `DB-Architecture.md` — Aurora + DynamoDB 설계
- `Final-Project-Architecture.md` — 4장 데이터베이스 아키텍처 (FHIR 리소스, 데이터 흐름)
- `Lab-svc/shared/schemas.py` — Lab 모달 입출력 스키마 (FHIR 매핑 이해용)

---

## 공통 필수 공부 (3명 모두)

아래 항목은 전체 아키텍처 이해를 위해 3명 모두 알아야 하는 내용:

| 항목 | 이유 |
|------|------|
| 전체 아키텍처 다이어그램 | 자기 영역이 전체에서 어디에 위치하는지 |
| 3-Tier 구조 (프론트 → 백엔드 → DB) | 데이터 흐름의 큰 그림 |
| 비용 예상표 (~$387/월) | 발표 시 비용 질문 대비 |
| 필수 체크리스트 (🔴 항목) | 배포 전 누락 방지 |
| 데모 시나리오 4개 (Clinical-Report-Flow.md) | 발표 시 시연 흐름 이해 |

---

## 공부 일정 제안

```
Day 1-2: 각자 담당 영역 문서 정독 + AWS 공식 문서 참고
Day 3:   각자 담당 영역 정리 (1인 5분 발표 자료)
Day 4:   팀 내 공유 세션 (각 15분 발표 + 5분 Q&A = 총 60분)
Day 5:   전체 아키텍처 다이어그램 보면서 통합 리뷰
```

---

## 요약 한눈에 보기

| | 팀원 A | 팀원 B | 팀원 C |
|--|--------|--------|--------|
| 키워드 | 컴퓨팅 + AI | 네트워크 + 보안 | DB + 모니터링 |
| 핵심 서비스 | ECS, Lambda, SageMaker, Bedrock | VPC, SG, IAM, KMS, WAF, Cognito | Aurora, DynamoDB, HAPI FHIR, CloudWatch |
| 핵심 질문 | AI가 어떻게 추론하는가? | 데이터가 어떻게 보호되는가? | 데이터가 어디에 저장되는가? |
| 발표 포인트 | 추론 흐름 전체 설명 | VPC 격리 + 암호화 흐름 | FHIR 리소스 생성 흐름 + 알람 |
| 참고 문서 | Infra-Architecture.md, ECG-*.md | Final-Project 5장, Checklist 2단계 | DB-Architecture.md, Final-Project 4장 |

---

**작성일**: 2026-04-28
