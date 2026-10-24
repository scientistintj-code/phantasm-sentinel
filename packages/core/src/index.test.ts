import { afterEach, expect, it, vi } from "vitest";
import graphFixture from "../fixtures/lab-graph.json";
import labCase from "../fixtures/lab-case.ndjson?raw";
import reports from "../fixtures/lab-reports.json";
import keys from "../fixtures/keys-health.json";
import { ApiError, createApiClient } from "./api";
import { ReplayDriver, parseReplayNdjson, type ReplayTimerApi } from "./replay";
import {
  graphSchema,
  keyHealthListSchema,
  parseSentinelEvent,
  parseSentinelEventJson,
  sentinelEventSchema,
  targetReportSchema,
  type SentinelEvent,
  type TargetReport,
} from "./schemas";
import { evidenceCoverage, logLines, moduleViews, riskView, stepperIndex } from "./selectors";
import { connectEventStream, type EventSourceLike, type EventStreamState } from "./sse";
import { applyEvent, createInitialState, createInvestigationStore } from "./store";

const CASE_ID = "c0ffee00-0000-4000-8000-000000000001";
const T0 = "2026-10-24T12:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

function event(seq: number, body: Record<string, unknown>, ts = T0): SentinelEvent {
  return parseSentinelEvent({ case_id: CASE_ID, seq, ts, ...body });
}

const report = targetReportSchema.parse(reports[0]);

const checks = [
  { field: "merchant_id", passed: true },
  { field: "gateway", passed: true },
  { field: "payment_endpoint", passed: true },
  { field: "host_ip", passed: true },
  { field: "domain_age", passed: false, reason: "Domain age 9 days is under 30 days" },
  { field: "ssl_issuer", passed: true },
  { field: "suspicious_scripts", passed: false, reason: "3 checkout scripts load from an unrelated host" },
  { field: "redirect_chain", passed: true },
] as const;

function everyType(): SentinelEvent[] {
  return [
    event(1, { type: "CaseCreated", title: "Lab storefront cluster" }),
    event(2, { type: "TargetQueued", target_id: "tgt_lab_a", url: "https://lab-a.example", host: "lab-a.example" }),
    event(3, { type: "PhaseChanged", target_id: "tgt_lab_a", phase: "init_browser" }),
    event(4, { type: "ModuleStatus", target_id: "tgt_lab_a", module: "search", state: "started" }),
    event(5, { type: "ModuleStatus", target_id: "tgt_lab_a", module: "search", state: "completed", duration_ms: 500, summary: "done" }),
    event(6, { type: "ReconFinding", target_id: "tgt_lab_a", source: "search", summary: "sibling hosts" }),
    event(7, { type: "ProbeStarted", target_id: "tgt_lab_a", run_id: "run_lab_a", key_label: "key-1" }),
    event(8, { type: "StreamingUrl", target_id: "tgt_lab_a", url: "https://stream.invalid/run_lab_a" }),
    event(9, { type: "AgentStep", target_id: "tgt_lab_a", index: 1, purpose: "Dismiss popup" }),
    event(10, { type: "IndicatorExtracted", target_id: "tgt_lab_a", indicator: { kind: "email", value: "a@lab.example", confidence: 0.8, source: "agent" } }),
    event(11, {
      type: "PayloadValidated",
      target_id: "tgt_lab_a",
      schema_version: "2.4",
      checks,
      report,
    }),
    event(12, { type: "GraphUpdated", target_id: "tgt_lab_a", version: 1 }),
    event(13, {
      type: "PivotSuggested",
      target_id: "tgt_lab_a",
      pivot_id: "piv_1",
      indicator: { kind: "email", value: "a@lab.example", confidence: 0.8, source: "agent" },
      query: "a@lab.example",
    }),
    event(14, { type: "SafetyHalt", target_id: "tgt_lab_a", reason: "payment wall" }),
    event(15, { type: "ProbeCompleted", target_id: "tgt_lab_a", status: "COMPLETED", reached_checkout: true, stopped_reason: "checkout_captured" }),
    event(16, { type: "TargetFailed", target_id: "tgt_lab_b", error_code: "AGENT_FAILED", message: "navigation blocked" }),
    event(17, { type: "CaseCompleted", targets: 2, failed: 1, clusters: 1 }),
    event(18, { type: "NotInContract", target_id: "tgt_lab_a", note: "keep going" }),
  ];
}

