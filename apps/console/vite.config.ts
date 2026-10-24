import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const corePackage = JSON.parse(
  readFileSync(fileURLToPath(new URL("../../packages/core/package.json", import.meta.url)), "utf8"),
) as { version: string };

export default defineConfig({
  base: "/console/",
  define: {
    __PHANTASM_CORE_VERSION__: JSON.stringify(corePackage.version),
  },
  resolve: {
    alias: {
      "@phantasm/core/fixtures": fileURLToPath(new URL("../../packages/core/fixtures", import.meta.url)),
    },
  },
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
