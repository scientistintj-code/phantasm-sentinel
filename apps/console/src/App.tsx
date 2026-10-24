import { useEffect, useMemo, useRef, useState } from "react";
import { useStore } from "zustand";
import {
  ApiError,
  ReplayDriver,
  createApiClient,
  createInvestigationStore,
  logLines,
  type Graph,
  type InvestigationStore,
  type KeyHealth,
  type ReplaySpeed,
  type SentinelEvent,
  type TargetReport,
  type TargetState,
  type VerifyResult,
} from "@phantasm/core";
import { Footer } from "./components/Footer";
import { ForensicPanel } from "./components/ForensicPanel";
import { GraphPanel } from "./components/GraphPanel";
import { LiveAgentView } from "./components/LiveAgentView";
import { MetricsRow } from "./components/MetricsRow";
import { MissionControl, type DeployState } from "./components/MissionControl";
import type { TerminalLine } from "./components/Terminal";
import { TinyFishPanel } from "./components/TinyFishPanel";
import { Topbar } from "./components/Topbar";
import { labCaseText, labGraph, labKeys, reportForTarget } from "./fixtures";
import {
  PDF_DISABLED_REASON,
  RISK_COLOR,
  buildExportBundle,
  dossierUrl,
  download,
  evidenceRows,
  validationView,
} from "./forensics";
import { useButtonRipple } from "./hooks/useButtonRipple";
import {
  FOCUS_CAP,
  addTargetUrl,
  agentTogglesEnabled,
  buildModuleCards,
  chipLabel,
  clampParallel,
  connectionLabel,
  consoleMode,
  deployLive,
  elapsedLabel,
  errorText,
  followedTarget,
  logViewState,
  presetUrls,
  stepperView,
  suggestedFocus,
} from "./mission";

const MODULE_LABEL: Record<string, string> = {
  search: "TinySearch",
  fetch: "TinyFetch",
  agent: "TinyAgent",
  vault: "TinyVault",
  profiles: "TinyProfiles",
  infra: "Infra",
};

const KEY_POLL_MS = 5000;

