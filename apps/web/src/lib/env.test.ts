import { expect, test } from "vitest";

import { loadEnv } from "./env";

test("normalizes the API origin", () => {
  expect(
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "HTTP://LocalHost:8000/" })
      .NEXT_PUBLIC_API_BASE_URL,
  ).toBe("http://localhost:8000");
});

test("keeps a non-default port", () => {
  expect(
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000" })
      .NEXT_PUBLIC_API_BASE_URL,
  ).toBe("http://127.0.0.1:8000");
});

test("rejects embedded credentials", () => {
  expect(() =>
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "http://user:pass@127.0.0.1:8000" }),
  ).toThrow(/credentials/);
});

test("rejects a query, a path, and a non-http scheme", () => {
  expect(() =>
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000?x=1" }),
  ).toThrow(/query/);
  expect(() =>
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:8000/health" }),
  ).toThrow(/path/);
  expect(() =>
    loadEnv({ NEXT_PUBLIC_API_BASE_URL: "javascript:alert(1)" }),
  ).toThrow(/http or https/);
});

test("rejects a missing value", () => {
  expect(() => loadEnv({ NEXT_PUBLIC_API_BASE_URL: undefined })).toThrow(
    /NEXT_PUBLIC_API_BASE_URL/,
  );
});
