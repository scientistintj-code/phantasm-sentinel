import { expect, test } from "vitest";
import type { CaseRecord, Graph, LedgerEntry, TargetReport, VerifyResult } from "@phantasm/core";

import {
  caseBundle,
  CASE_BUNDLE_SCHEMA,
  dossierDocument,
  extractHeuristicBlocks,
  isPrintQuery,
  methodologyFromSource,
  targetIds,
} from "./dossier";

const HASH = "a".repeat(64);

const graph: Graph = {
  version: 2,
  nodes: [{ id: "n1", type: "domain", label: "a.example", target_id: "tgt-b" }],
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

function entry(targetId: string): LedgerEntry {
  return {
    seq: 1,
    ts: "2026-10-24T12:00:00.000Z",
    event_type: "TargetQueued",
    payload: {
      case_id: "case-1",
      seq: 1,
      ts: "2026-10-24T12:00:00.000Z",
      type: "TargetQueued",
      target_id: targetId,
      url: "https://c.example",
      host: "c.example",
    },
    prev_hash: HASH,
    entry_hash: HASH,
  };
}

const record: CaseRecord = {
  id: "case-1",
  number: "PS-2026-0001",
  title: "Lab",
  status: "completed",
  created_at: "2026-10-24T12:00:00.000Z",
};

const verify: VerifyResult = {
  ok: true,
  entries_checked: 1,
  head_hash: HASH,
  signature_ok: true,
};

test("collects target ids from the graph and the ledger", () => {
  expect(targetIds(graph, [entry("tgt-c")])).toEqual(["tgt-a", "tgt-b", "tgt-c"]);
  expect(isPrintQuery("1")).toBe(true);
  expect(isPrintQuery("true")).toBe(false);
});

test("quotes risk.py weight blocks and falls back when the module is missing", () => {
  const source = [
    "SEVERITY_WEIGHTS = {",
    '    "safe": 0,',
    '    "medium": 8,',
    '    "high": 16,',
    "}",
    "",
  ].join("\n");
  expect(extractHeuristicBlocks(source)).toContain('"high": 16');
  const quoted = methodologyFromSource(source);
  expect(quoted).toContain("sentinel/graph/risk.py");
  expect(quoted).toContain('"medium": 8');
  expect(quoted).toContain("Findings are leads requiring verification.");
  const fallback = methodologyFromSource(null);
  expect(fallback).toContain("safe 0, medium 8, high 16.");
  expect(fallback).toContain("Findings are leads requiring verification.");
});

test("builds a versioned case bundle", () => {
  const reports: TargetReport[] = [];
  const bundle = caseBundle(record, graph, reports, verify, true);
  expect(bundle.schema).toBe(CASE_BUNDLE_SCHEMA);
  expect(bundle.replayed_from_recording).toBe(true);
  expect(bundle.ledger.head_hash).toBe(HASH);
  expect(bundle.graph.clusters[0]?.explanation).toBe("Shared gateway");
  expect(dossierDocument(bundle)).toContain('"schema": "phantasm.case.v1"');
});
