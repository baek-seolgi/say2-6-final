# 중앙 백엔드 오케스트레이터 통합 상태

## ✅ 완료된 작업

### 1. 파일 구조 정리
```
final/central/backend/
├── app/
│   ├── agent/                          # 오케스트레이터 모듈
│   │   ├── hybrid_decision_engine.py   # ML + 룰엔진 통합 의사결정 엔진
│   │   ├── session_manager.py          # 환자 세션 관리
│   │   ├── decision_engine.py          # 하위 호환성 alias
│   │   ├── orchestrator_utils/         # 유틸리티 모듈
│   │   │   ├── cc_map.py              # Chief Complaint 매핑
│   │   │   ├── feature_extractor.py   # ML 피처 추출
│   │   │   ├── bedrock_reporter.py    # Bedrock 리포트 생성
│   │   │   └── preprocess.py          # 전처리
│   │   ├── models_stratified/          # ML 모델 파일
│   │   │   ├── initial/               # 초기 결정 모델 (3개)
│   │   │   │   ├── lgbm_order_ecg.pkl
│   │   │   │   ├── lgbm_order_cxr.pkl
│   │   │   │   ├── lgbm_order_lab.pkl
│   │   │   │   └── metadata.pkl
│   │   │   └── followup/              # 후속 결정 모델 (5개)
│   │   │       ├── lgbm_order_ecg.pkl
│   │   │       ├── lgbm_order_cxr.pkl
│   │   │       ├── lgbm_order_lab.pkl
│   │   │       ├── lgbm_stop.pkl
│   │   │       ├── lgbm_need_reasoning.pkl
│   │   │       └── metadata.pkl
│   │   └── rag/                        # RAG 모듈
│   ├── api/                            # API 라우터
│   │   ├── triage.py                  # 트리아지 엔드포인트
│   │   ├── orders.py                  # 오더 관리
│   │   └── ...
│   ├── clients/                        # 외부 서비스 클라이언트
│   │   ├── modal_http.py              # 모달 서비스 HTTP 호출
│   │   └── ...
│   ├── main.py                         # FastAPI 앱 진입점
│   └── config.py                       # 환경 설정
├── data/
│   └── chief_complaint_modality_map.parquet  # CC 매핑 데이터
└── rag_db/                             # RAG 임베딩 DB (ChromaDB)
```

### 2. Import 경로 수정
- ✅ `orchestrator.utils.cc_map` → `app.agent.orchestrator_utils.cc_map`
- ✅ 모든 모듈이 `app.agent.*` 경로로 통일
- ✅ 하위 호환성을 위한 alias 유지 (`FusionDecisionEngine`)

### 3. 모달 서비스 연동
```python
# config.py
ECG_SERVICE_URL = "http://52.79.251.216:8003"
CXR_SERVICE_URL = "http://52.79.251.216:8002"
LAB_SERVICE_URL = "http://52.79.251.216:8000"
```

- ✅ `app/clients/modal_http.py`에서 HTTP 호출 구현
- ✅ `app/api/orders.py`에서 모달 실행 및 결과 처리
- ✅ 각 모달 서비스는 독립적인 컨테이너로 실행 중 (팀장 확인 완료)

### 4. ML 모델 통합
- ✅ Initial Decision Model (3개): ECG, CXR, LAB 초기 선택
- ✅ Follow-up Decision Model (5개): 추가 검사, 중단, 복잡 케이스 판단
- ✅ `app/main.py`에서 lifespan 시 모델 자동 로드
- ✅ `app.state`에 모델 저장하여 전역 접근 가능

### 5. 의사결정 흐름
```
1. 트리아지 제출 (POST /triage/submit)
   ↓
2. HybridDecisionEngine 초기 결정
   - CC Map 기반 우선순위
   - Initial ML Model 예측
   ↓
3. 모달 서비스 호출 (ECG/CXR/LAB)
   - HTTP POST /predict
   - 결과를 운영 DB에 저장
   ↓
4. Follow-up 결정
   - 완료된 모달 결과 분석
   - Follow-up ML Model 예측
   - 추가 검사 필요 여부 판단
   ↓
5. 최종 리포트 생성
   - Bedrock Claude를 통한 종합 판단
   - FHIR DiagnosticReport 생성
```

## 📊 테스트 결과

### Import 테스트
```bash
$ python test_imports.py
✓ HybridDecisionEngine import OK
✓ FusionDecisionEngine alias OK
✓ cc_map import OK
✓ feature_extractor import OK
✓ session_manager import OK

All imports successful!
```

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

# AWS
AWS_REGION=ap-northeast-2
BEDROCK_MODEL_ID=global.anthropic.claude-sonnet-4-6
```

### Docker Compose 실행
```bash
cd final/central/infra
docker-compose up -d
```

서비스 구성:
- `postgres`: PostgreSQL (hapi + central_db)
- `hapi-fhir`: HAPI FHIR 서버 (포트 8080)
- `backend`: 중앙 백엔드 (포트 8000)
- `pgweb`: PostgreSQL 웹 GUI (포트 8081)

## 📝 API 엔드포인트

### 트리아지
- `POST /triage/submit` - 환자 트리아지 제출 및 초기 결정

### 오더 관리
- `POST /orders/{sr_id}/approve` - AI 제안 승인 및 모달 실행
- `POST /orders/request` - 의사 직접 오더

### 상태 확인
- `GET /health` - 헬스체크
- `GET /ready` - Readiness probe (DB + ML 모델 로드 확인)

## 🎯 다음 단계

1. **로컬 테스트**
   ```bash
   cd final/central/infra
   docker-compose up -d
   # 백엔드: http://localhost:8000
   # API 문서: http://localhost:8000/docs
   ```

2. **프론트엔드 연동**
   - 프론트엔드가 `http://localhost:8000`을 바라보도록 설정
   - WebSocket 연결: `ws://localhost:8000/ws/{encounter_id}`

3. **통합 테스트**
   - 트리아지 제출 → 모달 실행 → 결과 확인
   - 전체 워크플로우 검증

## 📚 참고 문서

- `final/central/README.md` - 전체 시스템 개요
- `final/central/QUICKSTART.md` - 빠른 시작 가이드
- `final/central/DEPLOYMENT.md` - 배포 가이드
- `final/central/docs/ARCHITECTURE.md` - 아키텍처 상세
- `final/central/docs/DECISION_LOGIC.md` - 의사결정 로직 설명

## ✅ 체크리스트

- [x] 오케스트레이터 파일 구조 정리
- [x] Import 경로 수정
- [x] ML 모델 통합
- [x] 모달 서비스 HTTP 클라이언트 구현
- [x] 의사결정 엔진 통합
- [x] 세션 관리 구현
- [x] Import 테스트 통과
- [ ] 로컬 Docker Compose 테스트
- [ ] 프론트엔드 연동 테스트
- [ ] 전체 워크플로우 통합 테스트

---

**작성일**: 2026-05-11  
**작성자**: Kiro AI Assistant  
**상태**: ✅ 파일 구조 정리 완료, 통합 테스트 대기 중
