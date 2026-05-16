import { useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Activity, Building2, ShieldCheck } from "lucide-react";
import { AppShell } from "../../components/v2/AppShell";
import { Card } from "../../components/v2/ui/Card";
import { Button } from "../../components/v2/ui/Button";
import { useAuth, type UserRole } from "../../lib/v2/auth";

export default function LoginPage() {
  const nav = useNavigate();
  const loc = useLocation();
  const [params] = useSearchParams();
  const { signIn, demoLogin } = useAuth();
  const [loading, setLoading] = useState(false);

  // 로그인 후 이동할 경로 (보호 라우트에서 넘어온 from 우선)
  const redirectTo = (loc.state as { from?: string } | null)?.from || "/demo/worklist";

  const cognitoReady =
    !!import.meta.env.VITE_COGNITO_DOMAIN &&
    !!import.meta.env.VITE_COGNITO_CLIENT_ID;

  // 데모 모드 — URL `?demo=nurse` 면 간호사, 기본 의사
  const demoRoleParam = params.get("demo");
  const demoRole: UserRole = demoRoleParam === "nurse" ? "nurse" : "doctor";

  function handleSSO() {
    setLoading(true);
    if (cognitoReady) {
      // Cognito Hosted UI로 redirect (페이지 이탈)
      signIn();
    } else {
      // 데모 모드 — 의사(기본) 또는 ?demo=nurse 시 간호사로 즉시 로그인
      setTimeout(() => {
        demoLogin(demoRole);
        nav(redirectTo, { replace: true });
      }, 600);
    }
  }

  return (
    <AppShell bare>
      <div
        className="min-h-screen w-full grid place-items-center px-4"
        style={{
          background:
            "linear-gradient(135deg, #F8FAFC 0%, #EEF2FF 50%, #F5F3FF 100%)",
        }}
      >
        <Card className="w-full max-w-md p-8">
          {/* 브랜드 */}
          <div className="flex flex-col items-center mb-8">
            <div className="h-14 w-14 rounded-2xl bg-gradient-to-br from-brand-600 to-ai-accent grid place-items-center text-white shadow-ai mb-4">
              <Activity className="h-7 w-7" />
            </div>
            <h1 className="text-2xl font-bold text-slate-900">say-6</h1>
            <p className="text-sm text-slate-500 mt-1">응급실 AI 진단보조 시스템</p>
          </div>

          {/* SSO 단일 로그인 */}
          <Button
            variant="ai"
            fullWidth
            size="lg"
            onClick={handleSSO}
            disabled={loading}
            className="h-14"
          >
            <Building2 className="h-5 w-5" />
            {loading ? "병원 AD 인증 중…" : "병원 SSO로 로그인"}
          </Button>

          <p className="mt-3 text-center text-xs text-slate-500 flex items-center justify-center gap-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />
            병원 직원증으로 통합 인증
          </p>

          <p className="mt-6 text-center text-xs text-slate-400">
            v1.0 · © 2026 say-6
          </p>
        </Card>
      </div>
    </AppShell>
  );
}
