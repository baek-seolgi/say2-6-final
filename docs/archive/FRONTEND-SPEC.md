# 프론트엔드 요구사항 — 팀원용

## 참고 이미지

실제 병원 EMR 대시보드 스타일로 구현. 3단 레이아웃 (왼쪽 환자큐 / 가운데 상세 / 오른쪽 이력).

## 기술 스택

- React 18 + TypeScript
- Vite (빌드)
- Tailwind CSS (스타일)
- React Router (페이지 라우팅)
- WebSocket (실시간 업데이트)

스켈레톤이 `frontend/` 폴더에 이미 세팅돼 있음.
```bash
cd frontend
npm install
npm run dev
```

---

## 이미 만들어져 있는 것

| 파일 | 설명 |
|------|------|
| `src/lib/api.ts` | 백엔드 호출 함수 전부 구현됨 |
| `src/lib/types.ts` | TriageSubmission 타입 정의됨 |
| `vite.config.ts` | 백엔드 프록시 설정됨 (localhost:8000) |

**api.ts에 있는 함수들:**
```typescript
submitTriage(form)              // 트리아지 제출
approveOrder(srId)              // AI 제안 승인
rejectOrder(srId)               // AI 제안 기각
signReport(drId)                // 리포트 서명
connectEncounterWS(encounterId) // WebSocket 연결
```

---

## 만들어야 할 페이지 (5개)

### 1. 트리아지 페이지 (`/triage`)

간호사가 환자 정보를 직접 입력하는 폼.

```
┌─────────────────────────────────────────┐
│ 환자 등록 (트리아지)                      │
├─────────────────────────────────────────┤
│ 환자 정보                                │
│  나이: [    ] 성별: [남/여/기타 ▼]        │
│  이름: [         ] (선택)                │
├─────────────────────────────────────────┤
│ 바이탈 사인                              │
│  HR:  [   ] bpm    SBP: [   ] mmHg      │
│  DBP: [   ] mmHg   SpO2:[   ] %         │
│  RR:  [   ] /min   Temp:[   ] °C        │
│  GCS: [   ] /15                          │
├─────────────────────────────────────────┤
│ 주호소                                   │
│  [자유 텍스트 입력                    ]   │
│  ICD-10: [드롭다운 선택 ▼] (선택)        │
│  발생 시간: [   ] 분 전                  │
├─────────────────────────────────────────┤
│ 과거력                                   │
│  [고혈압          ] [x삭제]              │
│  [제2형 당뇨      ] [x삭제]              │
│  [+ 과거력 추가]                         │
├─────────────────────────────────────────┤
│              [제출]                       │
└─────────────────────────────────────────┘
```

**동작:**
- 제출 버튼 → `submitTriage(form)` 호출
- 성공 시 → `/dashboard/{encounter_id}`로 이동
- 응답에 `proposed_modalities`, `service_request_ids` 포함됨

**폼 타입 (types.ts에 정의됨):**
```typescript
{
  patient: { age, gender, name? },
  vitals: { hr, sbp, dbp, spo2, rr, temp, gcs },
  chief_complaint: { text, onset_minutes_ago?, code_hint? },
  past_history: [{ text, code_hint? }]
}
```

---

### 2. 대시보드 (`/dashboard/:encounterId`)

의사 메인 화면. 3단 레이아웃.

