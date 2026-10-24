// VERIFY: streaming_url origin is not stated in docs/TINYFISH_FACTS.md or docs/TINYFISH_DOCS.txt.
// This host is a placeholder, not a TinyFish endpoint.
export const TINYFISH_STREAMING_ORIGIN = "https://streaming.tinyfish.invalid";

export type SecurityHeader = {
  key: string;
  value: string;
};

function requireOrigin(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("CSP connect-src origin is invalid");
  }
  if (url.origin !== value) {
    throw new Error("CSP connect-src origin is invalid");
  }
  return url.origin;
}

/**
 * Static CSP. Next.js bootstraps with inline scripts, and these headers
 * cannot carry a per-request nonce. connect-src is this app plus the API.
 * frame-src is only the streaming placeholder. frame-ancestors is none.
 */
export function contentSecurityPolicy(apiOrigin: string, dev: boolean): string {
  const origin = requireOrigin(apiOrigin);
  const scriptSrc = dev
    ? "script-src 'self' 'unsafe-inline' 'unsafe-eval'"
    : "script-src 'self' 'unsafe-inline'";

  return [
    "default-src 'self'",
    scriptSrc,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self'",
    `connect-src 'self' ${origin}`,
    `frame-src ${TINYFISH_STREAMING_ORIGIN}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
  ].join("; ");
}

export function securityHeaders(): SecurityHeader[] {
  return [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
  ];
}
