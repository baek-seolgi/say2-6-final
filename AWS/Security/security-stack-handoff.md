# security-stack.yaml 팀원별 참조 가이드

> 배포 스택: `say2-6team-security`  
> 리전: `ap-northeast-2` (서울 / KMS, SG, IAM, Cognito, WAF)  
> 선행 조건: `say2-6team-network` 배포 완료  
> 배포 상태: ✅ 배포 완료 (2026-05-18)  
> 주요 변경: 비용 절감을 위해 RAG는 `embedding + Top-K 검색 반환`까지만 담당하고, 최종 Bedrock 소견 생성은 Orchestrator가 1회 수행

---

## 배포된 Export 실제 값 (2026-05-18)

| Export 이름 | 실제 값 |
|---|---|
| `say2-6team-alb-sg` | `sg-0d702017416dadb66` |
| `say2-6team-central-sg` | `sg-07ec4d26ca22427d6` |
| `say2-6team-ecg-sg` | `sg-0bc2906a2abb53bbd` |
| `say2-6team-cxr-sg` | `sg-03c32a9f9177f135c` |
| `say2-6team-lab-sg` | `sg-0bb2f142d6291e965` |
| `say2-6team-rag-sg` | `sg-01af9bb2d57aac1f3` |
| `say2-6team-chroma-sg` | `sg-0379c10f238a5cf37` | ⚠️ dev 미사용 (SG 리소스는 유지됨, 읽기 전용 구조로 ChromaDB 별도 서비스 없음) |
| `say2-6team-hapi-sg` | `sg-0924ad27224e89e32` |
| `say2-6team-aurora-sg` | `sg-07c279f248b815acd` |
| `say2-6team-kms-key-id` | `e3e09f7e-ca16-46ad-b87d-8897332338c8` |
| `say2-6team-kms-key-arn` | `arn:aws:kms:ap-northeast-2:666803869796:key/e3e09f7e-ca16-46ad-b87d-8897332338c8` |
| `say2-6team-ecs-execution-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-ecs-execution-role` |
| `say2-6team-orchestrator-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-orchestrator-task-role` |
| `say2-6team-ecg-task-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-ecg-task-role` |
| `say2-6team-cxr-task-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-cxr-task-role` |
| `say2-6team-lab-task-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-lab-task-role` |
| `say2-6team-rag-task-role-arn` | `arn:aws:iam::666803869796:role/say2-6team-rag-task-role` |
| `say2-6team-waf-arn` | `arn:aws:wafv2:ap-northeast-2:666803869796:regional/webacl/say2-6team-alb-waf/8e27d90b-07ba-4683-928a-c7ddae65e0ea` |
| `say2-6team-cognito-user-pool-id` | `ap-northeast-2_wDFEYgqCW` |
| `say2-6team-cognito-user-pool-client-id` | `dv4v8k3dte0jnpdi2385jenq6` |
| `say2-6team-cognito-domain-prefix` | `say2-6team-dev-666803869796-auth` |

---

## 0. 최종 데이터 흐름 기준

### 중앙 Orchestrator

```text
1. 환자 요청 수신
2. 필요한 모달 호출
3. 모달 간단 소견 취합
4. RAG 서비스에 검색 요청
5. RAG Top-K 결과 + 모달 결과를 Bedrock에 전달
6. 최종 소견 생성
7. 최종 결과 DB 저장
```

### RAG Service

```text
1. 모달 간단 소견을 query로 받음
2. Bedrock으로 query embedding 생성
3. ChromaDB/Vector DB에서 유사 사례 검색
4. Top-K 유사 사례 반환
5. 현재 케이스 임베딩/검색 로그 저장
```

### ChromaDB / Vector DB

```text
1. 벡터 인덱스 저장
2. RAG Service의 검색 요청 처리
3. 필요 시 인덱스/스냅샷 백업
```

역할 분리 의도:

