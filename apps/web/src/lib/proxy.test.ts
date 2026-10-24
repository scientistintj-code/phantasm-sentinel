import { expect, test } from "vitest";

import {
  filterRequestHeaders,
  proxyRequestHeaders,
  resolveProxyTarget,
  upstreamResponseHeaders,
} from "./proxy";

const apiBase = "http://127.0.0.1:8000";

test("allows case and key-health prefixes and rejects traversal", () => {
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/cases", ["v1", "cases"]),
  ).toEqual({ ok: true, url: "http://127.0.0.1:8000/v1/cases" });

  expect(
    resolveProxyTarget(
      apiBase,
      "http://web.local/api/sentinel/v1/cases/abc/events?x=1",
      ["v1", "cases", "abc", "events"],
    ),
  ).toEqual({ ok: true, url: "http://127.0.0.1:8000/v1/cases/abc/events?x=1" });

  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/health/keys", [
      "v1",
      "health",
      "keys",
    ]),
  ).toEqual({ ok: true, url: "http://127.0.0.1:8000/v1/health/keys" });

  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/health", ["v1", "health"]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/casesomething", [
      "v1",
      "casesomething",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/health/keyboard", [
      "v1",
      "health",
      "keyboard",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/cases/../admin", [
      "v1",
      "cases",
      "..",
      "admin",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/cases/%2e%2e/admin", [
      "v1",
      "cases",
      "..",
      "admin",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/cases/%2Fadmin", [
      "v1",
      "cases",
      "admin",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1/cases/%5Cadmin", [
      "v1",
      "cases",
      "admin",
    ]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel//v1/cases", ["v1", "cases"]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://web.local/api/sentinel/v1//cases", ["v1", "cases"]).ok,
  ).toBe(false);
  expect(
    resolveProxyTarget(apiBase, "http://user:secret@web.local/api/sentinel/v1/cases", [
      "v1",
      "cases",
    ]).ok,
  ).toBe(false);
});

test("forwards only safe headers and drops cookies", () => {
  const incoming = new Headers();
  incoming.set("cookie", "session=secret");
  incoming.set("authorization", "Bearer client");
  incoming.set("x-sentinel-token", "client-token");
  incoming.set("host", "evil.example");
  incoming.set("accept", "text/event-stream");
  incoming.set("content-type", "application/json");
  incoming.set("last-event-id", "12");
  incoming.set("x-evil", "1");

  const filtered = filterRequestHeaders(incoming);
  expect(filtered.get("cookie")).toBeNull();
  expect(filtered.get("authorization")).toBeNull();
  expect(filtered.get("x-sentinel-token")).toBeNull();
  expect(filtered.get("host")).toBeNull();
  expect(filtered.get("x-evil")).toBeNull();
  expect(filtered.get("accept")).toBe("text/event-stream");
  expect(filtered.get("content-type")).toBe("application/json");
  expect(filtered.get("last-event-id")).toBe("12");

  const proxied = proxyRequestHeaders(incoming, "server-token");
  expect(proxied.get("cookie")).toBeNull();
  expect(proxied.get("x-sentinel-token")).toBe("server-token");
  expect(proxied.get("last-event-id")).toBe("12");
  expect([...proxied.keys()].sort()).toEqual([
    "accept",
    "content-type",
    "last-event-id",
    "x-sentinel-token",
  ]);
});

test("streams SSE with an unbuffered no-store response and no cookies", () => {
  const headers = upstreamResponseHeaders("text/event-stream; charset=utf-8", true);
  expect(headers.get("content-type")).toBe("text/event-stream; charset=utf-8");
  expect(headers.get("cache-control")).toBe("no-store");
  expect(headers.get("x-accel-buffering")).toBe("no");
  expect(headers.get("set-cookie")).toBeNull();
});