export function App() {
  const mode = consoleMode();
  const store = useState(() => createConsoleStore(mode))[0];
  const client = useState(() => createApiClient())[0];
  const state = useStore(store);
  const driverRef = useRef<ReplayDriver | null>(null);
  const streamStopRef = useRef<(() => void) | null>(null);
  const caseIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [presentation, setPresentation] = useState(false);
  const [url, setUrl] = useState("");
  const [targets, setTargets] = useState<string[]>([]);
  const [urlHint, setUrlHint] = useState<string | null>(null);
  const [focus, setFocus] = useState("");
  const [parallel, setParallel] = useState(1);
  const [investigator, setInvestigator] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [deployState, setDeployState] = useState<DeployState>("idle");
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [apiError, setApiError] = useState<string | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | "all">("all");
  const [keys, setKeys] = useState<KeyHealth[]>(mode === "replay" ? labKeys : []);
  const [forceInvalid, setForceInvalid] = useState(false);
  const [streamBroken, setStreamBroken] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  useButtonRipple();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      driverRef.current?.pause();
      streamStopRef.current?.();
    };
  }, []);

  useEffect(() => {
    if (state.case?.status === "completed") setDeployState("complete");
  }, [state.case?.status]);

  useEffect(() => {
    if (selectedTargetId !== "all" && !state.targets[selectedTargetId]) setSelectedTargetId("all");
  }, [selectedTargetId, state.targets]);

  useEffect(() => {
    setStreamBroken(false);
  }, [selectedTargetId]);

  useEffect(() => {
    const id = state.case?.id;
    if (state.graphVersion <= 0 || !id) {
      setGraph(null);
      return;
    }
    if (mode === "replay") {
      setGraph(labGraph);
      return;
    }
    let cancelled = false;
    client
      .getGraph(id)
      .then((next) => {
        if (!cancelled) setGraph(next);
      })
      .catch(() => {
        // A failed refetch keeps the last drawn graph.
      });
    return () => {
      cancelled = true;
    };
  }, [client, mode, state.case?.id, state.graphVersion]);

  useEffect(() => {
    if (mode === "replay") {
      setKeys(labKeys);
      return;
    }
    let stopped = false;
    const load = () => {
      client
        .getKeyHealth()
        .then((rows) => {
          if (!stopped) setKeys(rows);
        })
        .catch(() => {
          // Key material is never rendered. A failed poll keeps the last squares.
        });
    };
    load();
    const timer = setInterval(load, KEY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client, mode]);

  const suggestion = suggestedFocus(targets);
  const presets = presetUrls(mode, import.meta.env.VITE_LAB_URLS).map((preset) => ({
    url: preset,
    label: chipLabel(preset),
  }));
  const canDeploy = investigator.trim() !== "" && authorized && targets.length > 0;
  const targetList = Object.values(state.targets);
  const followed = followedTarget(state, selectedTargetId);
  const report = resolveReport(followed, state.case?.status ?? null, mode);
  const risk = report
    ? {
        score: report.risk.score,
        text: `${report.risk.label} RISK` as const,
        label: report.risk.label,
        verdict: report.risk.verdict,
      }
    : null;
  const phase = stepperView(state, selectedTargetId);
  const view = logViewState(state, selectedTargetId);
  const lines = useMemo(() => toLines(view.log, logLines(view)), [view]);
  const modules = useMemo(() => buildModuleCards(state, selectedTargetId), [state, selectedTargetId]);
  const alerts = alertMessages(state, selectedTargetId);
  const caseId = state.case?.id ?? null;
  const riskText = risk?.text ?? "";
  const riskColor = risk ? RISK_COLOR[risk.label] : "#74869b";
  const validation = validationView(followed, forceInvalid);
  const agent = agentPill(state.case?.status ?? null);
  const streamingUrl = streamBroken ? null : (followed?.streamingUrl ?? null);
  const togglesEnabled = agentTogglesEnabled();

  const addUrl = (raw: string) => {
    const next = addTargetUrl(targets, raw);
    setTargets(next.urls);
    setUrlHint(next.hint);
    if (next.hint === null && next.urls.length > targets.length) setUrl("");
  };

  const onDeploy = () => {
    if (deployState === "running") {
      void onStop();
      return;
    }
    if (deployState !== "idle" || !canDeploy) return;
    setApiError(null);
    if (mode === "replay") {
      startReplay();
      return;
    }
    void startLive();
  };

  const startReplay = () => {
    if (!driverRef.current) {
      const driver = new ReplayDriver(labCaseText, store);
      driver.onEnd(() => {
        store.getState().setConnection("closed");
        if (mountedRef.current) setDeployState("complete");
      });
      driverRef.current = driver;
    }
    driverRef.current.setSpeed(speed);
    store.getState().setConnection("live");
    setDeployState("running");
    driverRef.current.play();
  };

  const startLive = async () => {
    setDeployState("deploying");
    try {
      const session = await deployLive({
        client,
        store,
        investigator,
        urls: targets,
        maxParallel: clampParallel(parallel),
        focus,
      });
      if (!mountedRef.current) {
        session.stopStream();
        return;
      }
      streamStopRef.current = session.stopStream;
      caseIdRef.current = session.caseId;
      setDeployState("running");
      if (session.rejected.length > 0) setApiError(session.rejected.join("; "));
    } catch (error) {
      if (!mountedRef.current) return;
      setDeployState("idle");
      setApiError(errorText(error));
    }
  };

  const onStop = async () => {
    if (mode === "replay") {
      driverRef.current?.pause();
      setDeployState("idle");
      return;
    }
    const caseId = caseIdRef.current;
    try {
      if (caseId) await client.cancelCase(caseId);
      streamStopRef.current?.();
      streamStopRef.current = null;
      store.getState().setConnection("closed");
      if (mountedRef.current) setDeployState("idle");
    } catch (error) {
      if (mountedRef.current) setApiError(error instanceof ApiError ? error.message : "Request failed");
    }
  };

  return (
    <div className="app-shell">
      <Topbar
        agentStatus={agent.text}
        agentClass={agent.className}
        mode={state.mode}
        presentation={presentation}
        onTogglePresentation={() => setPresentation((value) => !value)}
      />
      {apiError ? (
        <p className="error-banner" role="alert">
          <span>{apiError}</span>
          {deployState === "idle" ? (
            <button type="button" onClick={() => void startLive()}>
              Retry
            </button>
          ) : null}
        </p>
      ) : null}
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
              targets={targets}
              urlHint={urlHint}
              presets={presets}
              suggestion={suggestion}
              focus={focus}
              parallel={parallel}
              investigator={investigator}
              authorized={authorized}
              canDeploy={canDeploy}
              deployState={deployState}
              mode={mode}
              speed={speed}
              togglesEnabled={togglesEnabled}
              onUrl={setUrl}
              onAddUrl={() => addUrl(url)}
              onRemoveTarget={(target) => setTargets((current) => current.filter((item) => item !== target))}
              onPreset={(preset) => addUrl(preset)}
              onApplySuggestion={(value) => setFocus(value.slice(0, FOCUS_CAP))}
              onFocus={setFocus}
              onParallel={(value) => setParallel(clampParallel(value))}
              onInvestigator={setInvestigator}
              onAuthorized={setAuthorized}
              onDeploy={onDeploy}
              onSpeed={(value) => {
                setSpeed(value);
                driverRef.current?.setSpeed(value);
              }}
            />
            <TinyFishPanel
              modules={modules.cards}
              executed={modules.executed}
              elapsed={elapsedLabel(state.case?.startedAt ?? null, state.log[state.log.length - 1]?.ts)}
              connection={connectionLabel(state.connection)}
              keys={keys}
            />
          </div>
          <LiveAgentView
            targets={targetList}
            selectedTargetId={selectedTargetId}
            address={displayAddress(streamingUrl, followed)}
            live={state.case?.status === "running" || state.connection === "live"}
            streamingUrl={streamingUrl}
            phaseIndex={phase.phaseIndex}
            complete={phase.complete}
            lines={lines}
            onSelectTarget={setSelectedTargetId}
            onStreamError={() => setStreamBroken(true)}
          />
          <div className={`side-panel right-wrap${presentation ? " side-hidden" : ""}`}>
            <ForensicPanel
              score={risk?.score ?? 0}
              riskText={riskText || "—"}
              riskColor={riskColor}
              coverage={report?.risk.evidence_coverage ?? "0/8"}
              verdict={risk?.verdict ?? ""}
              validation={validation.state}
              chips={validation.chips}
              evidence={evidenceRows(report)}
              scanning={validation.state === "validating"}
              showSimulateError={import.meta.env.DEV}
              canExportJson={caseId !== null || report !== null}
              canExportPdf={caseId !== null}
              pdfDisabledReason={PDF_DISABLED_REASON}
              onSimulateError={() => setForceInvalid(true)}
              onExportJson={() => {
                void exportBundle({
                  mode,
                  caseId,
                  client,
                  snapshot: state.case,
                  target: followed,
                  report,
                  graph,
                });
              }}
              onExportPdf={() => {
                if (!caseId) return;
                const opened = window.open(dossierUrl(mode, caseId), "_blank", "noopener,noreferrer");
                if (opened) opened.opener = null;
              }}
            />
          </div>
        </div>
        <GraphPanel graph={graph} riskColor={riskColor} onSelectTarget={setSelectedTargetId} />
        <MetricsRow graph={graph} />
      </main>
      <Footer version={__PHANTASM_CORE_VERSION__} />
    </div>
  );
}

