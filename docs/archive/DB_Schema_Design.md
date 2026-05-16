# say-6 데이터베이스 설계 문서

> 응급실 멀티모달 AI 진단보조 시스템 운영 DB 스키마
> 팀 내부 공유용 · 최종 수정 2026-05-14

---

## 1. 개요

- **DBMS**: PostgreSQL 16+ (AWS Aurora Serverless v2 PostgreSQL-호환)
- **운영 DB 이름**: `drai_ops` (=say-6 운영 데이터)
- **HAPI FHIR DB**: `hapi` (같은 RDS 인스턴스, 완전 분리)
- **소스**: [final/central/backend/app/db/schema.sql](final/central/backend/app/db/schema.sql)

### 핵심 설계 원칙
1. **FHIR ID = PK** — UUID 재발급 없이 HAPI Encounter ID를 그대로 PK로 사용
2. **JSONB 우선** — 모달 AI 추론 결과는 컬럼화 X, JSONB 원본 보존 → Bedrock 종합 판단 시 손실 없이 투입
3. **Graceful Degradation** — HAPI 다운 시 운영 DB INSERT는 정상, FHIR 동기화는 큐에 적재 후 백필
4. **자동 트리거** — `subject_id` 자동 채움, `updated_at` 자동 갱신

---

## 2. 시스템 구성

```
┌─ 같은 Aurora SLv2 인스턴스 ─────────────────────────────┐
│                                                       │
│  ┌──────────────────┐         ┌──────────────────┐    │
│  │   drai_ops       │         │   hapi           │    │
│  │   (운영 DB)       │         │   (FHIR DB)      │    │
│  │                  │         │                  │    │
│  │ • encounters     │ ──참조→ │ • Patient        │    │
│  │ • modal_results  │   PK    │ • Encounter      │    │
│  │ • diagnostic_*   │  공유   │ • Observation    │    │
│  │ • modal_events   │         │ • Condition      │    │
│  │ • fhir_sync_queue│         │ • DiagnosticReport│   │
│  └──────────────────┘         └──────────────────┘    │
│         ↑                              ↑              │
│   aurora-app-user             hapi-db-user            │
└────────────────────────────────────────────────────────┘
```

- **drai_ops**: 우리 시스템 전용 (테이블 6개)
- **hapi**: HAPI FHIR 서버가 자동 관리 (의료 표준 9 리소스)
- 두 DB는 **PK(encounter_id)만 공유**, 직접 JOIN 불가 (cross-database)

---

## 3. ERD (텍스트 다이어그램)

```
              ┌──────────────────────────────────────┐
              │  encounters (응급실 방문 1건)         │
              │  ─────────────                       │
              │  PK encounter_id   ◀─ FHIR Encounter │
              │     patient_id     ◀─ FHIR Patient   │
              │     subject_id     ─ MIMIC 환자 ID   │
              │     chief_complaint                  │
              │     started_at / closed_at           │
              │     status: active|closed            │
              │     metadata (JSONB)                 │
              └─────────┬────────────────┬───────────┘
                        │ 1              │ 1
            ┌───────────┼────────┐       │
            ▼           ▼        ▼       ▼
   N ┌──────────┐ 1 ┌────────────┐ N ┌──────────┐ N ┌────────────────┐
     │modal_    │   │diagnostic_ │   │modal_    │   │fhir_sync_queue │
     │results   │   │reports     │   │events    │   │(별도, FK 없음)  │
     │──────────│   │────────────│   │──────────│   │────────────────│
     │ECG/CXR/  │   │AI 종합 소견 │   │WebSocket │   │HAPI 동기화 큐  │
     │LAB AI    │   │의사 서명    │   │이벤트 로그│   │(pending/synced)│
     │raw_resp  │   │status:     │   │event_type│   │retry_count     │
     │(JSONB)   │   │preliminary/│   │payload   │   │last_error      │
     │GIN 인덱스│   │signed/     │   │(JSONB)   │   │                │
     │UNIQUE    │   │amended     │   │          │   │                │
     │(enc,mod) │   │UNIQUE(enc) │   │          │   │                │
     └──────────┘   └────────────┘   └──────────┘   └────────────────┘
```

