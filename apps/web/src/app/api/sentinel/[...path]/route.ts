import { NextRequest } from "next/server";

import { env } from "@/lib/env";
import {
  problemResponse,
  proxyRequestHeaders,
  readCappedBody,
  readSentinelToken,
  resolveProxyTarget,
  upstreamResponseHeaders,
  wantsEventStream,
} from "@/lib/proxy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ path: string[] }>;
};

const METHODS = new Set(["GET", "HEAD", "POST"]);

async function handle(request: NextRequest, context: RouteContext): Promise<Response> {
  if (!METHODS.has(request.method)) {
    return problemResponse(405, "Method Not Allowed", "Method is not allowed");
  }

  const token = readSentinelToken(process.env.SENTINEL_TOKEN);
  if (!token) {
    return problemResponse(500, "Proxy unavailable", "Sentinel token is not configured");
  }

  const { path } = await context.params;
  const target = resolveProxyTarget(env.NEXT_PUBLIC_API_BASE_URL, request.url, path);
  if (!target.ok) {
    return problemResponse(403, "Forbidden", "Path is not allowed");
  }

  const body = await readCappedBody(request);
  if (body === "too_large") {
    return problemResponse(413, "Payload Too Large", "Request body exceeds 64 KB");
  }

  const headers = proxyRequestHeaders(request.headers, token);
  let upstream: Response;
  try {
    upstream = await fetch(target.url, {
      method: request.method,
      headers,
      body: body === null ? undefined : Buffer.from(body),
      redirect: "error",
      cache: "no-store",
    });
  } catch {
    return problemResponse(502, "Bad Gateway", "Upstream request failed");
  }

  const stream = wantsEventStream(
    request.headers.get("accept"),
    upstream.headers.get("content-type"),
  );
  return new Response(upstream.body, {
    status: upstream.status,
    headers: upstreamResponseHeaders(upstream.headers.get("content-type"), stream),
  });
}

export const GET = handle;
export const POST = handle;
export const HEAD = handle;
