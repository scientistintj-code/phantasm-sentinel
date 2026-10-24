import { MODULES, PHASES } from "@phantasm/core";
import { expect, test } from "vitest";

import { ACTIVE_STEPS, methodologyBlocks, PASSIVE_STEPS } from "./methodology";

test("classifies every phase and module once", () => {
  const all = [...PASSIVE_STEPS, ...ACTIVE_STEPS];
  expect(new Set(all).size).toBe(all.length);
  expect(all).toHaveLength(PHASES.length + MODULES.length);
  for (const phase of PHASES) expect(all).toContain(phase);
  for (const moduleName of MODULES) expect(all).toContain(moduleName);
  expect(PASSIVE_STEPS).toContain("search");
  expect(PASSIVE_STEPS).toContain("fetch");
  expect(PASSIVE_STEPS).toContain("validate_payload");
  expect(PASSIVE_STEPS).toContain("build_graph");
  expect(ACTIVE_STEPS).toContain("agent");
  expect(ACTIVE_STEPS).toContain("navigate_checkout");
});

test("quotes the supplied weights and the ledger limit", () => {
  const blocks = methodologyBlocks("safe 0, medium 8, high 16.");
  const flat = blocks
    .flatMap((block) => [block.heading, ...block.paragraphs, ...block.items, block.quote ?? ""])
    .join("\n");
  expect(flat).toContain("safe 0, medium 8, high 16.");
  expect(flat).toContain("Stop before any payment");
  expect(flat).toContain("Synthetic identity");
  expect(flat).toContain("X-Phantasm-Lab: synthetic");
  expect(flat).toContain("tamper-evident");
  expect(flat).toContain("not court-ready");
  expect(flat).toContain("Findings are leads requiring verification.");
  expect(flat).toContain("Passive.");
  expect(flat).toContain("Active.");
  expect(flat).toContain("init_browser (Initialize Cloud Browser)");
  expect(flat).toContain("TinyVault. Injects test credentials securely.");
});
