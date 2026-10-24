import { expect, test } from "vitest";

import {
  TINYFISH_STREAMING_ORIGIN,
  contentSecurityPolicy,
  securityHeaders,
} from "./security-headers";

const apiOrigin = "http://127.0.0.1:8000";

test("limits connect-src to this app and the API, and frame-src to the placeholder", () => {
  const policy = contentSecurityPolicy(apiOrigin, false);

  expect(policy).toContain(`connect-src 'self' ${apiOrigin}`);
  expect(policy).toContain(`frame-src ${TINYFISH_STREAMING_ORIGIN}`);
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).not.toContain("tinyfish.ai");
  expect(policy).not.toContain("*");
  expect(policy).not.toContain("unsafe-eval");
});

test("allows eval only in development", () => {
  expect(contentSecurityPolicy(apiOrigin, true)).toContain("'unsafe-eval'");
});

test("sets the static security headers", () => {
  expect(securityHeaders()).toEqual([
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "no-referrer" },
    {
      key: "Permissions-Policy",
      value:
        "camera=(), display-capture=(), geolocation=(), microphone=(), payment=(), usb=()",
    },
  ]);
});
