import { expect, it } from "vitest";
import { ApiError, createInvestigationStore, logLines, parseSentinelEvent, type SentinelEvent } from "@phantasm/core";
import {
  addTargetUrl,
  buildModuleCards,
  deployLive,
  keyPoolLabel,
  logViewState,
  normalizeTargetUrl,
  presetUrls,
  suggestedFocus,
  type LiveDeployClient,
} from "./mission";

const CASE_ID = "c0ffee00-0000-4000-8000-000000000001";
const T0 = "2026-10-24T12:00:00.000Z";

function at(offsetMs: number): string {
  return new Date(Date.parse(T0) + offsetMs).toISOString();
}

function event(seq: number, body: Record<string, unknown>, ts = T0): SentinelEvent {
  return parseSentinelEvent({ case_id: CASE_ID, seq, ts, ...body });
}

it("accepts http(s) targets and rejects other hosts", () => {
  expect(normalizeTargetUrl("https://lab-a.example")).toBe("https://lab-a.example/");
  expect(normalizeTargetUrl("http://shop.example/checkout")).toBe("http://shop.example/checkout");
  expect(normalizeTargetUrl("ftp://files.example/a")).toBeNull();
  expect(normalizeTargetUrl("https://user:pass@public.example/")).toBeNull();
  expect(normalizeTargetUrl("http://127.0.0.1/")).toBeNull();
  expect(normalizeTargetUrl("http://10.1.1.1/")).toBeNull();
  expect(normalizeTargetUrl("http://169.254.169.254/latest")).toBeNull();
  expect(normalizeTargetUrl("http://192.168.0.5/")).toBeNull();
  const capped = Array.from({ length: 10 }, (_, index) => `https://shop-${index}.example/`);
  expect(addTargetUrl(capped, "https://extra.example/").hint).toBe("At most 10 targets");
  expect(addTargetUrl(["https://lab-a.example/"], "https://lab-a.example").urls).toHaveLength(1);
});

it("loads replay labs and live presets from the env list", () => {
  expect(presetUrls("replay", "https://other.example")).toEqual([
    "https://lab-a.example/",
    "https://lab-b.example/",
    "https://lab-c.example/",
    "https://lab-d.example/",
    "https://lab-e.example/",
  ]);
  expect(presetUrls("live", "https://a.example, ftp://no, https://b.example")).toEqual([
    "https://a.example/",
    "https://b.example/",
  ]);
});

it("suggests focus from url keywords", () => {
  expect(suggestedFocus([])).toBe("");
  expect(suggestedFocus(["https://checkout.example/pay"])).toContain("payment endpoints");
  expect(suggestedFocus(["https://lab-a.example/"])).toContain("lab-a.example");
});

