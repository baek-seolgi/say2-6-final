# iam-policies 리뷰용 JSON 정책 모음

이 폴더의 JSON 파일은 팀 리뷰 및 정책 원본 확인용입니다.

## 사용 방식

- 실제 배포는 `security-stack.yaml` (또는 `security-stack-rag.yaml`)에 포함된 inline policy/rule로 진행합니다.
- 이 JSON 파일들은 팀장이 요청한 폴더 구조에 맞춘 리뷰용 문서입니다.
- CloudFormation YAML이 로컬 JSON 파일을 자동으로 include하지는 않으므로, 배포용 템플릿과 리뷰용 JSON을 함께 관리합니다.

## 포함 파일

| 파일 | 목적 |
|---|---|
| `orchestrator-role.json` | Orchestrator ECS Task Role 권한 |
| `ecs-task-role.json` | ECG/CXR/LAB 공통 ECS Task Role 권한 템플릿 |
| `ecg-task-role.json` | ECG Task Role 리뷰용 |
| `cxr-task-role.json` | CXR Task Role 리뷰용 |
| `lab-task-role.json` | LAB Task Role 리뷰용 |
| `rag-task-role.json` | RAG Task Role 리뷰용 |
| `ecs-execution-role.json` | ECS Execution Role 추가 권한 |
| `kms-key-policy.json` | KMS Key Policy |
| `waf-rules.json` | Regional WAF rule 구성 (ALB 연결, Scope: REGIONAL) |

## 현재 역할 분리 기준

### Orchestrator
- 환자 요청 수신
- 필요한 모달 호출
- 모달 간단 소견 취합
- RAG 서비스에 검색 요청
- RAG Top-K 결과 + 모달 결과를 Bedrock에 전달
- 최종 소견 생성
- 최종 결과 DB 저장

### RAG Service
- 모달 간단 소견을 query로 수신
- **Titan Embed / Bedrock embedding 호출**
- ChromaDB/Vector DB에서 유사 사례 검색
- Top-K 유사 사례 반환
- 현재 케이스 임베딩/검색 로그 저장

## 비용 절감 기준

RAG는 Bedrock LLM으로 별도 근거 요약을 생성하지 않습니다.

```text
현재:
RAG → Titan Embed embedding
Orchestrator → Bedrock final report
```

즉, Bedrock LLM 생성 호출은 Orchestrator의 최종 소견 생성 1회로 제한합니다.

## 주요 변경사항

### `rag-task-role.json`
- `bedrock:InvokeModel`은 유지합니다.
- 목적은 Titan Embed 기반 query embedding 생성입니다.
- `bedrock:InvokeModelWithResponseStream`은 제거했습니다.
- RAG의 별도 Bedrock LLM evidence summary 생성 권한은 두지 않았습니다.

### `orchestrator-role.json`
- 최종 소견 생성을 위해 `bedrock:InvokeModel`, `bedrock:InvokeModelWithResponseStream`을 유지합니다.

### `ecg/cxr/lab-task-role.json`
- 모달 서비스는 현재 Bedrock 호출 권한을 두지 않았습니다.
- S3 저장, Secret 조회, KMS 사용 중심으로 정리했습니다.

## 아직 완성형이 아닌 이유

### S3 권한
현재는 dev 단계라 `say2-6team-*` 버킷 prefix 기준으로 열어두었습니다.

다음 작업:
- data-stack 배포 후 실제 S3 Bucket ARN을 Export합니다.
- 이후 IAM 정책의 S3 Resource를 정확한 Bucket ARN으로 축소합니다.

### Secrets Manager 권한
현재는 dev 단계라 `say2-6team/*` Secret prefix 기준으로 읽기 권한을 열어두었습니다.

다음 작업:
- data-stack에서 Aurora Secret을 생성하고 Secret ARN을 Export합니다.
- 이후 IAM 정책의 Secrets Manager Resource를 정확한 Secret ARN으로 축소합니다.

### Bedrock 권한
현재 리뷰용 JSON에는 Bedrock Resource가 `*`로 되어 있습니다.

다음 작업:
- Titan Embed 모델 ARN이 확정되면 `rag-task-role.json`의 Resource 범위 축소를 검토합니다.
- 최종 소견용 Claude/Sonnet 모델 ARN이 확정되면 `orchestrator-role.json`의 Resource 범위 축소를 검토합니다.

### KMS Key ARN
리뷰용 JSON에는 `<PROJECT_KMS_KEY_ID>` placeholder가 들어 있습니다.

다음 작업:
- security-stack 배포 후 `say2-6team-kms-key-arn` Export 값을 기준으로 실제 정책 범위를 확인합니다.

### WAF Rules
현재 Managed Rules와 Rate Limit은 Count 모드입니다.

다음 작업:
- dev 단계에서 WAF sampled requests와 CloudWatch metrics를 확인합니다.
- 정상 요청이 차단되지 않는지 확인한 뒤 필요한 rule만 Block 모드로 전환합니다.
