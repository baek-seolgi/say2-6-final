# legacy-training — 모달 학습 시절 산출물

> 모델 학습·골든셋 평가·로컬 데모 시절의 코드와 데이터. 운영 코드에서 import 0건.
> 모델은 이미 `.onnx` / `.pkl`로 빌드되어 모달 서비스(`ecg-svc/`, `chest-svc-pre/`, `Lab-svc/`)에 배포됨.

| 파일 | 용도 |
|---|---|
| `train_ecg_s6.py` | ECG S6Backbone 학습 스크립트 |
| `export_onnx.py` | `best_model_s6.pt → ecg_s6.onnx` 1회성 변환 |
| `test_golden.py` | 골든셋 평가 |
| `streamlit_demo.py` | 초기 Streamlit 데모 (React 프론트로 대체) |
| `ecg_results_200_final.jsonl` | 골든셋 추론 결과 |
| `sampled_200_goldendataset.jsonl` | 골든셋 샘플 |

> 다시 모델을 재학습할 일이 생기면 참고용으로 꺼내 쓸 수 있도록 보관. 현재 운영엔 영향 없음.
