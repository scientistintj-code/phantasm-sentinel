import { LuScan } from "react-icons/lu";
import { PresentationMode } from "./PresentationMode";

export function Topbar({
  agentStatus,
  agentClass,
  mode,
  presentation,
  onTogglePresentation,
}: {
  agentStatus: "IDLE" | "RUNNING" | "COMPLETE";
  agentClass: "status-idle" | "status-running" | "status-complete";
  mode: "live" | "replay";
  presentation: boolean;
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
        <div className={`mode-badge mode-badge-${mode}`}>{mode === "live" ? "LIVE" : "REPLAY"}</div>
        <PresentationMode active={presentation} onToggle={onTogglePresentation} />
      </div>
    </header>
  );
}
