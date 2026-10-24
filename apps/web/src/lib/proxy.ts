import { env } from "./env";

export const MAX_BODY_BYTES = 64 * 1024;

const PROXY_PREFIX = "/api/sentinel";
const ALLOWED_ROOTS = ["/v1/cases", "/v1/health/keys"] as const;
const SAFE_REQUEST_HEADERS = ["accept", "accept-language", "content-type", "last-event-id"] as const;

export type ProxyTarget = { ok: true; url: string } | { ok: false };

export function readSentinelToken(value: string | undefined): string | null {
  if (value === undefined) return null;
  const token = value.trim();
  if (token === "" || /[\r\n]/.test(token)) return null;
  return token;
}

export function rawRequestPathIsSafe(rawUrl: string): boolean {
  if (rawUrl.includes("@") || rawUrl.includes("\\")) return false;
  const withoutHash = rawUrl.split("#")[0] ?? "";
  const scheme = /^[a-z][a-z+\-.]*:\/\//i.exec(withoutHash);
  const afterScheme = scheme ? withoutHash.slice(scheme[0].length) : withoutHash;
  const pathAndQuery = afterScheme.replace(/^[^/]*/, "");
  const pathOnly = pathAndQuery.split("?")[0] ?? "";
  if (pathOnly === "") return false;
  if (/%2f|%5c|%2e%2e/i.test(pathOnly)) return false;
  if (pathOnly.includes("//") || pathOnly.includes("..")) return false;
  return true;
}

export function isAllowedUpstreamPath(path: string): boolean {
  return ALLOWED_ROOTS.some((root) => path === root || path.startsWith(`${root}/`));
}

export function upstreamFromSegments(segments: readonly string[]): string | null {
  if (segments.length === 0) return null;
  for (const segment of segments) {
    if (segment.length === 0 || segment === "." || segment === "..") return null;
    if (segment.includes("/") || segment.includes("\\") || segment.includes("%")) return null;
    if (segment.includes("..")) return null;
  }
  const path = `/${segments.join("/")}`;
  if (!isAllowedUpstreamPath(path)) return null;
  return path;
}

export function resolveProxyTarget(
  apiBase: string,
  rawUrl: string,
  segments: readonly string[],
): ProxyTarget {
  if (!rawRequestPathIsSafe(rawUrl)) return { ok: false };
  const upstream = upstreamFromSegments(segments);
  if (!upstream) return { ok: false };

  let parsed: URL;
  let base: URL;
  try {
    parsed = new URL(rawUrl);
    base = new URL(apiBase);
  } catch {
    return { ok: false };
  }

  if (parsed.username !== "" || parsed.password !== "") return { ok: false };
  if (parsed.pathname !== `${PROXY_PREFIX}${upstream}`) return { ok: false };
  if (base.origin !== apiBase || base.username !== "" || base.password !== "") return { ok: false };
  if (/[\s\\]/.test(parsed.search)) return { ok: false };

  const target = new URL(`${upstream}${parsed.search}`, base.origin);
  if (target.origin !== base.origin || target.pathname !== upstream) return { ok: false };
  target.hash = "";
  return { ok: true, url: target.href };
}

export function filterRequestHeaders(input: Headers): Headers {
  const headers = new Headers();
  for (const name of SAFE_REQUEST_HEADERS) {
    const value = input.get(name);
    if (value === null || value.trim() === "" || /[\r\n]/.test(value)) continue;
    headers.set(name, value);
  }
  return headers;
}

export function proxyRequestHeaders(input: Headers, token: string): Headers {
  const headers = filterRequestHeaders(input);
  headers.set("X-Sentinel-Token", token);
  return headers;
}

export function wantsEventStream(accept: string | null, upstreamType: string | null): boolean {
  const acceptValue = (accept ?? "").toLowerCase();
  const typeValue = (upstreamType ?? "").toLowerCase();
  return acceptValue.includes("text/event-stream") || typeValue.includes("text/event-stream");
}

export function upstreamResponseHeaders(contentType: string | null, stream: boolean): Headers {
  const headers = new Headers();
  const mediaType = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (stream) {
    const eventType =
      mediaType === "text/event-stream" && contentType !== null && !/[\r\n]/.test(contentType)
        ? contentType
        : "text/event-stream";
    headers.set("content-type", eventType);
    headers.set("cache-control", "no-store");
    headers.set("x-accel-buffering", "no");
    return headers;
  }
  if (contentType !== null && contentType.trim() !== "" && !/[\r\n]/.test(contentType)) {
    headers.set("content-type", contentType);
  }
  headers.set("cache-control", "no-store");
  return headers;
}

export function problemResponse(status: number, title: string, detail: string): Response {
  return new Response(
    JSON.stringify({
      type: "about:blank",
      title,
      status,
      detail,
    }),
    {
      status,
      headers: {
        "content-type": "application/problem+json",
        "cache-control": "no-store",
      },
    },
  );
}

export async function readCappedBody(request: Request): Promise<Uint8Array | null | "too_large"> {
  if (request.method === "GET" || request.method === "HEAD") return null;
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return "too_large";
  }
  if (request.body === null) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const next = await reader.read();
    if (next.done) break;
    const value = next.value;
    if (!value) continue;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      return "too_large";
    }
    chunks.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function sentinelFetch(upstreamPath: string): Promise<Response> {
  const token = readSentinelToken(process.env.SENTINEL_TOKEN);
  if (!token) {
    return problemResponse(500, "Proxy unavailable", "Sentinel token is not configured");
  }
  const path = upstreamPath.startsWith("/") ? upstreamPath : `/${upstreamPath}`;
  const segments = path.split("/").filter((part) => part.length > 0);
  const target = resolveProxyTarget(
    env.NEXT_PUBLIC_API_BASE_URL,
    `http://sentinel.internal${PROXY_PREFIX}${path}`,
    segments,
  );
  if (!target.ok) {
    return problemResponse(403, "Forbidden", "Path is not allowed");
  }

  const headers = new Headers();
  headers.set("accept", "application/json");
  headers.set("X-Sentinel-Token", token);
  try {
    return await fetch(target.url, {
      method: "GET",
      headers,
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return problemResponse(502, "Bad Gateway", "Upstream request failed");
  }
}
