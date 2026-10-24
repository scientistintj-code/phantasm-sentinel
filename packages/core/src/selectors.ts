import { MODULES, type ModuleName, type SentinelEvent } from "./schemas";
import type { InvestigationState, TargetState } from "./store";

export type ModuleViewStatus = "idle" | "active" | "done" | "skipped";
export type LogTag = "START" | "FINISH" | "TRACE" | "THREAT";

export interface ModuleView {
  targetId: string;
  module: ModuleName;
  status: ModuleViewStatus;
  durationMs: number | null;
}

export interface EvidenceCoverage {
  targetId: string;
  passed: number;
  total: 8;
  label: string;
}

export interface RiskView {
  targetId: string;
  score: number;
  label: "LOW" | "MEDIUM" | "HIGH";
  text: "LOW RISK" | "MEDIUM RISK" | "HIGH RISK";
  verdict: string;
}

export interface LogLine {
  time: string;
  tag: LogTag;
  module: string;
  message: string;
}

export function stepperIndex(target: Pick<TargetState, "phaseIndex">): number {
  return target.phaseIndex;
}

function viewStatus(state: "started" | "completed" | "failed" | "skipped" | undefined): ModuleViewStatus {
  if (state === "started") return "active";
  if (state === "skipped") return "skipped";
  if (state === "completed" || state === "failed") return "done";
  return "idle";
}

export function moduleViews(state: InvestigationState): ModuleView[] {
  const views: ModuleView[] = [];
  const targetIds = Object.keys(state.targets).sort();
  for (const targetId of targetIds) {
    const target = state.targets[targetId];
    if (!target) continue;
    for (const moduleName of MODULES) {
      const snapshot = target.modules[moduleName];
      views.push({
        targetId,
        module: moduleName,
        status: viewStatus(snapshot?.state),
        durationMs: snapshot?.durationMs ?? null,
      });
    }
  }
  return views;
}

export function evidenceCoverage(state: InvestigationState): EvidenceCoverage[] {
  const rows: EvidenceCoverage[] = [];
  for (const target of Object.values(state.targets)) {
    if (!target.validation && !target.report) continue;
    const passed = target.validation
      ? target.validation.checks.filter((check) => check.passed).length
      : Number.parseInt(target.report?.risk.evidence_coverage ?? "0", 10);
    rows.push({ targetId: target.id, passed, total: 8, label: `${passed}/8` });
  }
  rows.sort((a, b) => a.targetId.localeCompare(b.targetId));
  return rows;
}

export function riskView(state: InvestigationState): RiskView[] {
  const rows: RiskView[] = [];
  for (const target of Object.values(state.targets)) {
    if (!target.report) continue;
    const label = target.report.risk.label;
    rows.push({
      targetId: target.id,
      score: target.report.risk.score,
      label,
      text: `${label} RISK`,
      verdict: target.report.risk.verdict,
    });
  }
  rows.sort((a, b) => a.targetId.localeCompare(b.targetId));
  return rows;
}

function formatOffset(startIso: string, eventIso: string): string {
  const delta = Math.max(0, Date.parse(eventIso) - Date.parse(startIso));
  const totalSeconds = Math.floor(delta / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function tagFor(event: SentinelEvent): LogTag {
  switch (event.type) {
    case "CaseCreated":
    case "TargetQueued":
    case "ProbeStarted":
      return "START";
    case "ModuleStatus":
      return event.state === "started" ? "START" : "FINISH";
    case "ProbeCompleted":
    case "PayloadValidated":
    case "CaseCompleted":
    case "GraphUpdated":
      return "FINISH";
    case "IndicatorExtracted":
    case "SafetyHalt":
    case "TargetFailed":
      return "THREAT";
    case "PhaseChanged":
    case "ReconFinding":
    case "StreamingUrl":
    case "AgentStep":
    case "PivotSuggested":
    case "UnknownEvent":
      return "TRACE";
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

function moduleFor(event: SentinelEvent): string {
  switch (event.type) {
    case "ModuleStatus":
      return event.module;
    case "ProbeStarted":
    case "ProbeCompleted":
    case "AgentStep":
    case "StreamingUrl":
      return "agent";
    case "ReconFinding":
      return event.source;
    default:
      return "";
  }
}

function messageFor(event: SentinelEvent): string {
  switch (event.type) {
    case "CaseCreated":
      return event.title;
    case "TargetQueued":
      return event.host;
    case "PhaseChanged":
      return event.phase;
    case "ModuleStatus":
      return event.summary ?? `${event.module} ${event.state}`;
    case "ReconFinding":
      return event.summary;
    case "ProbeStarted":
      return event.run_id;
    case "StreamingUrl":
      return event.url;
    case "AgentStep":
      return event.purpose;
    case "ProbeCompleted":
      return event.stopped_reason;
    case "IndicatorExtracted":
      return `${event.indicator.kind} ${event.indicator.value}`;
    case "PayloadValidated":
      return event.report.risk.verdict;
    case "GraphUpdated":
      return String(event.version);
    case "PivotSuggested":
      return event.query;
    case "SafetyHalt":
      return event.reason;
    case "TargetFailed":
      return event.message;
    case "CaseCompleted":
      return `${event.targets} targets`;
    case "UnknownEvent":
      return event.originalType;
    default: {
      const unreachable: never = event;
      return unreachable;
    }
  }
}

export function logLines(state: InvestigationState): LogLine[] {
  const start = state.case?.startedAt ?? state.log[0]?.ts;
  return state.log.map((event) => ({
    time: start ? formatOffset(start, event.ts) : "00:00",
    tag: tagFor(event),
    module: moduleFor(event),
    message: messageFor(event),
  }));
}
