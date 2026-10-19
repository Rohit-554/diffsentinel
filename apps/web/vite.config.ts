import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

// All apps share the repository-root .env.
const envDir = fileURLToPath(new URL("../..", import.meta.url));

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, envDir, "VITE_"), ...process.env };
  // The dev server proxies /api to the API so the browser sees one origin, the
  // same as nginx does in Docker Compose. No CORS configuration is needed.
  const apiTarget = env.VITE_API_PROXY_TARGET ?? "http://localhost:3000";

  return {
    envDir,
    plugins: [react()],
    server: {
      port: 5173,
      proxy: {
        "/api": { target: apiTarget, changeOrigin: true },
      },
    },
    test: {
      environment: "jsdom",
      setupFiles: ["./src/test/setup.ts"],
    },
  };
});
