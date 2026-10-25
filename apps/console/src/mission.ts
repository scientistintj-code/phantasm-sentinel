import {
  MODULES,
  ApiError,
  connectEventStream,
  moduleViews,
  stepperIndex,
  type ConnectEventStreamOptions,
  type InvestigationState,
  type InvestigationStore,
  type ModuleName,
  type ModuleViewStatus,
  type SentinelEvent,
} from "@phantasm/core";
import type { CreateCaseRequest, InvestigateRequest, TargetAdmission } from "@phantasm/core";
import type { CaseRecord } from "@phantasm/core";

export const TARGET_CAP = 10;
export const FOCUS_CAP = 300;

export const REPLAY_LAB_URLS = [
  "https://lab-a.example/",
  "https://lab-b.example/",
  "https://lab-c.example/",
  "https://lab-d.example/",
  "https://lab-e.example/",
] as const;

const MODULE_COPY: Record<ModuleName, string> = {
  search: "Discovers mirror and related domains",
  fetch: "Unpacks dynamic pages into clean JSON",
  agent: "Navigates popups and checkout flows",
  vault: "Injects test credentials securely",
  profiles: "Preserves session cookies across runs",
};

const FOCUS_RULES: ReadonlyArray<{ pattern: RegExp; text: string }> = [
  {
    pattern: /checkout|payment|cart|paygate|billing/i,
    text: "Follow checkout, payment endpoints, and merchant identifiers. Stop before any payment.",
  },
  {
    pattern: /pharma|pharmacy|\bpill\b|\brx\b|medicine|medic/i,
    text: "Inspect the pharmacy storefront, checkout scripts, and redirect chain. Stop before any payment.",
  },
  {
    pattern: /crypto|wallet|bitcoin|usdt/i,
    text: "Trace wallet endpoints, processor hosts, and payment redirects. Stop before any payment.",
  },
  {
    pattern: /ticket|booking|concert/i,
    text: "Trace ticket checkout, payment endpoints, and merchant reuse. Stop before any payment.",
  },
  {
    pattern: /replica|luxury|counterfeit|outlet/i,
    text: "Trace storefront scripts, payment endpoints, and shared merchant infrastructure. Stop before any payment.",
  },
];

const KEY_LABEL = /^key-\d+$/;

export interface LiveDeployClient {
  createCase(body: CreateCaseRequest): Promise<CaseRecord>;
  addTargets(caseId: string, body: { urls: string[] }): Promise<TargetAdmission[]>;
  investigate(caseId: string, body?: InvestigateRequest): Promise<unknown>;
  cancelCase(caseId: string): Promise<void>;
  eventsUrl(caseId: string): string;
}

export interface LiveSession {
  caseId: string;
  stopStream: () => void;
  rejected: string[];
}

export interface ModuleCardData {
  id: ModuleName;
  status: ModuleViewStatus;
  timing: string;
  description: string;
  result: string | null;
  progress: number | null;
  steps: Array<{ id: string; label: string; checked: boolean }> | null;
  span: { left: number; width: number } | null;
}

export function consoleMode(
  env: { VITE_DEFAULT_MODE?: string; VITE_CONSOLE_MODE?: string } = import.meta.env,
): "live" | "replay" {
  if (env.VITE_DEFAULT_MODE === "live" || env.VITE_DEFAULT_MODE === "replay") return env.VITE_DEFAULT_MODE;
  return env.VITE_CONSOLE_MODE === "live" ? "live" : "replay";
}

export function agentTogglesEnabled(env: { VITE_ENABLE_AGENT_TOGGLES?: string } = import.meta.env): boolean {
  return env.VITE_ENABLE_AGENT_TOGGLES === "true";
}

export function deployAllowed(input: { investigator: string; authorized: boolean; targetCount: number }): boolean {
  return input.authorized && input.investigator.trim() !== "" && input.targetCount > 0;
}

export function normalizeTargetUrl(raw: string): string | null {
  return classifyTargetUrl(raw).url;
}

