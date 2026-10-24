import { LuScan } from "react-icons/lu";
import { PresentationMode } from "./PresentationMode";

export function Topbar({
  agentStatus,
  agentClass,
  mode,
  liveEnabled,
  caseId,
  caseHref,
  presentation,
  onMode,
  onTogglePresentation,
}: {
  agentStatus: "IDLE" | "RUNNING" | "COMPLETE";
  agentClass: "status-idle" | "status-running" | "status-complete";
  mode: "live" | "replay";
  liveEnabled: boolean;
  caseId: string | null;
  caseHref: string | null;
  presentation: boolean;
  onMode: (mode: "live" | "replay") => void;
  onTogglePresentation: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-mark">
          <LuScan />
        </div>
        <div>
          <strong>
            PHANTASM<span>—WEB</span>
          </strong>
          <small>Unmasking Dynamic Cyber-Scam Infrastructure</small>
        </div>
      </div>
      <div className="top-meta">
        <div className={`status ${agentClass}`}>
          <i /> AGENT {agentStatus}
        </div>
        <div className="mode-switch" role="group" aria-label="Session mode">
          <button type="button" aria-pressed={mode === "replay"} onClick={() => onMode("replay")}>
            Replay
          </button>
          <button type="button" aria-pressed={mode === "live"} disabled={!liveEnabled} onClick={() => onMode("live")}>
            Live
          </button>
        </div>
        {caseId && caseHref ? (
          <a className="case-link" href={caseHref}>
            Open case file
          </a>
        ) : null}
        <PresentationMode active={presentation} onToggle={onTogglePresentation} />
      </div>
    </header>
  );
}
