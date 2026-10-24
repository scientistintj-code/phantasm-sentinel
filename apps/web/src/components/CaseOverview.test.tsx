import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError, type CaseRecord, type Graph, type TargetReport, type VerifyResult } from "@phantasm/core";
import { afterEach, expect, test, vi } from "vitest";

import type { DossierClient } from "@/lib/dossier";

import { CaseOverview } from "./CaseOverview";

const HASH = "a".repeat(64);

const record: CaseRecord = {
  id: "case 1",
  number: "PS-2026-0001",
  title: "Lab",
  status: "completed",
  created_at: "2026-10-24T12:00:00.000Z",
};

const graph: Graph = {
  version: 2,
  nodes: [{ id: "n1", type: "domain", label: "a.example", target_id: "tgt-a" }],
  edges: [],
  clusters: [
    {
      id: "cl-1",
      members: ["tgt-a"],
      confidence: 0.5,
      explanation: "Shared gateway",
    },
  ],
  insight: "One host.",
};

const verify: VerifyResult = {
  ok: true,
  entries_checked: 0,
  head_hash: HASH,
  signature_ok: true,
};

function client(): DossierClient {
  return {
    getCase: vi.fn(async () => record),
    getGraph: vi.fn(async () => graph),
    getReport: vi.fn(
      async () =>
        ({
          target_id: "tgt-a",
          host: "a.example",
          risk: { score: 55, label: "MEDIUM", evidence_coverage: "4/8", verdict: "lead" },
          evidence: [],
        }) as unknown as TargetReport,
    ),
    getLedger: vi.fn(async () => ({ entries: [], next_cursor: null })),
    verifyLedger: vi.fn(async () => verify),
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

test("shows a loading state", () => {
  const api = client();
  api.getCase = vi.fn(() => new Promise<CaseRecord>(() => undefined));
  render(<CaseOverview caseId="case 1" client={api} />);
  expect(screen.getByRole("status").textContent).toBe("Loading case.");
  expect(document.title).toBe("Case · Phantasm Sentinel");
});

test("shows tiles, the cluster explanation, and the case actions", async () => {
  const blobs: Blob[] = [];
  vi.spyOn(URL, "createObjectURL").mockImplementation((value: Blob | MediaSource) => {
    blobs.push(value as Blob);
    return "blob:case";
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
  const api = client();
  render(<CaseOverview caseId="case 1" replay client={api} />);

  expect(await screen.findByText("Shared gateway")).toBeTruthy();
  await waitFor(() => expect(document.title).toBe("PS-2026-0001 · Phantasm Sentinel"));
  expect(screen.getByRole("region", { name: "Targets" }).textContent).toContain("1");
  expect(screen.getByRole("region", { name: "Clusters" }).textContent).toContain("1");
  expect(screen.getByRole("region", { name: "Highest risk" }).textContent).toContain("MEDIUM");
  expect(screen.getByText("REPLAY")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Open in console" }).getAttribute("href")).toBe(
    "/console/?case=case%201",
  );
  expect(screen.getByRole("link", { name: "Ledger" }).getAttribute("href")).toBe(
    "/cases/case%201/ledger?replay=1",
  );
  expect(screen.getByRole("link", { name: "Dossier" }).getAttribute("href")).toBe(
    "/cases/case%201/dossier?replay=1",
  );

  fireEvent.click(screen.getByRole("button", { name: "Export JSON" }));
  await waitFor(() => expect(blobs.length).toBe(1));
  const body = blobs[0];
  expect(await body?.text()).toContain('"schema": "phantasm.case.v1"');
});

test("shows an empty case without clusters", async () => {
  const api = client();
  api.getGraph = vi.fn(async () => ({ ...graph, nodes: [], clusters: [] }));
  render(<CaseOverview caseId="case 1" client={api} />);
  expect(await screen.findByText("No targets.")).toBeTruthy();
  expect(screen.getByText("No clusters.")).toBeTruthy();
  expect(screen.getByRole("region", { name: "Highest risk" }).textContent).toContain("none");
  expect(screen.getByText("LIVE")).toBeTruthy();
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
  render(<CaseOverview caseId="missing" client={api} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Case not found");
  expect(screen.getByRole("button", { name: "Export JSON" }).hasAttribute("disabled")).toBe(true);
  expect(screen.getByRole("link", { name: "Open in console" }).getAttribute("href")).toBe(
    "/console/?case=missing",
  );
});
