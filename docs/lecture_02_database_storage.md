# 🗃️ 2교시 — 의무기록실과 영상보관소 설계 (Database & Storage)

> 📚 **과목**: Emergency Multimodal Diagnostic Orchestrator (say-6)
> 👨‍🏫 **담당**: 대규모 의료 데이터 모델링 / 클라우드 스토리지 아키텍처
> 🎯 **이번 시간 목표**: AI가 만들어내는 **다양한 모양의 데이터**를 어떻게 흘려보내지 않고 정리해서 쌓아두는지 — 의무기록실·영상보관소·작업 메모장의 분업 구조를 이해하기
> 📌 **선수 학습**: 1교시 (전체 동선)

---

## 🌱 들어가며 — DB가 두 개라는 첫 충격

> 신입 인턴: "교수님, 우리 시스템에 PostgreSQL DB가 두 개 있던데요? 하나로 합치면 안 되나요?"
> 교수님: "좋은 질문이에요. 합치면 안 되는 이유가 오늘 수업의 절반입니다."

이 시스템의 DB 구조를 처음 보면 헷갈리는 첫 의문: **DB가 2개 있다** (`central_db` + `hapi`) — 왜 한 개로 안 합쳤지?

오늘은 이 의문을 응급실의 **의무기록실 + 영상보관소 + 작업 메모장** 분업 구조에 비유해서 풀고, 우리 `central_db`의 6개 테이블이 어떻게 외래키로 엮이는지(별 모양 구조 / ERD) 차근차근 들여다봅니다.

---

## 🏥 1. 왜 데이터베이스가 두 개인가?

### 1.1 응급실의 진짜 모습 — 기록은 한 군데가 아니다

여러분이 응급실에 가본 적 있다면 의사가 동시에 여러 곳에 기록하는 걸 봤을 거예요:

| 응급실 기록 위치 | 무엇을 쓰나 | 누가 보나 |
|------------------|------------|-----------|
| 🗒️ **의사 손글씨 차트** | "환자 어딘가 아픈 표정, 진땀 흘림" 같은 자유 메모 | 응급실 의료진만 |
| 📋 **정식 진단서·청구서** | 상병 코드(ICD-10), 시술 코드, 약물 처방 정형 데이터 | 외부 병원·보험사·EMR |

이 둘은 **목적이 다르고, 양식이 다르고, 보는 사람이 달라요.** 그래서 분리합니다.

### 1.2 우리 시스템도 똑같이 분리

```
┌─────────────────────────────────────────────────────────┐
│   Aurora Serverless v2 클러스터 (say2-6team-aurora)      │
│                                                          │
│   ┌─────────────────┐         ┌─────────────────┐       │
│   │   central_db    │         │      hapi        │       │
│   │  (운영 메모장)    │         │   (의무기록실)    │       │
│   │                 │         │                  │       │
│   │  자유 양식        │         │  FHIR R4 표준    │       │
│   │  • AI 원본 결과    │         │  • Patient        │       │
│   │  • waveform JSON │         │  • Encounter     │       │
│   │  • 이벤트 로그      │         │  • ServiceRequest │       │
│   │  • 동기화 큐       │         │  • DiagnosticRpt │       │
│   │                 │         │                  │       │
│   │  ← 우리만 봄       │         │  외부 EMR도 봄     │       │
│   └────────┬────────┘         └────────┬─────────┘       │
│            │                            │                │
│            ▼                            ▼                │
│      백엔드가 직접 SQL          HAPI 서버가 자동 관리      │
└─────────────────────────────────────────────────────────┘
```

> 💡 **요점** — 같은 Aurora 클러스터 **한 대** 안에 **데이터베이스 2개**를 만들었어요. 인프라 비용은 1개분, 논리적 분리는 2개분.

### 1.3 왜 이렇게 분리했나? — 3가지 충돌하는 요구사항

| 요구사항 | 표준 DB (hapi) | 운영 DB (central_db) |
|---------|---------------|---------------------|
| **외부 EMR과 호환** | ✅ 필수 — FHIR R4 표준 | ❌ 우리만 쓰니까 무관 |
| **자유로운 스키마** | ❌ FHIR 양식 엄격 (필드 추가 불가) | ✅ AI 응답이 모달마다 다름 |
| **쓰기 속도** | ❌ HAPI 서버 거치므로 느림 (50~200ms) | ✅ asyncpg 직빵 (1~5ms) |
| **AI waveform 저장** | ❌ FHIR는 1000×12 배열 같은 거 못 담음 | ✅ JSONB로 그대로 저장 |
| **이벤트 로그 (modal_started, ...)** | ❌ FHIR에 그런 리소스 없음 | ✅ 자유롭게 schema 설계 |