```
┌────────┬──────────────────────────────────────────┐
│ 환자큐  │ 환자 배너: 김OO / 65세 / 남 / 흉통        │
│        ├──────────────────────────────────────────┤
│ 김OO   │ 바이탈 패널                               │
│ 65/M   │ HR 112  BP 148/92  SpO2 96%  RR 18      │
│ 흉통   │ Temp 37.2  GCS 15                        │
│ ★긴급  ├──────────────────────────────────────────┤
│        │ AI 제안 (ServiceRequest)                  │
│ 박OO   │ ┌────────────────────────────────────┐   │
│ 72/F   │ │ 🔬 CXR 촬영 권고                    │   │
│ 호흡곤란│ │ 사유: chest pain → CXR 최우선        │   │
│        │ │ 우선순위: urgent                     │   │
│ 이OO   │ │ [승인 ✓]  [기각 ✗]                  │   │
│ 28/M   │ └────────────────────────────────────┘   │
│ 외상   │ ┌────────────────────────────────────┐   │
│        │ │ 💓 ECG 촬영 권고                    │   │
│        │ │ 사유: chest pain → ECG 권고          │   │
│        │ │ [승인 ✓]  [기각 ✗]                  │   │
│        │ └────────────────────────────────────┘   │
│        ├──────────────────────────────────────────┤
│        │ 모달 결과 (완료된 것)                      │
│        │ [ECG 탭] [CXR 탭] [LAB 탭]              │
│        │ ┌────────────────────────────────────┐   │
│        │ │ ECG: ST분절 상승 심근경색 (92%)      │   │
│        │ │ risk: critical                      │   │
│        │ │ [상세 보기 →]                       │   │
│        │ └────────────────────────────────────┘   │
│        ├──────────────────────────────────────────┤
│        │ [최종 리포트 생성 →]                      │
└────────┴──────────────────────────────────────────┘
```

**호출 API:**

| 영역 | API | 설명 |
|------|-----|------|
| 환자 배너 | 트리아지 응답의 patient_id 사용 | 이름, 나이, 성별, 주호소 |
| 바이탈 패널 | `GET /encounters/{id}/observations` | category=vital-signs 필터 |
| AI 제안 | `GET /encounters/{id}/service-requests` | status=draft인 SR 목록 |
| 승인 버튼 | `POST /orders/{id}/approve` | SR 상태 전이 + 모달 실행 |
| 기각 버튼 | `POST /orders/{id}/reject` | SR 기각 + AI 대안 제안 |
| 모달 결과 | `GET /encounters/{id}/observations` | category=imaging 필터 |
| 실시간 | `connectEncounterWS(encounterId)` | 모달 완료, 새 제안 등 |

**WebSocket 이벤트 (ws로 받는 것):**
```json
{"event": "initial_proposals", "next_modalities": ["CXR", "ECG"], ...}
{"event": "modal_completed", "modality": "CXR", "summary": "...", ...}
{"event": "modal_failed", "error": "...", ...}
{"event": "new_proposal", "modality": "LAB", ...}
{"event": "ready_for_report", ...}
```

---

### 3. ECG 결과 페이지 (`/ecg/:encounterId`)

ECG 모달 분석 결과 상세.

```
┌─────────────────────────────────────────┐
│ ECG 분석 결과                            │
├─────────────────────────────────────────┤
│ 12-lead ECG 파형 시각화                  │
│ ┌─────────────────────────────────────┐ │
│ │ I   ─────∧──∨───────∧──∨────      │ │
│ │ II  ─────∧──∨───────∧──∨────      │ │
│ │ III ─────∧──∨───────∧──∨────      │ │
│ │ ...                               │ │
│ └─────────────────────────────────────┘ │
├─────────────────────────────────────────┤
│ ECG Vitals                              │
│ HR: 88 bpm | 서맥: No | 빈맥: No       │
├─────────────────────────────────────────┤
│ 소견 (Findings)                         │
│ • acute_mi — 급성 심근경색 (92%) critical│
│   → 즉시 심장내과 협진 및 PCI 팀 호출    │
├─────────────────────────────────────────┤
│ [대시보드로 돌아가기]                     │
└─────────────────────────────────────────┘
```

**데이터 소스:**
- `GET /encounters/{id}/observations` → code=11524-6 (EKG) 필터
- ECG 파형 데이터는 Observation의 waveform 필드 또는 S3 URL에서 fetch

---

### 4. CXR 결과 페이지 (`/cxr/:encounterId`)

CXR 모달 분석 결과 상세.

