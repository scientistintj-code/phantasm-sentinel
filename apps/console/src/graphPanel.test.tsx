import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { labGraph, labReports } from "./fixtures";
import { PDF_DISABLED_REASON, evidenceRows } from "./forensics";
import { copyText } from "./forensics";
import { ForensicPanel } from "./components/ForensicPanel";
import { GraphPanel } from "./components/GraphPanel";
import { MetricsRow } from "./components/MetricsRow";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("shows the report score, coverage, verdict, and failed-check reason", () => {
  const report = labReports[0]!;
  render(
    <ForensicPanel
      score={report.risk.score}
      riskText="HIGH RISK"
      riskColor="#fb5262"
      coverage={report.risk.evidence_coverage}
      verdict={report.risk.verdict}
      validation="invalid"
      chips={[
        { label: "Merchant ID", status: "passed" },
        { label: "Gateway", status: "failed", reason: "gateway missing" },
      ]}
      evidence={evidenceRows(report)}
      scanning={false}
      showSimulateError={false}
      canExportJson
      canExportPdf={false}
      pdfDisabledReason={PDF_DISABLED_REASON}
      animateMs={0}
      onSimulateError={() => undefined}
      onExportJson={() => undefined}
      onExportPdf={() => undefined}
    />,
  );
  const gauge = document.querySelector(".risk-gauge") as HTMLElement;
  expect(gauge.style.getPropertyValue("--risk-color")).toBe("#fb5262");
  expect(gauge.style.getPropertyValue("--risk")).toBe(`${report.risk.score * 3.6}deg`);
  expect(screen.getByText(String(report.risk.score))).toBeTruthy();
  expect(screen.getByText(`Evidence coverage ${report.risk.evidence_coverage}`)).toBeTruthy();
  expect(screen.getByText("Heuristic score, not a legal finding.")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Methodology" }).getAttribute("href")).toBe("/methodology");
  expect(screen.getByText(report.risk.verdict)).toBeTruthy();
  expect(screen.getByText("gateway missing")).toBeTruthy();
  expect(document.querySelectorAll(".evidence")).toHaveLength(8);
  expect(screen.getByText(PDF_DISABLED_REASON)).toBeTruthy();
  expect((screen.getByRole("button", { name: /Export PDF/ }) as HTMLButtonElement).disabled).toBe(true);
});

it("copies with the clipboard and a textarea fallback", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  await copyText("pk_live");
  expect(writeText).toHaveBeenCalledWith("pk_live");

  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText: vi.fn().mockRejectedValue(new Error("denied")) },
  });
  const exec = vi.fn().mockReturnValue(true);
  Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
  await copyText("fallback-value");
  expect(exec).toHaveBeenCalledWith("copy");

  render(
    <ForensicPanel
      score={0}
      riskText="—"
      riskColor="#74869b"
      coverage="0/8"
      verdict=""
      validation="waiting"
      chips={[]}
      evidence={[{ label: "Merchant ID", value: "pk_live", severity: "high" }]}
      scanning={false}
      showSimulateError={false}
      canExportJson={false}
      canExportPdf={false}
      pdfDisabledReason={PDF_DISABLED_REASON}
      animateMs={0}
      onSimulateError={() => undefined}
      onExportJson={() => undefined}
      onExportPdf={() => undefined}
    />,
  );
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockResolvedValue(undefined) } });
  fireEvent.click(screen.getByRole("button", { name: "Copy Merchant ID" }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", "Copied");
});

it("draws the graph, contact legend, table, and keyboard selection", () => {
  const onSelectTarget = vi.fn();
  render(<GraphPanel graph={labGraph} riskColor="#fb5262" onSelectTarget={onSelectTarget} />);
  expect(screen.getByText("Contact")).toBeTruthy();
  const domain = screen.getByRole("button", { name: "Scam Domain lab-a.example" });
  expect(domain.getAttribute("tabindex")).toBe("0");
  const merchant = screen.getByRole("button", { name: /Merchant ID LAB_PK_LIVE_ALPHA/ });
  const before = merchant.getAttribute("transform");
  fireEvent.keyDown(domain, { key: "Enter" });
  expect(onSelectTarget).toHaveBeenCalledWith("tgt_lab_a");
  expect(merchant.getAttribute("transform")).toBe(before);
  expect(document.querySelectorAll(".node.neighbor").length).toBeGreaterThan(0);
  fireEvent.click(screen.getByRole("button", { name: /CLUSTER A - 4 targets 92%/ }));
  expect(screen.getByRole("dialog").textContent).toContain("HIGH cluster");
  fireEvent.click(screen.getByRole("button", { name: "Close" }));
  fireEvent.click(screen.getByRole("button", { name: "Table view" }));
  expect(screen.getByRole("table")).toBeTruthy();
  expect(screen.getByRole("table").textContent).toContain("lab-a.example");
  expect(screen.getByRole("table").textContent).toContain("lab-d.example");
});

it("omits invented ASN and confidence annotations", () => {
  render(<MetricsRow graph={labGraph} />);
  expect(screen.getByText("OBSERVED DOMAINS")).toBeTruthy();
  expect(screen.getByText("SHARED MERCHANTS")).toBeTruthy();
  expect(screen.getByText("HOST CLUSTERS")).toBeTruthy();
  expect(screen.getByText("RELATIONSHIPS")).toBeTruthy();
  expect(screen.queryByText(/ASN 9009/)).toBeNull();
  expect(screen.queryByText(/96% confidence/)).toBeNull();
  expect(screen.queryByText(/% confidence/)).toBeNull();
});
