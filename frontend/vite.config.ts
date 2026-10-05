import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// API_PROXY_TARGET lets several local checkouts run side by side, each against its own backend.
const apiTarget = process.env.API_PROXY_TARGET ?? "http://localhost:8080";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" },
  server: {
    proxy: {
      "/api": { target: apiTarget, changeOrigin: true, ws: true },
      "/ws": { target: apiTarget, changeOrigin: true, ws: true },
    },
  },
});
