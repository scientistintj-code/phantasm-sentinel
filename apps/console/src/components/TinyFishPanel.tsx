import type { IconType } from "react-icons";
import { LuBot, LuCheck, LuFileJson, LuFingerprint, LuKeyRound, LuRadio, LuSearch, LuWorkflow } from "react-icons/lu";
import { Panel } from "./Panel";

export interface ModuleCardModel {
  id: "search" | "fetch" | "agent" | "vault" | "profiles";
  status: "idle" | "active" | "done" | "skipped";
  timing: string;
  description: string;
  result: string | null;
  progress: number | null;
  steps: Array<{ label: string; checked: boolean }> | null;
}

const ICONS: Record<ModuleCardModel["id"], IconType> = {
  search: LuSearch,
  fetch: LuFileJson,
  agent: LuBot,
  vault: LuKeyRound,
  profiles: LuFingerprint,
};

const NAMES: Record<ModuleCardModel["id"], string> = {
  search: "TinySearch",
  fetch: "TinyFetch",
  agent: "TinyAgent",
  vault: "TinyVault",
  profiles: "TinyProfiles",
};

export function TinyFishPanel({
  modules,
  elapsed,
  sseConnected,
  keyState,
}: {
  modules: ModuleCardModel[];
  elapsed: string;
  sseConnected: boolean;
  keyState: string;
}) {
  const done = modules.filter((module) => module.status === "done").length;
  return (
    <Panel title="POWERED BY TINYFISH" icon={LuWorkflow} className="tinyfish-panel">
      <div className={`module-counter ${done === modules.length && modules.length > 0 ? "complete" : ""}`}>
        <span>Modules executed</span>
        <strong>
          {done}/5 {done === 5 ? "Complete" : null}
        </strong>
      </div>
      <div className="module-list">
        {modules.map((module) => {
          const Icon = ICONS[module.id];
          return (
            <div className={`module-card module-${module.status}`} key={module.id}>
              <div className="module-icon">
                <Icon size={14} />
              </div>
              <div className="module-content">
                <div className="module-name">
                  <strong>{NAMES[module.id]}</strong>
                  <em>{module.timing}</em>
                </div>
                <span>{module.description}</span>
                {module.steps && module.status !== "idle" ? (
                  <div className="agent-steps">
                    {module.steps.map((step) => (
                      <small className={step.checked ? "checked" : ""} key={step.label}>
                        {step.checked ? <LuCheck size={8} /> : <i />}
                        {step.label}
                      </small>
                    ))}
                  </div>
                ) : null}
                {module.status === "done" && module.result ? (
                  <p className="module-result">
                    <LuCheck size={9} />
                    {module.result}
                  </p>
                ) : null}
                {module.status === "active" && module.progress !== null ? (
                  <div className="module-progress">
                    <i style={{ width: `${module.progress}%` }} />
                  </div>
                ) : null}
              </div>
              <i className="module-status">{module.status === "done" ? <LuCheck size={7} /> : null}</i>
            </div>
          );
        })}
      </div>
      <div className="execution-timeline">
        <div className="timeline-head">
          <span>Execution Timeline</span>
          <b>{elapsed}</b>
        </div>
        <div className="timeline-track">
          {modules.map((module) => (
            <span title={`${NAMES[module.id]} · ${module.timing}`} key={module.id}>
              <i style={{ width: `${module.progress ?? (module.status === "done" ? 100 : 0)}%` }} />
            </span>
          ))}
        </div>
      </div>
      <div className={`tiny-badges ${sseConnected ? "is-active" : ""}`}>
        <span>
          <LuFingerprint size={11} /> Stealth Fingerprint: <b>READY</b>
        </span>
        <span>
          <LuRadio size={11} /> SSE Stream /run-sse: <b>{sseConnected ? "CONNECTED" : "STANDBY"}</b>
        </span>
      </div>
      <div className="api-row">
        <div>
          <small>TinyFish API Key</small>
          <code>················</code>
        </div>
        <span>
          <i />
          {keyState}
        </span>
      </div>
    </Panel>
  );
}