**한 DB로 다 하려고 했다면?**
- FHIR만 쓰면: AI waveform·이벤트·재시도 큐를 욱여넣어야 함 → 표준 위반, 외부 호환성 깨짐
- 자유 양식만 쓰면: 외부 EMR과 호환 안 됨 → 병원 도입 불가
- **둘 다 필요하므로 둘 다 만들었다.**

### 1.4 의사가 서명하는 순간 — 두 DB의 교차

```
🗒️ central_db.diagnostic_reports (Bedrock 초안)
              │
              │ 의사 검토 + 서명
              ▼
📋 hapi DB의 DiagnosticReport.status = "final"  (외부 EMR로 송출 가능)
```

- AI가 만든 초안은 우리만 봄 → central_db
- 의사가 서명한 final 문서만 외부 표준으로 → hapi DB
- **공식화의 경계선이 명확함.**

---

## ⭐ 2. central_db 별 모양 구조 (Star Schema)

### 2.1 6개 테이블 — encounters를 중심으로

`encounters`(환자 방문 사건)를 한가운데 두고, 나머지 5개가 외래키(FK)로 별처럼 연결됩니다.

```
                    ┌──────────────┐
                    │   patients   │   👤 환자 인적 정보
                    │  (subject_id) │      (이름, 생년월일, 성별 ...)
                    └──────┬───────┘
                           │ 1
                           │
                           ▼ N
       ┌─────────────────────────────────────────┐
       │              encounters                 │   ⭐ 한 환자의 한 번의 응급실 방문
       │  • encounter_id (UUID, HAPI Encounter)  │      모든 데이터의 중심축
       │  • subject_id   (FK → patients)         │
       │  • chief_complaint / vitals / acuity    │
       │  • created_at                           │
       └───┬──────────────┬──────────────┬───────┘
           │ 1            │ 1            │ 1
           │              │              │
           ▼ N            ▼ N            ▼ 0..1
   ┌──────────────┐ ┌──────────────┐ ┌──────────────────┐
   │ modal_results│ │ modal_events │ │ diagnostic_reports│
   │ (ECG/CXR/LAB)│ │ (타임라인)     │ │  (Bedrock 소견)    │
   │              │ │               │ │                  │
   │ raw_response │ │ event_type    │ │ summary           │
   │   JSONB +    │ │ payload JSONB │ │ risk_level        │
   │   GIN index  │ │               │ │ ai_diagnosis     │
   └──────────────┘ └──────────────┘ └──────────────────┘

                    ┌──────────────────┐
                    │ fhir_sync_queue  │   🔁 HAPI 다운 시 재시도 큐
                    │                  │      (encounter_id 참조하지만
                    │ encounter_id     │       FK 강제는 안 함 — 큐는
                    │ resource_type    │       빠르게 비워야 하므로)
                    │ payload JSONB    │
                    │ retry_count      │
                    └──────────────────┘
```

### 2.2 왜 별 모양(Star Schema)인가?

데이터 웨어하우스에서 자주 보는 패턴인데, 이유는 단순합니다:

1. **"이 환자의 모든 것"** 을 한 방에 조회 가능
   ```sql
   SELECT * FROM encounters e
     LEFT JOIN modal_results r  ON r.encounter_id = e.encounter_id
     LEFT JOIN modal_events ev ON ev.encounter_id = e.encounter_id
     LEFT JOIN diagnostic_reports dr ON dr.encounter_id = e.encounter_id
     WHERE e.encounter_id = '56774473-...';
   ```
2. **JOIN 깊이가 얕음** (1단계만) → 빠름
3. **외래키 일관성 보장**: `encounter_id` 한 줄이 사라지면 그에 연결된 모든 모달 결과/이벤트도 같이 정리됨 (`ON DELETE CASCADE`)

### 2.3 각 테이블 핵심 컬럼만

