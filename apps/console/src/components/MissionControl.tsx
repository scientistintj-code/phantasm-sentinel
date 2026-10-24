import { useState } from "react";
import { LuGlobe, LuRocket, LuShieldCheck } from "react-icons/lu";
import type { ReplaySpeed } from "@phantasm/core";
import { Panel } from "./Panel";

export type DeployState = "idle" | "deploying" | "running" | "complete";

export function MissionControl({
  url,
  targets,
  urlHint,
  presets,
  suggestion,
  focus,
  parallel,
  investigator,
  authorized,
  canDeploy,
  deployState,
  mode,
  speed,
  togglesEnabled,
  onUrl,
  onAddUrl,
  onRemoveTarget,
  onPreset,
  onApplySuggestion,
  onFocus,
  onParallel,
  onInvestigator,
  onAuthorized,
  onDeploy,
  onSpeed,
}: {
  url: string;
  targets: readonly string[];
  urlHint: string | null;
  presets: readonly { url: string; label: string }[];
  suggestion: string;
  focus: string;
  parallel: number;
  investigator: string;
  authorized: boolean;
  canDeploy: boolean;
  deployState: DeployState;
  mode: "live" | "replay";
  speed: ReplaySpeed;
  togglesEnabled: boolean;
  onUrl: (value: string) => void;
  onAddUrl: () => void;
  onRemoveTarget: (url: string) => void;
  onPreset: (url: string) => void;
  onApplySuggestion: (value: string) => void;
  onFocus: (value: string) => void;
  onParallel: (value: number) => void;
  onInvestigator: (value: string) => void;
  onAuthorized: (value: boolean) => void;
  onDeploy: () => void;
  onSpeed: (value: ReplaySpeed) => void;
}) {
  const locked = deployState !== "idle";
  const deployClass =
    deployState === "running" ? "is-running" : deployState === "complete" ? "is-complete" : deployState === "deploying" ? "is-deploying" : "";
  const deployDisabled = deployState === "deploying" || deployState === "complete" || (deployState === "idle" && !canDeploy);
  return (
    <Panel title="MISSION CONTROL" icon={LuRocket} className="left-panel">
      <label htmlFor="target-url">Target scam URL</label>
      <div className="input-wrap">
        <LuGlobe size={16} />
        <input
          id="target-url"
          value={url}
          placeholder="https://suspicious-site.example"
          disabled={locked}
          onChange={(event) => onUrl(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              onAddUrl();
            }
          }}
        />
      </div>
      {targets.length > 0 ? (
        <div className="target-chips" aria-label="Targets">
          {targets.map((target) => (
            <span className="target-chip" key={target} title={target}>
              <span>{chipText(target)}</span>
              <button type="button" aria-label={`Remove ${target}`} disabled={locked} onClick={() => onRemoveTarget(target)}>
                ×
              </button>
            </span>
          ))}
        </div>
      ) : null}
      {urlHint ? (
        <p className="url-hint" role="status">
          {urlHint}
        </p>
      ) : null}
      {suggestion ? (
        <button type="button" className="suggest-chip" disabled={locked} onClick={() => onApplySuggestion(suggestion)}>
          <b>Suggested focus</b>
          {suggestion}
        </button>
      ) : null}
      {presets.length > 0 ? (
        <div className="preset-grid">
          {presets.map((preset) => (
            <button type="button" key={preset.url} disabled={locked} onClick={() => onPreset(preset.url)}>
              <LuGlobe size={14} />
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      <label htmlFor="investigation-focus">Investigation focus (optional)</label>
      <textarea
        id="investigation-focus"
        rows={4}
        maxLength={300}
        value={focus}
        disabled={locked}
        onChange={(event) => onFocus(event.target.value)}
      />
      <span className="char-count">
        {focus.length}/300
      </span>
      <div className="slider-label">
        <span>max {parallel} by key pool</span>
        <b>{parallel}</b>
      </div>
      <input
        className="range"
        type="range"
        min={1}
        max={5}
        value={parallel}
        aria-label="max_parallel"
        disabled={locked}
        onChange={(event) => onParallel(Number(event.target.value))}
      />
      {/* VERIFY: investigate does not accept stealth or proxy until TINYFISH_FACTS confirms those fields. */}
      <div className="toggle-list">
        <AgentToggle label="Stealth fingerprinting" enabled={togglesEnabled} />
        <AgentToggle label="Residential proxy" enabled={togglesEnabled} />
      </div>
      <label htmlFor="investigator-name">Investigator name</label>
      <input
        id="investigator-name"
        className="plain-input"
        value={investigator}
        disabled={locked}
        onChange={(event) => onInvestigator(event.target.value)}
      />
      <label className="auth-line">
        <input
          className="auth-check"
          type="checkbox"
          checked={authorized}
          disabled={locked}
          onChange={(event) => onAuthorized(event.target.checked)}
        />
        <span>I am authorized to investigate these targets</span>
      </label>
      <button type="button" className={`btn deploy ${deployClass}`.trim()} disabled={deployDisabled} onClick={onDeploy}>
        {deployState === "running" ? <i className="stop-dot" /> : <LuRocket size={18} />}
        {deployLabel(deployState)}
      </button>
      {mode === "replay" ? (
        <div className="speed-row" role="group" aria-label="Replay speed">
          {([1, 2, 4, 8] as const).map((value) => (
            <button
              type="button"
              key={value}
              className={speed === value ? "is-selected" : ""}
              aria-pressed={speed === value}
              onClick={() => onSpeed(value)}
            >
              {value}x
            </button>
          ))}
        </div>
      ) : null}
      <p className="legal">
        <LuShieldCheck size={13} /> Authorized investigation only. Test credentials only. No real payments.
      </p>
    </Panel>
  );
}

function deployLabel(deployState: DeployState): string {
  if (deployState === "deploying") return "DEPLOYING";
  if (deployState === "running") return "STOP AGENT";
  if (deployState === "complete") return "MISSION COMPLETE";
  return "DEPLOY AGENT";
}

function chipText(url: string): string {
  try {
    const parsed = new URL(url);
    const path = `${parsed.pathname}${parsed.search}`;
    if (path === "/" || path === "") return parsed.host;
    return `${parsed.host}${path}`;
  } catch {
    return url;
  }
}

function AgentToggle({ label, enabled }: { label: string; enabled: boolean }) {
  const [on, setOn] = useState(false);
  if (!enabled) {
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
          Managed by Tiny Fish
        </span>
      </span>
    );
  }
  return (
    <button type="button" className="toggle-row" aria-pressed={on} onClick={() => setOn((value) => !value)}>
      <span>{label}</span>
      <span className="toggle-control">
        <small>{on ? "ON" : "OFF"}</small>
        <span className={`switch${on ? " on" : ""}`}>
          <i />
        </span>
      </span>
    </button>
  );
}