it("parses every event type through the reducer", () => {
  const events = everyType();
  const types = events.map((item) => item.type);
  expect(types).toEqual([
    "CaseCreated",
    "TargetQueued",
    "PhaseChanged",
    "ModuleStatus",
    "ModuleStatus",
    "ReconFinding",
    "ProbeStarted",
    "StreamingUrl",
    "AgentStep",
    "IndicatorExtracted",
    "PayloadValidated",
    "GraphUpdated",
    "PivotSuggested",
    "SafetyHalt",
    "ProbeCompleted",
    "TargetFailed",
    "CaseCompleted",
    "UnknownEvent",
  ]);
  const state = events.reduce(applyEvent, createInitialState());
  const target = state.targets["tgt_lab_a"];
  expect(target).toBeDefined();
  expect(state.case).toMatchObject({ title: "Lab storefront cluster", status: "completed", targets: 2, failed: 1, clusters: 1 });
  expect(target?.host).toBe("lab-a.example");
  expect(stepperIndex(target!)).toBe(0);
  expect(target?.modules.search).toMatchObject({ state: "completed", durationMs: 500 });
  expect(target?.runId).toBe("run_lab_a");
  expect(target?.keyLabel).toBe("key-1");
  expect(target?.streamingUrl).toBe("https://stream.invalid/run_lab_a");
  expect(target?.steps).toEqual([{ index: 1, purpose: "Dismiss popup" }]);
  expect(target?.indicators).toHaveLength(1);
  expect(target?.report?.target_id).toBe("tgt_lab_a");
  expect(target?.validation?.schemaVersion).toBe("2.4");
  expect(state.graphVersion).toBe(1);
  expect(state.pivots.map((pivot) => pivot.pivotId)).toEqual(["piv_1"]);
  expect(state.safetyHalts.map((halt) => halt.reason)).toEqual(["payment wall"]);
  expect(state.targets["tgt_lab_b"]?.status).toBe("failed");
  expect(state.unknownCount).toBe(1);
  expect(state.log.at(-1)?.type).toBe("UnknownEvent");
  expect(moduleViews(state).find((view) => view.targetId === "tgt_lab_a" && view.module === "vault")?.status).toBe("idle");
  expect(evidenceCoverage(state)[0]).toMatchObject({ targetId: "tgt_lab_a", passed: 6, label: "6/8" });
  expect(riskView(state)[0]?.text).toBe("HIGH RISK");
  const lines = logLines(state);
  expect(lines[0]).toMatchObject({ time: "00:00", tag: "START", message: "Lab storefront cluster" });
  expect(lines.find((line) => line.message === "sibling hosts")).toMatchObject({ tag: "TRACE", module: "search" });
  expect(lines.find((line) => line.message === "payment wall")?.tag).toBe("THREAT");
});

it("ignores duplicate seq and applies out-of-order seq", () => {
  const later = event(2, { type: "PhaseChanged", target_id: "tgt_lab_a", phase: "build_graph" }, at(2000));
  const earlier = event(1, { type: "PhaseChanged", target_id: "tgt_lab_a", phase: "init_browser" }, at(1000));
  const once = applyEvent(createInitialState(), later);
  expect(applyEvent(once, later)).toBe(once);
  const both = applyEvent(once, earlier);
  expect(both.log.map((item) => item.seq)).toEqual([2, 1]);
  expect(both.targets["tgt_lab_a"]?.phase).toBe("build_graph");
  expect(stepperIndex(both.targets["tgt_lab_a"]!)).toBe(6);
  const store = createInvestigationStore();
  store.getState().apply(later);
  const log = store.getState().log;
  store.getState().apply(later);
  expect(store.getState().log).toBe(log);
});

