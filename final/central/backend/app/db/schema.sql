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
    last_reminder_at   TIMESTAMPTZ,                                -- 5분 미서명 FCM 리마인더 발송 시각 (스팸 방지)
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (encounter_id)  -- 1 encounter = 1 소견서 (재생성 시 UPSERT)
);

CREATE INDEX IF NOT EXISTS idx_dr_enc     ON diagnostic_reports(encounter_id);
CREATE INDEX IF NOT EXISTS idx_dr_subject ON diagnostic_reports(subject_id);
CREATE INDEX IF NOT EXISTS idx_dr_status  ON diagnostic_reports(status, created_at DESC);
-- 리마인더 워커가 미서명 + 시간 경과한 row 빠르게 찾도록 부분 인덱스
CREATE INDEX IF NOT EXISTS idx_dr_unsigned_reminder
    ON diagnostic_reports(created_at, last_reminder_at)
    WHERE status <> 'signed';

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


-- ================================================================
-- 6. fhir_sync_queue: HAPI 동기화 백로그 (Graceful Degradation)
--    HAPI 일시 다운 시 운영 DB INSERT는 정상 진행되고,
--    HAPI 동기화는 이 큐에 적재 → retry worker가 백필.
--    의사 화면은 HAPI 다운을 모르고 정상 동작.
-- ================================================================
CREATE TABLE IF NOT EXISTS fhir_sync_queue (
    id            BIGSERIAL PRIMARY KEY,
    encounter_id  TEXT NOT NULL,
    patient_id    TEXT,
    resource_type VARCHAR(40) NOT NULL,                  -- Patient/Encounter/ServiceRequest/Condition/...
    resource_id   TEXT NOT NULL,                         -- 우리가 발급한 UUID (PUT 대상)
    payload       JSONB NOT NULL,                        -- HAPI에 보낼 FHIR JSON 원본
    status        VARCHAR(20) NOT NULL DEFAULT 'pending', -- pending / synced / failed
    retry_count   INTEGER NOT NULL DEFAULT 0,
    last_error    TEXT,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    synced_at     TIMESTAMPTZ
);

-- 부분 인덱스 — pending row만 빠르게 (성능 최적화)
CREATE INDEX IF NOT EXISTS idx_fsq_pending
    ON fhir_sync_queue(status, created_at)
    WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_fsq_encounter
    ON fhir_sync_queue(encounter_id);

-- ================================================================
-- 7. device_tokens: 모바일 푸시 알림 토큰 (FCM / APNs / Web Push)
--    Flutter 앱이 시작 시 POST /devices/register 로 토큰 업서트.
--    백엔드는 critical 이벤트 발생 시 활성 토큰들에 푸시 발송.
-- ================================================================
CREATE TABLE IF NOT EXISTS device_tokens (
    id           BIGSERIAL PRIMARY KEY,
    user_id      TEXT,                                  -- Cognito sub or physician id (nullable: 익명 단말 허용)
    token        TEXT NOT NULL UNIQUE,                  -- FCM/APNs 푸시 토큰 (UPSERT 키)
    platform     VARCHAR(20) NOT NULL,                  -- 'ios' | 'android' | 'web'
    app_version  VARCHAR(20),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),    -- 같은 토큰 재등록 시 갱신
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dt_user     ON device_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_dt_platform ON device_tokens(platform);
-- 활성 토큰만 빠르게 — 30일 내 last_seen
CREATE INDEX IF NOT EXISTS idx_dt_active   ON device_tokens(last_seen_at DESC);