- **encounter_id**가 모든 자식 테이블의 FK (ON DELETE CASCADE)
- **fhir_sync_queue**는 FK 없음 (HAPI 실패 시에도 작성 가능해야 함)

---

## 4. 테이블 상세

### 4.1 `encounters` — 응급실 방문 1건

| 컬럼 | 타입 | 설명 | 비고 |
|---|---|---|---|
| `encounter_id` | TEXT PK | FHIR Encounter ID | HAPI 자동 부여 |
| `patient_id` | TEXT NOT NULL | FHIR Patient ID | |
| `subject_id` | VARCHAR(20) | MIMIC 원본 환자 ID | S3 ECG/CXR/Lab 조회 키 |
| `chief_complaint` | TEXT | 주증상 | |
| `patient_name` | VARCHAR(128) | 환자명 | |
| `patient_age` | INTEGER | 나이 | |
| `patient_gender` | VARCHAR(16) | 성별 | |
| `started_at` | TIMESTAMPTZ NOT NULL | 도착 시각 | DEFAULT NOW() |
| `closed_at` | TIMESTAMPTZ | 마감 시각 | nullable |
| `status` | VARCHAR(20) NOT NULL | 상태 | `active` / `closed` |
| `metadata` | JSONB | 추가 정보 | DEFAULT `{}` |

**인덱스**:
- `idx_enc_patient` — patient_id
- `idx_enc_subject` — subject_id
- `idx_enc_status_start` — (status, started_at DESC) → Worklist 정렬용

---

### 4.2 `modal_results` — AI 모달 추론 결과 (핵심)

각 환자당 ECG·CXR·LAB 결과 3행. **`raw_response`가 가장 중요** — Bedrock 종합 판단 시 원본 투입.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | BIGSERIAL PK | 자동증가 |
| `encounter_id` | TEXT FK | encounters CASCADE |
| `subject_id` | VARCHAR(20) | 트리거 자동 채움 |
| `modality` | VARCHAR(16) NOT NULL | `ECG` / `CXR` / `LAB` |
| `service_request_id` | VARCHAR(64) | FHIR ServiceRequest ID |
| `raw_response` | **JSONB NOT NULL** | 모달 서비스 응답 원본 |
| `risk_level` | VARCHAR(20) | `routine` / `urgent` / `critical` |
| `summary` | TEXT | 요약 문장 |
| `synced_to_fhir` | BOOLEAN | 호환용 (미사용) |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

**제약**: `UNIQUE (encounter_id, modality)` → 같은 환자 같은 모달 중복 방지 (UPSERT 사용)

**인덱스**:
- `idx_mr_enc` — encounter_id
- `idx_mr_subject` — subject_id
- `idx_mr_risk` — risk_level
- `idx_mr_created` — created_at DESC
- `idx_mr_sr` — service_request_id
- **`idx_mr_raw_gin` — GIN(raw_response)** ★ JSONB 검색 최적화

### `raw_response` JSONB 예시

```json
// ECG 모달
{
  "modality": "ECG",
  "confidence": 0.92,
  "findings": ["ST elevation V2-V4", "Reciprocal change in II/III/aVF"],
  "diagnosis": "STEMI (anterior wall) 의심",
  "measurements": {
    "HR": 88, "PR": 160, "QRS": 95, "QTc": 412
  },
  "model_version": "v1.2",
  "inference_time_ms": 1832
}

// CXR 모달
{
  "modality": "CXR",
  "confidence": 0.89,
  "findings": [
    { "label": "Consolidation", "confidence": 0.32, "bbox": [120,80,180,140] },
    { "label": "Pneumothorax", "confidence": 0.89, "bbox": [85,60,135,120] }
  ],
  "view": "PA",
  "heatmap_s3": "s3://say-6-pacs/heatmap/042-cxr.png"
}

// LAB 모달
{
  "modality": "LAB",
  "say6_score": 88,
  "trend": "rising",
  "values": {
    "Troponin": 0.82,
    "CK-MB": 12.4,
    "WBC": 10.2
  },
  "predict_6h": "high_risk"
}
```