function createConsoleStore(mode: "live" | "replay"): InvestigationStore {
  const store = createInvestigationStore();
  store.getState().setMode(mode);
  return store;
}

function resolveReport(
  target: TargetState | null,
  status: "created" | "running" | "completed" | "cancelled" | null,
  mode: "live" | "replay",
): TargetReport | null {
  if (!target) return null;
  if (target.report) return target.report;
  if (mode === "replay" && status === "completed") return reportForTarget(target.id);
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

function alertMessages(state: ReturnType<InvestigationStore["getState"]>, targetId: string | "all"): string[] {
  const messages = state.safetyHalts
    .filter((halt) => targetId === "all" || halt.targetId === targetId || halt.targetId === null)
    .map((halt) => halt.reason);
  for (const event of state.log) {
    if (event.type !== "TargetFailed") continue;
    if (targetId !== "all" && event.target_id !== targetId) continue;
    messages.push(event.message);
  }
  return messages;
}

function displayAddress(streamingUrl: string | null, target: TargetState | null): string {
  const raw = streamingUrl || target?.url || "";
  return raw.replace(/^https?:\/\//, "");
}

async function exportBundle(input: {
  mode: "live" | "replay";
  caseId: string | null;
  client: { verifyLedger(caseId: string): Promise<VerifyResult> };
  snapshot: ReturnType<InvestigationStore["getState"]>["case"];
  target: TargetState | null;
  report: TargetReport | null;
  graph: Graph | null;
}): Promise<void> {
  let ledgerHead: VerifyResult | null = null;
  if (input.mode === "live" && input.caseId) {
    try {
      ledgerHead = await input.client.verifyLedger(input.caseId);
    } catch {
      ledgerHead = null;
    }
  }
  const bundle = buildExportBundle({
    mode: input.mode,
    case: input.snapshot,
    target: input.target,
    report: input.report,
    graph: input.graph,
    ledgerHead,
  });
  download(`phantasm-${input.caseId ?? "case"}.json`, JSON.stringify(bundle, null, 2), "application/json");
}
