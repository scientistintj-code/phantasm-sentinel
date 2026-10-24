import { expect, it } from "vitest";
import type { TargetState } from "@phantasm/core";
import { buildExportBundle, dossierUrl, evidenceRows, validationView } from "./forensics";

const checks = [
  { field: "merchant_id", passed: true },
  { field: "gateway", passed: false, reason: "gateway missing" },
  { field: "payment_endpoint", passed: true },
  { field: "host_ip", passed: true },
  { field: "domain_age", passed: true },
  { field: "ssl_issuer", passed: true },
  { field: "suspicious_scripts", passed: true },
  { field: "redirect_chain", passed: true },
] as const;

function target(phase: TargetState["phase"], validation: TargetState["validation"]): Pick<TargetState, "phase" | "validation"> {
  return { phase, validation };
}

it("maps dossier urls and export bundle fields", () => {
  expect(dossierUrl("live", "case 1")).toBe("/cases/case%201/dossier?print=1");
  expect(dossierUrl("replay", "case 1")).toBe("/replay/cases/case%201/dossier?print=1");
  const bundle = buildExportBundle({
    mode: "replay",
    case: null,
    target: null,
    report: null,
    graph: null,
    ledgerHead: null,
  });
  expect(Object.keys(bundle)).toEqual([
    "mode",
    "case",
    "target",
    "report",
    "validation",
    "indicators",
    "graph",
    "ledger_head",
  ]);
  expect(bundle.ledger_head).toBeNull();
  expect(bundle.indicators).toEqual([]);
});

it("drives validation from the payload checks", () => {
  expect(validationView(null, false).state).toBe("waiting");
  expect(validationView(target("validate_payload", null), false).state).toBe("validating");
  expect(validationView(target("validate_payload", null), false).chips.every((chip) => chip.status === "checking")).toBe(true);
  const failed = validationView(target("build_graph", { schemaVersion: "2.4", checks: [...checks] }), false);
  expect(failed.state).toBe("invalid");
  expect(failed.chips.find((chip) => chip.label === "Gateway")).toMatchObject({
    status: "failed",
    reason: "gateway missing",
  });
  expect(failed.chips.find((chip) => chip.label === "Merchant ID")?.status).toBe("passed");
  const forced = validationView(target("build_graph", { schemaVersion: "2.4", checks: checks.map((check) => ({ ...check, passed: true, reason: undefined })) }), true);
  expect(forced.state).toBe("invalid");
  expect(forced.chips.every((chip) => chip.status === "passed")).toBe(true);
});

it("keeps eight evidence rows", () => {
  expect(evidenceRows(null)).toHaveLength(8);
  expect(evidenceRows(null).every((row) => row.severity === "empty")).toBe(true);
});
