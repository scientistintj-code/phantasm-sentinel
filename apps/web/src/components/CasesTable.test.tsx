import { cleanup, render, screen } from "@testing-library/react";
import { ApiError, type CaseRecord, type Graph, type TargetReport } from "@phantasm/core";
import { afterEach, expect, test, vi } from "vitest";

import { CasesTable } from "./CasesTable";
import type { CaseListClient } from "@/lib/cases";

const record: CaseRecord = {
  id: "case-1",
  number: "PS-2026-0001",
  title: "Lab storefront",
  status: "running",
  created_at: "2026-10-24T12:00:00.000Z",
};

const graph: Graph = {
  version: 1,
  nodes: [{ id: "n1", type: "domain", label: "a.example", target_id: "tgt-a" }],
  edges: [],
  clusters: [],
  insight: "",
};

function client(list: () => Promise<CaseRecord[]>): CaseListClient {
  return {
    listCases: vi.fn(list),
    getGraph: vi.fn(async () => graph),
    getReport: vi.fn(
      async () =>
        ({
          target_id: "tgt-a",
          risk: { score: 70, label: "HIGH", evidence_coverage: "3/8", verdict: "lead" },
        }) as TargetReport,
    ),
  };
}

afterEach(() => {
  cleanup();
});

test("shows a loading state", () => {
  const api = client(() => new Promise<CaseRecord[]>(() => undefined));
  render(<CasesTable client={api} />);
  expect(screen.getByRole("status").textContent).toBe("Loading cases.");
});

test("links an empty list to the console", async () => {
  render(<CasesTable client={client(async () => [])} />);
  const action = await screen.findByRole("link", { name: "Open in console" });
  expect(action.getAttribute("href")).toBe("/console/");
  expect(screen.getByText("No cases.")).toBeTruthy();
  expect(screen.queryByRole("status")).toBeNull();
});

test("shows an API failure", async () => {
  const api = client(async () => {
    throw new ApiError({
      type: "about:blank",
      title: "Unavailable",
      status: 503,
      detail: "Case list unavailable",
    });
  });
  render(<CasesTable client={api} />);
  expect((await screen.findByRole("alert")).textContent).toBe("Case list unavailable");
  expect(screen.queryByRole("link", { name: "Open in console" })).toBeNull();
});

test("renders the case columns with a live badge", async () => {
  render(<CasesTable client={client(async () => [record])} />);
  expect(await screen.findByRole("link", { name: "PS-2026-0001" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "PS-2026-0001" }).getAttribute("href")).toBe(
    "/cases/case-1",
  );
  expect(screen.getByText("Lab storefront")).toBeTruthy();
  expect(screen.getByText("running")).toBeTruthy();
  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("HIGH")).toBeTruthy();
  expect(screen.getByText("LIVE")).toBeTruthy();
  expect(screen.getByText("2026-10-24T12:00:00.000Z")).toBeTruthy();
});

test("marks replay rows", async () => {
  render(<CasesTable replay client={client(async () => [record])} />);
  expect(await screen.findByText("REPLAY")).toBeTruthy();
  expect(screen.getByRole("link", { name: "PS-2026-0001" }).getAttribute("href")).toBe(
    "/cases/case-1?replay=1",
  );
});
