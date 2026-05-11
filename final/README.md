# Emergency Multimodal Diagnostic Orchestrator - ML Integrated

> **ML 기반 의사결정 엔진**과 **RAG 기반 리포트 생성**을 통합한 응급 진단 보조 시스템

[![AWS](https://img.shields.io/badge/AWS-Serverless-orange)](https://aws.amazon.com/)
[![Python](https://img.shields.io/badge/Python-3.12-blue)](https://www.python.org/)
[![ML](https://img.shields.io/badge/ML-LightGBM-green)](https://lightgbm.readthedocs.io/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

---

## 🎯 프로젝트 개요

### 핵심 목적
- 🚑 **응급 환자의 골든타임 확보**: ML 기반 능동적 검사 선택으로 진단 시간 단축
- 👨‍⚕️ **의료진 간 경력 편차 최소화**: 데이터 기반 AI 의사결정 지원
- 🔬 **멀티모달 진단 보조**: CXR, ECG, Blood Lab 통합 분석
- 📋 **자동 소견서 생성**: RAG 기반 임상 리포트 자동 생성

### 주요 특징
- ⭐ **ML 기반 의사결정**: MIMIC-IV 데이터로 학습된 LightGBM 모델 (8개)
- 🧠 **데이터 기반 접근**: 하드코딩된 규칙 없이 순수 데이터 기반 예측
- 🔄 **적응형 워크플로우**: 환자 상태에 따라 동적으로 검사 선택
- 📚 **RAG 기반 리포트**: MIMIC-NOTE 유사 케이스 참조로 품질 향상

---

## 🏗️ 시스템 아키텍처

```
┌─────────────────────────────────────────────────────────────────┐
│                    Client (React Frontend)                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │  FastAPI Backend │
                    │  (Port 8000)     │
                    └────────┬────────┘
                             │
        ┌────────────────────┼────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ ML Decision  │    │ Modal Services│    │ RAG System   │
│ Engine       │    │ (ECG/CXR/LAB)│    │ (ChromaDB)   │
│ (LightGBM)   │    │               │    │              │
└──────────────┘    └──────────────┘    └──────────────┘
        │                    │                    │
        └────────────────────┼────────────────────┘
                             │
                             ▼
                    ┌─────────────────┐
                    │ FHIR Server     │
                    │ (HAPI FHIR)     │
                    └─────────────────┘
```

---

## 📊 ML 모델 구조

### Initial Decision Models (초기 결정 - 3개)
환자가 처음 도착했을 때 어떤 검사를 먼저 할지 결정

| 모델 | 목적 | Positive Rate |
|------|------|---------------|
| `order_ecg` | ECG 검사 필요 여부 | 0.3% |
| `order_cxr` | CXR 검사 필요 여부 | 0.4% |
| `order_lab` | LAB 검사 필요 여부 | 3.0% |

### Follow-up Decision Models (후속 결정 - 5개)
검사 결과를 보고 다음 행동을 결정

| 모델 | 목적 | Positive Rate |
|------|------|---------------|
| `order_ecg` | 추가 ECG 필요 | 0.3% |
| `order_cxr` | 추가 CXR 필요 | 0.4% |
| `order_lab` | 추가 LAB 필요 | 1.9% |
| `stop` | 검사 중단 (충분한 정보) | 39% |
| `need_reasoning` | LLM 추론 필요 (복잡한 케이스) | 46% |

### 모델 특징
- **알고리즘**: LightGBM (Gradient Boosting)
- **학습 데이터**: MIMIC-IV Emergency Department 데이터
- **피처**: 환자 정보, 바이탈 사인, 랩 결과, Chief Complaint
- **평가 지표**: AUC (Primary), F1 Score (Secondary)
- **클래스 불균형 처리**: scale_pos_weight 자동 계산

---

## 🚀 빠른 시작

### Prerequisites

```bash
# 필수 도구
- Docker & Docker Compose
- Python 3.12+
- AWS CLI (배포 시)

# 설치 확인
docker --version
docker-compose --version
python --version
```

### 1. 로컬 실행

```bash
# 1. 레포 클론
cd final_integrated/central

# 2. Docker Compose 실행
cd infra
docker-compose up -d

# 3. 서비스 확인
docker-compose ps
```

**접속 URL:**
- Backend API: http://localhost:8000
- API Docs: http://localhost:8000/docs
- FHIR Server: http://localhost:8080/fhir
- PgWeb (DB GUI): http://localhost:8081

### 2. API 테스트

```bash
# 헬스체크
curl http://localhost:8000/health

# ML 모델 로드 확인
curl http://localhost:8000/ready

# 트리아지 제출
curl -X POST http://localhost:8000/triage/submit \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "P001",
    "chief_complaint": "chest pain",
    "age": 65,
    "gender": "M",
    "acuity": 2,
    "heartrate": 95,
    "sbp": 140,
    "dbp": 85
  }'
```

---

## 📁 프로젝트 구조

```
final_integrated/
├── central/                                # 중앙 오케스트레이터
│   ├── backend/                           # FastAPI 백엔드
│   │   ├── app/
│   │   │   ├── agent/                     # 오케스트레이터 모듈
│   │   │   │   ├── hybrid_decision_engine.py  # ⭐ ML 의사결정 엔진
│   │   │   │   ├── session_manager.py         # 환자 세션 관리
│   │   │   │   ├── models_stratified/         # ⭐ ML 모델 파일
│   │   │   │   │   ├── initial/              # 초기 결정 (3개)
│   │   │   │   │   └── followup/             # 후속 결정 (5개)
│   │   │   │   ├── orchestrator_utils/        # 유틸리티
│   │   │   │   │   ├── cc_map.py             # Chief Complaint 매핑
│   │   │   │   │   ├── feature_extractor.py  # ML 피처 추출
│   │   │   │   │   └── bedrock_reporter.py   # Bedrock 리포트
│   │   │   │   └── rag/                       # RAG 시스템
│   │   │   ├── api/                           # API 엔드포인트
│   │   │   ├── clients/                       # 외부 서비스 클라이언트
│   │   │   ├── db/                            # 데이터베이스
│   │   │   ├── fhir/                          # FHIR 연동
│   │   │   └── main.py                        # FastAPI 앱
│   │   ├── data/                              # 데이터 파일
│   │   ├── Dockerfile
│   │   └── requirements.txt
│   ├── deploy/                                # AWS Lambda 배포
│   ├── frontend/                              # React 프론트엔드
│   ├── infra/                                 # Docker Compose
│   ├── docs/                                  # 문서
│   └── tests/                                 # 테스트
└── README.md                                  # 이 파일
```

---

## 🔄 의사결정 흐름

### 1. 트리아지 단계
```python
POST /triage/submit
{
  "patient_id": "P001",
  "chief_complaint": "chest pain",
  "age": 65,
  "vitals": {...}
}
```

### 2. Initial Decision (초기 결정)
```
Chief Complaint: "chest pain"
↓
CC Map Prior: ["ECG", "CXR"]  # 데이터 기반 우선순위
↓
Initial ML Models 예측:
- order_ecg: 0.85 ⭐ (가장 높음)
- order_cxr: 0.72
- order_lab: 0.23
↓
Decision: ECG 검사 실행
```

### 3. Modal Execution (검사 실행)
```
ECG Service 호출
↓
결과: ST elevation detected (STEMI 의심)
↓
DB 저장 + FHIR 리소스 생성
```

### 4. Follow-up Decision (후속 결정)
```
Completed: [ECG]
Results: ST elevation
↓
Follow-up ML Models 예측:
- order_cxr: 0.78 ⭐
- order_lab: 0.65
- need_reasoning: 0.82 ⭐⭐ (가장 높음)
- stop: 0.15
↓
Decision: NEED_REASONING (복잡한 케이스)
```

### 5. LLM Reasoning (Bedrock)
```
Bedrock Claude Sonnet 4.5
↓
입력:
- Patient: 65세 남성, chest pain
- ECG: ST elevation
- Vitals: HR 95, BP 140/85
↓
출력: "Acute STEMI 의심, 즉시 심혈관 중재 필요"
```

### 6. Report Generation (RAG)
```
RAG System (ChromaDB)
↓
유사 케이스 검색 (MIMIC-NOTE)
↓
Bedrock로 최종 리포트 생성
↓
FHIR DiagnosticReport 생성
```

---

## 🧩 주요 컴포넌트

### 1. HybridDecisionEngine
**역할**: ML 기반 의사결정 엔진

```python
from app.agent.hybrid_decision_engine import HybridDecisionEngine

engine = HybridDecisionEngine(
    patient=patient_data,
    modalities_completed=['ECG'],
    inference_results=[ecg_result],
    iteration=1,
    ml_models_initial=initial_models,
    ml_models_followup=followup_models
)

decision = engine.decide()
# {
#   'decision': 'NEED_REASONING',
#   'rationale': 'ML: need_reasoning (82%) - complex case',
#   'risk_level': 'high',
#   'ml_scores': {...}
# }
```

### 2. SessionManager
**역할**: 환자 세션 관리 및 오케스트레이션 루프

```python
from app.agent.session_manager import SessionManager

manager = SessionManager()
session = manager.create_session(patient_id, patient_data)

# 모달 결과 추가
manager.add_inference_result(patient_id, ecg_result)

# 다음 결정
decision = manager.get_next_decision(patient_id)
```

### 3. RAG System
**역할**: 유사 케이스 검색 및 리포트 생성

```python
from app.agent.rag import RAGRetriever, RAGGenerator

retriever = RAGRetriever()
similar_cases = retriever.search(query, top_k=5)

generator = RAGGenerator()
report = generator.generate(patient_data, similar_cases)
```

---

## 📊 성능 지표

### ML 모델 성능 (Test Set)

| 모델 | AUC | F1 Score | Precision | Recall |
|------|-----|----------|-----------|--------|
| Initial: order_ecg | 0.92 | 0.45 | 0.78 | 0.32 |
| Initial: order_cxr | 0.91 | 0.42 | 0.75 | 0.30 |
| Initial: order_lab | 0.88 | 0.58 | 0.72 | 0.48 |
| Follow-up: stop | 0.85 | 0.76 | 0.81 | 0.72 |
| Follow-up: need_reasoning | 0.83 | 0.74 | 0.79 | 0.70 |

### 시스템 성능
- **평균 응답 시간**: < 2초 (ML 예측)
- **모달 호출 시간**: 3-5초 (외부 서비스)
- **리포트 생성 시간**: 5-8초 (RAG + Bedrock)
- **전체 워크플로우**: 15-30초 (케이스에 따라)

---

## 🔧 환경 설정

### 필수 환경변수

```bash
# FHIR 서버
FHIR_BASE_URL=http://hapi-fhir:8080/fhir

# 운영 DB
OPS_DB_URL=postgresql://admin:secret@postgres:5432/central_db

# 모달 서비스 (EC2 IP)
ECG_SERVICE_URL=http://52.79.251.216:8003
CXR_SERVICE_URL=http://52.79.251.216:8002
LAB_SERVICE_URL=http://52.79.251.216:8000

# AWS Bedrock
AWS_REGION=ap-northeast-2
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6

# ML 모델 경로
ML_MODELS_INITIAL_DIR=./app/agent/models_stratified/initial
ML_MODELS_FOLLOWUP_DIR=./app/agent/models_stratified/followup
```

---

## 📚 문서

| 문서 | 설명 | 대상 |
|------|------|------|
| **[INTEGRATION_COMPLETE.md](central/INTEGRATION_COMPLETE.md)** | 통합 완료 보고서 | 전체 |
| [QUICKSTART.md](central/QUICKSTART.md) | 5분 안에 시작하기 | 처음 사용자 |
| [DEPLOYMENT.md](central/DEPLOYMENT.md) | 상세 배포 가이드 | DevOps |
| [docs/ARCHITECTURE.md](central/docs/ARCHITECTURE.md) | 시스템 아키텍처 | 개발자 |
| [docs/DECISION_LOGIC.md](central/docs/DECISION_LOGIC.md) | ML 의사결정 로직 | ML 엔지니어 |
| [docs/UPGRADE_GUIDE.md](central/docs/UPGRADE_GUIDE.md) | ML 모델 업그레이드 | ML 엔지니어 |

---

## 🧪 테스트

### 단위 테스트
```bash
cd central/backend
pytest tests/
```

### 통합 테스트
```bash
cd central/tests
python local_test.py
python full_workflow_simulation.py
```

### API 테스트
```bash
# Postman Collection
central/tests/postman_collection.json
```

---

## 🚢 배포

### Docker Compose (로컬/개발)
```bash
cd central/infra
docker-compose up -d
```

### AWS Lambda (프로덕션)
```bash
cd central/deploy
./scripts/deploy.sh
```

자세한 내용은 [DEPLOYMENT.md](central/DEPLOYMENT.md) 참조

---

## 🤝 기여

### 팀원
- 원정아
- 박현우
- 홍경태
- 양정인
- 이정인

### 기여 방법
1. Fork the repository
2. Create your feature branch
3. Commit your changes
4. Push to the branch
5. Create a Pull Request

---

## 📄 라이선스

MIT License - 자세한 내용은 [LICENSE](LICENSE) 참조

---

## 🙏 감사의 말

- **MIMIC-IV**: 학습 데이터 제공
- **AWS**: 인프라 및 Bedrock 서비스
- **LightGBM**: ML 프레임워크
- **FastAPI**: 백엔드 프레임워크
- **HAPI FHIR**: FHIR 서버

---

## 📞 문의

프로젝트 관련 문의사항은 이슈를 등록해주세요.

---

**Last Updated**: 2026-05-11  
**Version**: 1.0.0 (ML Integrated)  
**Status**: ✅ Production Ready
