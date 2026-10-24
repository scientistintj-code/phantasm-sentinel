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
import { StatusBanners } from "./components/StatusBanners";
import type { TerminalLine } from "./components/Terminal";
import { TinyFishPanel } from "./components/TinyFishPanel";
import { Topbar } from "./components/Topbar";
import { loadConfig } from "./config";
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
  buildModuleCards,
  chipLabel,
  clampParallel,
  connectionLabel,
  deployAllowed,
  deployLive,
  elapsedLabel,
  errorText,
  followedTarget,
  logViewState,
  presetUrls,
  stepperView,
  suggestedFocus,
} from "./mission";
import { attachCase, caseFileHref, caseIdFromSearch, displayHost, keyPoolBanner, targetTabs, visiblePivots } from "./viewState";

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
  const config = useState(() => loadConfig())[0];
  const store = useState(() => createConsoleStore(config.defaultMode))[0];
  const client = useState(() => createApiClient({ baseUrl: config.apiBase }))[0];
  const state = useStore(store);
  const [mode, setMode] = useState(config.defaultMode);
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
  const [keys, setKeys] = useState<KeyHealth[]>(config.defaultMode === "replay" ? labKeys : []);
  const [poolKeys, setPoolKeys] = useState<KeyHealth[] | null>(null);
  const [liveEnabled, setLiveEnabled] = useState(true);
  const [hiddenPivots, setHiddenPivots] = useState<ReadonlySet<string>>(() => new Set());
  const [forceInvalid, setForceInvalid] = useState(false);
  const [graph, setGraph] = useState<Graph | null>(null);
  const retryRef = useRef<(() => void) | null>(null);
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
    const caseId = caseIdFromSearch(window.location.search);
    if (!caseId) return;
    caseIdRef.current = caseId;
    setDeployState("running");
    const session = attachCase({ client, store, caseId });
    streamStopRef.current = session.stopStream;
    return () => {
      session.stopStream();
      if (streamStopRef.current === session.stopStream) streamStopRef.current = null;
    };
  }, [client, store]);

  useEffect(() => {
    if (mode === "replay") setKeys(labKeys);
    else if (poolKeys) setKeys(poolKeys);
    let stopped = false;
    const load = () => {
      client
        .getKeyHealth()
        .then((rows) => {
          if (stopped) return;
          setLiveEnabled(true);
          setPoolKeys(rows);
          if (mode === "live") setKeys(rows);
        })
        .catch(() => {
          if (stopped) return;
          setLiveEnabled(false);
          if (!caseIdRef.current) {
            setMode("replay");
            store.getState().setMode("replay");
            setKeys(labKeys);
          }
        });
    };
    load();
    const timer = setInterval(load, KEY_POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [client, mode, store]);

  const suggestion = suggestedFocus(targets);
  const presets = presetUrls(mode, config.labUrls).map((preset) => ({
    url: preset,
    label: chipLabel(preset),
  }));
  const canDeploy = deployAllowed({ investigator, authorized, targetCount: targets.length });
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
  const caseId = state.case?.id ?? caseIdRef.current;
  const riskText = risk?.text ?? "";
  const riskColor = risk ? RISK_COLOR[risk.label] : "#74869b";
  const validation = validationView(followed, forceInvalid);
  const agent = agentPill(state.case?.status ?? null);
  const streamingUrl = followed?.streamingUrl ?? null;
  const togglesEnabled = config.agentToggles;
  const keyNotice = keyPoolBanner(poolKeys ?? []);
  const pivots = visiblePivots(state, selectedTargetId, hiddenPivots);

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
    retryRef.current = () => void startLive();
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
      retryRef.current = () => void startLive();
    }
  };

  const onMode = (next: "live" | "replay") => {
    if (next === "live" && !liveEnabled) return;
    if (next === mode) return;
    if (deployState === "running" || deployState === "deploying") return;
    setMode(next);
    store.getState().setMode(next);
    if (next === "replay") setKeys(labKeys);
  };

  const onApprovePivot = (pivotId: string) => {
    const id = state.case?.id ?? caseIdRef.current;
    if (!id) return;
    const run = async () => {
      try {
        await client.approvePivot(id, pivotId);
        if (!mountedRef.current) return;
        setHiddenPivots((current) => new Set(current).add(pivotId));
        setApiError(null);
      } catch (error) {
        if (!mountedRef.current) return;
        setApiError(errorText(error));
        retryRef.current = () => void run();
      }
    };
    void run();
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
      if (!mountedRef.current) return;
      setApiError(error instanceof ApiError ? error.message : "Request failed");
      retryRef.current = () => void onStop();
    }
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <Topbar
        agentStatus={agent.text}
        agentClass={agent.className}
        mode={mode}
        liveEnabled={liveEnabled}
        caseId={caseId}
        caseHref={caseId ? caseFileHref(caseId) : null}
        presentation={presentation}
        onMode={onMode}
        onTogglePresentation={() => setPresentation((value) => !value)}
      />
      <StatusBanners
        apiError={apiError}
        onRetry={() => retryRef.current?.()}
        reconnecting={state.connection === "reconnecting"}
        keyNotice={keyNotice}
      />
      <main id="main" tabIndex={-1} className={presentation ? "presentation" : ""}>
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
            targets={targetTabs(state)}
            selectedTargetId={selectedTargetId}
            address={displayHost(followed)}
            mode={mode}
            streamingUrl={streamingUrl}
            streamOrigins={config.streamOrigins}
            phaseIndex={phase.phaseIndex}
            complete={phase.complete}
            lines={lines}
            pivots={pivots}
            onSelectTarget={setSelectedTargetId}
            onApprovePivot={onApprovePivot}
            onDismissPivot={(pivotId) => setHiddenPivots((current) => new Set(current).add(pivotId))}
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
        card: event?.type === "SafetyHalt" ? "halt" : undefined,
      };
  });
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
