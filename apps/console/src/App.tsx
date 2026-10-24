import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  MODULES,
  ReplayDriver,
  createInvestigationStore,
  logLines,
  moduleViews,
  riskView,
  stepperIndex,
  type InvestigationStore,
  type ModuleName,
  type SentinelEvent,
  type TargetReport,
  type TargetState,
} from "@phantasm/core";
import { Footer } from "./components/Footer";
import { ForensicPanel, type EvidenceItem, type ValidationChip, type ValidationState } from "./components/ForensicPanel";
import { GraphPanel } from "./components/GraphPanel";
import { LiveAgentView } from "./components/LiveAgentView";
import { MetricsRow } from "./components/MetricsRow";
import { MissionControl, type DeployState } from "./components/MissionControl";
import type { TerminalLine } from "./components/Terminal";
import { TinyFishPanel, type ModuleCardModel } from "./components/TinyFishPanel";
import { Topbar } from "./components/Topbar";
import { labCaseText, labGraph, labKeys, reportForTarget } from "./fixtures";
import { useButtonRipple } from "./hooks/useButtonRipple";

const MODULE_COPY: Record<ModuleName, string> = {
  search: "Discovers mirror and related domains",
  fetch: "Unpacks dynamic pages into clean JSON",
  agent: "Navigates popups and checkout flows",
  vault: "Injects test credentials securely",
  profiles: "Preserves session cookies across runs",
};

const MODULE_LABEL: Record<string, string> = {
  search: "TinySearch",
  fetch: "TinyFetch",
  agent: "TinyAgent",
  vault: "TinyVault",
  profiles: "TinyProfiles",
  infra: "Infra",
};

const EVIDENCE_LABELS = [
  "Merchant ID",
  "Gateway",
  "Payment Endpoint",
  "Host IP",
  "Domain Age",
  "SSL Issuer",
  "Suspicious Scripts",
  "Redirect Chain",
] as const;

const RISK_COLOR = { LOW: "#25d492", MEDIUM: "#f5b942", HIGH: "#fb5262" } as const;

