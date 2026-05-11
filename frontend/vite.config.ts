import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 3000,
    proxy: {
      "/predict": "http://13.124.117.190:8000",
      "/health": "http://13.124.117.190:8000",
      "/ready": "http://13.124.117.190:8000",
      // 중앙백엔드 (8001) — SPA 라우트와 충돌 안 나는 prefix만
      "/mimic": "http://localhost:8001",
      "/triage/submit": "http://localhost:8001",  // SPA의 /triage와 충돌 X
      "/encounters": "http://localhost:8001",
      "/orders": "http://localhost:8001",
      "/reports": "http://localhost:8001",
      "/assets": "http://localhost:8001",
    },
  },
});
