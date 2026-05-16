import { Link } from "react-router-dom";
import {
  Cpu, Database, Network, Shield, Server, Bell,
  GitBranch, ArrowUpRight, CheckCircle2,
} from "lucide-react";
import { BrandShell } from "../../components/brand/BrandShell";

export default function TechnologyPage() {
  return (
    <BrandShell>
      <Hero />
      <ArchitectureSection />
      <CoreTechSection />
      <DataSection />
      <AWSSection />
      <ComplianceSection />
      <BottomCTA />
    </BrandShell>
  );
}

function Hero() {
  return (
    <section className="border-b border-vuno-divider bg-vuno-surface/30">
      <div className="max-w-[1400px] mx-auto px-6 py-20 md:py-28">
        <div className="max-w-3xl">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 border border-vuno-cyan/40 text-vuno-cyan text-xs font-bold uppercase tracking-[0.2em] mb-6">
            Technology
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight text-white">
            의료 표준 위에 쌓은 <br />
            <span className="text-vuno-cyan">검증 가능한 AI</span>
          </h1>
          <p className="mt-6 text-lg text-vuno-muted leading-relaxed">
            FHIR R4 · MIMIC-IV · AWS Multi-AZ. 의료 도메인의 신뢰성과
            현대 AI 인프라의 확장성을 동시에.
          </p>
        </div>
      </div>
    </section>
  );
}

function ArchitectureSection() {
  return (
    <section className="py-28">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white">System Architecture</h2>
          <p className="mt-5 text-lg text-vuno-muted">의사 브라우저부터 AI 추론까지 9단계</p>
        </div>

        <div className="max-w-3xl mx-auto">
          <FlowStep n={1} role="의사 브라우저" desc="POST /api/triage 제출" />
          <Arrow />
          <FlowStep n={2} role="Orchestrator" desc="HAPI Patient/Encounter PUT · encounter_id 발급" />
          <Arrow />
          <FlowStep n={3} role="Aurora DB" desc="encounters INSERT · JSONB metadata 적재" />
          <Arrow />
          <FlowStep n={4} role="Cloud Map DNS" desc="3 모달 병렬 호출 (ECG · CXR · LAB)" highlight />
          <Arrow />
          <FlowStep n={5} role="각 AI 모달" desc="S3에서 원본 다운로드 → 추론 → modal_results UPSERT" />
          <Arrow />
          <FlowStep n={6} role="ChromaDB" desc="유사 사례 검색 (top-K 임상 노트)" />
          <Arrow />
          <FlowStep n={7} role="Bedrock Claude" desc="종합 소견서 narrative 생성" highlight />
          <Arrow />
          <FlowStep n={8} role="Aurora + HAPI" desc="diagnostic_reports INSERT + FHIR DiagnosticReport PUT" />
          <Arrow />
          <FlowStep n={9} role="WebSocket" desc="report_generated 이벤트 → 의사 화면 즉시 표시" />
        </div>
      </div>
    </section>
  );
}

function FlowStep({ n, role, desc, highlight }: { n: number; role: string; desc: string; highlight?: boolean }) {
  return (
    <div
      className={
        "flex items-center gap-4 p-4 border " +
        (highlight
          ? "border-vuno-cyan bg-vuno-cyan/5"
          : "border-vuno-border bg-vuno-surface")
      }
    >
      <div
        className={
          "h-10 w-10 grid place-items-center font-bold font-numeric flex-shrink-0 " +
          (highlight
            ? "bg-vuno-cyan text-vuno-bg"
            : "bg-vuno-bg border border-vuno-border text-vuno-cyan")
        }
      >
        {n}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-bold text-white">{role}</div>
        <div className="text-sm text-vuno-muted">{desc}</div>
      </div>
    </div>
  );
}

function Arrow() {
  return (
    <div className="flex justify-center py-1.5">
      <div className="h-5 w-px bg-vuno-border" />
    </div>
  );
}