---

### 4.3 `diagnostic_reports` — AI 종합 소견 + 의사 서명

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `encounter_id` | TEXT FK | UNIQUE (1 encounter = 1 소견서) |
| `subject_id` | VARCHAR(20) | 트리거 자동 |
| `fhir_report_id` | VARCHAR(64) | FHIR DiagnosticReport ID |
| `ai_diagnosis` | TEXT | Bedrock Claude 출력 본문 |
| `ai_recommendations` | JSONB | 권고 사항 배열 |
| `ai_risk_level` | VARCHAR(20) | 종합 위험도 |
| `physician_edits` | TEXT | 의사 수정 본문 |
| `status` | VARCHAR(20) | `preliminary` / `signed` / `amended` |
| `signed_by` | VARCHAR(64) | 서명한 의사 ID |
| `signed_at` | TIMESTAMPTZ | 서명 시각 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `updated_at` | TIMESTAMPTZ | **트리거 자동 갱신** |

**제약**: `UNIQUE (encounter_id)`

**인덱스**:
- `idx_dr_enc` — encounter_id
- `idx_dr_subject` — subject_id
- `idx_dr_status` — (status, created_at DESC)

### `ai_recommendations` JSONB 예시
```json
[
  { "order": 1, "action": "Aspirin 300mg PO STAT", "priority": "critical" },
  { "order": 2, "action": "심혈관조영술 즉시", "priority": "critical" },
  { "order": 3, "action": "순환기내과 컨설트", "priority": "high" }
]
```

---

### 4.4 `modal_events` — WebSocket 이벤트 로그

실시간 이벤트의 영구 보관 (재전송·디버그용).

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `encounter_id` | TEXT | FK 없음 (NULL 허용) |
| `subject_id` | VARCHAR(20) | 트리거 자동 |
| `event_type` | VARCHAR(40) NOT NULL | 이벤트 종류 (아래 표) |
| `payload` | JSONB | 이벤트 페이로드 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |

**인덱스**:
- `idx_me_enc_time` — (encounter_id, created_at DESC)
- `idx_me_subject` — subject_id
- `idx_me_type` — event_type

### `event_type` 10종 (WebSocket Broadcast)

| event_type | 의미 |
|---|---|
| `encounter_created` | 트리아지 등록 완료 |
| `order_placed` | ServiceRequest 생성 (ECG/CXR/LAB 오더) |
| `initial_proposal` | AI 1차 권고 |
| `modal_started` | 모달 분석 시작 |
| `modal_completed` | 모달 분석 완료 |
| `modal_failed` | 모달 분석 실패 |
| `next_proposal` | AI 후속 권고 |
| `ready_for_report` | 종합 판단 준비 완료 |
| `report_generated` | AI 종합 소견서 생성 |
| `report_signed` | 의사 서명 / EMR 전송 |

---

### 4.5 `fhir_sync_queue` — HAPI 동기화 백로그 ★

**Graceful Degradation** 핵심. HAPI 다운 시에도 운영 DB INSERT는 정상 진행.

