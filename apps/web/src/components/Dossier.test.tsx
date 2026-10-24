import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, type LedgerEntry, type TargetReport, type VerifyResult } from "@phantasm/core";
import { afterEach, expect, test, vi } from "vitest";

import { clearDossierPrints, methodologyFromSource, type DossierClient } from "@/lib/dossier";

import { Dossier } from "./Dossier";

const HASH = "d".repeat(64);
const METHODOLOGY = methodologyFromSource(null);

const FIELDS = [
  ["merchant_id", "Merchant ID"],
  ["gateway", "Gateway"],
  ["payment_endpoint", "Payment Endpoint"],
  ["host_ip", "Host IP"],
  ["domain_age", "Domain Age"],
  ["ssl_issuer", "SSL Issuer"],
  ["suspicious_scripts", "Suspicious Scripts"],
  ["redirect_chain", "Redirect Chain"],
] as const;

const SEVERITY = ["safe", "medium", "high"] as const;

function report(): TargetReport {
  return {
    target_id: "tgt-a",
    host: "shop.example",
    risk: {
      score: 42,
      label: "MEDIUM",
      evidence_coverage: "6/8",
      verdict: "Young domain with a shared gateway.",
    },
    evidence: FIELDS.map(([field, label], index) => ({
      field,
      label,
      value: `${field}-value`,
      severity: SEVERITY[index % 3] ?? "safe",
      source: "agent",
    })) as TargetReport["evidence"],
  };
}

const verify: VerifyResult = {
  ok: false,
  entries_checked: 4,
  first_broken_seq: 3,
  reason: "hash mismatch",
  head_hash: HASH,
  signature_ok: false,
};

const queued: LedgerEntry = {
  seq: 1,
  ts: "2026-10-24T12:00:00.000Z",
  event_type: "TargetQueued",
  payload: {
    case_id: "case-1",
    seq: 1,
    ts: "2026-10-24T12:00:00.000Z",
    type: "TargetQueued",
    target_id: "tgt-a",
    url: "https://shop.example",
    host: "shop.example",
  },
  prev_hash: HASH,
  entry_hash: HASH,
};

function client(): DossierClient {
  return {
    getCase: vi.fn().mockResolvedValue({
      id: "case-1",
      number: "PS-2026-0004",
      title: "Replay lab",
      status: "completed",
      created_at: "2026-10-24T12:00:00.000Z",
    }),
    getGraph: vi.fn().mockResolvedValue({
      version: 4,
      nodes: [{ id: "n1", type: "domain", label: "shop.example", target_id: "tgt-a" }],
      edges: [],
      clusters: [
        {
          id: "cl-9",
          members: ["tgt-a"],
          confidence: 0.91,
          explanation: "Single storefront cluster.",
        },
      ],
      insight: "One cluster.",
    }),
    getLedger: vi.fn().mockResolvedValue({ entries: [queued], next_cursor: null }),
    getReport: vi.fn().mockResolvedValue(report()),
    verifyLedger: vi.fn().mockResolvedValue(verify),
  };
}

afterEach(() => {
  cleanup();
  clearDossierPrints();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

test("renders reports, clusters, ledger head, replay disclosure, and downloads the bundle", async () => {
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    blobs.push(value as Blob);
    return "blob:dossier";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const print = vi.fn();
  window.print = print;
  Object.defineProperty(document, "fonts", {
    configurable: true,
    value: { ready: Promise.resolve() },
  });

  const api = client();
  render(
    <Dossier caseId="case-1" replay autoPrint methodology={METHODOLOGY} client={api} />,
  );

  expect(await screen.findByText("PS-2026-0004")).toBeTruthy();
  expect(screen.getByText("Replayed from recording")).toBeTruthy();
  expect(screen.getByText("Merchant ID")).toBeTruthy();
  expect(screen.getByText("Redirect Chain")).toBeTruthy();
  expect(screen.getAllByRole("row")).toHaveLength(9);
  expect(screen.getByText("merchant_id-value")).toBeTruthy();
  expect(screen.getAllByText("safe").length).toBe(3);
  expect(screen.getAllByText("medium").length).toBe(3);
  expect(screen.getAllByText("high").length).toBe(2);
  expect(screen.getByText("Single storefront cluster.")).toBeTruthy();
  expect(screen.getByText(HASH)).toBeTruthy();
  expect(screen.getByText(/Verification status: failed/)).toBeTruthy();
  expect(screen.getByText(/HMAC invalid/)).toBeTruthy();
  expect(screen.getByText(/Findings are leads requiring verification/)).toBeTruthy();
  expect(screen.getByText(/safe 0, medium 8, high 16/)).toBeTruthy();

  await waitFor(() => expect(print).toHaveBeenCalledTimes(1));

  fireEvent.click(screen.getByRole("button", { name: "Download JSON bundle" }));
  const body = blobs[0];
  expect(body).toBeTruthy();
  const text = await body?.text();
  expect(text).toContain('"schema": "phantasm.case.v1"');
  expect(text).toContain("Young domain with a shared gateway.");
  expect(api.getReport).toHaveBeenCalledWith("case-1", "tgt-a");
});

test("does not print or disclose replay unless asked", async () => {
  const print = vi.fn();
  window.print = print;
  render(<Dossier caseId="case-1" methodology={METHODOLOGY} client={client()} />);
  expect(await screen.findByText("shop.example")).toBeTruthy();
  expect(screen.queryByText("Replayed from recording")).toBeNull();
  expect(print).not.toHaveBeenCalled();
});

test("shows an API failure", async () => {
  const api = client();
  api.getCase = vi.fn().mockRejectedValue(
    new ApiError({
      type: "about:blank",
      title: "Not Found",
      status: 404,
      detail: "Case not found",
    }),
  );
  render(<Dossier caseId="missing" methodology={METHODOLOGY} client={api} />);
  expect((await screen.findByRole("alert")).textContent).toContain("Case not found");
  expect(screen.getByRole("button", { name: "Download JSON bundle" }).hasAttribute("disabled")).toBe(
    true,
  );
});