export function App() {
  const store = useState(createReplayStore)[0];
  const state = useStore(store);
  const driverRef = useRef<ReplayDriver | null>(null);
  const [presentation, setPresentation] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [url, setUrl] = useState("");
  const [goal, setGoal] = useState("");
  const [parallel, setParallel] = useState(1);
  const [forceInvalid, setForceInvalid] = useState(false);
  const [streamBroken, setStreamBroken] = useState(false);
  useButtonRipple();

  useEffect(() => {
    return () => {
      driverRef.current?.pause();
    };
  }, []);

  const target = selectTarget(state.targets);
  const report = resolveReport(target, state.case?.status ?? null);
  const risk = riskView(state).find((row) => row.targetId === target?.id) ?? null;
  const phaseIndex = target ? stepperIndex(target) : -1;
  const complete = state.case?.status === "completed" || target?.status === "completed";
  const lines = useMemo(() => toLines(state.log, logLines(state)), [state]);
  const alerts = alertMessages(state.log, state.safetyHalts);
  const graph = state.graphVersion > 0 ? labGraph : null;
  const riskText = risk?.text ?? "";
  const riskColor = risk ? RISK_COLOR[risk.label] : "#74869b";
  const validation = validationState(target, forceInvalid);
  const deployState: DeployState = playing ? "running" : state.case?.status === "completed" ? "complete" : "idle";
  const agent = agentPill(state.case?.status ?? null);
  const key = labKeys[0];

  const onDeploy = () => {
    if (playing) {
      driverRef.current?.pause();
      store.getState().reset();
      store.getState().setMode("replay");
      store.getState().setConnection("closed");
      setPlaying(false);
      setForceInvalid(false);
      setStreamBroken(false);
      return;
    }
    const driver = new ReplayDriver(labCaseText, store);
    driverRef.current = driver;
    driver.onEnd(() => {
      store.getState().setConnection("closed");
      setPlaying(false);
    });
    store.getState().setConnection("live");
    setPlaying(true);
    setForceInvalid(false);
    setStreamBroken(false);
    driver.play();
  };

  const streamingUrl = streamBroken ? null : (target?.streamingUrl ?? null);

  return (
    <div className="app-shell">
      <Topbar
        agentStatus={agent.text}
        agentClass={agent.className}
        mode={state.mode}
        presentation={presentation}
        onTogglePresentation={() => setPresentation((value) => !value)}
      />
      {alerts.length > 0 ? (
        <p className="error-banner" role="alert">
          {alerts.join(" · ")}
        </p>
      ) : null}
      {state.connection === "reconnecting" ? (
        <p className="reconnecting-banner" role="status">
          Reconnecting to event stream
        </p>
      ) : null}
      <main className={presentation ? "presentation" : ""}>
        <div className="dashboard-grid">
          <div className={`left-stack side-panel${presentation ? " side-hidden" : ""}`}>
            <MissionControl
              url={url}
              goal={goal}
              parallel={parallel}
              onUrl={setUrl}
              onGoal={setGoal}
              onParallel={setParallel}
              deployState={deployState}
              onDeploy={onDeploy}
            />
            <TinyFishPanel
              modules={moduleCards(state, target)}
              elapsed={elapsedLabel(state.case?.startedAt ?? null, state.log)}
              sseConnected={state.connection === "live" || playing}
              keyState={key?.state === "healthy" ? "Configured" : (key?.state ?? "Unavailable")}
            />
          </div>
          <LiveAgentView
            address={displayAddress(streamingUrl, target)}
            live={state.case?.status === "running" || state.connection === "live"}
            streamingUrl={streamingUrl}
            phaseIndex={phaseIndex}
            complete={Boolean(complete)}
            lines={lines}
            onStreamError={() => setStreamBroken(true)}
          />
          <div className={`side-panel right-wrap${presentation ? " side-hidden" : ""}`}>
            <ForensicPanel
              score={risk?.score ?? 0}
              riskText={riskText || "—"}
              riskColor={riskColor}
              verdict={risk?.verdict ?? ""}
              validation={validation}
              chips={validationChips(target, validation)}
              evidence={evidenceItems(report)}
              scanning={validation === "validating"}
              showSimulateError={import.meta.env.DEV}
              canExport={report !== null}
              onSimulateError={() => setForceInvalid(true)}
              onCopy={(value) => {
                void navigator.clipboard?.writeText(value);
              }}
              onExportJson={() => {
                if (report) download("phantasm-report.json", JSON.stringify(report, null, 2), "application/json");
              }}
              onExportPdf={() => {
                if (report) download("phantasm-report.pdf", reportText(report), "text/plain");
              }}
            />
          </div>
        </div>
        <GraphPanel graph={graph} riskColor={riskColor} />
        <MetricsRow graph={graph} riskText={riskText} />
      </main>
      <Footer version={__PHANTASM_CORE_VERSION__} />
    </div>
  );
}

function createReplayStore(): InvestigationStore {
  const store = createInvestigationStore();
  store.getState().setMode("replay");
  return store;
}

function selectTarget(targets: Record<string, TargetState>): TargetState | null {
  const list = Object.values(targets).sort((a, b) => a.id.localeCompare(b.id));
  return list.find((item) => item.status === "running") ?? list.find((item) => item.phaseIndex >= 0) ?? list[0] ?? null;
}

function resolveReport(target: TargetState | null, status: "created" | "running" | "completed" | "cancelled" | null): TargetReport | null {
  if (!target) return null;
  if (target.report) return target.report;
  if (status === "completed") return reportForTarget(target.id);
  return null;
}

function agentPill(status: "created" | "running" | "completed" | "cancelled" | null): {
  text: "IDLE" | "RUNNING" | "COMPLETE";
  className: "status-idle" | "status-running" | "status-complete";
} {
  if (status === "running") return { text: "RUNNING", className: "status-running" };
  if (status === "completed") return { text: "COMPLETE", className: "status-complete" };
  return { text: "IDLE", className: "status-idle" };
}