| 컴포넌트 | 핵심 역할 |
|---|---|
| Orchestrator | 전체 흐름 조율, 최종 Bedrock 호출, 최종 결과 DB 저장 |
| Modal Services | 검사 실행, 원본 S3 저장, 간단 소견 생성 |
| RAG Service | 임베딩, 유사 사례 검색, Top-K 반환, 검색 로그 저장 |
| ChromaDB/Vector DB | 벡터 저장소 및 검색 엔진 |
| Data Stack | Aurora, HAPI, ChromaDB/Vector 저장소, S3 데이터 저장소 |

---

## 1. 비용 관점 변경사항

이전 구조는 RAG가 Bedrock으로 근거 요약까지 만들고, Orchestrator가 다시 Bedrock으로 최종 소견을 생성하는 구조였습니다.

```text
이전:
RAG → Bedrock embedding
RAG → Bedrock LLM evidence summary
Orchestrator → Bedrock LLM final report
```

현재 구조는 비용 절감을 위해 Bedrock LLM 호출을 줄입니다.

```text
현재:
RAG → Bedrock embedding
Orchestrator → Bedrock LLM final report
```

즉, RAG는 Top-K 유사 사례를 찾아 넘기고, 최종 판단/최종 문장 생성은 Orchestrator가 한 번만 Bedrock을 호출해서 처리합니다.

---

## 2. 파일 구성

| 파일/폴더 | 리전 | 역할 |
|---|---|---|
| `security-stack.yaml` | `ap-northeast-2` | KMS, SG, IAM Role, Cognito, WAF(ALB용) 생성 |
| `iam-policies/` | - | IAM/KMS/WAF 정책 리뷰용 JSON 모음 |
| ~~`waf-global-stack.yaml`~~ | ~~`us-east-1`~~ | ❌ 사용 안 함 (WAF를 security-stack에 통합) |

> `iam-policies/*.json`은 리뷰용 문서입니다. 실제 배포는 `security-stack.yaml`의 inline 정책 기준으로 진행합니다.

---

## 3. 배포 순서

```text
① network-stack        ap-northeast-2
   ↓ Export: VPC, Subnet, Endpoint SG, Cloud Map

② security-stack       ap-northeast-2
   ↓ Export: SG, KMS, IAM Role, Cognito, WAF WebACL ARN

③ data-stack           ap-northeast-2
   ↓ Import: aurora-sg, hapi-sg, kms-key-arn 등 (chroma-sg는 dev 미사용)

④ compute-stack        ap-northeast-2
   ↓ Import: alb-sg, central-sg, modal SGs, rag-sg, IAM Role, Cognito, WAF ARN 등
```

> WAF는 security-stack에 통합됨 (Scope: REGIONAL, ALB 직접 연결).  
> compute-stack에서 ALB 생성 후 `AWS::WAFv2::WebACLAssociation`으로 `say2-6team-waf-arn`을 ALB에 연결합니다.

---

## 4. Security Stack Export 목록

### Security Group Exports

| Export 이름 | 값 | 사용처 |
|---|---|---|
| `say2-6team-alb-sg` | ALB SG ID | compute-stack / ALB |
| `say2-6team-central-sg` | Orchestrator SG ID | compute-stack / ECS Orchestrator |
| `say2-6team-ecg-sg` | ECG SG ID | compute-stack / ECG ECS Service |
| `say2-6team-cxr-sg` | CXR SG ID | compute-stack / CXR ECS Service |
| `say2-6team-lab-sg` | LAB SG ID | compute-stack / LAB ECS Service |
| `say2-6team-rag-sg` | RAG API SG ID | compute-stack / RAG Service |
| `say2-6team-chroma-sg` | ChromaDB/Vector DB SG ID | ⚠️ dev 미사용 (리소스 유지, 읽기 전용 구조) |
| `say2-6team-hapi-sg` | HAPI SG ID | data-stack / HAPI EC2 |
| `say2-6team-aurora-sg` | Aurora SG ID | data-stack / Aurora Cluster |

