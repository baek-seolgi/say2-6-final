# 통합 검증 체크리스트

## 📋 파일 구조 검증

### ML 모델 파일
```bash
# Initial Models (3개)
[ ] final_integrated/central/backend/app/agent/models_stratified/initial/lgbm_order_ecg.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/initial/lgbm_order_cxr.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/initial/lgbm_order_lab.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/initial/metadata.pkl

# Follow-up Models (5개)
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/lgbm_order_ecg.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/lgbm_order_cxr.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/lgbm_order_lab.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/lgbm_stop.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/lgbm_need_reasoning.pkl
[ ] final_integrated/central/backend/app/agent/models_stratified/followup/metadata.pkl
```

**검증 명령어:**
```bash
# Windows
dir final_integrated\central\backend\app\agent\models_stratified\initial\*.pkl
dir final_integrated\central\backend\app\agent\models_stratified\followup\*.pkl

# Linux/Mac
ls -lh final_integrated/central/backend/app/agent/models_stratified/initial/*.pkl
ls -lh final_integrated/central/backend/app/agent/models_stratified/followup/*.pkl
```

---

### 유틸리티 모듈
```bash
[ ] final_integrated/central/backend/app/agent/orchestrator_utils/cc_map.py
[ ] final_integrated/central/backend/app/agent/orchestrator_utils/feature_extractor.py
[ ] final_integrated/central/backend/app/agent/orchestrator_utils/bedrock_reporter.py
[ ] final_integrated/central/backend/app/agent/orchestrator_utils/preprocess.py
[ ] final_integrated/central/backend/app/agent/orchestrator_utils/__init__.py
```

---

### 의사결정 엔진
```bash
[ ] final_integrated/central/backend/app/agent/hybrid_decision_engine.py
[ ] final_integrated/central/backend/app/agent/session_manager.py
[ ] final_integrated/central/backend/app/agent/decision_engine.py (alias)
```

---

### 기존 시스템 모듈
```bash
[ ] final_integrated/central/backend/app/agent/rag/
[ ] final_integrated/central/backend/app/api/
[ ] final_integrated/central/backend/app/clients/
[ ] final_integrated/central/backend/app/db/
[ ] final_integrated/central/backend/app/fhir/
[ ] final_integrated/central/backend/app/main.py
[ ] final_integrated/central/backend/app/config.py
```

---

## 🔍 Import 경로 검증

### 1. hybrid_decision_engine.py
```bash
# 확인할 import
from app.agent.orchestrator_utils.cc_map import ChiefComplaintModalityMap
```

**검증 명령어:**
```bash
grep "from app.agent.orchestrator_utils" final_integrated/central/backend/app/agent/hybrid_decision_engine.py
```

**예상 결과:**
```
from app.agent.orchestrator_utils.cc_map import ChiefComplaintModalityMap
```

---

### 2. session_manager.py
```bash
# 확인할 imports
from app.agent.orchestrator_utils.bedrock_reporter import BedrockReporter
from app.agent.hybrid_decision_engine import HybridDecisionEngine
```

**검증 명령어:**
```bash
grep "from app.agent" final_integrated/central/backend/app/agent/session_manager.py
```

**예상 결과:**
```
from app.agent.orchestrator_utils.bedrock_reporter import BedrockReporter
from app.agent.hybrid_decision_engine import HybridDecisionEngine
```

---

### 3. feature_extractor.py
```bash
# 확인할 import
from app.agent.orchestrator_utils.cc_map import load_cc_map
```

**검증 명령어:**
```bash
grep "from app.agent" final_integrated/central/backend/app/agent/orchestrator_utils/feature_extractor.py
```

**예상 결과:**
```
from app.agent.orchestrator_utils.cc_map import load_cc_map
```

---

## 🧪 Python Import 테스트

### 테스트 스크립트 생성
```bash
# final_integrated/central/backend/test_imports.py
```