function moduleCards(
  state: ReturnType<InvestigationStore["getState"]>,
  target: TargetState | null,
): ModuleCardModel[] {
  const views = moduleViews(state).filter((view) => view.targetId === target?.id);
  return MODULES.map((moduleName) => {
    const view = views.find((item) => item.module === moduleName);
    const status = view?.status ?? "idle";
    const summary = target?.modules[moduleName]?.summary ?? null;
    const timing =
      status === "idle" ? "Waiting" : status === "active" ? "Executing..." : status === "skipped" ? "Skipped" : formatDuration(view?.durationMs ?? null);
    return {
      id: moduleName,
      status,
      timing,
      description: MODULE_COPY[moduleName],
      result: status === "done" ? summary : null,
      progress: status === "active" ? 60 : status === "done" ? 100 : null,
      steps:
        moduleName === "agent" && target && status !== "idle"
          ? target.steps.map((step) => ({ label: step.purpose, checked: true }))
          : null,
    };
  });
}

function formatDuration(durationMs: number | null): string {
  if (durationMs === null) return "Done";
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function elapsedLabel(startedAt: string | null, log: SentinelEvent[]): string {
  const last = log[log.length - 1]?.ts;
  if (!startedAt || !last) return "0.0s";
  const ms = Math.max(0, Date.parse(last) - Date.parse(startedAt));
  return `${(ms / 1000).toFixed(1)}s`;
}

function toLines(events: SentinelEvent[], rows: ReturnType<typeof logLines>): TerminalLine[] {
  return rows.map((row, index) => {
    const event = events[index];
    return {
      id: String(event?.seq ?? index),
      time: row.time,
      tag: row.tag,
      tone: row.tag === "FINISH" ? "ok" : row.tag === "THREAT" ? "risk" : row.tag === "TRACE" ? "warn" : "info",
      module: MODULE_LABEL[row.module] ?? row.module,
      message: row.message,
    };
  });
}

function alertMessages(
  log: SentinelEvent[],
  halts: Array<{ reason: string }>,
): string[] {
  const messages = halts.map((halt) => halt.reason);
  for (const event of log) {
    if (event.type === "TargetFailed") messages.push(event.message);
  }
  return messages;
}

function validationState(target: TargetState | null, forceInvalid: boolean): ValidationState {
  if (forceInvalid) return "invalid";
  if (target?.validation) return "validated";
  if (target?.phase === "validate_payload") return "validating";
  return "waiting";
}

function validationChips(target: TargetState | null, validation: ValidationState): ValidationChip[] {
  return EVIDENCE_LABELS.map((label, index) => {
    const field = target?.validation?.checks[index];
    if (validation === "invalid") return { label, status: "failed" };
    if (validation === "validating") return { label, status: "checking" };
    if (!field) return { label, status: "pending" };
    return { label, status: field.passed ? "passed" : "failed" };
  });
}

function evidenceItems(report: TargetReport | null): EvidenceItem[] {
  if (!report) {
    return EVIDENCE_LABELS.map((label) => ({ label, value: "—", severity: "empty" }));
  }
  return report.evidence.map((row) => ({
    label: row.label,
    value: row.value,
    severity: row.severity,
  }));
}

function displayAddress(streamingUrl: string | null, target: TargetState | null): string {
  const raw = streamingUrl || target?.url || "";
  return raw.replace(/^https?:\/\//, "");
}

function reportText(report: TargetReport): string {
  const lines = [
    "PHANTASM-WEB FORENSIC REPORT",
    `Target: ${report.host}`,
    `Risk: ${report.risk.score} / ${report.risk.label} RISK`,
    `Verdict: ${report.risk.verdict}`,
    "",
    ...report.evidence.map((row) => `${row.label}: ${row.value}`),
  ];
  return lines.join("\n");
}

function download(filename: string, contents: string, type: string): void {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(new Blob([contents], { type }));
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}
