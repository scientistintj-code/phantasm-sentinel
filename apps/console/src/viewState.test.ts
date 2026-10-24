import { expect, it } from "vitest";
import { createInvestigationStore, parseSentinelEvent, type SentinelEvent } from "@phantasm/core";
import { stepperView } from "./mission";
import { attachCase, caseFileHref, caseIdFromSearch, keyPoolBanner, targetTabs, visiblePivots } from "./viewState";

const CASE_ID = "c0ffee00-0000-4000-8000-000000000001";
const T0 = "2026-10-24T12:00:00.000Z";

function event(seq: number, body: Record<string, unknown>): SentinelEvent {
  return parseSentinelEvent({ case_id: CASE_ID, seq, ts: T0, ...body });
}

it("maps the stepper to the earliest running phase", () => {
  const store = createInvestigationStore();
  const events = [
    event(1, { type: "CaseCreated", title: "Lab" }),
    event(2, { type: "TargetQueued", target_id: "tgt_lab_a", url: "https://lab-a.example", host: "lab-a.example" }),
    event(3, { type: "TargetQueued", target_id: "tgt_lab_b", url: "https://lab-b.example", host: "lab-b.example" }),
    event(4, { type: "PhaseChanged", target_id: "tgt_lab_a", phase: "navigate_checkout" }),
    event(5, { type: "PhaseChanged", target_id: "tgt_lab_b", phase: "load_site" }),
  ];
  for (const item of events) store.getState().apply(item);
  expect(stepperView(store.getState(), "tgt_lab_a")).toEqual({ phaseIndex: 3, complete: false });
  expect(stepperView(store.getState(), "all")).toEqual({ phaseIndex: 1, complete: false });
});

it("names the earliest key recovery when every key is exhausted or cooling", () => {
  expect(keyPoolBanner([{ state: "healthy" }, { state: "cooling" }])).toBeNull();
  expect(keyPoolBanner([{ state: "exhausted" }, { state: "invalid" }])).toBeNull();
  expect(keyPoolBanner([{ state: "exhausted" }, { state: "cooling" }])).toBe("All keys exhausted or cooling");
  expect(
    keyPoolBanner([
      { state: "cooling", recoversAt: "2026-10-24T12:00:40.000Z" },
      { state: "exhausted", recoversAt: "2026-10-24T12:00:10.000Z" },
    ]),
  ).toBe("All keys exhausted or cooling. Earliest recovery 2026-10-24T12:00:10.000Z");
});

it("marks a safety halt with a red dot and a failed target with its message", () => {
  const store = createInvestigationStore();
  for (const item of [
    event(1, { type: "CaseCreated", title: "Lab" }),
    event(2, { type: "TargetQueued", target_id: "tgt_lab_a", url: "https://lab-a.example", host: "lab-a.example" }),
    event(3, { type: "TargetQueued", target_id: "tgt_lab_b", url: "https://lab-b.example", host: "lab-b.example" }),
    event(4, { type: "SafetyHalt", target_id: "tgt_lab_a", reason: "payment wall" }),
    event(5, { type: "TargetFailed", target_id: "tgt_lab_b", error_code: "SITE_BLOCKED", message: "site blocked" }),
    event(6, {
      type: "PivotSuggested",
      target_id: "tgt_lab_a",
      pivot_id: "piv_1",
      query: "site:lab-a.example merchant",
      indicator: { kind: "domain", value: "lab-a.example", confidence: 1, source: "agent" },
    }),
  ]) {
    store.getState().apply(item);
  }
  const tabs = targetTabs(store.getState());
  expect(tabs.find((tab) => tab.id === "tgt_lab_a")).toMatchObject({ dot: "failed", halted: true, failureMessage: null });
  expect(tabs.find((tab) => tab.id === "tgt_lab_b")).toMatchObject({ status: "failed", failureMessage: "site blocked" });
  expect(visiblePivots(store.getState(), "tgt_lab_a", new Set()).map((pivot) => pivot.query)).toEqual([
    "site:lab-a.example merchant",
  ]);
  expect(visiblePivots(store.getState(), "tgt_lab_a", new Set(["piv_1"]))).toEqual([]);
});

it("reads a case deep link and resumes the stream from the last seq", () => {
  expect(caseIdFromSearch("?case=case-1")).toBe("case-1");
  expect(caseIdFromSearch("?case=")).toBeNull();
  expect(caseFileHref("case 1")).toBe("/cases/case%201");
  const store = createInvestigationStore();
  store.getState().apply(event(4, { type: "CaseCreated", title: "Lab" }));
  let lastSeq: number | undefined;
  const session = attachCase({
    client: { eventsUrl: (id) => `/api/sentinel/v1/cases/${id}/events` },
    store,
    caseId: "case-1",
    connect: (options) => {
      lastSeq = options.lastSeq;
      expect(options.url).toBe("/api/sentinel/v1/cases/case-1/events");
      return () => undefined;
    },
  });
  expect(lastSeq).toBe(4);
  session.stopStream();
});
