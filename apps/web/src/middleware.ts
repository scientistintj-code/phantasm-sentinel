import { NextRequest, NextResponse } from "next/server";

import { contentSecurityPolicy, parseStreamOrigins } from "./lib/security-headers";

function makeNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function middleware(request: NextRequest) {
  const dev = process.env.NODE_ENV !== "production";
  const nonce = dev ? undefined : makeNonce();
  const policy = contentSecurityPolicy({
    dev,
    nonce,
    streamOrigins: parseStreamOrigins(process.env.SENTINEL_STREAM_ORIGINS),
  });

  const requestHeaders = new Headers(request.headers);
  if (nonce !== undefined) {
    requestHeaders.set("x-nonce", nonce);
    requestHeaders.set("Content-Security-Policy", policy);
  }

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