export function classifyTargetUrl(raw: string): { url: string | null; hint: string | null } {
  const trimmed = raw.trim();
  if (!trimmed) return { url: null, hint: null };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { url: null, hint: "Enter an http(s) URL" };
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { url: null, hint: "Enter an http(s) URL" };
  }
  if (parsed.username !== "" || parsed.password !== "") {
    return { url: null, hint: "Enter an http(s) URL" };
  }
  if (parsed.hostname === "" || isBlockedHost(parsed.hostname)) {
    return { url: null, hint: "That host cannot be investigated" };
  }
  parsed.hash = "";
  return { url: parsed.href, hint: null };
}

export function addTargetUrl(current: readonly string[], raw: string): { urls: string[]; hint: string | null } {
  const classified = classifyTargetUrl(raw);
  if (!classified.url) return { urls: [...current], hint: classified.hint };
  if (current.includes(classified.url)) return { urls: [...current], hint: null };
  if (current.length >= TARGET_CAP) return { urls: [...current], hint: "At most 10 targets" };
  return { urls: [...current, classified.url], hint: null };
}

export function presetUrls(mode: "live" | "replay", labUrlsEnv: string | undefined): string[] {
  if (mode === "replay") return [...REPLAY_LAB_URLS];
  if (!labUrlsEnv) return [];
  const urls: string[] = [];
  for (const part of labUrlsEnv.split(",")) {
    const normalized = normalizeTargetUrl(part);
    if (!normalized || urls.includes(normalized)) continue;
    urls.push(normalized);
    if (urls.length >= TARGET_CAP) break;
  }
  return urls;
}

export function chipLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (path === "/" || path === "") return parsed.host;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

export function suggestedFocus(urls: readonly string[]): string {
  if (urls.length === 0) return "";
  const blob = urls.join(" ");
  for (const rule of FOCUS_RULES) {
    if (rule.pattern.test(blob)) return rule.text;
  }
  const host = chipLabel(urls[0] ?? "").split("/")[0] || "the target";
  return `Investigate ${host} for shared merchant infrastructure and checkout behavior. Stop before any payment.`;
}

export function caseTitle(urls: readonly string[]): string {
  const hosts = urls.map((url) => chipLabel(url).split("/")[0]).filter((host) => host !== "");
  const title = hosts.length > 0 ? `Investigation: ${hosts.join(", ")}` : "Investigation";
  return title.slice(0, 180);
}

export function clampParallel(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(5, Math.max(1, Math.round(value)));
}

export function keyPoolLabel(label: string, index: number): string {
  return KEY_LABEL.test(label) ? label : `key-${index + 1}`;
}

export function connectionLabel(connection: InvestigationState["connection"]): string {
  return connection.toUpperCase();
}

export function elapsedLabel(startedAt: string | null, lastTs: string | undefined): string {
  if (!startedAt || !lastTs) return "0.0s";
  const ms = Date.parse(lastTs) - Date.parse(startedAt);
  if (!Number.isFinite(ms)) return "0.0s";
  return `${(Math.max(0, ms) / 1000).toFixed(1)}s`;
}

export function logViewState(state: InvestigationState, targetId: string | "all"): InvestigationState {
  if (targetId === "all") return state;
  return {
    ...state,
    log: state.log.filter((event) => eventMatchesTarget(event, targetId)),
  };
}

export function stepperView(
  state: InvestigationState,
  targetId: string | "all",
): { phaseIndex: number; complete: boolean } {
  if (targetId !== "all") {
    const target = state.targets[targetId];
    if (!target) return { phaseIndex: -1, complete: false };
    const complete = target.status === "completed" || state.case?.status === "completed";
    return { phaseIndex: stepperIndex(target), complete };
  }
  const targets = Object.values(state.targets);
  if (targets.length === 0) return { phaseIndex: -1, complete: state.case?.status === "completed" };
  const complete = state.case?.status === "completed" || targets.every((target) => target.status === "completed");
  if (complete) return { phaseIndex: stepperIndex(targets[0]!), complete: true };
  const running = targets.filter((target) => target.status === "running");
  const pool = running.length > 0 ? running : targets;
  const earliest = pool.reduce((best, target) => (stepperIndex(target) < stepperIndex(best) ? target : best));
  return { phaseIndex: stepperIndex(earliest), complete: false };
}

