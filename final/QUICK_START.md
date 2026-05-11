# 빠른 시작 가이드

## 🚀 5분 안에 시작하기

### 1️⃣ Import 테스트 (필수)

```bash
cd final_integrated/central/backend
python test_imports.py
```

**예상 결과:**
```
============================================================
Import 경로 검증 시작
============================================================

✓ HybridDecisionEngine import OK
✓ SessionManager import OK
✓ ChiefComplaintModalityMap import OK
✓ InferenceFeatureExtractor import OK
✓ BedrockReporter import OK
✓ load_stratified_models import OK
✓ RAG modules import OK
✓ API modules import OK
✓ FHIR modules import OK
✓ DB modules import OK

============================================================
✅ All imports successful!
============================================================
```

---

### 2️⃣ Docker 실행

```bash
cd final_integrated/central/infra
docker-compose up -d
```

**서비스 확인:**
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

### 3️⃣ API 테스트

```bash
# Health Check
curl http://localhost:8000/health

# ML 모델 로드 확인
curl http://localhost:8000/ready

# API 문서
# 브라우저에서: http://localhost:8000/docs
```

---

### 4️⃣ 트리아지 테스트

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

---

## ✅ 검증 완료 후

모든 테스트가 통과하면:

```bash
# 1. 기존 final 폴더 백업
mv final final_backup_$(date +%Y%m%d)

# 2. final_integrated를 final로 변경
mv final_integrated final

# 3. 최종 확인
cd final/central/infra
docker-compose up -d
curl http://localhost:8000/health
```

---

## 📚 더 자세한 정보

- [README.md](README.md) - 전체 프로젝트 개요
- [SUMMARY.md](SUMMARY.md) - 통합 요약
- [INTEGRATION_COMPLETE.md](central/INTEGRATION_COMPLETE.md) - 상세 통합 보고서
- [VERIFICATION_CHECKLIST.md](VERIFICATION_CHECKLIST.md) - 전체 검증 체크리스트

---

## 🆘 문제 발생 시

### Import 에러
```bash
cd final_integrated/central/backend
python test_imports.py
# 에러 메시지 확인
```

### Docker 에러
```bash
cd final_integrated/central/infra
docker-compose logs backend
# 로그 확인
```

### ML 모델 로드 에러
```bash
# 모델 파일 확인
ls -lh final_integrated/central/backend/app/agent/models_stratified/initial/
ls -lh final_integrated/central/backend/app/agent/models_stratified/followup/
```

---

**준비 완료!** 🎉
