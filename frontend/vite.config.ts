import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  test: { environment: "jsdom", setupFiles: "./src/test/setup.ts" },
  server: {
    proxy: {
      "/api": { target: "http://localhost:8080", changeOrigin: true, ws: true },
      "/ws": { target: "http://localhost:8080", changeOrigin: true, ws: true },
    },
  },
});