#### 👤 `patients`
```sql
CREATE TABLE patients (
    subject_id     VARCHAR(20) PRIMARY KEY,    -- MIMIC subject_id
    name           VARCHAR(100),
    birth_date     DATE,
    sex            CHAR(1),                     -- M / F
    created_at     TIMESTAMP DEFAULT NOW()
);
```

#### ⭐ `encounters` (별의 중심)
```sql
CREATE TABLE encounters (
    encounter_id      UUID PRIMARY KEY,         -- HAPI FHIR Encounter resource id와 동일
    subject_id        VARCHAR(20) REFERENCES patients(subject_id),
    chief_complaint   TEXT,
    vitals            JSONB,                    -- HR, BP, SpO2 등 자유 형식
    acuity            SMALLINT,                  -- 1=가장 위급, 5=가장 경증
    created_at        TIMESTAMP DEFAULT NOW(),
    -- 인덱스
    INDEX idx_e_subject (subject_id),
    INDEX idx_e_created (created_at DESC)
);
```

**핵심**: `encounter_id`는 우리가 발급한 UUID인데, **HAPI FHIR의 `Encounter.id`와 같은 값**을 씁니다. 두 DB 간 다리 역할을 하는 키예요.

#### 🩺 `modal_results` (AI 원본 응답)
```sql
CREATE TABLE modal_results (
    id                BIGSERIAL PRIMARY KEY,
    encounter_id      UUID REFERENCES encounters(encounter_id) ON DELETE CASCADE,
    modality          VARCHAR(16),               -- 'ECG' / 'CXR' / 'LAB'
    raw_response      JSONB NOT NULL,            -- 🌟 모달 응답 전체 (waveform 포함)
    risk_level        VARCHAR(20),               -- routine / urgent / critical
    summary           TEXT,
    synced_to_fhir    BOOLEAN DEFAULT false,
    created_at        TIMESTAMP DEFAULT NOW(),
    UNIQUE (encounter_id, modality)              -- 한 방문당 모달 1건
);
```

#### 🕒 `modal_events` (타임라인)
```sql
CREATE TABLE modal_events (
    id            BIGSERIAL PRIMARY KEY,
    encounter_id  UUID REFERENCES encounters(encounter_id),
    event_type    VARCHAR(40),                  -- 'modal_started' / 'modal_completed' / 'report_generated'
    payload       JSONB DEFAULT '{}',
    created_at    TIMESTAMP DEFAULT NOW(),
    INDEX idx_me_enc_time (encounter_id, created_at DESC)
);
```

**용도**: 프론트 타임라인 UI ("진료 진행 상황") + 디버깅용 감사 로그.

#### 📄 `diagnostic_reports` (Bedrock 종합 소견)
```sql
CREATE TABLE diagnostic_reports (
    id                BIGSERIAL PRIMARY KEY,
    encounter_id      UUID REFERENCES encounters(encounter_id) ON DELETE CASCADE,
    summary           TEXT,                      -- 종합 소견 한국어 마크다운
    risk_level        VARCHAR(20),
    ai_diagnosis      JSONB,                     -- {primary: "STEMI", secondary: [...], ...}
    similar_cases     JSONB,                     -- RAG로 찾은 유사 케이스 5건
    physician_signed  BOOLEAN DEFAULT false,
    signed_at         TIMESTAMP,
    created_at        TIMESTAMP DEFAULT NOW()
);
```

#### 🔁 `fhir_sync_queue` (재시도 큐)
```sql
CREATE TABLE fhir_sync_queue (
    id              BIGSERIAL PRIMARY KEY,
    encounter_id    UUID,                        -- FK 강제 X (큐는 빠르게 비워야 함)
    resource_type   VARCHAR(40),                 -- 'Patient' / 'Encounter' / 'ServiceRequestTransition'
    payload         JSONB NOT NULL,
    retry_count     INT DEFAULT 0,
    last_error      TEXT,
    created_at      TIMESTAMP DEFAULT NOW(),
    next_attempt    TIMESTAMP DEFAULT NOW()
);
```

**역할**: HAPI FHIR가 일시 다운됐을 때 운영 흐름이 멈추지 않도록 큐에 적재 → 5분마다 워커가 재시도 → 성공 시 row 삭제.