it("filters the log, counts completed modules, and places timeline spans", () => {
  const store = createInvestigationStore();
  const events = [
    event(1, { type: "CaseCreated", title: "Lab storefront cluster" }),
    event(2, { type: "TargetQueued", target_id: "tgt_lab_a", url: "https://lab-a.example", host: "lab-a.example" }, at(80)),
    event(3, { type: "TargetQueued", target_id: "tgt_lab_b", url: "https://lab-b.example", host: "lab-b.example" }, at(120)),
    event(4, { type: "ModuleStatus", target_id: "tgt_lab_a", module: "search", state: "started" }, at(1000)),
    event(5, { type: "ModuleStatus", target_id: "tgt_lab_a", module: "search", state: "completed", duration_ms: 500, summary: "mirrors" }, at(1500)),
    event(6, { type: "ModuleStatus", target_id: "tgt_lab_a", module: "vault", state: "skipped" }, at(1600)),
    event(7, { type: "AgentStep", target_id: "tgt_lab_a", index: 1, purpose: "Dismiss popup" }, at(1700)),
    event(8, { type: "AgentStep", target_id: "tgt_lab_b", index: 1, purpose: "Open cart" }, at(1800)),
    event(9, { type: "SafetyHalt", target_id: "tgt_lab_a", reason: "payment wall" }, at(1900)),
  ];
  for (const item of events) store.getState().apply(item);
  const state = store.getState();
  const filtered = logViewState(state, "tgt_lab_a");
  expect(filtered.log.some((item) => item.type === "AgentStep" && item.purpose === "Open cart")).toBe(false);
  expect(filtered.log.some((item) => item.type === "CaseCreated")).toBe(true);
  const tags = logLines(filtered);
  expect(tags.find((line) => line.message === "payment wall")?.tag).toBe("THREAT");
  expect(tags.find((line) => line.message === "Dismiss popup")?.tag).toBe("TRACE");
  const built = buildModuleCards(state, "tgt_lab_a");
  expect(built.executed).toBe(1);
  expect(built.cards.find((card) => card.id === "vault")?.timing).toBe("Not used in this run");
  expect(built.cards.find((card) => card.id === "search")?.timing).toBe("0.5s");
  expect(built.cards.find((card) => card.id === "agent")?.steps?.map((step) => step.label)).toEqual(["Dismiss popup"]);
  const span = built.cards.find((card) => card.id === "search")?.span;
  expect(span?.left).toBeGreaterThan(40);
  expect(span?.width).toBeGreaterThan(10);
  expect(keyPoolLabel("sk-live-secret", 0)).toBe("key-1");
  expect(keyPoolLabel("key-2", 1)).toBe("key-2");
});

it("deploys through createCase, addTargets, investigate, and the event stream", async () => {
  const store = createInvestigationStore();
  const calls: string[] = [];
  let investigateBody = "";
  const client: LiveDeployClient = {
    async createCase(body) {
      calls.push(`create:${body.authorized_by}:${String(body.authorization_ack)}`);
      return {
        id: "case-1",
        number: "PS-2026-0001",
        title: body.title,
        status: "created",
        created_at: T0,
      };
    },
    async addTargets(_id, body) {
      calls.push(`targets:${body.urls.join(",")}`);
      return body.urls.map((url) => ({ url, host: "lab-a.example", accepted: true }));
    },
    async investigate(_id, body) {
      investigateBody = JSON.stringify(body);
      calls.push("investigate");
      return { case_id: "case-1" };
    },
    async cancelCase() {
      calls.push("cancel");
    },
    eventsUrl(id) {
      return `/api/sentinel/v1/cases/${id}/events`;
    },
  };
  const noted: string[] = [];
  const session = await deployLive({
    client,
    store,
    investigator: " Ada ",
    urls: ["https://lab-a.example/"],
    maxParallel: 2,
    focus: "  checkout trail  ",
    onCaseId: (id) => noted.push(id),
    connect: (options) => {
      calls.push(`stream:${options.url}`);
      options.onEvent(parseSentinelEvent({ case_id: "case-1", seq: 1, ts: T0, type: "CaseCreated", title: "Live" }));
      options.onState("live");
      return () => options.onState("closed");
    },
  });
  expect(calls).toEqual([
    "create:Ada:true",
    "targets:https://lab-a.example/",
    "investigate",
    "stream:/api/sentinel/v1/cases/case-1/events",
  ]);
  expect(investigateBody).toContain('"max_parallel":2');
  expect(investigateBody).toContain("checkout trail");
  expect(noted).toEqual(["case-1", "case-1"]);
  expect(session.caseId).toBe("case-1");
  expect(store.getState().connection).toBe("live");
  session.stopStream();
  expect(store.getState().connection).toBe("closed");

  const rejected: LiveDeployClient = {
    ...client,
    async addTargets() {
      return [{ url: "https://lab-a.example/", host: "lab-a.example", accepted: false, reason: "blocked" }];
    },
    async investigate() {
      calls.push("investigate-rejected");
    },
  };
  await expect(
    deployLive({
      client: rejected,
      store,
      investigator: "Ada",
      urls: ["https://lab-a.example/"],
      maxParallel: 9,
      focus: "",
      connect: () => () => undefined,
    }),
  ).rejects.toBeInstanceOf(ApiError);
  expect(calls.includes("investigate-rejected")).toBe(false);
});
