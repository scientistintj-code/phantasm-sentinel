import { useEffect, useState } from "react";
import { LuCheck, LuCopy, LuFileJson, LuFileText, LuInfo, LuShield, LuShieldAlert, LuTriangleAlert, LuX } from "react-icons/lu";
import { copyText } from "../forensics";
import { Panel } from "./Panel";

export type ValidationState = "waiting" | "validating" | "validated" | "invalid";

export interface EvidenceItem {
  label: string;
  value: string;
  severity: "safe" | "medium" | "high" | "empty";
}

export interface ValidationChip {
  label: string;
  status: "pending" | "checking" | "passed" | "failed";
  reason?: string;
}

const VALIDATION_TEXT: Record<ValidationState, string> = {
  waiting: "Awaiting payload",
  validating: "Validating schema...",
  validated: "Schema Validated",
  invalid: "Validation Failed",
};

const COUNT_MS = 700;

export function ForensicPanel({
  score,
  riskText,
  riskColor,
  coverage,
  verdict,
  validation,
  chips,
  evidence,
  scanning,
  showSimulateError,
  canExportJson,
  canExportPdf,
  pdfDisabledReason,
  animateMs = COUNT_MS,
  onSimulateError,
  onExportJson,
  onExportPdf,
}: {
  score: number;
  riskText: string;
  riskColor: string;
  coverage: string;
  verdict: string;
  validation: ValidationState;
  chips: ValidationChip[];
  evidence: EvidenceItem[];
  scanning: boolean;
  showSimulateError: boolean;
  canExportJson: boolean;
  canExportPdf: boolean;
  pdfDisabledReason: string;
  animateMs?: number;
  onSimulateError: () => void;
  onExportJson: () => void;
  onExportPdf: () => void;
}) {
  const shown = useCountUp(score, animateMs);
  const [toast, setToast] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(false), 1600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const onCopy = (value: string) => {
    void copyText(value)
      .then(() => setToast(true))
      .catch(() => setToast(false));
  };

  return (
    <Panel title="FORENSIC INTELLIGENCE" icon={LuShieldAlert} className="right-panel">
      <div className="risk-wrap">
        <div
          className="risk-gauge"
          role="meter"
          aria-label="Composite risk score"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={shown}
          style={{ ["--risk" as string]: `${shown * 3.6}deg`, ["--risk-color" as string]: riskColor }}
        >
          <div>
            <strong>{shown}</strong>
            <small>/ 100</small>
          </div>
        </div>
        <div>
          <small>COMPOSITE RISK SCORE</small>
          <b style={{ color: riskColor }}>{riskText}</b>
          <span className="coverage-line">
            Evidence coverage {coverage}
            <span className="info-tip">
              <button type="button" aria-label="Score methodology">
                <LuInfo size={12} />
              </button>
              <span className="info-tooltip" role="tooltip">
                Heuristic score, not a legal finding. <a href="/methodology">Methodology</a>
              </span>
            </span>
          </span>
        </div>
      </div>
      <p className="verdict" style={{ ["--risk-color" as string]: riskColor }}>
        {verdict || "No evidence yet"}
      </p>
      <div className={`validation-block validation-${validation}`}>
        <div className="validated">
          <span className="validation-icon">
            {validation === "waiting" ? <LuShield size={15} /> : null}
            {validation === "validating" ? <LuShield className="shield-spin" size={15} /> : null}
            {validation === "validated" ? <LuCheck className="validation-check" size={15} /> : null}
            {validation === "invalid" ? <LuX size={15} /> : null}
            {validation === "validated" ? (
              <span className="validation-particles">
                {Array.from({ length: 6 }, (_, index) => (
                  <i key={index} />
                ))}
              </span>
            ) : null}
          </span>
          <span>{VALIDATION_TEXT[validation]}</span>
          <small>v2.4</small>
        </div>
        <div className="validation-report">
          <div className="validation-report-head">
            <span>Validation Report</span>
            {showSimulateError ? (
              <button type="button" onClick={onSimulateError}>
                <LuTriangleAlert size={9} /> Simulate error
              </button>
            ) : null}
          </div>
          <div className="validation-chips">
            {chips.map((chip) => (
              <span className={chip.status === "pending" ? "" : chip.status} key={chip.label} title={chip.reason}>
                {chip.status === "passed" ? <LuCheck size={8} /> : null}
                {chip.status === "failed" ? <LuX size={8} /> : null}
                {chip.status === "pending" || chip.status === "checking" ? <i /> : null}
                {chip.label}
                {chip.status === "failed" && chip.reason ? <em className="chip-reason">{chip.reason}</em> : null}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={`evidence-list ${scanning ? "is-scanning" : ""}`}>
        {evidence.length === 0 ? <div className="empty-state">No evidence extracted</div> : null}
        {evidence.map((item) => (
          <div className="evidence" key={item.label}>
            <i className={item.severity} />
            <div>
              <small>{item.label}</small>
              <strong>{item.value}</strong>
            </div>
            <button type="button" aria-label={`Copy ${item.label}`} onClick={() => onCopy(item.value)}>
              <LuCopy size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="export-row">
        <button type="button" className="btn btn-ghost" disabled={!canExportJson} onClick={onExportJson}>
          <LuFileJson size={15} /> Export JSON
        </button>
        <span className="export-slot">
          <button type="button" className="btn btn-ghost" disabled={!canExportPdf} onClick={onExportPdf}>
            <LuFileText size={15} /> Export PDF
          </button>
          {canExportPdf ? null : (
            <span className="export-tooltip" role="tooltip">
              {pdfDisabledReason}
            </span>
          )}
        </span>
      </div>
      {toast ? (
        <div className="copy-toast" role="status">
          Copied
        </div>
      ) : null}
    </Panel>
  );
}

function useCountUp(target: number, duration: number): number {
  const [value, setValue] = useState(duration <= 0 ? target : 0);

  useEffect(() => {
    const reduce =
      typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (duration <= 0 || reduce) {
      setValue(target);
      return;
    }
    let frame = 0;
    const start = performance.now();
    setValue(0);
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) frame = window.requestAnimationFrame(step);
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [target, duration]);

  return value;
}
