import { LuLock, LuMonitor } from "react-icons/lu";
import type { TargetState } from "@phantasm/core";
import { Panel } from "./Panel";
import { Stepper } from "./Stepper";
import { Terminal, type TerminalLine } from "./Terminal";

export function LiveAgentView({
  targets,
  selectedTargetId,
  address,
  live,
  streamingUrl,
  phaseIndex,
  complete,
  lines,
  onSelectTarget,
  onStreamError,
}: {
  targets: TargetState[];
  selectedTargetId: string | "all";
  address: string;
  live: boolean;
  streamingUrl: string | null;
  phaseIndex: number;
  complete: boolean;
  lines: TerminalLine[];
  onSelectTarget: (targetId: string | "all") => void;
  onStreamError: () => void;
}) {
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
            className={`target-tab${selectedTargetId === target.id ? " is-selected" : ""}`}
            onClick={() => onSelectTarget(target.id)}
          >
            <i className={`status-dot status-dot-${target.status}`} />
            {target.host || target.id}
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
          {live ? (
            <span className="live">
              <i />
              LIVE
            </span>
          ) : null}
        </div>
        <div className="browser-body">
          <div className="scanline" />
          {streamingUrl ? (
            <iframe
              key={streamingUrl}
              title="Live agent stream"
              src={streamingUrl}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              onError={onStreamError}
              style={{ width: "100%", height: "100%", border: 0, position: "relative", zIndex: 1 }}
            />
          ) : (
            <div className="empty-state">Awaiting live stream</div>
          )}
        </div>
      </div>
      <Stepper phaseIndex={phaseIndex} complete={complete} />
      <Terminal lines={lines} resetKey={selectedTargetId} />
    </Panel>
  );
}