function CoreTechSection() {
  const items = [
    {
      icon: Cpu, title: "멀티모달 추론",
      desc: "PyTorch (ECG) · ONNX (CXR) · XGBoost (LAB) — 각 모달 독립 ECS 서비스로 격리 배포",
      tags: ["PyTorch", "ONNX", "XGBoost"],
    },
    {
      icon: Database, title: "RAG / ChromaDB",
      desc: "MIMIC-IV 49,743건 Bedrock Titan v2 임베딩 · 512차원 코사인 유사도",
      tags: ["ChromaDB", "Bedrock Titan v2", "MIMIC-IV"],
    },
    {
      icon: GitBranch, title: "FHIR R4 표준",
      desc: "HAPI FHIR 서버 9 리소스 자동 관리 — Patient · Encounter · Observation · Condition 등",
      tags: ["FHIR R4", "HAPI", "HL7"],
    },
    {
      icon: Bell, title: "Graceful Degradation",
      desc: "HAPI 다운 시 fhir_sync_queue로 자동 백필 · 임상 무중단 (TEST 검증 완료 16건 410ms)",
      tags: ["Aurora PostgreSQL", "Queue", "Retry"],
    },
    {
      icon: Network, title: "WebSocket 실시간",
      desc: "modal_events 10종 이벤트 fan-out · Critical 환자 자동 알림 + Push",
      tags: ["WebSocket", "SNS", "Push API"],
    },
    {
      icon: Shield, title: "Cognito + MFA",
      desc: "JWT 인증 · 병원 AD SAML/OIDC SSO 연동 · 5년 CloudTrail 감사 추적",
      tags: ["Cognito", "SAML", "JWT"],
    },
  ];

  return (
    <section className="py-28 border-t border-vuno-divider bg-vuno-surface/30">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white">Core Technology Stack</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {items.map((it) => (
            <div key={it.title} className="border border-vuno-border bg-vuno-bg p-6 hover:border-vuno-cyan transition-colors">
              <div className="h-10 w-10 bg-vuno-surface border border-vuno-cyan/40 grid place-items-center text-vuno-cyan mb-4">
                <it.icon className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white mb-2">{it.title}</h3>
              <p className="text-sm text-vuno-muted leading-relaxed">{it.desc}</p>
              <div className="mt-4 flex flex-wrap gap-1.5">
                {it.tags.map((t) => (
                  <span key={t} className="px-2 py-0.5 border border-vuno-border text-xs text-vuno-cyan font-medium font-numeric">{t}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function DataSection() {
  return (
    <section id="data" className="py-28">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 border border-emerald-400/40 text-emerald-400 text-xs font-bold uppercase tracking-[0.2em] mb-5">
              Open Medical Data
            </div>
            <h2 className="text-3xl md:text-5xl font-bold leading-tight text-white">
              <span className="text-vuno-cyan">MIMIC-IV</span><br />
              검증된 임상 데이터셋
            </h2>
            <p className="mt-6 text-lg text-vuno-muted leading-relaxed">
              MIT Lab for Computational Physiology에서 공개한 ICU 환자 데이터.
              비식별화된 임상 노트·검사 결과·진단명·처방 정보를 학습·평가·RAG에 활용합니다.
            </p>
            <ul className="mt-6 space-y-2.5">
              {[
                "임상 노트 49,743건 임베딩",
                "비식별화 처리 완료 (HIPAA 호환)",
                "MIT 라이선스 (연구·교육 자유 사용)",
                "ICU 환자 380,000명 데이터",
              ].map((b) => (
                <li key={b} className="flex gap-2 text-vuno-muted">
                  <CheckCircle2 className="h-5 w-5 text-vuno-cyan flex-shrink-0 mt-0.5" />
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="border border-vuno-border bg-vuno-bg p-7 font-numeric text-sm">
            <div className="text-xs text-vuno-cyan mb-4 tracking-wider uppercase">// MIMIC-IV (Phase 1)</div>
            <pre className="leading-relaxed text-xs md:text-sm overflow-x-auto text-vuno-muted">{`{
  "dataset": "MIMIC-IV v2.2",
  "embedding_count": 49743,
  "embedding_model": "Bedrock Titan v2",
  "dimensions": 512,
  "metric": "cosine",
  "storage": "ChromaDB on EFS",
  "categories": {
    "discharge_notes": 23104,
    "radiology_reports": 12891,
    "ecg_reports": 8472,
    "lab_summaries": 5276
  },
  "license": "MIT (PhysioNet)"
}`}</pre>
          </div>
        </div>
      </div>
    </section>
  );
}

function AWSSection() {
  const blocks = [
    { icon: Server,   title: "Computing",     desc: "ECS Fargate × 4 · HAPI EC2 · Multi-AZ Auto Scaling" },
    { icon: Network,  title: "Network",       desc: "VPC 3-tier · VPC Endpoint 6종 · CloudFront + WAF" },
    { icon: Shield,   title: "Security",      desc: "Defense-in-Depth 7층 · KMS · Cognito · CloudTrail 5년" },
    { icon: Database, title: "Database",      desc: "Aurora SLv2 · S3 PACS · ChromaDB · HAPI FHIR" },
    { icon: Bell,     title: "Observability", desc: "CloudWatch · SNS → Email/SMS · WebSocket 실시간" },
  ];
  return (
    <section id="aws" className="py-28 border-y border-vuno-divider bg-vuno-surface/30">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="text-center mb-16">
          <div className="inline-flex items-center gap-2 px-3 py-1 border border-vuno-cyan/40 text-vuno-cyan text-xs font-bold uppercase tracking-[0.2em] mb-5">
            AWS Multi-AZ Architecture
          </div>
          <h2 className="text-3xl md:text-5xl font-bold leading-tight text-white">
            응급실에 적합한 <br />
            <span className="text-vuno-cyan">무중단 인프라</span>
          </h2>
          <p className="mt-5 text-lg text-vuno-muted">5개 영역 24/7 가용성 보장</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 max-w-6xl mx-auto">
          {blocks.map((b) => (
            <div key={b.title} className="border border-vuno-border bg-vuno-bg p-6 hover:border-vuno-cyan transition-colors">
              <div className="h-10 w-10 bg-vuno-surface border border-vuno-cyan/40 grid place-items-center text-vuno-cyan mb-4">
                <b.icon className="h-5 w-5" />
              </div>
              <h3 className="font-bold text-white">{b.title}</h3>
              <p className="text-xs text-vuno-muted mt-2 leading-relaxed">{b.desc}</p>
            </div>
          ))}
        </div>

        <div className="text-center mt-12 text-sm text-vuno-dim">
          Phase 1 MVP 예상 비용 <span className="font-numeric font-bold text-vuno-cyan">~$1,105/월</span>
        </div>
      </div>
    </section>
  );
}

function ComplianceSection() {
  const items = [
    { title: "FHIR R4 표준",   desc: "HL7 국제 표준으로 병원 EMR과 즉시 호환" },
    { title: "의료법 5년 보관",  desc: "CloudTrail Management/Data Events 5년 보존" },
    { title: "KMS 암호화",      desc: "Aurora · S3 · EBS 모든 환자 데이터 암호화" },
    { title: "PHI 로깅 금지",   desc: "환자 이름·진단 본문 CloudWatch 적재 차단" },
  ];
  return (
    <section className="py-28">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white">Security · Compliance</h2>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 max-w-5xl mx-auto">
          {items.map((it) => (
            <div key={it.title} className="border border-vuno-border bg-vuno-surface p-6 text-center">
              <Shield className="h-9 w-9 mx-auto text-vuno-cyan mb-3" />
              <h3 className="font-bold text-white">{it.title}</h3>
              <p className="text-xs text-vuno-muted mt-2 leading-relaxed">{it.desc}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function BottomCTA() {
  return (
    <section className="py-20 border-t border-vuno-divider">
      <div className="max-w-[900px] mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white">
          기술 상세는 화이트페이퍼로
        </h2>
        <p className="mt-3 text-vuno-muted">아키텍처 다이어그램·DDL·IAM 정책 전체 설계 문서 제공</p>
        <Link
          to="/contact"
          className="inline-flex items-center gap-2 mt-7 h-12 px-8 font-bold border border-vuno-cyan text-vuno-cyan hover:bg-vuno-cyan hover:text-vuno-bg transition-colors tracking-wider uppercase text-sm"
        >
          기술 문서 요청 <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
