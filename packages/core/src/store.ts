import { createStore } from "zustand/vanilla";
import {
  PHASES,
  type Indicator,
  type ModuleName,
  type PhaseName,
  type SentinelEvent,
  type TargetReport,
} from "./schemas";
import type { EventStreamState } from "./sse";

export type InvestigationMode = "live" | "replay";
export type TargetStatus = "queued" | "running" | "completed" | "failed";

export interface ModuleSnapshot {
  state: "started" | "completed" | "failed" | "skipped";
  durationMs: number | null;
  summary: string | null;
}

export interface TargetState {
  id: string;
  host: string;
  url: string | null;
  status: TargetStatus;
  phase: PhaseName | null;
  phaseIndex: number;
  modules: Partial<Record<ModuleName, ModuleSnapshot>>;
  steps: Array<{ index: number; purpose: string }>;
  streamingUrl: string | null;
  runId: string | null;
  keyLabel: string | null;
  indicators: Indicator[];
  report: TargetReport | null;
  validation: {
    schemaVersion: string;
    checks: Array<{ field: string; passed: boolean; reason?: string }>;
  } | null;
}

export interface CaseSnapshot {
  id: string;
  title: string;
  status: "created" | "running" | "completed" | "cancelled";
  startedAt: string;
  targets: number | null;
  failed: number | null;
  clusters: number | null;
}

export interface PivotState {
  pivotId: string;
  targetId: string;
  indicator: Indicator;
  query: string;
  seq: number;
}

export interface SafetyHaltState {
  seq: number;
  targetId: string | null;
  reason: string;
}

export interface SharedIndicatorGroup {
  targetIds: string[];
  indicators: Array<{ kind: Indicator["kind"]; value: string }>;
}

export interface InvestigationState {
  case: CaseSnapshot | null;
  mode: InvestigationMode;
  connection: EventStreamState;
  targets: Record<string, TargetState>;
  log: SentinelEvent[];
  sharedIndicators: SharedIndicatorGroup[];
  pivots: PivotState[];
  safetyHalts: SafetyHaltState[];
  graphVersion: number;
  unknownCount: number;
  appliedSeqs: ReadonlySet<number>;
}

export interface InvestigationActions {
  apply: (event: SentinelEvent) => void;
  setMode: (mode: InvestigationMode) => void;
  setConnection: (connection: EventStreamState) => void;
  reset: () => void;
}

const LOG_CAP = 5000;
const STEP_CAP = 500;

export function createInitialState(): InvestigationState {
  return {
    case: null,
    mode: "live",
    connection: "closed",
    targets: {},
    log: [],
    sharedIndicators: [],
    pivots: [],
    safetyHalts: [],
    graphVersion: 0,
    unknownCount: 0,
    appliedSeqs: new Set<number>(),
  };
}

function blankTarget(id: string): TargetState {
  return {
    id,
    host: "",
    url: null,
    status: "queued",
    phase: null,
    phaseIndex: -1,
    modules: {},
    steps: [],
    streamingUrl: null,
    runId: null,
    keyLabel: null,
    indicators: [],
    report: null,
    validation: null,
  };
}

function appendCapped<T>(items: readonly T[], item: T, cap: number): T[] {
  if (items.length < cap) return [...items, item];
  const next = items.slice(items.length - cap + 1);
  next.push(item);
  return next;
}

function earlierIso(a: string, b: string): string {
  return Date.parse(a) <= Date.parse(b) ? a : b;
}

function markRunning(target: TargetState): TargetState {
  if (target.status === "queued") return { ...target, status: "running" };
  return target;
}

function updateTarget(
  targets: Record<string, TargetState>,
  id: string,
  update: (target: TargetState) => TargetState,
): Record<string, TargetState> {
  const current = targets[id] ?? blankTarget(id);
  return { ...targets, [id]: update(current) };
}

function evolveCase(current: CaseSnapshot | null, event: SentinelEvent): CaseSnapshot {
  const startedAt = current ? earlierIso(current.startedAt, event.ts) : event.ts;
  let status = current?.status ?? "created";
  if (event.type === "CaseCompleted") status = "completed";
  else if (event.type !== "CaseCreated" && status === "created") status = "running";
  return {
    id: current?.id ?? event.case_id,
    title: event.type === "CaseCreated" ? event.title : (current?.title ?? ""),
    status,
    startedAt,
    targets: event.type === "CaseCompleted" ? event.targets : (current?.targets ?? null),
    failed: event.type === "CaseCompleted" ? event.failed : (current?.failed ?? null),
    clusters: event.type === "CaseCompleted" ? event.clusters : (current?.clusters ?? null),
  };
}