> 💡 **이걸 왜 hapi DB에 안 넣고 central_db에 넣었나?**
> 큐의 본질은 "외부 시스템(HAPI)이 죽었을 때의 buffer"예요. 그 buffer를 죽은 시스템 안에 두면 의미가 없겠죠. **항상 살아있는 우리 운영 DB**에 두는 게 맞습니다.

### 2.4 mermaid ER 다이어그램 (Aurora `central_db`)

```mermaid
erDiagram
    PATIENTS ||--o{ ENCOUNTERS : "1 - N"
    ENCOUNTERS ||--o{ MODAL_RESULTS : "1 - N"
    ENCOUNTERS ||--o{ MODAL_EVENTS : "1 - N"
    ENCOUNTERS ||--o| DIAGNOSTIC_REPORTS : "1 - 0..1"
    ENCOUNTERS ..o{ FHIR_SYNC_QUEUE : "logical ref (no FK)"

    PATIENTS {
        varchar20 subject_id PK
        varchar100 name
        date birth_date
        char1 sex
    }
    ENCOUNTERS {
        uuid encounter_id PK
        varchar20 subject_id FK
        text chief_complaint
        jsonb vitals
        smallint acuity
        timestamp created_at
    }
    MODAL_RESULTS {
        bigint id PK
        uuid encounter_id FK
        varchar16 modality
        jsonb raw_response "모달 응답 전체"
        varchar20 risk_level
        text summary
        bool synced_to_fhir
    }
    MODAL_EVENTS {
        bigint id PK
        uuid encounter_id FK
        varchar40 event_type
        jsonb payload
        timestamp created_at
    }
    DIAGNOSTIC_REPORTS {
        bigint id PK
        uuid encounter_id FK
        text summary
        varchar20 risk_level
        jsonb ai_diagnosis
        jsonb similar_cases
        bool physician_signed
    }
    FHIR_SYNC_QUEUE {
        bigint id PK
        uuid encounter_id
        varchar40 resource_type
        jsonb payload
        int retry_count
    }
```

---



## 📂 3. S3 스토리지 — 크고 무거운 건 DB 밖으로

### 3.1 DB에 큰 파일 넣으면 어떻게 되나?

이론적으론 PostgreSQL의 `bytea`나 JSONB로 ECG `.dat` 파일도 넣을 수 있습니다. **근데 그러면 안 돼요.**

| 항목 | DB에 직접 저장 | S3 + URL 참조 |
|------|---------------|----------------|
| **파일 크기 1MB** | DB 백업·복제 시 같이 따라다님 | S3에 한 번만, DB는 URL 한 줄 |
| **저장 비용** | RDS 스토리지 ($0.115/GB/월) | S3 Standard ($0.025/GB/월) — 4.6배 저렴 |
| **백업 속도** | 거대해져서 점점 느려짐 | DB 백업 빠름, S3는 별도 버저닝 |
| **CDN 가속** | 못 함 | CloudFront로 의사 폰까지 빠르게 전송 가능 |
| **읽기 동시성** | DB 커넥션 풀 소모 | S3는 사실상 무제한 |

### 3.2 우리 시스템의 분리 원칙

```
정형 메타데이터 (검색·조회 자주)  →  Aurora DB
└─ encounter_id, subject_id, modality, risk_level, summary

비정형 작은 데이터 (모달 응답 JSON)  →  Aurora DB의 JSONB
└─ findings, ecg_vitals, all_probs, waveform (작으면 같이)

거대 바이너리 (.hea / .dat / .png)  →  S3
└─ DB에는 URL 한 줄만 참조
```

### 3.3 S3 Prefix 분리 — MIMIC 원본 데이터

```
say2-6team/                                    ← S3 버킷
├── mimic/
│   ├── ecg/
│   │   ├── ecg_s6.onnx                       ← 모델 파일 (모달 컨테이너가 시작 시 로드)
│   │   ├── ecg_s6.onnx.data
│   │   └── waveforms/
│   │       └── files/p1000/p10000032/s40689238/
│   │           ├── 40689238.hea              ← WFDB 헤더 (626B)
│   │           └── 40689238.dat              ← WFDB 신호 (120KB)
│   ├── cxr/
│   │   └── files/p10/p10000980/s50414267/
│   │       └── 50414267-...jpg               ← X-ray 이미지 (~1MB)
│   └── labevents/
│       └── per_subject/
│           └── 10000032.json                  ← 환자별 혈액검사
```

