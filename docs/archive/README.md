# docs/archive — 보관용 옛 문서

> 더 이상 활성 문서가 아닙니다. 참고용으로만 보관 (git history와 별개로 파일 자체를 남겨둠).
> 새 코드 작업 시에는 **루트 `README.md` → "문서 지도" 섹션**을 따라 최신 문서를 보세요.

## 보관 사유별 분류

### 모달 학습 시절 (4월)
ECG/CXR/LAB 모델 학습 단계의 설계·전처리 문서. 모델은 EC2/ECS로 배포 완료되어
실제 운영에선 `ecg-svc/`, `chest-svc-pre/`, `Lab-svc/` 폴더의 README 참고.

- `ECG-MIMIC-Signal-Preprocessing.md`
- `ECG-Modal-Pipeline-Overview.md`
- `ECG-Preprocessing-Pipeline.md`
- `ECG-Training-Design.md`
- `MIMIC-IV-ECG-Analysis.md`
- `Urgency-Weighted-Loss.md`

### 4월 초안 — 이후 AWS/ 폴더로 갱신됨
- `Clinical-Report-Flow.md` → `final/central/README.md`
- `DB-Architecture.md` → `AWS/AWS_DB_Design_v3.md` + `AWS/aurora-serverless/`
- `DB_Schema_Design.md` → `AWS/aurora-serverless/schema.yaml` (IaC가 진실원)
- `Infra-Architecture.md` → `AWS/` 전체 폴더
- `Final-Project-Architecture.md` → 루트 `README.md`

### 통합 작업 시점 메모 (1회성)
- `HANDOFF.md`
- `INTEGRATION_COMPLETE.md`
- `INTEGRATION_STATUS.md`
- `SUMMARY.md`
- `VERIFICATION_CHECKLIST.md`
- `FRONTEND-SPEC.md` (React 코드가 실제 spec)

### 기타
- `presentation_content.md` — 발표 자료
- `TEAM_DM.md` — 팀 DM 메모

---

> ⚠️ 이 폴더의 문서를 새 작업의 기준으로 삼지 마세요. 최신 정보는 활성 문서에 있습니다.