export function followedTarget(state: InvestigationState, targetId: string | "all") {
  if (targetId !== "all") return state.targets[targetId] ?? null;
  const targets = Object.values(state.targets);
  return (
    targets.find((target) => target.status === "running") ??
    [...targets].sort((a, b) => (b.report?.risk.score ?? -1) - (a.report?.risk.score ?? -1))[0] ??
    null
  );
}

export function buildModuleCards(state: InvestigationState, targetId: string | "all"): {
  cards: ModuleCardData[];
  executed: number;
} {
  const views = moduleViews(state).filter((view) => targetId === "all" || view.targetId === targetId);
  const spans = moduleSpans(state, targetId);
  const steps = agentSteps(state, targetId);
  let executed = 0;
  const cards = MODULES.map((moduleName) => {
    const related = views.filter((view) => view.module === moduleName);
    const status = mergedStatus(related.map((view) => view.status));
    const completed = related.some((view) => state.targets[view.targetId]?.modules[moduleName]?.state === "completed");
    if (completed) executed += 1;
    const durationMs = related.reduce<number | null>((best, view) => {
      if (view.durationMs === null) return best;
      return best === null ? view.durationMs : Math.max(best, view.durationMs);
    }, null);
    const summary =
      related
        .map((view) => state.targets[view.targetId]?.modules[moduleName]?.summary ?? null)
        .find((value) => value !== null && value !== "") ?? null;
    return {
      id: moduleName,
      status,
      timing: durationLabel(status, durationMs),
      description: MODULE_COPY[moduleName],
      result: status === "done" ? summary : null,
      progress: status === "done" ? 100 : null,
      steps: moduleName === "agent" && steps.length > 0 ? steps : null,
      span: spans[moduleName] ?? null,
    };
  });
  return { cards, executed };
}

export async function deployLive(
  input: {
    client: LiveDeployClient;
    store: InvestigationStore;
    investigator: string;
    urls: readonly string[];
    maxParallel: number;
    focus: string;
    connect?: (options: ConnectEventStreamOptions) => () => void;
    onCaseId?: (caseId: string) => void;
  },
): Promise<LiveSession> {
  const investigator = input.investigator.trim();
  if (investigator === "") {
    throw new ApiError({ type: "about:blank", title: "Investigator name is required", status: 400 });
  }
  if (input.urls.length === 0) {
    throw new ApiError({ type: "about:blank", title: "At least one target is required", status: 400 });
  }
  const record = await input.client.createCase({
    title: caseTitle(input.urls),
    authorized_by: investigator,
    authorization_ack: true,
  });
  const admissions = await input.client.addTargets(record.id, { urls: [...input.urls] });
  const rejected = admissions.filter((row) => !row.accepted);
  if (admissions.length === 0 || rejected.length === admissions.length) {
    const detail = rejected.map((row) => `${row.host}: ${row.reason ?? "rejected"}`).join("; ") || "No targets were accepted";
    throw new ApiError({ type: "about:blank", title: "Targets rejected", status: 422, detail });
  }
  const focus = input.focus.trim().slice(0, FOCUS_CAP);
  const body: InvestigateRequest = { max_parallel: clampParallel(input.maxParallel) };
  if (focus !== "") body.focus = focus;
  const started = await input.client.investigate(record.id, body);
  const caseId = caseIdFromInvestigate(started) ?? record.id;
  input.onCaseId?.(caseId);
  const connect = input.connect ?? connectEventStream;
  const stopStream = connect({
    url: input.client.eventsUrl(caseId),
    onEvent: (event) => {
      input.store.getState().apply(event);
      input.onCaseId?.(event.case_id);
    },
    onState: (connection) => input.store.getState().setConnection(connection),
  });
  return {
    caseId,
    stopStream,
    rejected: rejected.map((row) => `${row.host}: ${row.reason ?? "rejected"}`),
  };
}