| 컬럼 | 타입 | 설명 |
|---|---|---|
| `id` | BIGSERIAL PK | |
| `encounter_id` | TEXT NOT NULL | FK 없음 (의도적) |
| `patient_id` | TEXT | |
| `resource_type` | VARCHAR(40) NOT NULL | `Patient` / `Encounter` / `ServiceRequest` / `Condition` / `Observation` / `DocumentReference` / `DiagnosticReport` / `AllergyIntolerance` / `MedicationStatement` |
| `resource_id` | TEXT NOT NULL | 우리가 발급한 UUID (PUT 대상) |
| `payload` | JSONB NOT NULL | HAPI에 보낼 FHIR JSON |
| `status` | VARCHAR(20) NOT NULL | `pending` / `synced` / `failed` |
| `retry_count` | INTEGER NOT NULL | DEFAULT 0 |
| `last_error` | TEXT | 마지막 에러 메시지 |
| `created_at` | TIMESTAMPTZ | DEFAULT NOW() |
| `synced_at` | TIMESTAMPTZ | 백필 성공 시각 |

**인덱스** (부분 인덱스로 최적화):
- `idx_fsq_pending` — `status = 'pending'` 인 행만 인덱싱 (Retry Worker 빠른 스캔)
- `idx_fsq_encounter` — encounter_id

### 동작 흐름

```
[정상]                          [HAPI 다운 시]
1. encounters INSERT ✓         1. encounters INSERT ✓
2. HAPI PUT ✓                  2. HAPI PUT ❌
                                  → fhir_sync_queue INSERT (pending)
                                  → 의사 화면: 정상 등록 ✓

[5분 후 HAPI 복구]
Retry Worker:
  SELECT * FROM fhir_sync_queue WHERE status = 'pending'
  → HAPI PUT 재시도 → 성공 시 status='synced', synced_at=NOW()
                  실패 시 retry_count++ , last_error 기록
```

---

## 5. 트리거 & 함수

### 5.1 `_fill_subject_id()` — subject_id 자동 채움

자식 테이블 INSERT 시 `subject_id`가 NULL이면 부모(encounters)에서 자동 조회.

```sql
-- modal_results / diagnostic_reports / modal_events 모두 적용
CREATE TRIGGER trg_mr_fill_subject
BEFORE INSERT OR UPDATE OF encounter_id ON modal_results
FOR EACH ROW EXECUTE FUNCTION _fill_subject_id();
```

→ 백엔드 코드는 `subject_id` 신경 안 써도 됨. 자동.

### 5.2 `_bump_updated_at()` — updated_at 자동 갱신

```sql
CREATE TRIGGER trg_dr_updated_at
BEFORE UPDATE ON diagnostic_reports
FOR EACH ROW EXECUTE FUNCTION _bump_updated_at();
```

→ `diagnostic_reports` UPDATE 시 `updated_at = NOW()` 자동.

---

## 6. 인덱스 전략 요약

| 인덱스 | 용도 |
|---|---|
| 모든 `encounter_id` 컬럼 | 자식 테이블 JOIN |
| `idx_enc_status_start` | Worklist (active 환자 시간순) |
| `idx_mr_raw_gin` | JSONB `raw_response` 내부 검색 (`@>` 연산자) |
| `idx_dr_status` | 미서명 소견서 알람 (4h 초과) |
| `idx_fsq_pending` | Retry Worker 효율 (부분 인덱스) |
| `idx_me_enc_time` | 이벤트 타임라인 조회 |

### GIN 인덱스 사용 예시
```sql
-- raw_response.diagnosis 검색 (GIN 인덱스 활용)
SELECT * FROM modal_results
WHERE raw_response @> '{"diagnosis": "STEMI"}';

-- raw_response.confidence > 0.9
SELECT * FROM modal_results
WHERE (raw_response->>'confidence')::float > 0.9;
```

---

## 7. 사용 예시 (FastAPI 백엔드 흐름)

### 7.1 환자 등록 (트리아지)
```python
# 1. HAPI Patient PUT → patient_id 발급
# 2. HAPI Encounter PUT → encounter_id 발급
# 3. drai_ops.encounters INSERT
await conn.execute("""
    INSERT INTO encounters
      (encounter_id, patient_id, subject_id, chief_complaint, patient_name, ...)
    VALUES ($1, $2, $3, $4, $5, ...)
""", encounter_id, patient_id, "15638163", "흉통", "김재훈", ...)
```