```python
#!/usr/bin/env python3
"""
Import 경로 검증 스크립트
"""
import sys
from pathlib import Path

# Add app to path
sys.path.insert(0, str(Path(__file__).parent))

def test_imports():
    """Test all critical imports"""
    errors = []
    
    # Test 1: HybridDecisionEngine
    try:
        from app.agent.hybrid_decision_engine import HybridDecisionEngine
        print("✓ HybridDecisionEngine import OK")
    except Exception as e:
        errors.append(f"✗ HybridDecisionEngine import failed: {e}")
    
    # Test 2: SessionManager
    try:
        from app.agent.session_manager import SessionManager
        print("✓ SessionManager import OK")
    except Exception as e:
        errors.append(f"✗ SessionManager import failed: {e}")
    
    # Test 3: CC Map
    try:
        from app.agent.orchestrator_utils.cc_map import ChiefComplaintModalityMap
        print("✓ ChiefComplaintModalityMap import OK")
    except Exception as e:
        errors.append(f"✗ ChiefComplaintModalityMap import failed: {e}")
    
    # Test 4: Feature Extractor
    try:
        from app.agent.orchestrator_utils.feature_extractor import InferenceFeatureExtractor
        print("✓ InferenceFeatureExtractor import OK")
    except Exception as e:
        errors.append(f"✗ InferenceFeatureExtractor import failed: {e}")
    
    # Test 5: Bedrock Reporter
    try:
        from app.agent.orchestrator_utils.bedrock_reporter import BedrockReporter
        print("✓ BedrockReporter import OK")
    except Exception as e:
        errors.append(f"✗ BedrockReporter import failed: {e}")
    
    # Test 6: Load models function
    try:
        from app.agent.hybrid_decision_engine import load_stratified_models
        print("✓ load_stratified_models import OK")
    except Exception as e:
        errors.append(f"✗ load_stratified_models import failed: {e}")
    
    # Test 7: RAG modules
    try:
        from app.agent.rag import RAGRetriever, RAGGenerator
        print("✓ RAG modules import OK")
    except Exception as e:
        errors.append(f"✗ RAG modules import failed: {e}")
    
    # Test 8: API modules
    try:
        from app.api import triage, orders, encounters
        print("✓ API modules import OK")
    except Exception as e:
        errors.append(f"✗ API modules import failed: {e}")
    
    # Test 9: FHIR modules
    try:
        from app.fhir import client, resources
        print("✓ FHIR modules import OK")
    except Exception as e:
        errors.append(f"✗ FHIR modules import failed: {e}")
    
    # Test 10: DB modules
    try:
        from app.db import client, encounters
        print("✓ DB modules import OK")
    except Exception as e:
        errors.append(f"✗ DB modules import failed: {e}")
    
    # Summary
    print("\n" + "="*60)
    if errors:
        print(f"❌ {len(errors)} import(s) failed:")
        for error in errors:
            print(f"  {error}")
        return False
    else:
        print("✅ All imports successful!")
        return True

if __name__ == "__main__":
    success = test_imports()
    sys.exit(0 if success else 1)
```

**실행:**
```bash
cd final_integrated/central/backend
python test_imports.py
```

---

## 🐳 Docker 검증

### 1. Docker Compose 파일 확인
```bash
[ ] final_integrated/central/infra/docker-compose.yml 존재
```

### 2. Docker 빌드 테스트
```bash
cd final_integrated/central/infra
docker-compose build
```

**예상 결과:**
```
Successfully built <image_id>
Successfully tagged central_backend:latest
```

### 3. Docker 실행 테스트
```bash
docker-compose up -d
```

**예상 결과:**
```
Creating network "infra_default" with the default driver
Creating infra_postgres_1 ... done
Creating infra_hapi-fhir_1 ... done
Creating infra_backend_1 ... done
Creating infra_pgweb_1 ... done
```

### 4. 서비스 상태 확인
```bash
docker-compose ps
```

**예상 결과:**
```
Name                   State    Ports
------------------------------------------------
infra_backend_1        Up       0.0.0.0:8000->8000/tcp
infra_hapi-fhir_1      Up       0.0.0.0:8080->8080/tcp
infra_postgres_1       Up       5432/tcp
infra_pgweb_1          Up       0.0.0.0:8081->8081/tcp
```

---

## 🔌 API 엔드포인트 검증

### 1. Health Check
```bash
curl http://localhost:8000/health
```

**예상 결과:**
```json
{
  "status": "healthy",
  "timestamp": "2026-05-11T..."
}
```

### 2. Readiness Check (ML 모델 로드 확인)
```bash
curl http://localhost:8000/ready
```

**예상 결과:**
```json
{
  "status": "ready",
  "ml_models_loaded": true,
  "initial_models": 3,
  "followup_models": 5
}
```

### 3. API Docs
```bash
# 브라우저에서 열기
http://localhost:8000/docs
```

**확인 사항:**
- [ ] Swagger UI 정상 로드
- [ ] `/triage/submit` 엔드포인트 존재
- [ ] `/orders/{sr_id}/approve` 엔드포인트 존재
- [ ] `/health` 엔드포인트 존재

---

## 🧠 ML 모델 로드 검증

### 1. 로그 확인
```bash
docker-compose logs backend | grep -i "model"
```