### IAM Role Exports

| Export 이름 | 값 | 사용처 |
|---|---|---|
| `say2-6team-ecs-execution-role-arn` | ECS Execution Role ARN | 모든 ECS Task Definition |
| `say2-6team-orchestrator-role-arn` | Orchestrator Task Role ARN | Orchestrator Task Definition |
| `say2-6team-ecg-task-role-arn` | ECG Task Role ARN | ECG Task Definition |
| `say2-6team-cxr-task-role-arn` | CXR Task Role ARN | CXR Task Definition |
| `say2-6team-lab-task-role-arn` | LAB Task Role ARN | LAB Task Definition |
| `say2-6team-rag-task-role-arn` | RAG Task Role ARN | RAG Task Definition |

### KMS / Cognito Exports

| Export 이름 | 값 | 사용처 |
|---|---|---|
| `say2-6team-kms-key-id` | KMS Key ID | data-stack / 암호화 설정 |
| `say2-6team-kms-key-arn` | KMS Key ARN | IAM 정책, Aurora, S3, Secrets Manager |
| `say2-6team-cognito-user-pool-id` | User Pool ID | frontend/backend 인증 연동 |
| `say2-6team-cognito-user-pool-client-id` | User Pool Client ID | frontend 로그인 연동 |
| `say2-6team-cognito-domain-prefix` | Hosted UI domain prefix | frontend 로그인 URL 구성 |

---

## 5. Security Group 트래픽 정책

### 기본 흐름

```text
사용자 / CloudFront
  ↓ 443
ALB
  ↓ 8000
Orchestrator
  ├─ 8001 → ECG
  ├─ 8002 → CXR
  ├─ 8003 → LAB
  ├─ 8000 → RAG Service
  ├─ 8080 → HAPI
  ├─ 5432 → Aurora
  └─ 443  → Interface VPC Endpoints

RAG Service
  ├─ 8000 → ChromaDB / Vector DB
  ├─ 443  → Interface VPC Endpoints
  │         Bedrock embedding / Secrets / KMS / Logs
  └─ 443  → S3 Gateway Endpoint path
            RAG logs, embeddings, snapshot backup if needed
```

### SG별 주요 규칙

| SG | Inbound | Outbound | 설명 |
|---|---|---|---|
| `alb-sg` | `0.0.0.0/0 → 443` | `central-sg → 8000` | ALB HTTPS 진입 |
| `central-sg` | `alb-sg → 8000` | ECG/CXR/LAB/RAG/HAPI/Aurora/Endpoint | Orchestrator |
| `ecg-sg` | `central-sg → 8001` | Endpoint/S3 | ECG 서비스 |
| `cxr-sg` | `central-sg → 8002` | Endpoint/S3 | CXR 서비스 |
| `lab-sg` | `central-sg → 8003` | Endpoint/S3 | LAB 서비스 |
| `rag-sg` | `central-sg → 8000` | Chroma/Endpoint/S3 | RAG API 서비스 |
| `chroma-sg` | `rag-sg → 8000` | Endpoint/S3 | ⚠️ dev 미사용 (읽기 전용 구조, ChromaDB는 RAG 컨테이너 내부 파일) |
| `hapi-sg` | `central-sg → 8080` | `aurora-sg → 5432`, Endpoint | HAPI FHIR |
| `aurora-sg` | `central-sg/hapi-sg → 5432` | 없음 | Aurora PostgreSQL |

> `chroma-sg`는 리소스로 유지되지만 dev에서는 사용하지 않습니다.  
> 읽기 전용 구조 변경으로 ChromaDB는 별도 서비스가 아닌 RAG 컨테이너 내부 파일(S3에서 다운로드)로 처리합니다.  
> 향후 쓰기 기능이 필요해지면 ChromaDB를 별도 서비스로 분리하고 이 SG를 활성화합니다.

