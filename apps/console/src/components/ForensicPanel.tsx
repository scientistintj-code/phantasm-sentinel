import { LuCheck, LuCopy, LuFileJson, LuFileText, LuShield, LuShieldAlert, LuTriangleAlert, LuX } from "react-icons/lu";
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
}

const VALIDATION_TEXT: Record<ValidationState, string> = {
  waiting: "Awaiting payload",
  validating: "Validating schema...",
  validated: "Schema Validated",
  invalid: "Validation Failed",
};

export function ForensicPanel({
  score,
  riskText,
  riskColor,
  verdict,
  validation,
  chips,
  evidence,
  scanning,
  showSimulateError,
  canExport,
  onSimulateError,
  onCopy,
  onExportJson,
  onExportPdf,
}: {
  score: number;
  riskText: string;
  riskColor: string;
  verdict: string;
  validation: ValidationState;
  chips: ValidationChip[];
  evidence: EvidenceItem[];
  scanning: boolean;
  showSimulateError: boolean;
  canExport: boolean;
  onSimulateError: () => void;
  onCopy: (value: string) => void;
  onExportJson: () => void;
  onExportPdf: () => void;
}) {
  return (
    <Panel title="FORENSIC INTELLIGENCE" icon={LuShieldAlert} className="right-panel">
      <div className="risk-wrap">
        <div className="risk-gauge" style={{ ["--risk" as string]: `${score * 3.6}deg`, ["--risk-color" as string]: riskColor }}>
          <div>
            <strong>{score}</strong>
            <small>/ 100</small>
          </div>
        </div>
        <div>
          <small>COMPOSITE RISK SCORE</small>
          <b style={{ color: riskColor }}>{riskText}</b>
          <span>{verdict ? "Confidence from report" : "Awaiting evidence"}</span>
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
              <span className={chip.status === "pending" ? "" : chip.status} key={chip.label}>
                {chip.status === "passed" ? <LuCheck size={8} /> : null}
                {chip.status === "failed" ? <LuX size={8} /> : null}
                {chip.status === "pending" || chip.status === "checking" ? <i /> : null}
                {chip.label}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div className={`evidence-list ${scanning ? "is-scanning" : ""}`}>
        {evidence.length === 0 ? <div className="empty-state">No evidence extracted</div> : null}
        {evidence.map((item) => (
          <div className="evidence" key={item.label}>
            <i className={item.severity === "high" ? "" : item.severity} />
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
        <button type="button" className="btn btn-ghost" disabled={!canExport} onClick={onExportJson}>
          <LuFileJson size={15} /> Export JSON
        </button>
        <button type="button" className="btn btn-ghost" disabled={!canExport} onClick={onExportPdf}>
          <LuFileText size={15} /> Export PDF
        </button>
      </div>
    </Panel>
  );
}
