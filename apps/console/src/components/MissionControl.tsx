import { LuGlobe, LuRocket, LuShieldCheck } from "react-icons/lu";
import { Panel } from "./Panel";

export type DeployState = "idle" | "running" | "complete";

export function MissionControl({
  url,
  goal,
  parallel,
  onUrl,
  onGoal,
  onParallel,
  deployState,
  onDeploy,
}: {
  url: string;
  goal: string;
  parallel: number;
  onUrl: (value: string) => void;
  onGoal: (value: string) => void;
  onParallel: (value: number) => void;
  deployState: DeployState;
  onDeploy: () => void;
}) {
  const deployClass = deployState === "running" ? "is-running" : deployState === "complete" ? "is-complete" : "";
  return (
    <Panel title="MISSION CONTROL" icon={LuRocket} className="left-panel">
      <label>Target scam URL</label>
      <div className="input-wrap">
        <LuGlobe size={16} />
        <input
          value={url}
          placeholder="https://suspicious-site.example"
          onChange={(event) => onUrl(event.target.value)}
        />
      </div>
      <label>Investigation goal</label>
      <textarea rows={4} maxLength={300} value={goal} onChange={(event) => onGoal(event.target.value)} />
      <div className="slider-label">
        <span>Parallel agents</span>
        <b>{parallel}</b>
      </div>
      <input
        className="range"
        type="range"
        min={1}
        max={5}
        value={parallel}
        onChange={(event) => onParallel(Number(event.target.value))}
      />
      <div className="toggle-list">
        <DisabledToggle label="Stealth fingerprinting" />
        <DisabledToggle label="Residential proxy" />
      </div>
      <button type="button" className={`btn deploy ${deployClass}`.trim()} onClick={onDeploy}>
        {deployState === "running" ? <i className="stop-dot" /> : <LuRocket size={18} />}
        {deployState === "running" ? "STOP AGENT" : deployState === "complete" ? "MISSION COMPLETE" : "DEPLOY AGENT"}
      </button>
      <p className="legal">
        <LuShieldCheck size={13} /> Authorized investigation only. Test credentials only. No real payments.
      </p>
    </Panel>
  );
}

function DisabledToggle({ label }: { label: string }) {
  return (
    <span className="toggle-disabled">
      <button type="button" className="toggle-row is-disabled" disabled>
        <span>{label}</span>
        <span className="toggle-control">
          <small>OFF</small>
          <span className="switch">
            <i />
          </span>
        </span>
      </button>
      <span className="toggle-tooltip" role="tooltip">
        Not sent on investigate
      </span>
    </span>
  );
}
