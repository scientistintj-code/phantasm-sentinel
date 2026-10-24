/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE?: string;
  readonly VITE_LAB_URLS?: string;
  readonly VITE_STREAM_ORIGINS?: string;
  readonly VITE_DEFAULT_MODE?: string;
  readonly VITE_ENABLE_AGENT_TOGGLES?: string;
  readonly VITE_CONSOLE_MODE?: string;
}

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
