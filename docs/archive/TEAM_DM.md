# 팀방 DM 메시지 — say-6 AWS 인프라 구축

> 팀 채널에 그대로 복붙해서 공유

---

```
@here Dr. AI Radiologist AWS 인프라 구축 작업 분장 공유드립니다.

🛠️ 도구: AWS CloudFormation (YAML 메인, 정책 본문만 JSON)
📍 리전: ap-northeast-2 (서울)
🏷️ 리소스 prefix: say-6-

📌 역할 분담
• 양정인 → 🔐 보안 + 🌐 네트워크 (network-stack, security-stack)
• 이정인 → ⚙️ 컴퓨팅 (compute-stack)
• 홍경태 → 🗄️ DB + 📊 모니터링 (data-stack, monitoring-stack)
   ※ 알림은 SNS → Email/SMS 직접 발송 (Slack Lambda 제외)

📅 배포 순서 (파일 작성은 병렬 OK, 배포만 순서대로)
  1. network-stack    (양정인)
  2. security-stack   (양정인)
  3. data-stack       (홍경태)
  4. compute-stack    (이정인)
  5. monitoring-stack (홍경태)

⚠️ 작업 시작 전 필수
스택 간 값 공유는 'Export 규약'대로 통일해야 합니다.
모든 Export 이름은 say-6- 로 시작합니다.
→ [Notion 링크]

🗓️ 일정 제안
• Day 1 오전: 30분 회의 (Export 규약 확정, 명명 규칙 합의)
• Day 1 오후 ~ Day 2: 각자 YAML 병렬 작성
• Day 3 오전: cfn-lint 문법 검증
• Day 3 오후: 1→2→3→4→5 순서로 통합 배포 테스트

질문은 이 채널에서 자유롭게 주세요 🙏
```
