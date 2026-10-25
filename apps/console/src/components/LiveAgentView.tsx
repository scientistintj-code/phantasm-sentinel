import { LuLock, LuMonitor } from "react-icons/lu";
import { PHASES, type PivotState } from "@phantasm/core";
import { Panel } from "./Panel";
import { Stepper } from "./Stepper";
import { StreamFrame, simulatedStream } from "./StreamFrame";
import { Terminal, type TerminalLine } from "./Terminal";
import type { TargetTabModel } from "../viewState";

export function LiveAgentView({
  targets,
  selectedTargetId,
  address,
  mode,
  streamingUrl,
  streamOrigins,
  phaseIndex,
  complete,
  lines,
  pivots,
  onSelectTarget,
  onApprovePivot,
  onDismissPivot,
}: {
  targets: TargetTabModel[];
  selectedTargetId: string | "all";
  address: string;
  mode: "live" | "replay";
  streamingUrl: string | null;
  streamOrigins: readonly string[];
  phaseIndex: number;
  complete: boolean;
  lines: TerminalLine[];
  pivots: PivotState[];
  onSelectTarget: (targetId: string | "all") => void;
  onApprovePivot: (pivotId: string) => void;
  onDismissPivot: (pivotId: string) => void;
}) {
  const runPhase = PHASES[phaseIndex] ?? null;
  const simulated = simulatedStream(streamingUrl, streamOrigins, mode === "replay");
  return (
    <Panel title="LIVE AGENT VIEW" icon={LuMonitor} className="center-panel">
      <div className="target-tabs" role="tablist" aria-label="Targets">
        <button
          type="button"
          role="tab"
          aria-selected={selectedTargetId === "all"}
          className={`target-tab${selectedTargetId === "all" ? " is-selected" : ""}`}
          onClick={() => onSelectTarget("all")}
        >
          All targets
        </button>
        {targets.map((target) => (
          <button
            type="button"
            role="tab"
            key={target.id}
            aria-selected={selectedTargetId === target.id}
            className={`target-tab${selectedTargetId === target.id ? " is-selected" : ""}${target.status === "failed" ? " is-failed" : ""}`}
            onClick={() => onSelectTarget(target.id)}
          >
            <i className={`status-dot status-dot-${target.dot}`} />
            <span>{target.label}</span>
            {target.failureMessage ? <span className="tab-failure">{target.failureMessage}</span> : null}
          </button>
        ))}
      </div>
      <div className="browser">
        <div className="browser-bar">
          <div className="traffic">
            <i />
            <i />
            <i />
          </div>
          <div className="address">
            <LuLock size={13} />
            {address}
          </div>
          {mode === "live" && !simulated ? (
            <span className="live">
              <i />
              LIVE
            </span>
          ) : (
            <span className="replay-badge">REPLAY</span>
          )}
        </div>
        <div className="browser-body">
          <StreamFrame
            streamingUrl={streamingUrl}
            origins={streamOrigins}
            recorded={mode === "replay"}
            host={address}
            runPhase={runPhase}
          />
        </div>
      </div>
      <Stepper phaseIndex={phaseIndex} complete={complete} />
      <Terminal lines={lines} resetKey={selectedTargetId} />
      {pivots.length > 0 ? (
        <div className="pivot-row" aria-label="Pivot suggested">
          {pivots.map((pivot) => (
            <div className="pivot-chip" key={pivot.pivotId}>
              <b>Pivot Suggested</b>
              <code>{pivot.query}</code>
              <button type="button" onClick={() => onApprovePivot(pivot.pivotId)}>
                Approve
              </button>
              <button type="button" onClick={() => onDismissPivot(pivot.pivotId)}>
                Dismiss
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </Panel>
  );
}
