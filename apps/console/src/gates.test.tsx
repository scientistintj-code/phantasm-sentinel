import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./forensics";
import { deployAllowed } from "./mission";
import { StatusBanners } from "./components/StatusBanners";
import { Topbar } from "./components/Topbar";
import { LiveAgentView } from "./components/LiveAgentView";
import type { PivotState } from "@phantasm/core";

afterEach(() => {
  cleanup();
});

it("gates deploy on authorization", () => {
  expect(deployAllowed({ investigator: "Ada", authorized: false, targetCount: 1 })).toBe(false);
  expect(deployAllowed({ investigator: " ", authorized: true, targetCount: 1 })).toBe(false);
  expect(deployAllowed({ investigator: "Ada", authorized: true, targetCount: 0 })).toBe(false);
  expect(deployAllowed({ investigator: "Ada", authorized: true, targetCount: 2 })).toBe(true);
});

it("disables Live when key health is unavailable", () => {
  render(
    <Topbar
      agentStatus="IDLE"
      agentClass="status-idle"
      mode="replay"
      liveEnabled={false}
      caseId="case-1"
      caseHref="/cases/case-1"
      presentation={false}
      onMode={() => undefined}
      onTogglePresentation={() => undefined}
    />,
  );
  expect((screen.getByRole("button", { name: "Live" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByRole("link", { name: "Open case file" }).getAttribute("href")).toBe("/cases/case-1");
});

it("renders api, reconnect, and key-pool banners", () => {
  const onRetry = vi.fn();
  render(
    <StatusBanners
      apiError="Targets rejected"
      onRetry={onRetry}
      reconnecting
      keyNotice="All keys exhausted or cooling. Earliest recovery 2026-10-24T12:00:10.000Z"
    />,
  );
  expect(screen.getByRole("alert").textContent).toContain("Targets rejected");
  fireEvent.click(screen.getByRole("button", { name: "Retry" }));
  expect(onRetry).toHaveBeenCalledOnce();
  expect(screen.getByText("Reconnecting to event stream")).toBeTruthy();
  expect(screen.getByText(/Earliest recovery 2026-10-24T12:00:10.000Z/)).toBeTruthy();
});

it("falls back to a textarea when the clipboard rejects", async () => {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const exec = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  await copyText("fallback-value");
  expect(exec).toHaveBeenCalledWith("copy");
});

it("approves and dismisses the exact pivot query", () => {
  const pivot: PivotState = {
    pivotId: "piv_1",
    targetId: "tgt_lab_a",
    query: "site:lab-a.example merchant",
    seq: 6,
    indicator: { kind: "domain", value: "lab-a.example", confidence: 1, source: "agent" },
  };
  const onApprove = vi.fn();
  const onDismiss = vi.fn();
  render(
    <LiveAgentView
      targets={[
        { id: "tgt_lab_a", label: "lab-a.example", status: "running", dot: "failed", failureMessage: null, halted: true },
        { id: "tgt_lab_b", label: "lab-b.example", status: "failed", dot: "failed", failureMessage: "site blocked", halted: false },
      ]}
      selectedTargetId="tgt_lab_a"
      address="lab-a.example"
      mode="live"
      streamingUrl={null}
      streamOrigins={[]}
      phaseIndex={1}
      complete={false}
      lines={[{ id: "4", time: "00:01", tag: "THREAT", tone: "risk", module: "", message: "payment wall", card: "halt" }]}
      pivots={[pivot]}
      onSelectTarget={() => undefined}
      onApprovePivot={onApprove}
      onDismissPivot={onDismiss}
    />,
  );
  expect(document.querySelector(".status-dot-failed")).toBeTruthy();
  expect(screen.getByText("site blocked")).toBeTruthy();
  expect(screen.getByText("payment wall").className).toBe("halt-card");
  expect(screen.getByText("site:lab-a.example merchant")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Approve" }));
  fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
  expect(onApprove).toHaveBeenCalledWith("piv_1");
  expect(onDismiss).toHaveBeenCalledWith("piv_1");
});