---

## 6. lji (컴퓨팅) — compute-stack.yaml에서 가져갈 것

### Orchestrator ECS Service

```yaml
SecurityGroups:
  - !ImportValue say2-6team-central-sg

ExecutionRoleArn: !ImportValue say2-6team-ecs-execution-role-arn
TaskRoleArn: !ImportValue say2-6team-orchestrator-role-arn
```

### ECG / CXR / LAB ECS Service

```yaml
# ECG
SecurityGroups:
  - !ImportValue say2-6team-ecg-sg
TaskRoleArn: !ImportValue say2-6team-ecg-task-role-arn

# CXR
SecurityGroups:
  - !ImportValue say2-6team-cxr-sg
TaskRoleArn: !ImportValue say2-6team-cxr-task-role-arn

# LAB
SecurityGroups:
  - !ImportValue say2-6team-lab-sg
TaskRoleArn: !ImportValue say2-6team-lab-task-role-arn
```

### RAG Service가 ECS로 배포되는 경우

```yaml
SecurityGroups:
  - !ImportValue say2-6team-rag-sg

ExecutionRoleArn: !ImportValue say2-6team-ecs-execution-role-arn
TaskRoleArn: !ImportValue say2-6team-rag-task-role-arn
```

RAG 서비스 포트:

```text
RAG API: 8000
```

환경변수 예시:

```yaml
Environment:
  - Name: CHROMA_MODE
    Value: local
  - Name: CHROMA_DB_DIR
    Value: ./local_rag_db
  - Name: RAG_DB_BUCKET
    Value: say2-6team-rag-db
  - Name: EMBED_CACHE_ENABLED
    Value: "false"
  - Name: AWS_DEFAULT_REGION
    Value: ap-northeast-2
```

> dev에서는 `CHROMA_MODE=local` (PersistentClient, S3에서 다운로드한 파일 사용).  
> `CHROMA_HOST`/`CHROMA_PORT`는 불필요 (별도 ChromaDB 서버 없음).

RAG API 응답 예시:

```json
{
  "case_id": "case-001",
  "top_k": [
    {
      "case_ref": "mimic-xxxx",
      "similarity": 0.86,
      "summary": "..."
    }
  ],
  "embedding_saved": true,
  "search_log_saved": true
}
```

---

## 7. hkt (DB + 모니터링) — data-stack.yaml에서 가져갈 것

### ChromaDB / Vector DB

ChromaDB를 Data Subnet EC2 또는 ECS로 배포하는 경우:

```yaml
SecurityGroupIds:
  - !ImportValue say2-6team-chroma-sg
```

포트:

```text
ChromaDB / Vector DB: 8000
```

접근 허용:

```text
rag-sg → chroma-sg : 8000
```

> Orchestrator는 ChromaDB에 직접 접근하지 않습니다.  
> Orchestrator는 RAG Service만 호출하고, RAG Service가 ChromaDB를 조회합니다.

### Aurora

```yaml
VpcSecurityGroupIds:
  - !ImportValue say2-6team-aurora-sg

KmsKeyId: !ImportValue say2-6team-kms-key-arn
```

### HAPI EC2

```yaml
SecurityGroupIds:
  - !ImportValue say2-6team-hapi-sg
```

### DB Secret 관련

현재 security-stack은 DB Secret을 직접 만들지 않습니다.

권장 방식:

```text
data-stack
→ Aurora 생성
→ Aurora Secret 생성 또는 RDS managed secret 사용
→ Secret ARN Export
→ 이후 security-stack IAM 정책을 정확한 Secret ARN으로 축소
```

DB Secret 이름 권장:

```text
say2-6team/aurora-credentials
```

---

## 8. 아직 완성형이 아닌 이유와 후속 작업

### IAM Resource 범위

현재 dev 단계 IAM 정책은 prefix/wildcard를 사용합니다.

