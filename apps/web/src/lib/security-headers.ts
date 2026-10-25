export type SecurityHeader = {
  key: string;
  value: string;
};

// VERIFY: docs/TINYFISH_FACTS.md does not document the streaming_url host.
// frame-src is 'self' so /console can embed /mock-stream, plus the http(s) origins in SENTINEL_STREAM_ORIGINS.
// script-src stays 'self' plus a production nonce, without strict-dynamic,
// so same-origin /console/ scripts keep loading. The stream iframe is frame-src.

export type ContentSecurityPolicyOptions = {
  dev: boolean;
  nonce?: string;
  streamOrigins: readonly string[];
};

const NONCE_PATTERN = /^[A-Za-z0-9+/]+=*$/;

export function parseStreamOrigins(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === "") return [];
  const origins: string[] = [];
  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    let url: URL;
    try {
      url = new URL(trimmed);
    } catch {
      continue;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") continue;
    if (url.username !== "" || url.password !== "") continue;
    if (/[*;\s]/.test(url.origin)) continue;
    if (!origins.includes(url.origin)) origins.push(url.origin);
  }
  return origins;
}

function scriptSrc(dev: boolean, nonce: string | undefined): string {
  if (dev) return "script-src 'self' 'unsafe-inline' 'unsafe-eval'";
  if (nonce !== undefined && NONCE_PATTERN.test(nonce)) {
    return `script-src 'self' 'nonce-${nonce}'`;
  }
  return "script-src 'self'";
}

function frameSrc(origins: readonly string[]): string {
  const safe = origins.filter((origin) => {
    try {
      const url = new URL(origin);
      return (
        url.origin === origin &&
        (url.protocol === "http:" || url.protocol === "https:") &&
        url.username === "" &&
        url.password === ""
      );
    } catch {
      return false;
    }
  });
  const sources = ["'self'", ...safe];
  return `frame-src ${sources.join(" ")}`;
}

export function contentSecurityPolicy(options: ContentSecurityPolicyOptions): string {
  return [
    "default-src 'self'",
    scriptSrc(options.dev, options.nonce),
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    frameSrc(options.streamOrigins),
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
