import { Link } from "react-router-dom";
import { Mail, Github, Linkedin, ArrowUpRight } from "lucide-react";
import { BrandShell } from "../../components/brand/BrandShell";

interface Member {
  name: string;
  role: string;
  focus: string;
  bio: string;
  initial: string;
}

const MEMBERS: Member[] = [
  {
    name: "양정인",
    role: "Security & Network Lead",
    focus: "보안 · 네트워크",
    bio: "AWS VPC 3-tier 설계, IAM Least Privilege, WAF/KMS/Cognito. Defense-in-Depth 7층 방어 + 5년 감사 추적 구축.",
    initial: "양",
  },
  {
    name: "이정인",
    role: "Compute Lead",
    focus: "컴퓨팅",
    bio: "ECS Fargate 멀티모달 추론 서비스 4종 배포, ALB Auto Scaling, Rolling Update. HAPI FHIR EC2 운영.",
    initial: "이",
  },
  {
    name: "홍경태",
    role: "Data & Observability Lead",
    focus: "DB · 모니터링",
    bio: "Aurora Serverless v2 설계, FHIR R4 표준 스키마, Graceful Degradation Queue. CloudWatch + SNS 7종 Alarm 시스템.",
    initial: "홍",
  },
];

export default function TeamPage() {
  return (
    <BrandShell>
      <Hero />
      <MembersSection />
      <MissionSection />
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
            Team
          </div>
          <h1 className="text-4xl md:text-6xl font-bold leading-tight text-white">
            응급실에 AI를 <br />
            <span className="text-vuno-cyan">제대로 가져다 놓는 팀</span>
          </h1>
          <p className="mt-6 text-lg text-vuno-muted leading-relaxed">
            의료 도메인 + 클라우드 인프라 + AI 엔지니어링.
            응급 의료의 1초가 얼마나 무거운지 알고 시스템을 설계합니다.
          </p>
        </div>
      </div>
    </section>
  );
}

function MembersSection() {
  return (
    <section className="py-28">
      <div className="max-w-[1400px] mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-5xl font-bold text-white">Core Team</h2>
          <p className="mt-5 text-lg text-vuno-muted">3명이 5개 인프라 영역을 담당합니다</p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {MEMBERS.map((m) => (
            <MemberCard key={m.name} member={m} />
          ))}
        </div>
      </div>
    </section>
  );
}

function MemberCard({ member }: { member: Member }) {
  return (
    <div className="border border-vuno-border bg-vuno-surface p-7 hover:border-vuno-cyan hover:bg-vuno-elevated transition-all">
      {/* 아바타 */}
      <div className="h-20 w-20 bg-vuno-bg border-2 border-vuno-cyan grid place-items-center text-vuno-cyan text-3xl font-bold mb-5">
        {member.initial}
      </div>

      <h3 className="text-xl font-bold text-white">{member.name}</h3>
      <div className="text-sm text-vuno-cyan font-semibold mt-1">{member.role}</div>
      <div className="text-xs text-vuno-dim mt-1 uppercase tracking-wider">{member.focus}</div>

      <p className="text-sm text-vuno-muted mt-5 leading-relaxed">{member.bio}</p>

      <div className="mt-6 pt-5 border-t border-vuno-border flex items-center gap-2">
        <a className="h-9 w-9 bg-vuno-bg border border-vuno-border hover:border-vuno-cyan hover:text-vuno-cyan grid place-items-center text-vuno-muted transition-colors" title="이메일">
          <Mail className="h-4 w-4" />
        </a>
        <a className="h-9 w-9 bg-vuno-bg border border-vuno-border hover:border-vuno-cyan hover:text-vuno-cyan grid place-items-center text-vuno-muted transition-colors" title="GitHub">
          <Github className="h-4 w-4" />
        </a>
        <a className="h-9 w-9 bg-vuno-bg border border-vuno-border hover:border-vuno-cyan hover:text-vuno-cyan grid place-items-center text-vuno-muted transition-colors" title="LinkedIn">
          <Linkedin className="h-4 w-4" />
        </a>
      </div>
    </div>
  );
}

function MissionSection() {
  return (
    <section className="py-28 border-t border-vuno-divider bg-vuno-surface/30">
      <div className="max-w-[1100px] mx-auto px-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
          <div>
            <div className="text-xs font-bold text-vuno-cyan uppercase tracking-[0.2em] mb-4">Mission</div>
            <h3 className="text-2xl md:text-3xl font-bold text-white leading-tight">
              응급실 의사의 <br />
              "혼자 보는 시간"을 줄입니다.
            </h3>
            <p className="mt-5 text-vuno-muted leading-relaxed">
              한 명의 의사가 동시에 12명을 봐야 하는 응급실에서,
              AI가 1차 소견을 정리해주면 의사는 가장 위급한 환자부터 깊이 봅니다.
              우리가 만드는 건 의사를 대체하는 AI가 아니라, 의사가 더 잘하도록 돕는 시스템입니다.
            </p>
          </div>
          <div>
            <div className="text-xs font-bold text-vuno-cyan uppercase tracking-[0.2em] mb-4">Values</div>
            <ul className="space-y-4 text-vuno-muted">
              <li className="flex gap-4">
                <span className="text-vuno-cyan font-bold font-numeric">01</span>
                <div>
                  <div className="font-bold text-white">의료 표준 우선</div>
                  <div className="text-sm">FHIR R4 · KTAS · 의료법 5년 보관</div>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="text-vuno-cyan font-bold font-numeric">02</span>
                <div>
                  <div className="font-bold text-white">최종 결정은 의사</div>
                  <div className="text-sm">AI는 항상 근거를 함께 제시, 승인·거부 권한은 의사</div>
                </div>
              </li>
              <li className="flex gap-4">
                <span className="text-vuno-cyan font-bold font-numeric">03</span>
                <div>
                  <div className="font-bold text-white">임상 무중단</div>
                  <div className="text-sm">시스템이 다운돼도 환자 등록은 항상 성공</div>
                </div>
              </li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}

function BottomCTA() {
  return (
    <section className="py-20 border-t border-vuno-divider">
      <div className="max-w-[900px] mx-auto px-6 text-center">
        <h2 className="text-3xl md:text-4xl font-bold text-white">함께 만드시겠어요?</h2>
        <p className="mt-3 text-vuno-muted">파일럿 병원, 임상 자문, 협력 개발자를 찾고 있습니다.</p>
        <Link
          to="/contact"
          className="inline-flex items-center gap-2 mt-7 h-12 px-8 font-bold border border-vuno-cyan text-vuno-cyan hover:bg-vuno-cyan hover:text-vuno-bg transition-colors tracking-wider uppercase text-sm"
        >
          협력 문의 <ArrowUpRight className="h-4 w-4" />
        </Link>
      </div>
    </section>
  );
}