**Prefix 분리의 이점**:
- IAM 권한을 prefix 단위로 좁힐 수 있음 (예: ECG 모달 IAM은 `mimic/ecg/*`만 허용)
- 라이프사이클 정책: `mimic/ecg/waveforms/*`는 30일 후 Glacier로 (조회 적음 + 비용 절감)
- S3 Select로 prefix 안 JSON 일부만 빠르게 추출 가능

### 3.4 FHIR `DocumentReference` — 표준 방식의 URL 참조

FHIR R4에는 이런 패턴을 위해 **`DocumentReference`** 리소스가 정확히 준비돼있습니다.

```json
{
  "resourceType": "DocumentReference",
  "id": "ref-12345",
  "status": "current",
  "type": {
    "coding": [{"system": "http://loinc.org", "code": "11522-0", "display": "ECG 12-lead"}]
  },
  "subject": {"reference": "Patient/p10000032"},
  "context": {
    "encounter": [{"reference": "Encounter/56774473-..."}]
  },
  "content": [{
    "attachment": {
      "contentType": "application/wfdb",
      "url": "s3://say2-6team/mimic/ecg/waveforms/files/p1000/p10000032/s40689238/40689238",
      "size": 120626,
      "creation": "2026-05-17T12:23:01Z"
    }
  }]
}
```

**이 패턴의 4가지 이점**:

1. **DB는 가벼움** — URL + 메타데이터만, 1KB 미만
2. **FHIR 표준 호환** — 다른 병원 EMR도 똑같이 `DocumentReference`로 X-ray 참조
3. **권한 통제** — S3에 직접 접근 못하게 막고, 백엔드가 pre-signed URL로 임시 제공 가능
4. **다양한 미디어 지원** — DICOM, PDF, JPEG, WFDB ... `contentType`만 바꾸면 됨

### 3.5 실제 동선 — orchestrator가 S3와 DB를 어떻게 함께 쓰나?

```
1️⃣ 환자 등록
   orchestrator → 🗃️ Aurora central_db.encounters INSERT
                → 📁 hapi DB Patient + Encounter 등록 (HAPI 서버 경유)

2️⃣ ECG 검사 시
   orchestrator → 📂 S3에서 .hea + .dat 다운로드 (base64 인코딩)
                → ecg-svc /predict (base64 전달, S3 직접 접근 X)
                ← ECG findings + waveform JSON 응답
                → 🗃️ Aurora central_db.modal_results INSERT
                       (raw_response JSONB에 findings + waveform 함께 저장 — waveform이 1000×12라 수십 KB 정도라 JSONB OK)
                → 📁 hapi DB에 ServiceRequest 상태 변경 + DocumentReference 생성
                       (DocumentReference.attachment.url = "s3://...")

3️⃣ 의사 화면 조회
   React → orchestrator GET /api/encounters/{id}/modal/ecg
        → 🗃️ Aurora central_db.modal_results 조회 (waveform JSONB 포함 즉시 반환)
        → 화면에서 D3.js로 waveform 시각화
```

> 💡 **포인트**
> waveform은 우리가 JSONB에 같이 넣었어요 — 1000×12 = 12000 float, 압축하면 80KB 정도라 JSONB가 합리적입니다.
> 만약 **MRI 같은 100MB짜리** 데이터라면 무조건 S3로 빼고 DB에는 URL만.

---

## 🎯 4. 한 페이지 요약

```
1. Aurora 클러스터 1개 안에 DB 2개:
   ├─ central_db = 우리 병원 작업 메모장 (자유 양식, 빠름)
   └─ hapi      = 의무기록실 (FHIR 표준, 외부 호환)

2. central_db는 encounters를 중심으로 별 모양:
   patients - encounters - {modal_results, modal_events, diagnostic_reports, fhir_sync_queue}

3. 큰 바이너리(.hea/.dat/.png/MRI)는 S3에 두고 DB에는 URL만:
   FHIR DocumentReference 리소스로 표준화 → 외부 EMR도 같은 방식으로 참조 가능.
```

---

## 📝 5. 쪽지 시험 (5분)

**Q1.** 같은 Aurora 클러스터 안에 `central_db`와 `hapi` 두 DB를 굳이 분리한 가장 큰 이유 2가지를 쓰시오.