```
┌─────────────────────────────────────────┐
│ CXR 분석 결과                            │
├──────────────────┬──────────────────────┤
│ 원본 이미지       │ 세그멘테이션 마스크    │
│ ┌──────────────┐ │ ┌──────────────────┐ │
│ │  CXR 원본    │ │ │ (히트맵 오버레이) │ │
│ └──────────────┘ │ └──────────────────┘ │
├──────────────────┴──────────────────────┤
│ 측정값: CTR 0.58 (정상 <0.50)           │
├─────────────────────────────────────────┤
│ 소견 (Findings)                         │
│ • Cardiomegaly — 심비대 (82%) moderate  │
│   → 심초음파 추가 검사 권고              │
├─────────────────────────────────────────┤
│ MIMIC-style Report                      │
│ FINDINGS: The cardiac silhouette is...  │
│ IMPRESSION: 1. Moderate cardiomegaly... │
├─────────────────────────────────────────┤
│ [대시보드로 돌아가기]                     │
└─────────────────────────────────────────┘
```

**데이터 소스:**
- `GET /encounters/{id}/observations` → code=36643-5 (CXR) 필터
- CXR 이미지/마스크는 S3 URL에서 fetch (metadata.mask_base64)

---

### 5. 리포트 페이지 (`/report/:encounterId`)

최종 SOAP 리포트 + 의사 서명.

```
┌─────────────────────────────────────────┐
│ 최종 SOAP 리포트                         │
├─────────────────────────────────────────┤
│ S: 65세 남성, 30분간 좌측 흉통...        │
│ O: HR 112, BP 148/92, SpO2 96%         │
│    ECG: ST elevation (inferior leads)   │
│    CXR: Cardiomegaly                    │
│ A: Anterior wall STEMI                  │
│ P: 즉시 cath lab 활성화, Aspirin 300mg  │
├─────────────────────────────────────────┤
│ 상태: preliminary (AI 생성)              │
│                                         │
│ [의사 서명 → final 확정]                 │
└─────────────────────────────────────────┘
```

**동작:**
- 서명 버튼 → `signReport(drId)` 호출
- 성공 시 상태 표시가 "final (확정)"으로 변경

---

## 만들어야 할 컴포넌트

```
frontend/src/
├── pages/
│   ├── TriagePage.tsx
│   ├── DashboardPage.tsx
│   ├── ECGResultPage.tsx
│   ├── CXRResultPage.tsx
│   └── ReportPage.tsx
├── components/
│   ├── PatientQueue.tsx     ← 왼쪽 환자 큐 리스트
│   ├── PatientBanner.tsx    ← 환자 배너 (이름/나이/성별/주호소)
│   ├── VitalsPanel.tsx      ← 바이탈 사인 표시
│   ├── ProposalCard.tsx     ← AI 제안 카드 (승인/기각 버튼)
│   ├── ModalTabs.tsx        ← ECG/CXR/LAB 탭 전환
│   ├── ECGWaveform.tsx      ← ECG 파형 차트
│   ├── CXRViewer.tsx        ← CXR 이미지 + 마스크 오버레이
│   └── SOAPReport.tsx       ← SOAP 리포트 표시 + 서명 버튼
├── lib/
│   ├── api.ts               ← 이미 구현됨 (건드리지 말 것)
│   └── types.ts             ← 이미 구현됨 (건드리지 말 것)
└── App.tsx                  ← 라우터 설정 추가 필요
```

---

## App.tsx 라우터 설정

```tsx
<Routes>
  <Route path="/" element={<DashboardPage />} />
  <Route path="/triage" element={<TriagePage />} />
  <Route path="/dashboard/:encounterId" element={<DashboardPage />} />
  <Route path="/ecg/:encounterId" element={<ECGResultPage />} />
  <Route path="/cxr/:encounterId" element={<CXRResultPage />} />
  <Route path="/report/:encounterId" element={<ReportPage />} />
</Routes>
```

---

## 백엔드 테스트 방법

프론트 개발 중 API 확인하려면:
```bash
# 백엔드 + FHIR 서버 띄우기
cd ../infra
docker compose up -d

# Swagger UI에서 API 직접 테스트
open http://localhost:8000/docs
```

---

## 주의사항

1. `src/lib/api.ts`와 `src/lib/types.ts`는 건드리지 말 것 (백엔드와 맞춰져 있음)
2. WebSocket 연결은 `connectEncounterWS(encounterId)` 사용
3. 백엔드 프록시가 vite.config.ts에 설정돼 있어서 `/triage`, `/orders` 등 상대경로로 호출하면 됨
4. Tailwind CSS 사용 (index.css에 이미 설정됨)
