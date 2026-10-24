import { z } from "zod";

/**
 * Public environment, validated when this module loads.
 * Loopback is allowed: this is our own API, not a page the agent fetches.
 */
const apiBaseUrlSchema = z
  .string({ error: "is required" })
  .trim()
  .min(1, { error: "is required" })
  .transform((value, ctx) => {
    const normalized = normalizeApiBaseUrl(value);
    if (normalized.ok) {
      return normalized.url;
    }
    ctx.addIssue(normalized.message);
    return z.NEVER;
  });

const envSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: apiBaseUrlSchema,
});

export type Env = z.output<typeof envSchema>;

type EnvSource = {
  NEXT_PUBLIC_API_BASE_URL?: string | undefined;
};

type NormalizeResult =
  { ok: true; url: string } | { ok: false; message: string };

function normalizeApiBaseUrl(value: string): NormalizeResult {
  if (/[\s\\@]/.test(value)) {
    return { ok: false, message: "must not include credentials or whitespace" };
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return { ok: false, message: "must be an absolute http or https URL" };
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, message: "must use http or https" };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, message: "must not include credentials" };
  }
  if (url.search !== "" || url.hash !== "") {
    return { ok: false, message: "must not include a query or fragment" };
  }
  if (url.pathname !== "/" && url.pathname !== "") {
    return { ok: false, message: "must not include a path" };
  }
  if (url.hostname === "") {
    return { ok: false, message: "must include a host" };
  }

  return { ok: true, url: url.origin };
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length > 0
          ? issue.path.map(String).join(".")
          : "environment";
      return `${path}: ${issue.message}`;
    })
    .join("; ");
}

export function loadEnv(source: EnvSource): Env {
  const parsed = envSchema.safeParse({
    NEXT_PUBLIC_API_BASE_URL: source.NEXT_PUBLIC_API_BASE_URL,
  });
  if (!parsed.success) {
    throw new Error(`Invalid environment. ${formatIssues(parsed.error)}`);
  }
  return parsed.data;
}

export const env = loadEnv({
  NEXT_PUBLIC_API_BASE_URL: process.env.NEXT_PUBLIC_API_BASE_URL,
});