**예상 로그:**
```
backend_1  | INFO: Loaded model: order_ecg from ./app/agent/models_stratified/initial
backend_1  | INFO: Loaded model: order_cxr from ./app/agent/models_stratified/initial
backend_1  | INFO: Loaded model: order_lab from ./app/agent/models_stratified/initial
backend_1  | INFO: Loaded model: order_ecg from ./app/agent/models_stratified/followup
backend_1  | INFO: Loaded model: order_cxr from ./app/agent/models_stratified/followup
backend_1  | INFO: Loaded model: order_lab from ./app/agent/models_stratified/followup
backend_1  | INFO: Loaded model: stop from ./app/agent/models_stratified/followup
backend_1  | INFO: Loaded model: need_reasoning from ./app/agent/models_stratified/followup
```

### 2. Python 스크립트로 확인
```python
# test_model_load.py
import pickle
from pathlib import Path

def test_model_files():
    base_path = Path("final_integrated/central/backend/app/agent/models_stratified")
    
    # Initial models
    initial_models = ['order_ecg', 'order_cxr', 'order_lab']
    for model in initial_models:
        path = base_path / 'initial' / f'lgbm_{model}.pkl'
        assert path.exists(), f"Missing: {path}"
        with open(path, 'rb') as f:
            model_obj = pickle.load(f)
            print(f"✓ {model} loaded successfully")
    
    # Follow-up models
    followup_models = ['order_ecg', 'order_cxr', 'order_lab', 'stop', 'need_reasoning']
    for model in followup_models:
        path = base_path / 'followup' / f'lgbm_{model}.pkl'
        assert path.exists(), f"Missing: {path}"
        with open(path, 'rb') as f:
            model_obj = pickle.load(f)
            print(f"✓ {model} loaded successfully")
    
    print("\n✅ All model files verified!")

if __name__ == "__main__":
    test_model_files()
```

---

## 🔄 전체 워크플로우 테스트

### 1. 트리아지 제출
```bash
curl -X POST http://localhost:8000/triage/submit \
  -H "Content-Type: application/json" \
  -d '{
    "patient_id": "TEST001",
    "chief_complaint": "chest pain",
    "age": 65,
    "gender": "M",
    "acuity": 2,
    "pain": 8,
    "heartrate": 95,
    "sbp": 140,
    "dbp": 85,
    "temperature": 37.2,
    "resprate": 18,
    "o2sat": 96
  }'
```

**예상 결과:**
```json
{
  "encounter_id": "...",
  "status": "active",
  "initial_decision": {
    "decision": "CALL_NEXT_MODALITY",
    "next_modalities": ["ECG"],
    "rationale": "Initial selection for: chest pain (data-driven)"
  }
}
```

### 2. 로그 확인
```bash
docker-compose logs backend | tail -50
```

**확인 사항:**
- [ ] "HybridDecisionEngine initialized" 로그
- [ ] "Initial ML Model 예측" 로그
- [ ] "CC Map 사용" 로그
- [ ] 에러 없음

---

## 📊 최종 체크리스트

### 파일 구조
- [ ] ML 모델 파일 (8개) 모두 존재
- [ ] 유틸리티 모듈 (4개) 모두 존재
- [ ] 의사결정 엔진 파일 존재
- [ ] 기존 시스템 모듈 유지

### Import 경로
- [ ] hybrid_decision_engine.py import 수정 완료
- [ ] session_manager.py import 수정 완료
- [ ] feature_extractor.py import 수정 완료
- [ ] 모든 import 테스트 통과

### Docker
- [ ] docker-compose.yml 존재
- [ ] Docker 빌드 성공
- [ ] 모든 서비스 실행 중
- [ ] 포트 정상 바인딩

### API
- [ ] /health 엔드포인트 정상
- [ ] /ready 엔드포인트 정상 (ML 모델 로드 확인)
- [ ] /docs Swagger UI 정상
- [ ] /triage/submit 엔드포인트 정상

### ML 모델
- [ ] Initial models (3개) 로드 성공
- [ ] Follow-up models (5개) 로드 성공
- [ ] 모델 예측 정상 작동
- [ ] 로그에 에러 없음

### 전체 워크플로우
- [ ] 트리아지 제출 성공
- [ ] Initial decision 정상
- [ ] 모달 호출 가능
- [ ] Follow-up decision 정상

---

## ✅ 검증 완료 시

모든 체크리스트 항목이 완료되면:

1. **백업 생성**
   ```bash
   # 기존 final 폴더 백업
   mv final final_backup_$(date +%Y%m%d_%H%M%S)
   ```

2. **통합 폴더 활성화**
   ```bash
   # final_integrated를 final로 변경
   mv final_integrated final
   ```

3. **최종 테스트**
   ```bash
   cd final/central/infra
   docker-compose down
   docker-compose up -d
   curl http://localhost:8000/health
   ```

---

**검증 완료일**: _______________  
**검증자**: _______________  
**상태**: [ ] 통과 / [ ] 실패  
**비고**: _______________