export function sharedIndicatorGroups(targets: Record<string, TargetState>): SharedIndicatorGroup[] {
  const index = new Map<string, { kind: Indicator["kind"]; value: string; targetIds: Set<string> }>();
  for (const [targetId, target] of Object.entries(targets)) {
    for (const indicator of target.indicators) {
      const key = `${indicator.kind}\0${indicator.value}`;
      let row = index.get(key);
      if (!row) {
        row = { kind: indicator.kind, value: indicator.value, targetIds: new Set() };
        index.set(key, row);
      }
      row.targetIds.add(targetId);
    }
  }
  const shared: Array<{ kind: Indicator["kind"]; value: string; targetIds: string[] }> = [];
  for (const row of index.values()) {
    if (row.targetIds.size >= 2) {
      shared.push({ kind: row.kind, value: row.value, targetIds: [...row.targetIds].sort() });
    }
  }
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const current = parent.get(id);
    if (!current || current === id) {
      parent.set(id, id);
      return id;
    }
    const root = find(current);
    parent.set(id, root);
    return root;
  };
  const unite = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  for (const row of shared) {
    const first = row.targetIds[0];
    if (!first) continue;
    for (const id of row.targetIds.slice(1)) unite(first, id);
  }
  const grouped = new Map<string, SharedIndicatorGroup>();
  for (const row of shared) {
    const anchor = row.targetIds[0];
    if (!anchor) continue;
    const root = find(anchor);
    let group = grouped.get(root);
    if (!group) {
      group = { targetIds: [], indicators: [] };
      grouped.set(root, group);
    }
    group.indicators.push({ kind: row.kind, value: row.value });
    for (const id of row.targetIds) {
      if (!group.targetIds.includes(id)) group.targetIds.push(id);
    }
  }
  return [...grouped.values()]
    .map((group) => ({
      targetIds: [...group.targetIds].sort(),
      indicators: [...group.indicators].sort((a, b) =>
        a.kind === b.kind ? a.value.localeCompare(b.value) : a.kind.localeCompare(b.kind),
      ),
    }))
    .sort((a, b) => a.targetIds.join().localeCompare(b.targetIds.join()));
}

export function applyEvent(state: InvestigationState, event: SentinelEvent): InvestigationState {
  if (state.appliedSeqs.has(event.seq)) return state;
  const appliedSeqs = new Set(state.appliedSeqs);
  appliedSeqs.add(event.seq);
  let targets = state.targets;
  let pivots = state.pivots;
  let safetyHalts = state.safetyHalts;
  let graphVersion = state.graphVersion;
  let unknownCount = state.unknownCount;
  let sharedIndicators = state.sharedIndicators;

  switch (event.type) {
    case "CaseCreated":
    case "CaseCompleted":
      break;
    case "TargetQueued":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...target,
        host: event.host,
        url: event.url,
      }));
      break;
    case "PhaseChanged": {
      const phaseIndex = PHASES.indexOf(event.phase);
      targets = updateTarget(targets, event.target_id, (target) => {
        if (target.phase !== null && target.phaseIndex >= phaseIndex) return target;
        return { ...markRunning(target), phase: event.phase, phaseIndex };
      });
      break;
    }
    case "ModuleStatus":
      targets = updateTarget(targets, event.target_id, (target) => {
        const previous = target.modules[event.module];
        return {
          ...markRunning(target),
          modules: {
            ...target.modules,
            [event.module]: {
              state: event.state,
              durationMs: event.duration_ms ?? previous?.durationMs ?? null,
              summary: event.summary ?? previous?.summary ?? null,
            },
          },
        };
      });
      break;
    case "ReconFinding":
      targets = updateTarget(targets, event.target_id, (target) => markRunning(target));
      break;
    case "ProbeStarted":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...markRunning(target),
        runId: event.run_id,
        keyLabel: event.key_label,
      }));
      break;
    case "StreamingUrl":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...markRunning(target),
        streamingUrl: event.url,
      }));
      break;
    case "AgentStep":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...markRunning(target),
        steps: appendCapped(target.steps, { index: event.index, purpose: event.purpose }, STEP_CAP),
      }));
      break;
    case "ProbeCompleted":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...target,
        status: event.status.toUpperCase() === "COMPLETED" ? "completed" : "failed",
      }));
      break;
    case "IndicatorExtracted":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...markRunning(target),
        indicators: [...target.indicators, event.indicator],
      }));
      sharedIndicators = sharedIndicatorGroups(targets);
      break;
    case "PayloadValidated":
      targets = updateTarget(targets, event.target_id, (target) => ({
        ...markRunning(target),
        report: event.report,
        validation: { schemaVersion: event.schema_version, checks: [...event.checks] },
      }));
      break;
    case "GraphUpdated":
      graphVersion = Math.max(graphVersion, event.version);
      targets = updateTarget(targets, event.target_id, (target) => markRunning(target));
      break;
    case "PivotSuggested":
      pivots = [
        ...pivots.filter((pivot) => pivot.pivotId !== event.pivot_id),
        {
          pivotId: event.pivot_id,
          targetId: event.target_id,
          indicator: event.indicator,
          query: event.query,
          seq: event.seq,
        },
      ];
      targets = updateTarget(targets, event.target_id, (target) => markRunning(target));
      break;
    case "SafetyHalt":
      safetyHalts = [
        ...safetyHalts,
        { seq: event.seq, targetId: event.target_id ?? null, reason: event.reason },
      ];
      if (event.target_id) {
        targets = updateTarget(targets, event.target_id, (target) => target);
      }
      break;
    case "TargetFailed":
      targets = updateTarget(targets, event.target_id, (target) => ({ ...target, status: "failed" }));
      break;
    case "UnknownEvent":
      unknownCount += 1;
      if (event.target_id) {
        targets = updateTarget(targets, event.target_id, (target) => target);
      }
      break;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }

  return {
    case: evolveCase(state.case, event),
    mode: state.mode,
    connection: state.connection,
    targets,
    log: appendCapped(state.log, event, LOG_CAP),
    sharedIndicators,
    pivots,
    safetyHalts,
    graphVersion,
    unknownCount,
    appliedSeqs,
  };
}

export function createInvestigationStore() {
  return createStore<InvestigationState & InvestigationActions>((set, get) => ({
    ...createInitialState(),
    apply: (event) => {
      const current = get();
      const next = applyEvent(current, event);
      if (next !== current) set(next);
    },
    setMode: (mode) => set({ mode }),
    setConnection: (connection) => set({ connection }),
    reset: () => {
      const { mode, connection } = get();
      set({ ...createInitialState(), mode, connection });
    },
  }));
}

export type InvestigationStore = ReturnType<typeof createInvestigationStore>;