it("groups shared indicators across targets", () => {
  const indicator = (seq: number, targetId: string, kind: "email" | "phone", value: string) =>
    event(seq, {
      type: "IndicatorExtracted",
      target_id: targetId,
      indicator: { kind, value, confidence: 0.5, source: "agent" as const },
    });
  let state = createInitialState();
  state = applyEvent(state, indicator(1, "a", "email", "shared@lab.example"));
  state = applyEvent(state, indicator(2, "b", "email", "shared@lab.example"));
  state = applyEvent(state, indicator(3, "b", "phone", "+15550001"));
  state = applyEvent(state, indicator(4, "c", "phone", "+15550001"));
  state = applyEvent(state, indicator(5, "d", "email", "solo@lab.example"));
  expect(state.sharedIndicators).toHaveLength(1);
  expect(state.sharedIndicators[0]?.targetIds).toEqual(["a", "b", "c"]);
  state = applyEvent(state, indicator(6, "e", "phone", "+15559999"));
  state = applyEvent(state, indicator(7, "f", "phone", "+15559999"));
  expect(state.sharedIndicators).toHaveLength(2);
});

it("caps steps and the log", () => {
  let state = createInitialState();
  for (let seq = 1; seq <= 501; seq += 1) {
    state = applyEvent(state, event(seq, { type: "AgentStep", target_id: "t", index: seq, purpose: `s${seq}` }));
  }
  expect(state.targets.t?.steps).toHaveLength(500);
  expect(state.targets.t?.steps[0]?.index).toBe(2);
  state = createInitialState();
  for (let seq = 1; seq <= 5001; seq += 1) {
    state = applyEvent(state, event(seq, { type: "ReconFinding", target_id: "t", source: "infra", summary: `n${seq}` }));
  }
  expect(state.log).toHaveLength(5000);
  expect(state.log[0]?.seq).toBe(2);
});

it("rejects malformed JSON and invalid known events", () => {
  expect(() => parseSentinelEventJson("{")).toThrow(SyntaxError);
  expect(() => parseSentinelEventJson("null")).toThrow();
  expect(() => sentinelEventSchema.parse({ type: "CaseCreated" })).toThrow();
  expect(() =>
    parseSentinelEvent({
      case_id: CASE_ID,
      seq: 1,
      ts: T0,
      type: "PhaseChanged",
      target_id: "t",
      phase: "sideways",
    }),
  ).toThrow();
  const unknown = parseSentinelEventJson(
    JSON.stringify({ case_id: CASE_ID, seq: 4, ts: T0, type: "Wat", extra: true }),
  );
  expect(unknown.type).toBe("UnknownEvent");
  if (unknown.type === "UnknownEvent") expect(unknown.originalType).toBe("Wat");
  expect(() => parseReplayNdjson("{")).toThrow(SyntaxError);
  expect(graphSchema.parse(graphFixture).version).toBe(5);
  expect(keyHealthListSchema.parse(keys)).toHaveLength(3);
  for (const item of reports) targetReportSchema.parse(item);
});

class FakeEventSource implements EventSourceLike {
  static made: FakeEventSource[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(
    readonly url: string,
    readonly init?: { withCredentials?: boolean; headers?: Record<string, string> },
  ) {
    FakeEventSource.made.push(this);
  }

  close(): void {
    this.closed = true;
  }
}

function createClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const api: ReplayTimerApi & { advance: (ms: number) => void } = {
    now: () => now,
    setTimeout(fn, ms) {
      const id = nextId;
      nextId += 1;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimeout(handle) {
      timers.delete(handle as number);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: { id: number; at: number; fn: () => void } | null = null;
        for (const [id, timer] of timers) {
          if (timer.at <= end && (!next || timer.at < next.at || (timer.at === next.at && id < next.id))) {
            next = { id, at: timer.at, fn: timer.fn };
          }
        }
        if (!next) break;
        timers.delete(next.id);
        now = next.at;
        next.fn();
      }
      now = end;
    },
  };
  return api;
}

