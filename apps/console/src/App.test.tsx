import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { App } from "./App";
import { CASE_ID_STORAGE_KEY } from "./viewState";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

function deployButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: /DEPLOY AGENT|STOP AGENT|DEPLOYING|MISSION COMPLETE/ }) as HTMLButtonElement;
}

it("renders the idle replay shell", () => {
  render(<App />);
  expect(screen.getAllByText(/PHANTASM/).length).toBeGreaterThan(0);
  expect(screen.getByText(/AGENT\s+IDLE/)).toBeTruthy();
  expect(screen.getByText("REPLAY")).toBeTruthy();
  expect(screen.getByText(/awaiting mission deployment/)).toBeTruthy();
  expect(screen.queryByText(/MOCK INTELLIGENCE FEED/)).toBeNull();
  expect(screen.queryByText("AGENT_04")).toBeNull();
  expect(screen.queryByText(/v0\.9\.6/)).toBeNull();
  expect(screen.queryByText(/nexora-deals/)).toBeNull();
  expect(screen.queryByText("Fake E-commerce")).toBeNull();
  expect(screen.getByText(/PHANTASM CORE v\d/)).toBeTruthy();
  expect(screen.getByRole("button", { name: /Simulate error/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Presentation Mode/ }));
  expect(document.querySelector("main.presentation")).toBeTruthy();
  expect(screen.getAllByText("Managed by Tiny Fish").length).toBeGreaterThan(0);
  expect(screen.getByText("max 1 by key pool")).toBeTruthy();
  expect(screen.getByText("key-1")).toBeTruthy();
  expect(screen.getByText("Search")).toBeTruthy();
  expect(screen.getByText("Browser Context Profiles")).toBeTruthy();
  expect(deployButton().disabled).toBe(true);
});

it("adds removable targets, fills focus, and deploys a replay", () => {
  render(<App />);
  const input = screen.getByPlaceholderText("https://suspicious-site.example");
  fireEvent.change(input, { target: { value: "ftp://files.example/a" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("Enter an http(s) URL")).toBeTruthy();

  fireEvent.change(input, { target: { value: "https://checkout.example/pay" } });
  fireEvent.keyDown(input, { key: "Enter" });
  expect(screen.getByText("checkout.example/pay")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Suggested focus/ }));
  const focus = screen.getByLabelText(/Investigation focus/) as HTMLTextAreaElement;
  expect(focus.value).toContain("payment endpoints");
  expect(screen.getByText(`${focus.value.length}/300`)).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: "lab-e.example" }));
  expect(screen.getAllByText("lab-e.example").length).toBeGreaterThan(0);
  fireEvent.change(screen.getByLabelText(/max_parallel/), { target: { value: "4" } });
  expect(screen.getByText("max 4 by key pool")).toBeTruthy();
  expect(screen.getByRole("button", { name: "4x" })).toBeTruthy();

  fireEvent.change(screen.getByLabelText(/Investigator name/), { target: { value: "Ada" } });
  fireEvent.click(screen.getByRole("checkbox", { name: /I am authorized to investigate these targets/ }));
  expect(deployButton().disabled).toBe(false);
  fireEvent.click(deployButton());
  expect(screen.getByRole("button", { name: /STOP AGENT/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /Presentation Mode/ }));
  expect(document.querySelector("main.presentation")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: /STOP AGENT/ }));
  expect(screen.getByRole("button", { name: /DEPLOY AGENT/ })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Remove https://checkout.example/pay" }));
  expect(screen.queryByText("checkout.example/pay")).toBeNull();
});

it("clears a missing case id from storage and the url without an error banner", async () => {
  localStorage.setItem(CASE_ID_STORAGE_KEY, "missing");
  sessionStorage.setItem(CASE_ID_STORAGE_KEY, "missing");
  window.history.replaceState(null, "", "/console/?case=missing");
  const calls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    const href = String(url);
    calls.push(href);
    if (href.endsWith("/v1/health/keys")) {
      return new Response("[]", { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.endsWith("/v1/cases/missing")) {
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Case not found",
          instance: "/v1/cases/missing",
        }),
        { status: 404, headers: { "content-type": "application/problem+json" } },
      );
    }
    return new Response("{}", { status: 500 });
  });

  render(<App />);
  await waitFor(() => {
    expect(calls.some((href) => href.endsWith("/v1/health/keys"))).toBe(true);
  });
  expect(calls.some((href) => href.includes("/v1/cases/"))).toBe(false);
  expect(screen.queryByRole("alert")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Live" }));
  await waitFor(() => {
    expect(localStorage.getItem(CASE_ID_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(CASE_ID_STORAGE_KEY)).toBeNull();
  });
  expect(window.location.search).toBe("");
  expect(screen.queryByRole("alert")).toBeNull();
  expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  expect(screen.getByText(/AGENT\s+IDLE/)).toBeTruthy();
  expect(calls.some((href) => href.endsWith("/v1/cases/missing"))).toBe(true);
  expect(calls.some((href) => href.includes("/events") || href.includes("/graph") || href.includes("/report"))).toBe(false);
});