**Q2.** `encounter_id` 컬럼이 두 DB(`central_db.encounters`와 `hapi.Encounter`)에서 같은 값을 가져야 하는 이유는?

**Q3.** `central_db`를 별 모양 구조로 짠 이점을 한 문장으로 설명하시오.

**Q4.** ECG `.dat` 파일이 120KB일 때 DB(JSONB)에 base64로 같이 넣어도 될까? MRI `.dcm` 파일이 100MB라면?

**Q5.** `fhir_sync_queue` 테이블은 왜 `hapi` DB가 아니라 `central_db`에 있어야 하는가?

---

<details>
<summary>✅ 정답 펼치기</summary>

**A1.** ① HAPI FHIR는 표준이라 양식 엄격 → AI waveform·자유 이벤트 못 담음. central_db는 자유 양식 가능. ② HAPI 서버 거치는 쓰기는 느림 → 운영 DB는 직접 SQL로 빠름. ③ 책임 분리 — 외부 EMR 호환은 HAPI만, 내부 운영은 central_db만.

**A2.** 두 DB 사이의 다리 역할. 같은 환자 방문을 양쪽에서 가리킬 때 다른 ID 쓰면 매번 변환 테이블 필요 → 운영 비용 ↑. UUID 한 번 만들어서 양쪽이 공유.

**A3.** `encounters`를 중심에 두면 "이 환자 방문의 모달 결과·이벤트·소견" 을 1단계 JOIN으로 즉시 조회할 수 있고, `ON DELETE CASCADE`로 외래키 일관성도 자동 보장된다.

**A4.** ① 120KB는 JSONB OK (압축하면 더 작아짐, 의사가 조회할 때 같이 보여줘야 하므로 한 row에 있는 게 효율적). ② 100MB는 S3 필수 — DB 백업·복제가 그만큼 무거워짐, 비용 4.6배, 의사 모바일 전송 시 CDN 못 씀. FHIR DocumentReference로 URL만 참조.

**A5.** 큐의 본질은 "외부 시스템(HAPI) 다운 시 buffer". buffer를 죽은 시스템 안에 두면 의미가 없음. 항상 살아있는 운영 DB에 두는 게 맞음.

</details>

---

## 🔮 6. 다음 시간 예고 — 3교시

> **"FHIR R4 9종 리소스 깊이 보기 — Patient, Encounter, ServiceRequest, Observation, DiagnosticReport, DocumentReference, Practitioner, ImagingStudy, Bundle"**
>
> 오늘 표면적으로 다룬 FHIR 리소스들을 실제 JSON 예제와 함께 한 줄씩 뜯어봅니다. **HAPI FHIR 서버가 내부적으로 이걸 어떻게 저장하는지**도 들춰봐요.

---

## 📚 더 읽어볼 거리

| 자료 | 무엇을 배우나 |
|------|-------------|
| [FHIR R4 — DocumentReference](https://www.hl7.org/fhir/documentreference.html) | 의료 미디어 참조 표준 |
| [Aurora Serverless v2 — Scaling](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/aurora-serverless-v2.html) | ACU 단위 자동 스케일링 |
| [Star Schema vs Snowflake](https://www.vertabelo.com/blog/data-warehouse-modeling-star-schema-vs-snowflake-schema/) | 분석용 DB의 두 가지 패턴 |
| [PostgreSQL — Foreign Keys / ON DELETE CASCADE](https://www.postgresql.org/docs/current/ddl-constraints.html) | 외래키 일관성 보장 |
| [S3 Storage Classes](https://aws.amazon.com/s3/storage-classes/) | Standard / IA / Glacier 비용·성능 트레이드오프 |

---

> 👨‍🏫 **마지막 한마디**
> 데이터 모델링은 **"미래의 나에게 보내는 편지"** 예요. 지금 잘 만들어두면 1년 뒤 새 기능 붙일 때 행복하고, 대충 만들면 1년 뒤 새벽 2시에 마이그레이션 스크립트 짜고 있게 됩니다.
>
> 우리가 오늘 본 6개 테이블 + 2개 DB 구조는 그 행복한 미래를 위한 첫 단추예요. 다음 시간엔 그 단추를 FHIR 양식에 맞춰 채우는 법을 배웁니다 🩺