it("resumes the event stream from the last applied seq", () => {
  FakeEventSource.made = [];
  const clock = createClock();
  const states: EventStreamState[] = [];
  const seen: SentinelEvent[] = [];
  const stop = connectEventStream({
    url: "/api/sentinel/v1/cases/c/events",
    lastSeq: 12,
    onEvent: (item) => seen.push(item),
    onState: (state) => states.push(state),
    EventSource: FakeEventSource,
    random: () => 0,
    setTimeout: clock.setTimeout,
    clearTimeout: clock.clearTimeout,
  });
  const first = FakeEventSource.made[0];
  expect(states[0]).toBe("connecting");
  expect(first?.init?.withCredentials).toBe(false);
  expect(first?.init?.headers?.["Last-Event-ID"]).toBe("12");
  first?.onopen?.();
  expect(states).toContain("live");
  first?.onmessage?.({ data: "{", lastEventId: "12" });
  expect(seen).toHaveLength(0);
  first?.onmessage?.({
    data: JSON.stringify({
      case_id: CASE_ID,
      seq: 13,
      ts: at(1300),
      type: "PhaseChanged",
      target_id: "tgt_lab_a",
      phase: "load_site",
    }),
    lastEventId: "13",
  });
  expect(seen.map((item) => item.seq)).toEqual([13]);
  first?.onerror?.();
  expect(states.at(-1)).toBe("reconnecting");
  expect(first?.closed).toBe(true);
  clock.advance(0);
  const second = FakeEventSource.made[1];
  expect(FakeEventSource.made).toHaveLength(2);
  expect(second?.init?.headers?.["Last-Event-ID"]).toBe("13");
  stop();
  expect(states.at(-1)).toBe("closed");
  clock.advance(30_000);
  expect(FakeEventSource.made).toHaveLength(2);
});

it("plays, pauses, seeks, and honors replay speed", () => {
  const clock = createClock();
  const store = createInvestigationStore();
  const text = [
    { t_ms: 0, event: { case_id: CASE_ID, seq: 1, ts: T0, type: "CaseCreated", title: "Replay" } },
    {
      t_ms: 1000,
      event: { case_id: CASE_ID, seq: 2, ts: at(1000), type: "TargetQueued", target_id: "t", url: "https://lab.example", host: "lab.example" },
    },
  ]
    .map((line) => JSON.stringify(line))
    .join("\n");
  const driver = new ReplayDriver(text, store, clock);
  const ended = vi.fn();
  driver.onEnd(ended);
  driver.setSpeed(2);
  driver.play();
  expect(store.getState().mode).toBe("replay");
  expect(store.getState().log).toHaveLength(1);
  clock.advance(499);
  expect(store.getState().log).toHaveLength(1);
  clock.advance(1);
  expect(store.getState().targets.t?.host).toBe("lab.example");
  expect(ended).toHaveBeenCalledTimes(1);

  driver.seek(0);
  expect(store.getState().log).toHaveLength(1);
  expect(store.getState().targets.t).toBeUndefined();
  driver.setSpeed(1);
  driver.play();
  clock.advance(400);
  driver.pause();
  clock.advance(2000);
  expect(store.getState().log).toHaveLength(1);
  driver.play();
  clock.advance(600);
  expect(store.getState().log).toHaveLength(2);
});