| 대상 | 현재 허용 범위 | 후속 작업 |
|---|---|---|
| Secrets Manager | `say2-6team/*` | data-stack 후 정확한 Secret ARN으로 축소 |
| S3 | `say2-6team-*` | data-stack 후 정확한 Bucket ARN으로 축소 |
| Bedrock | `Resource: "*"` | embedding/final model 확정 후 제한 검토 |
| ChromaDB 저장소 | SG만 제공 | 배포 방식 확정 후 접근/백업 정책 보강 |

### Cognito

현재 Callback/Logout URL은 localhost입니다.

```text
http://localhost:3000/callback
http://localhost:3000/logout
```

CloudFront 또는 커스텀 도메인 확정 후:

```text
1. CognitoCallbackUrl / CognitoLogoutUrl을 HTTPS 도메인으로 변경
2. security-stack update
3. 프론트 로그인/로그아웃 플로우 검증
```

### WAF

현재 WAF rule은 Count 모드입니다.

```text
1. dev 트래픽 관찰
2. sampled requests 확인
3. 오탐 여부 확인
4. 필요한 rule만 Block 모드 전환
```

---

## 9. 의도적으로 제외한 설계

| 항목 | 현재 상태 | 이유 |
|---|---|---|
| NACL | 제외 | 초기 연결/디버깅 우선, 추후 hardening |
| Secrets Manager Secret 생성 | 제외 | DB Secret은 data-stack에서 Aurora와 함께 관리 |
| WAF Block 모드 | 제외 | dev 단계 오탐 방지 |
| CloudFront 연결 | 제외 | CloudFront stack에서 WAF ARN Parameter로 연결 |
| RAG → Aurora 직접 저장 | 제외 | 최종 결과 DB 저장은 Orchestrator 담당 |
| Orchestrator → Chroma 직접 접근 | 제외 | ChromaDB는 RAG Service 뒤에 둠 |
| RAG의 Bedrock LLM 요약 생성 | 제외 | 비용 절감을 위해 Top-K만 반환하고 최종 LLM 호출은 Orchestrator가 1회 수행 |

---

## 10. 배포 명령

### Security Stack (WAF 포함)

```bash
aws cloudformation deploy \
  --stack-name say2-6team-security \
  --template-file security-stack.yaml \
  --region ap-northeast-2 \
  --profile say2-6team \
  --capabilities CAPABILITY_NAMED_IAM
```

> WAF(Regional)도 이 스택에 포함되어 있으므로 별도 배포 불필요.

---

## 11. 연결 안 될 때 체크리스트

| 증상 | 원인 가능성 | 확인 방법 |
|---|---|---|
| RAG API 호출 실패 | `central-sg → rag-sg:8000` 누락 | SG rule 확인 |
| ChromaDB 검색 실패 | dev에서는 해당 없음 (컨테이너 내부 파일 모드). Task 시작 시 S3 다운로드 실패 여부 확인 | CloudWatch Logs에서 entrypoint.sh 로그 확인 |
| WAF가 ALB에 연결 안 됨 | WebACLAssociation 누락 또는 ARN 불일치 | compute-stack에 `AWS::WAFv2::WebACLAssociation` 있는지, `say2-6team-waf-arn` Import 확인 |
| RAG embedding 실패 | Bedrock 권한 또는 Endpoint 문제 | `rag-task-role`, Endpoint SG 확인 |
| Secret 조회 실패 | Secret 이름/ARN 불일치 | `say2-6team/*` prefix 확인 |
| S3 접근 실패 | Bucket 이름이 prefix와 불일치 | `say2-6team-*` 버킷명 확인 |
| DB 연결 실패 | Aurora SG/HAPI SG/포트 문제 | `aurora-sg` inbound 5432 확인 |
| Cognito 리다이렉트 실패 | Callback URL 불일치 | security-stack parameter update 필요 |
