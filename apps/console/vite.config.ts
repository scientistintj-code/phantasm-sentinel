import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "/console/",
  plugins: [react()],
  build: {
    outDir: "../web/public/console",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/api/sentinel": {
        target: "http://localhost:3000",
      },
    },
  },
  test: {
    environment: "jsdom",
  },
});