it("replays the lab case to five completed targets and one shared group", () => {
  const clock = createClock();
  const store = createInvestigationStore();
  const driver = new ReplayDriver(labCase, store, clock);
  driver.setSpeed(8);
  driver.play();
  clock.advance(6000);
  const state = store.getState();
  const targets = Object.values(state.targets);
  expect(targets).toHaveLength(5);
  expect(targets.every((target) => target.status === "completed")).toBe(true);
  expect(state.sharedIndicators).toHaveLength(1);
  expect(state.sharedIndicators[0]?.targetIds).toEqual(
    expect.arrayContaining(["tgt_lab_a", "tgt_lab_b", "tgt_lab_c"]),
  );
  expect(state.graphVersion).toBe(5);
  expect(state.case).toMatchObject({ status: "completed", targets: 5, failed: 0, clusters: 1 });
  expect(state.log).toHaveLength(219);
  for (const target of targets) expect(stepperIndex(target)).toBe(6);
  const lines = logLines(state);
  expect(lines[0]).toMatchObject({ time: "00:00", tag: "START" });
  expect(lines.at(-1)).toMatchObject({ time: "00:45", tag: "FINISH", message: "5 targets" });
  expect(lines.find((line) => line.message === "2 sibling hosts share this checkout copy")).toMatchObject({
    tag: "FINISH",
    module: "search",
    time: "00:01",
  });
  expect(evidenceCoverage(state).find((row) => row.targetId === "tgt_lab_a")).toMatchObject({ passed: 6, label: "6/8" });
  expect(evidenceCoverage(state).find((row) => row.targetId === "tgt_lab_e")).toMatchObject({ passed: 8, label: "8/8" });
  expect(riskView(state).find((row) => row.targetId === "tgt_lab_e")?.text).toBe("LOW RISK");
  const vault = moduleViews(state).find((view) => view.targetId === "tgt_lab_a" && view.module === "vault");
  expect(vault).toMatchObject({ status: "skipped", durationMs: null });
  const search = moduleViews(state).find((view) => view.targetId === "tgt_lab_a" && view.module === "search");
  expect(search).toMatchObject({ status: "done", durationMs: 500 });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

it("validates REST responses and refuses credential headers", async () => {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const fixtureReport: TargetReport = targetReportSchema.parse(reports[0]);
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const path = String(url);
    if (path.endsWith("/v1/cases") && (init?.method ?? "GET") === "GET") {
      return new Response(
        JSON.stringify([
          {
            id: CASE_ID,
            number: "PS-2026-0001",
            title: "Lab",
            status: "created",
            created_at: T0,
          },
        ]),
        { status: 200 },
      );
    }
    if (path.endsWith("/investigate")) return new Response(null, { status: 202 });
    if (path.endsWith("/missing")) {
      return new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Not Found",
          status: 404,
          detail: "Case not found",
          instance: "/v1/cases/missing",
        }),
        { status: 404, headers: { "content-type": "application/problem+json" } },
      );
    }
    if (path.endsWith("/report")) return new Response(JSON.stringify(fixtureReport), { status: 200 });
    if (path.endsWith("/not-json")) return new Response("nope", { status: 200 });
    return new Response("{}", { status: 500 });
  });
  const client = createApiClient({ baseUrl: "/api/sentinel" });
  expect(client.eventsUrl(CASE_ID)).toBe(`/api/sentinel/v1/cases/${CASE_ID}/events`);
  const cases = await client.listCases();
  expect(cases[0]?.number).toBe("PS-2026-0001");
  await client.investigate(CASE_ID, { max_parallel: 2, focus: "checkout", use_profiles: false });
  const reportBody = await client.getReport(CASE_ID, "tgt_lab_a");
  expect(reportBody.host).toBe("lab-a.example");
  for (const call of calls) {
    expect(call.init?.credentials).toBe("omit");
    const headers = new Headers(call.init?.headers);
    expect(headers.get("authorization")).toBeNull();
    expect(headers.get("x-sentinel-token")).toBeNull();
    expect(headers.get("cookie")).toBeNull();
  }
  await expect(client.getCase("missing")).rejects.toMatchObject({
    name: "ApiError",
    type: "about:blank",
    title: "Not Found",
    status: 404,
    detail: "Case not found",
    instance: "/v1/cases/missing",
  });
  await expect(client.getCase("missing")).rejects.toBeInstanceOf(ApiError);
  await expect(client.getCase("not-json")).rejects.toBeInstanceOf(ApiError);
});
