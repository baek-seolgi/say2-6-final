# mobile — 의사용 say-6 모바일 앱

> Flutter 기반 iOS/Android 앱. 응급실 의사가 폰으로 환자 정보 조회·AI 권고 승인·소견서 검토/서명할 수 있게 한다.
> 백엔드(`final/central/backend/`)와 웹 프론트(`frontend/`)는 그대로 — 같은 FastAPI API를 호출하는 두 번째 클라이언트.

---

## 동기

응급실은 규모가 커서 의사가 모니터링 스테이션 앞에 항시 있을 수 없다.
폰으로 critical 환자 푸시 알림 → 1탭 승인 → 소견서 서명까지 가능하면 시간 단축.

## 아키텍처 위치

```
                  ┌──────────────────────────┐
                  │   FastAPI 백엔드          │
                  │   (final/central/backend) │
                  │   ★ 그대로 유지 ★         │
                  └─────────┬────────────────┘
                            │ HTTP/WebSocket/FCM
            ┌───────────────┼───────────────┐
            ▼               ▼               ▼
    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
    │  Web 프론트   │  │  Mobile App  │  │   ...        │
    │  Vite/React  │  │  Flutter     │  │              │
    │  frontend/   │  │  mobile/     │  │              │
    └──────────────┘  └──────────────┘  └──────────────┘
       의사 PC           의사 폰
```

→ 백엔드 코드 한 줄도 안 바뀜. mobile/은 같은 `/orders/:id/approve`, `/reports/:id/sign` 등을 Dart로 호출.

---

## 기술 선택

- **Framework**: Flutter (의료 폼·리스트 UI + iOS/Android 단일 코드베이스)
- **상태 관리**: `flutter_riverpod` (DI + 컴파일 안전)
- **라우팅**: `go_router` (딥링크/푸시 알림 라우팅)
- **HTTP**: `dio` (인터셉터: 토큰 갱신·재시도·로깅)
- **모델**: `freezed` + `json_serializable` (immutable, sealed union)
- **보안 저장**: `flutter_secure_storage` (iOS Keychain / Android Keystore)
- **생체 인증**: `local_auth` (Face ID / Touch ID)
- **푸시**: `firebase_messaging` (FCM + APNs)
- **WebSocket**: `web_socket_channel`
- **서명 캡처**: `signature` 패키지
- **이미지 캐시**: `cached_network_image` (CXR S3 presigned URL)

자세한 비교/선정 근거는 (TBD: 의사결정 문서 작성 예정).

---

## 프로젝트 구조 (계획)

```
mobile/
├── lib/
│   ├── main.dart
│   ├── app.dart                  # MaterialApp + theme + router
│   ├── router.dart               # go_router 정의
│   ├── core/
│   │   ├── config.dart           # API_BASE_URL, FCM 설정
│   │   ├── api/                  # Dio client + endpoints
│   │   │   ├── client.dart
│   │   │   ├── patients_api.dart
│   │   │   ├── orders_api.dart
│   │   │   └── reports_api.dart
│   │   ├── models/               # Patient, AIRec, Report (freezed)
│   │   └── auth/
│   │       ├── auth_state.dart   # Riverpod provider
│   │       └── biometric.dart
│   ├── features/
│   │   ├── auth/                 # 로그인 + 생체 게이트
│   │   ├── worklist/             # 환자 목록
│   │   ├── patient/              # 환자 상세 + AI 권고 + 직접 오더
│   │   ├── report/               # 소견서 뷰어/편집/서명
│   │   └── notifications/        # FCM 핸들러
│   └── shared/
│       ├── widgets/              # KtasBadge, RiskBadge 등
│       └── theme/                # vuno 컬러 토큰
├── android/                      # flutter create 시 생성
├── ios/                          # flutter create 시 생성
├── pubspec.yaml                  # flutter create 시 생성
└── README.md                     # 이 파일
```

---

## Phase 로드맵

### Phase 1 (MVP, 약 2주) — 핵심 가치: 푸시 + 빠른 승인
- 로그인 (Face ID/Touch ID)
- 환자 목록 (KTAS 정렬, 폴링)
- 환자 상세 + AI 권고 1탭 승인
- FCM 푸시 수신 → 환자 상세 딥링크

### Phase 2 (3~4주) — 소견서 검토·서명
- A4 소견서 미리보기 (`ReportPrintSheet`를 Dart로 포팅)
- 터치 서명 캡처 + 생체 인증
- 서명 후 EMR 전송

### Phase 3 (선택) — 검사 결과 상세
- ECG 12-Lead 뷰어 (zoom/pan)
- CXR PACS 뷰어 (pinch zoom)
- LAB 표

---

## 백엔드 추가 작업 (Flutter와 무관, 먼저 진행 가능)

1. `POST /devices/register {token, platform: ios|android}` — FCM/APNs 토큰 저장
2. 이벤트 발생 시 푸시 디스패치 — `triage.submit` / `modal_completed` / `report_ready`
3. (선택) 모바일용 lean 응답 — payload 사이즈 ↓
4. 모바일 refresh token 정책 (30일 + 짧은 access token 10분)

---

## 의료 앱 보안 체크리스트

- [ ] 인증: Face ID/Touch ID 재인증 (앱 진입·서명 시)
- [ ] 세션: 5분 무활동 자동 잠금
- [ ] 단말 저장: `flutter_secure_storage` (디스크 캐시 금지)
- [ ] 화면 캡처 차단: Android `FLAG_SECURE`, iOS 워터마크
- [ ] 원격 wipe: MDM 또는 토큰 revocation
- [ ] 백엔드 audit log: 모든 환자 데이터 접근 기록

---

## 시작하기 (Flutter 설치 후)

```bash
# 1) Flutter SDK 설치 (macOS)
brew install --cask flutter

# 2) flutter doctor로 환경 점검
flutter doctor

# 3) 이 폴더에서 프로젝트 scaffold
cd mobile
flutter create . --org com.say6 --project-name say6_doctor --platforms ios,android

# 4) 의존성 설치
flutter pub get

# 5) 실행 (시뮬레이터/에뮬레이터 필요)
flutter run
```

---

## 출시 사전 결정 사항

1. **출시 OS** — iOS only / Android only / 둘 다? (iOS는 Apple Developer $99/년)
2. **푸시 인프라** — FCM 직접 / AWS SNS Mobile Push
3. **인증** — 기존 Cognito OAuth 재사용 / 별도 모바일 PIN
4. **API base URL** — dev/staging/prod 분리 (`--dart-define` 활용)
