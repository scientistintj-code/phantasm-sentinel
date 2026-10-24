import type { IconType } from "react-icons";
import { LuBot, LuCheck, LuFileJson, LuFingerprint, LuKeyRound, LuRadio, LuSearch, LuWorkflow } from "react-icons/lu";
import type { ModuleCardData } from "../mission";
import { keyPoolLabel } from "../mission";
import { Panel } from "./Panel";

export type ModuleCardModel = ModuleCardData;

const ICONS: Record<ModuleCardModel["id"], IconType> = {
  search: LuSearch,
  fetch: LuFileJson,
  agent: LuBot,
  vault: LuKeyRound,
  profiles: LuFingerprint,
};

const NAMES: Record<ModuleCardModel["id"], string> = {
  search: "Search",
  fetch: "Fetch",
  agent: "Agent",
  vault: "Vault",
  profiles: "Browser Context Profiles",
};

export interface KeySquare {
  label: string;
  state: "healthy" | "cooling" | "exhausted" | "invalid";
}

export function TinyFishPanel({
  modules,
  executed,
  elapsed,
  connection,
  keys,
}: {
  modules: ModuleCardModel[];
  executed: number;
  elapsed: string;
  connection: string;
  keys: KeySquare[];
}) {
  const streamLive = connection === "LIVE";
  const timed = modules.some((module) => module.span !== null);
  return (
    <Panel title="POWERED BY TINYFISH" icon={LuWorkflow} className="tinyfish-panel">
      <div className={`module-counter ${executed === 5 ? "complete" : ""}`}>
        <span>Modules executed</span>
        <strong>
          {executed}/5 {executed === 5 ? "Complete" : null}
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
                {module.steps && module.steps.length > 0 ? (
                  <div className="agent-steps">
                    {module.steps.map((step) => (
                      <small className={step.checked ? "checked" : ""} key={step.id}>
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
        <div className={`timeline-track${timed ? " timeline-real" : ""}`}>
          {modules.map((module) => (
            <span
              title={`${NAMES[module.id]} · ${module.timing}`}
              key={module.id}
              style={module.span ? { left: `${module.span.left}%`, width: `${module.span.width}%` } : undefined}
            >
              <i style={module.span ? undefined : { width: `${module.progress ?? 0}%` }} />
            </span>
          ))}
        </div>
      </div>
      <div className={`tiny-badges ${streamLive ? "is-active" : ""}`}>
        <span>
          <LuFingerprint size={11} /> Stealth Fingerprint: <b>READY</b>
        </span>
        <span>
          <LuRadio size={11} /> SSE Stream /run-sse: <b>{connection}</b>
        </span>
      </div>
      <div className="api-row">
        <div>
          <small>Key pool</small>
          <div className="key-pool">
            {keys.map((key, index) => {
              const label = keyPoolLabel(key.label, index);
              return (
                <span className={`key-square key-${key.state}`} key={`${label}-${index}`} title={key.state}>
                  {label}
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </Panel>
  );
}
