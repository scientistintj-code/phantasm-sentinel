/// <reference types="vite/client" />

declare const __PHANTASM_CORE_VERSION__: string;

declare module "*.ndjson?raw" {
  const source: string;
  export default source;
}

declare module "*.json?raw" {
  const source: string;
  export default source;
}

declare module "*.css";