export function caseIdFromInvestigate(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const raw = record.case_id ?? record.id;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed.length > 200) return null;
  if (/[\s/?#\\]/.test(trimmed)) return null;
  return trimmed;
}

export function errorText(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  return "Request failed";
}

function durationLabel(status: ModuleViewStatus, durationMs: number | null): string {
  if (status === "skipped") return "Not used in this run";
  if (status === "idle") return "Waiting";
  if (status === "active") return "Executing...";
  if (durationMs === null) return "Done";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function mergedStatus(statuses: ModuleViewStatus[]): ModuleViewStatus {
  if (statuses.length === 0) return "idle";
  if (statuses.includes("active")) return "active";
  if (statuses.includes("done")) return "done";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  return "idle";
}

function agentSteps(
  state: InvestigationState,
  targetId: string | "all",
): Array<{ id: string; label: string; checked: boolean }> {
  if (targetId === "all") {
    return state.log
      .filter((event) => event.type === "AgentStep")
      .slice(-5)
      .map((event) => ({ id: String(event.seq), label: event.purpose, checked: true }));
  }
  const target = state.targets[targetId];
  if (!target) return [];
  return target.steps.slice(-5).map((step) => ({
    id: `${targetId}-${step.index}`,
    label: step.purpose,
    checked: true,
  }));
}

function moduleSpans(
  state: InvestigationState,
  targetId: string | "all",
): Partial<Record<ModuleName, { left: number; width: number }>> {
  const startedAt = state.case?.startedAt;
  if (!startedAt) return {};
  const origin = Date.parse(startedAt);
  if (!Number.isFinite(origin)) return {};
  let horizon = origin;
  for (const event of state.log) {
    const ts = Date.parse(event.ts);
    if (Number.isFinite(ts)) horizon = Math.max(horizon, ts);
  }
  const span = Math.max(horizon - origin, 1);
  const acc = new Map<ModuleName, { start: number; end: number; open: boolean }>();
  for (const event of state.log) {
    if (event.type !== "ModuleStatus") continue;
    if (targetId !== "all" && event.target_id !== targetId) continue;
    const ts = Date.parse(event.ts);
    if (!Number.isFinite(ts)) continue;
    const current = acc.get(event.module) ?? { start: ts, end: ts, open: false };
    current.start = Math.min(current.start, ts);
    if (event.state === "started") {
      current.end = Math.max(current.end, ts);
      current.open = true;
    } else {
      current.end = Math.max(ts, current.start + (event.duration_ms ?? 0));
      current.open = false;
    }
    acc.set(event.module, current);
  }
  const result: Partial<Record<ModuleName, { left: number; width: number }>> = {};
  for (const [moduleName, row] of acc) {
    const end = row.open ? Math.max(row.end, horizon) : row.end;
    const left = clampPercent(((row.start - origin) / span) * 100);
    const width = clampPercent(((end - row.start) / span) * 100);
    const bounded = Math.min(Math.max(width, 2), 100 - left);
    result[moduleName] = { left, width: bounded };
  }
  return result;
}

function eventMatchesTarget(event: SentinelEvent, targetId: string): boolean {
  if (!("target_id" in event) || event.target_id === undefined) return true;
  return event.target_id === targetId;
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) return true;
  if (host === "metadata.google.internal" || host === "metadata.google.com") return true;
  const mapped = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped?.[1] && isBlockedIPv4(mapped[1])) return true;
  if (host.includes(":")) return isBlockedIPv6(host);
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) return isBlockedIPv4(host);
  return false;
}

function isBlockedIPv4(host: string): boolean {
  const parts = host.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return true;
  const a = parts[0] ?? 0;
  const b = parts[1] ?? 0;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  if (a >= 224) return true;
  return false;
}

function isBlockedIPv6(host: string): boolean {
  const normalized = host.replace(/^\[|\]$/g, "");
  if (normalized === "::1" || normalized === "0:0:0:0:0:0:0:1") return true;
  const head = normalized.split(":")[0]?.toLowerCase() ?? "";
  if (head === "fe80" || head === "fc00" || head.startsWith("fc") || head.startsWith("fd")) return true;
  return false;
}
