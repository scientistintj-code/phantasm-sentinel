import { expect, test } from "vitest";

import { contentSecurityPolicy, parseStreamOrigins, securityHeaders } from "./security-headers";

test("limits connect-src to this app and frame-src to configured stream origins", () => {
  const policy = contentSecurityPolicy({
    dev: false,
    nonce: "abc+def=",
    streamOrigins: ["https://stream.example"],
  });

  expect(policy).toContain("default-src 'self'");
  expect(policy).toContain("script-src 'self' 'nonce-abc+def='");
  expect(policy).toContain("style-src 'self' 'unsafe-inline'");
  expect(policy).toContain("font-src 'self'");
  expect(policy).toContain("img-src 'self' data:");
  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toContain("127.0.0.1");
  expect(policy).toContain("frame-src https://stream.example");
  expect(policy).toContain("frame-ancestors 'none'");
  expect(policy).toContain("base-uri 'self'");
  expect(policy).toContain("form-action 'self'");
  expect(policy).not.toContain("strict-dynamic");
  expect(policy).not.toContain("unsafe-eval");
  expect(policy).not.toContain("blob:");
  expect(policy).not.toContain("tinyfish.ai");
  expect(policy).not.toContain("*");
});

test("uses frame-src none when no stream origins are configured", () => {
  expect(
    contentSecurityPolicy({ dev: false, nonce: "abc", streamOrigins: [] }),
  ).toContain("frame-src 'none'");
});

test("keeps only http(s) stream origins", () => {
  expect(
    parseStreamOrigins(
      "https://stream.example/view, javascript:alert(1), data:text/html,hi, https://stream.example/other",
    ),
  ).toEqual(["https://stream.example"]);
  expect(parseStreamOrigins(undefined)).toEqual([]);
});

test("allows eval only in development", () => {
  const policy = contentSecurityPolicy({ dev: true, streamOrigins: [] });
  expect(policy).toContain("'unsafe-eval'");
  expect(policy).toContain("'unsafe-inline'");
  expect(policy).not.toContain("nonce-");
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
