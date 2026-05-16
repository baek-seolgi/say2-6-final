// say-6 v2 — AWS Cognito JWT 인증 헬퍼
//
// 운영 환경 사용 흐름:
//   1) Cognito User Pool + Hosted UI 활성화
//   2) IdP (병원 AD/Okta) SAML 또는 OIDC 등록
//   3) signInWithSSO() → Hosted UI로 redirect
//   4) 콜백 URL에서 code 받음 → exchangeCodeForTokens()
//   5) idToken 디코드 → user 정보 + groups(role) 추출
//   6) 모든 API 호출에 Authorization: Bearer <accessToken>
//
// 환경변수 (frontend/.env):
//   VITE_COGNITO_DOMAIN=say-6.auth.ap-northeast-2.amazoncognito.com
//   VITE_COGNITO_CLIENT_ID=xxxxxxxxxxxxxxxxxxxxxxxxxxxx
//   VITE_COGNITO_REDIRECT_URI=https://app.say-6.com/v2/auth/callback
//   VITE_COGNITO_REGION=ap-northeast-2
//   VITE_COGNITO_USER_POOL_ID=ap-northeast-2_xxxxxxxxx

import type { UserRole } from "./auth";

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
}

export interface CognitoIdTokenPayload {
  sub: string;
  email?: string;
  name?: string;
  "cognito:groups"?: string[];      // 예: ["doctor"] 또는 ["nurse"]
  "cognito:username"?: string;
  exp: number;
  iat: number;
}

const TOKEN_STORAGE_KEY = "say6_cognito_tokens";

// ─────────────────────────────────────────────────────────────
// 1. 로그인 — Cognito Hosted UI로 redirect
// ─────────────────────────────────────────────────────────────
export function signInWithSSO(): void {
  const domain      = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId    = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI;

  if (!domain || !clientId || !redirectUri) {
    console.warn("[Cognito] 환경변수 누락 — 데모 모드로 fallback");
    return;
  }

  const url = new URL(`https://${domain}/oauth2/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  url.searchParams.set("redirect_uri", redirectUri);
  // SAML/OIDC IdP를 직접 지정하려면:
  //   url.searchParams.set("identity_provider", "HospitalAD");

  window.location.href = url.toString();
}

// ─────────────────────────────────────────────────────────────
// 2. 콜백 — code → tokens 교환
// ─────────────────────────────────────────────────────────────
export async function exchangeCodeForTokens(code: string): Promise<CognitoTokens> {
  const domain      = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId    = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI;

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`https://${domain}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) throw new Error(`Cognito token exchange 실패: ${res.status}`);

  const json = await res.json();
  const tokens: CognitoTokens = {
    idToken: json.id_token,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  };
  saveTokens(tokens);
  return tokens;
}

// ─────────────────────────────────────────────────────────────
// 3. JWT 디코드 (서명 검증 없음 — 클라이언트는 페이로드만 읽음)
//    서명 검증은 백엔드(API Gateway / ALB)에서 수행
// ─────────────────────────────────────────────────────────────
export function decodeIdToken(idToken: string): CognitoIdTokenPayload | null {
  try {
    const [, payload] = idToken.split(".");
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    return JSON.parse(decodeURIComponent(escape(json)));
  } catch {
    return null;
  }
}

// Cognito Groups → UserRole 매핑
export function roleFromGroups(groups?: string[]): UserRole | undefined {
  if (!groups) return undefined;
  if (groups.includes("doctor")) return "doctor";
  if (groups.includes("nurse"))  return "nurse";
  return undefined;
}

// ─────────────────────────────────────────────────────────────
// 4. 토큰 저장/조회 (localStorage)
//    NOTE: 프로덕션에서는 HttpOnly cookie + Backend session 권장
// ─────────────────────────────────────────────────────────────
export function saveTokens(tokens: CognitoTokens): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
}

export function loadTokens(): CognitoTokens | null {
  try {
    const raw = localStorage.getItem(TOKEN_STORAGE_KEY);
    if (!raw) return null;
    const t = JSON.parse(raw) as CognitoTokens;
    if (t.expiresAt < Date.now()) {
      // 만료된 토큰 — 갱신 필요
      clearTokens();
      return null;
    }
    return t;
  } catch {
    return null;
  }
}

export function clearTokens(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}

// ─────────────────────────────────────────────────────────────
// 5. fetch wrapper — 자동으로 Authorization 헤더 첨부
// ─────────────────────────────────────────────────────────────
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const tokens = loadTokens();
  const headers = new Headers(init?.headers);

  if (tokens?.accessToken) {
    headers.set("Authorization", `Bearer ${tokens.accessToken}`);
  }
  if (!headers.has("Content-Type") && init?.body) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(input, { ...init, headers });

  // 401 — 토큰 만료 또는 무효
  if (res.status === 401) {
    clearTokens();
    window.location.href = "/demo/login";
  }
  return res;
}

// ─────────────────────────────────────────────────────────────
// 6. 로그아웃 — Cognito Hosted UI logout endpoint
// ─────────────────────────────────────────────────────────────
export function signOut(): void {
  clearTokens();
  const domain      = import.meta.env.VITE_COGNITO_DOMAIN;
  const clientId    = import.meta.env.VITE_COGNITO_CLIENT_ID;
  const redirectUri = import.meta.env.VITE_COGNITO_REDIRECT_URI;

  if (!domain || !clientId) {
    window.location.href = "/demo/login";
    return;
  }

  const url = new URL(`https://${domain}/logout`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("logout_uri", redirectUri ?? window.location.origin);
  window.location.href = url.toString();
}
