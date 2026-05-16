import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    // localtunnel/ngrok/cloudflare 외부 호스트 허용 (Figma plugin 등에서 접근)
    allowedHosts: [".loca.lt", ".trycloudflare.com", ".ngrok-free.app", ".ngrok.app"],
    proxy: {
      "/predict": "http://13.124.117.190:8000",
      "/health": "http://13.124.117.190:8000",
      "/ready": "http://13.124.117.190:8000",
      // 중앙백엔드 (8000, Docker container — ML 결정 엔진 통합 후)
      "/mimic": "http://localhost:8000",
      "/triage/submit": "http://localhost:8000",  // SPA의 /triage와 충돌 X
      "/encounters": "http://localhost:8000",
      "/orders": "http://localhost:8000",
      "/reports": "http://localhost:8000",
      "/assets": "http://localhost:8000",
    },
  },
});
