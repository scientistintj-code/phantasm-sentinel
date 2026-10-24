import { z } from "zod";

// VERIFY: docs/TINYFISH_FACTS.md documents the Agent API origin https://agent.tinyfish.ai
// but does not document the host of streaming_url. The allow-list therefore defaults to empty.
export const DOCUMENTED_STREAM_ORIGINS = "";

const blankToUndefined = (value: unknown) => (typeof value === "string" && value.trim() === "" ? undefined : value);

const envSchema = z.object({
  VITE_API_BASE: z.preprocess(blankToUndefined, z.string().trim().min(1).default("/api/sentinel")),
  VITE_LAB_URLS: z.preprocess(blankToUndefined, z.string().default("")),
  VITE_STREAM_ORIGINS: z.preprocess(blankToUndefined, z.string().default(DOCUMENTED_STREAM_ORIGINS)),
  VITE_DEFAULT_MODE: z.preprocess(blankToUndefined, z.enum(["replay", "live"]).default("replay")),
  VITE_ENABLE_AGENT_TOGGLES: z.preprocess(blankToUndefined, z.string().default("")),
});

export interface ConsoleConfig {
  apiBase: string;
  labUrls: string;
  streamOrigins: string[];
  defaultMode: "replay" | "live";
  agentToggles: boolean;
}

export interface ConsoleEnv {
  VITE_API_BASE?: string;
  VITE_LAB_URLS?: string;
  VITE_STREAM_ORIGINS?: string;
  VITE_DEFAULT_MODE?: string;
  VITE_ENABLE_AGENT_TOGGLES?: string;
}

export function loadConfig(env: ConsoleEnv = import.meta.env): ConsoleConfig {
  const parsed = envSchema.parse({
    VITE_API_BASE: env.VITE_API_BASE,
    VITE_LAB_URLS: env.VITE_LAB_URLS,
    VITE_STREAM_ORIGINS: env.VITE_STREAM_ORIGINS,
    VITE_DEFAULT_MODE: env.VITE_DEFAULT_MODE,
    VITE_ENABLE_AGENT_TOGGLES: env.VITE_ENABLE_AGENT_TOGGLES,
  });
  return {
    apiBase: parsed.VITE_API_BASE,
    labUrls: parsed.VITE_LAB_URLS,
    streamOrigins: parseOriginList(parsed.VITE_STREAM_ORIGINS),
    defaultMode: parsed.VITE_DEFAULT_MODE,
    agentToggles: parsed.VITE_ENABLE_AGENT_TOGGLES === "true",
  };
}

export function parseOriginList(raw: string): string[] {
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const origin = originOf(part.trim());
    if (!origin || origins.includes(origin)) continue;
    origins.push(origin);
  }
  return origins;
}

function originOf(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username !== "" || url.password !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}
