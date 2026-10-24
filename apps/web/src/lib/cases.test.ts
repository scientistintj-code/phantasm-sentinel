import { ApiError, type CaseRecord, type Graph, type TargetReport } from "@phantasm/core";
import { expect, test } from "vitest";

import {
  casePath,
  caseRunBadge,
  consolePath,
  highestRiskLabel,
  loadCaseOverview,
  loadCaseRows,
  type CaseListClient,
  type CaseOverviewClient,
} from "./cases";

const record: CaseRecord = {
  id: "case 1",
  number: "PS-2026-0001",
  title: "Lab",
  status: "completed",
  created_at: "2026-10-24T12:00:00.000Z",
};

const graph: Graph = {
  version: 1,
  nodes: [{ id: "n1", type: "domain", label: "a.example", target_id: "tgt-a" }],
  edges: [],
  clusters: [
    {
      id: "cl-1",
      members: ["tgt-a", "tgt-b"],
      confidence: 0.5,
      explanation: "Shared gateway",
    },
  ],
  insight: "Two hosts.",
};

function report(targetId: string, score: number, label: "LOW" | "MEDIUM" | "HIGH"): TargetReport {
  return {
    target_id: targetId,
    risk: { score, label, evidence_coverage: "1/8", verdict: "lead" },
  } as TargetReport;
}

test("ranks the highest score and breaks ties by label", () => {
  expect(
    highestRiskLabel([
      { score: 10, label: "LOW" },
      { score: 40, label: "MEDIUM" },
      { score: 40, label: "HIGH" },
    ]),
  ).toBe("HIGH");
  expect(highestRiskLabel([])).toBeNull();
  expect(caseRunBadge(false)).toBe("LIVE");
  expect(caseRunBadge(true)).toBe("REPLAY");
  expect(casePath("case 1", true, "ledger")).toBe("/cases/case%201/ledger?replay=1");
  expect(consolePath("case 1")).toBe("/console/?case=case%201");
});

test("counts graph targets and keeps the higher risk label", async () => {
  const client: CaseListClient = {
    listCases: async () => [record],
    getGraph: async () => graph,
    getReport: async (_caseId, targetId) =>
      targetId === "tgt-b" ? report("tgt-b", 90, "HIGH") : report("tgt-a", 12, "LOW"),
  };
  const rows = await loadCaseRows(client, false);
  expect(rows).toEqual([
    {
      id: "case 1",
      number: "PS-2026-0001",
      title: "Lab",
      status: "completed",
      targets: 2,
      riskLabel: "HIGH",
      run: "LIVE",
      createdAt: "2026-10-24T12:00:00.000Z",
    },
  ]);
});

test("lists a case when the graph is missing", async () => {
  const missing = new ApiError({
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "Graph not found",
  });
  const client: CaseListClient = {
    listCases: async () => [record],
    getGraph: async () => {
      throw missing;
    },
    getReport: async () => report("tgt-a", 1, "LOW"),
  };
  const rows = await loadCaseRows(client, true);
  expect(rows[0]?.targets).toBe(0);
  expect(rows[0]?.riskLabel).toBeNull();
  expect(rows[0]?.run).toBe("REPLAY");
});

test("loads overview tiles and treats a missing report as no score", async () => {
  const client: CaseOverviewClient = {
    getCase: async () => record,
    getGraph: async () => graph,
    getReport: async () => {
      throw new ApiError({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Report not found",
      });
    },
  };
  const model = await loadCaseOverview(client, record.id);
  expect(model.targetCount).toBe(2);
  expect(model.riskLabel).toBeNull();
  expect(model.clusters[0]?.explanation).toBe("Shared gateway");
});

test("surfaces a case lookup failure", async () => {
  const client: CaseOverviewClient = {
    getCase: async () => {
      throw new ApiError({
        type: "about:blank",
        title: "Not Found",
        status: 404,
        detail: "Case not found",
      });
    },
    getGraph: async () => graph,
    getReport: async () => report("tgt-a", 1, "LOW"),
  };
  await expect(loadCaseOverview(client, "missing")).rejects.toMatchObject({ detail: "Case not found" });
});
