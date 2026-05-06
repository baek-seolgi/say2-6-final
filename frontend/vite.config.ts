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
      // 중앙백엔드 — /mimic만 프록시 (SPA 라우트와 충돌 X)
      "/mimic": "http://localhost:8001",
    },
  },
});