### 7.2 모달 추론 결과 저장
```python
await conn.execute("""
    INSERT INTO modal_results
      (encounter_id, modality, raw_response, risk_level, summary)
    VALUES ($1, $2, $3::jsonb, $4, $5)
    ON CONFLICT (encounter_id, modality) DO UPDATE SET
      raw_response = EXCLUDED.raw_response,
      risk_level = EXCLUDED.risk_level,
      created_at = NOW()
""", enc_id, "ECG", json.dumps(ecg_result), "urgent", "STEMI 의심")
# subject_id는 트리거가 자동 채움
```

### 7.3 종합 소견서 생성
```python
await conn.execute("""
    INSERT INTO diagnostic_reports
      (encounter_id, ai_diagnosis, ai_recommendations, ai_risk_level, status)
    VALUES ($1, $2, $3::jsonb, $4, 'preliminary')
    ON CONFLICT (encounter_id) DO UPDATE SET
      ai_diagnosis = EXCLUDED.ai_diagnosis,
      ai_recommendations = EXCLUDED.ai_recommendations,
      ai_risk_level = EXCLUDED.ai_risk_level
""", enc_id, claude_output, json.dumps(recommendations), "critical")
```

### 7.4 HAPI 동기화 실패 → 큐 적재
```python
try:
    await hapi_client.put_diagnostic_report(...)
except Exception as e:
    await conn.execute("""
        INSERT INTO fhir_sync_queue
          (encounter_id, patient_id, resource_type, resource_id, payload, last_error)
        VALUES ($1, $2, 'DiagnosticReport', $3, $4::jsonb, $5)
    """, enc_id, pid, fhir_id, json.dumps(payload), str(e))
```

### 7.5 Retry Worker (5분 주기)
```python
rows = await conn.fetch("""
    SELECT * FROM fhir_sync_queue
    WHERE status = 'pending' AND retry_count < 5
    ORDER BY created_at
    LIMIT 100
""")
for r in rows:
    try:
        await hapi_client.put(r["resource_type"], r["resource_id"], r["payload"])
        await conn.execute("""
            UPDATE fhir_sync_queue
            SET status='synced', synced_at=NOW()
            WHERE id=$1
        """, r["id"])
    except Exception as e:
        await conn.execute("""
            UPDATE fhir_sync_queue
            SET retry_count = retry_count + 1, last_error = $2
            WHERE id = $1
        """, r["id"], str(e))
```

---

## 8. FHIR 매핑 (hapi DB)

운영 DB(`drai_ops`) ↔ FHIR DB(`hapi`) 매핑:

| 우리 테이블 | FHIR 리소스 (HAPI 자동) | 저장 시점 |
|---|---|---|
| `encounters` | `Patient` + `Encounter` | 트리아지 시작 |
| `modal_results` (ECG/CXR/LAB) | `ServiceRequest` × 3 | 모달 호출 직전 |
| `modal_results.raw_response` | `Observation` | 모달 완료 시 (수치 부분만) |
| `modal_results.raw_response.heatmap_s3` | `DocumentReference` | CXR 히트맵 |
| `diagnostic_reports` | `DiagnosticReport` | Bedrock 생성 시 |
| (의사 confirm) | `Condition` | 의사 서명 시 |
| (트리아지 입력) | `AllergyIntolerance`, `MedicationStatement` | 트리아지 시작 |

**중요**: AI 추론 raw 응답은 FHIR에 저장하지 않음 (`modal_results.raw_response`에만). FHIR엔 표준화된 수치만.

---

## 9. 운영 가이드

### 9.1 권한 관리
```sql
-- 운영 사용자 (백엔드만 사용)
CREATE USER aurora_app_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE drai_ops TO aurora_app_user;
GRANT USAGE ON SCHEMA public TO aurora_app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aurora_app_user;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO aurora_app_user;

-- HAPI 전용 사용자 (hapi DB만 접근)
CREATE USER hapi_db_user WITH PASSWORD '...';
GRANT CONNECT ON DATABASE hapi TO hapi_db_user;
-- (hapi DB 안에서 권한 설정)
```

