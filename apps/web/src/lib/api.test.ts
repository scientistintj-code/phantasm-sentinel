import { afterEach, expect, test, vi } from "vitest";
import { z } from "zod";

import { ApiError, apiFetch } from "./api";

const healthSchema = z.object({ status: z.string() });

afterEach(() => {
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("loads a schema-checked response from the API origin without credentials", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(apiFetch("/health", healthSchema)).resolves.toEqual({
    status: "ok",
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/health",
    expect.objectContaining({ credentials: "omit", redirect: "error" }),
  );
});

test("sends caller credentials and headers only to the API origin", async () => {
  const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ok" }));
  vi.stubGlobal("fetch", fetchMock);

  await apiFetch("http://127.0.0.1:8000/health", healthSchema, {
    method: "POST",
    credentials: "include",
    redirect: "follow",
    headers: { Authorization: "Bearer session" },
  });

  expect(fetchMock).toHaveBeenCalledWith(
    "http://127.0.0.1:8000/health",
    expect.objectContaining({
      method: "POST",
      credentials: "include",
      redirect: "error",
      headers: { Authorization: "Bearer session" },
    }),
  );
});

test("does not send credentials or headers to another origin", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    apiFetch("https://agent.tinyfish.ai/v1/automation/run", healthSchema, {
      credentials: "include",
      headers: { Authorization: "Bearer session" },
    }),
  ).rejects.toMatchObject({ name: "ApiError", code: "forbidden_origin" });

  await expect(
    apiFetch("//evil.example/steal", healthSchema),
  ).rejects.toBeInstanceOf(ApiError);
  expect(fetchMock).not.toHaveBeenCalled();
});

test("rejects credentials embedded in the request URL", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);

  await expect(
    apiFetch("http://user:secret@127.0.0.1:8000/health", healthSchema),
  ).rejects.toMatchObject({ code: "embedded_credentials" });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("throws ApiError for a problem response and a schema mismatch", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      jsonResponse({ code: "invalid_target", detail: "bad target" }, 400),
    )
    .mockResolvedValueOnce(jsonResponse({ nope: true }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(apiFetch("/health", healthSchema)).rejects.toMatchObject({
    status: 400,
    code: "invalid_target",
    message: "bad target",
  });
  await expect(apiFetch("/health", healthSchema)).rejects.toMatchObject({
    code: "invalid_response",
  });
});

test("throws ApiError when the network request fails", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("offline")));

  await expect(apiFetch("/health", healthSchema)).rejects.toMatchObject({
    code: "network",
  });
});
