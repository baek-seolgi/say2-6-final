-- ================================================================
-- drai_ops 운영 DB 스키마 (PostgreSQL 16+)
--
-- 이 파일이 하는 일:
--   - 우리 시스템 전용 운영 테이블 정의
--   - HAPI FHIR가 쓰는 hapi database와는 완전 분리 (같은 RDS 인스턴스)
--   - 모달 원본 응답을 JSONB로 보존 → Bedrock 종합 판단 시 구조 손실 없이 투입
--
-- 실행 방법:
--   psql -U admin -d drai_ops -f schema.sql
--   (또는 docker-entrypoint-initdb.d/ 로 자동 실행)
-- ================================================================

-- 운영 DB는 FHIR ID를 그대로 PK로 사용 (UUID 변환 불필요)

-- ================================================================
-- 1. encounters: 응급실 방문 1건
--    (FHIR Encounter와 1:1 매핑. encounter_id = FHIR Encounter ID)
-- ================================================================
CREATE TABLE IF NOT EXISTS encounters (
    encounter_id       TEXT PRIMARY KEY,                       -- = FHIR Encounter ID (HAPI 자동 부여)
    patient_id         TEXT NOT NULL,                          -- = FHIR Patient ID
    subject_id         VARCHAR(20),                            -- MIMIC 원본 환자 ID (S3 ECG/CXR/Lab 조회 키)
    chief_complaint    TEXT,
    patient_name       VARCHAR(128),
    patient_age        INTEGER,
    patient_gender     VARCHAR(16),
    started_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at          TIMESTAMPTZ,
    status             VARCHAR(20) NOT NULL DEFAULT 'active',  -- active / closed
    metadata           JSONB DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_enc_patient      ON encounters(patient_id);
CREATE INDEX IF NOT EXISTS idx_enc_subject      ON encounters(subject_id);
CREATE INDEX IF NOT EXISTS idx_enc_status_start ON encounters(status, started_at DESC);

-- ================================================================
-- 2. modal_results: 각 모달(ECG/CXR/LAB) 원본 응답 (핵심!)
--    raw_response(JSONB)가 모달 서비스가 반환한 PredictResponse 원본.
--    종합 판단 시 이걸 Bedrock에 그대로 투입.
-- ================================================================
CREATE TABLE IF NOT EXISTS modal_results (
    id                 BIGSERIAL PRIMARY KEY,
    encounter_id       TEXT NOT NULL REFERENCES encounters(encounter_id) ON DELETE CASCADE,
    subject_id         VARCHAR(20),                              -- encounter_id의 환자 MIMIC subject_id (트리거 자동 채움)
    modality           VARCHAR(16) NOT NULL,                     -- ECG / CXR / LAB
    service_request_id VARCHAR(64),
    raw_response       JSONB NOT NULL,                           -- 모달 원본 응답 (AI 추론 결과는 FHIR에 저장하지 않고 여기만)
    risk_level         VARCHAR(20),                              -- routine / urgent / critical
    summary            TEXT,
    synced_to_fhir     BOOLEAN NOT NULL DEFAULT FALSE,           -- 호환용 (현재 미사용)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (encounter_id, modality)
);

CREATE INDEX IF NOT EXISTS idx_mr_enc        ON modal_results(encounter_id);
CREATE INDEX IF NOT EXISTS idx_mr_subject    ON modal_results(subject_id);
CREATE INDEX IF NOT EXISTS idx_mr_risk       ON modal_results(risk_level);
CREATE INDEX IF NOT EXISTS idx_mr_created    ON modal_results(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mr_sr         ON modal_results(service_request_id);
-- JSONB 내부 필드 인덱스 (자주 쿼리할 시)
CREATE INDEX IF NOT EXISTS idx_mr_raw_gin    ON modal_results USING GIN (raw_response);

-- ================================================================
-- 3. diagnostic_reports: 종합 판단 결과 (Bedrock 출력 + 의사 수정)
-- ================================================================
CREATE TABLE IF NOT EXISTS diagnostic_reports (
    id                 BIGSERIAL PRIMARY KEY,
    encounter_id       TEXT NOT NULL REFERENCES encounters(encounter_id) ON DELETE CASCADE,
    subject_id         VARCHAR(20),                                -- encounter_id의 MIMIC subject_id (트리거 자동 채움)
    fhir_report_id     VARCHAR(64),
    ai_diagnosis       TEXT,
    ai_recommendations JSONB DEFAULT '[]'::jsonb,
    ai_risk_level      VARCHAR(20),
    physician_edits    TEXT,
    status             VARCHAR(20) NOT NULL DEFAULT 'preliminary',  -- preliminary / signed / amended
    signed_by          VARCHAR(64),
    signed_at          TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (encounter_id)  -- 1 encounter = 1 소견서 (재생성 시 UPSERT)
);

CREATE INDEX IF NOT EXISTS idx_dr_enc     ON diagnostic_reports(encounter_id);
CREATE INDEX IF NOT EXISTS idx_dr_subject ON diagnostic_reports(subject_id);
CREATE INDEX IF NOT EXISTS idx_dr_status  ON diagnostic_reports(status, created_at DESC);

-- updated_at 자동 갱신 트리거
CREATE OR REPLACE FUNCTION _bump_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_dr_updated_at ON diagnostic_reports;
CREATE TRIGGER trg_dr_updated_at
BEFORE UPDATE ON diagnostic_reports
FOR EACH ROW EXECUTE FUNCTION _bump_updated_at();

-- ================================================================
-- 4. modal_events: WebSocket 이벤트 로그 (디버그/재전송 대비)
-- ================================================================
CREATE TABLE IF NOT EXISTS modal_events (
    id           BIGSERIAL PRIMARY KEY,
    encounter_id TEXT,
    subject_id   VARCHAR(20),                          -- encounter_id의 MIMIC subject_id (트리거 자동 채움)
    event_type   VARCHAR(40) NOT NULL,
    payload      JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_me_enc_time ON modal_events(encounter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_me_subject  ON modal_events(subject_id);
CREATE INDEX IF NOT EXISTS idx_me_type     ON modal_events(event_type);

-- ================================================================
-- 5. subject_id 자동 채움 트리거
--    encounter_id로 INSERT/UPDATE 시 encounters에서 subject_id 룩업해 자동 세팅.
--    수동으로 NULL이 아닌 값을 명시했다면 그대로 보존.
-- ================================================================
CREATE OR REPLACE FUNCTION _fill_subject_id() RETURNS TRIGGER AS $$
BEGIN
    IF NEW.subject_id IS NULL AND NEW.encounter_id IS NOT NULL THEN
        SELECT subject_id INTO NEW.subject_id
        FROM encounters
        WHERE encounter_id = NEW.encounter_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_mr_fill_subject  ON modal_results;
CREATE TRIGGER trg_mr_fill_subject
BEFORE INSERT OR UPDATE OF encounter_id ON modal_results
FOR EACH ROW EXECUTE FUNCTION _fill_subject_id();

DROP TRIGGER IF EXISTS trg_dr_fill_subject  ON diagnostic_reports;
CREATE TRIGGER trg_dr_fill_subject
BEFORE INSERT OR UPDATE OF encounter_id ON diagnostic_reports
FOR EACH ROW EXECUTE FUNCTION _fill_subject_id();

DROP TRIGGER IF EXISTS trg_me_fill_subject  ON modal_events;
CREATE TRIGGER trg_me_fill_subject
BEFORE INSERT OR UPDATE OF encounter_id ON modal_events
FOR EACH ROW EXECUTE FUNCTION _fill_subject_id();