### 9.2 백업 정책
| 항목 | 값 |
|---|---|
| **PITR (Point-In-Time Recovery)** | 35일 |
| **자동 스냅샷** | 매일 03:00 KST |
| **AWS Backup Vault Lock** | 5년 (의료법 요건) |
| **Cross-Region Replica** | Phase 3 검토 |

### 9.3 모니터링 알람
| 알람 | 조건 | 채널 |
|---|---|---|
| `aurora-acu-saturated` | ACU == Max 5분 | SNS Critical |
| `fhir-queue-backlog` | `fhir_sync_queue.pending > 50` | SNS Warning |
| `unsigned-report` | `diagnostic_reports.status='preliminary'` AND age > 4h | SNS Warning |

### 9.4 마이그레이션
- 스키마 변경 시: **Alembic** 사용 (현재 미적용, Phase 2 도입 예정)
- 임시: schema.sql 수동 적용 + `IF NOT EXISTS` 활용

---

## 10. JSONB 컬럼 가이드

### 10.1 사용 컬럼 4개
| 테이블.컬럼 | 용도 | 인덱스 |
|---|---|---|
| `encounters.metadata` | past_history, vitals, allergies | — |
| `modal_results.raw_response` | AI 모달 원본 응답 | **★ GIN** |
| `diagnostic_reports.ai_recommendations` | 권고 목록 | — |
| `modal_events.payload` | actor, modality 등 | — |
| `fhir_sync_queue.payload` | FHIR JSON 원본 | — |

### 10.2 JSONB 쿼리 패턴
```sql
-- Containment (포함) — GIN 인덱스 활용
SELECT * FROM modal_results WHERE raw_response @> '{"diagnosis": "STEMI"}';

-- Path 추출
SELECT raw_response->>'diagnosis' AS dx FROM modal_results;
SELECT raw_response->'measurements'->>'HR' AS hr FROM modal_results;

-- 숫자 비교 (캐스팅 필요)
SELECT * FROM modal_results
WHERE (raw_response->>'confidence')::float > 0.9;

-- 배열 요소 검색
SELECT * FROM modal_results
WHERE raw_response->'findings' ?| array['STEMI', 'NSTEMI'];

-- UPSERT 시 부분 업데이트
UPDATE modal_results
SET raw_response = raw_response || '{"reviewed_by": "Dr.Kim"}'::jsonb
WHERE id = 42;
```

### 10.3 JSONB 사용 시 주의
- **NOT NULL 체크**: `raw_response IS NOT NULL` (빈 객체 `{}`도 NOT NULL)
- **타입 캐스팅**: `->>` 는 항상 TEXT, 숫자 비교 시 `::float` 또는 `::int` 명시
- **GIN 인덱스**는 INSERT 약간 느리지만 SELECT는 매우 빠름 (현재 트레이드오프 OK)

---

## 11. 팀 작업 분담 참고

| 담당 | 영역 | DB 관련 작업 |
|---|---|---|
| **양정인** | 보안 + 네트워크 | aurora-sg, Secrets Manager, KMS 키 |
| **이정인** | 컴퓨팅 | orchestrator → asyncpg 연결, 풀 설정 |
| **홍경태** | DB + 모니터링 | **스키마 관리·인덱스·마이그레이션·백업·알람** |

---

## 12. 변경 이력

| 날짜 | 버전 | 변경 |
|---|---|---|
| 2026-05-14 | v1.0 | 최초 문서화 (schema.sql 기준) |

---

**문서 위치**: `DB_Schema_Design.md`
**소스 코드**: [final/central/backend/app/db/schema.sql](final/central/backend/app/db/schema.sql)
**문의**: `#infra-cfn` 채널 또는 홍경태
