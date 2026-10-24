import type {
  CaseSnapshot,
  Graph,
  Indicator,
  TargetReport,
  TargetState,
  VerifyResult,
} from "@phantasm/core";
import type { EvidenceItem, ValidationChip, ValidationState } from "./components/ForensicPanel";

export const RISK_COLOR = { LOW: "#25d492", MEDIUM: "#f5b942", HIGH: "#fb5262" } as const;

export const PDF_DISABLED_REASON = "Available after a case exists";

const EVIDENCE_FIELDS = [
  ["merchant_id", "Merchant ID"],
  ["gateway", "Gateway"],
  ["payment_endpoint", "Payment Endpoint"],
  ["host_ip", "Host IP"],
  ["domain_age", "Domain Age"],
  ["ssl_issuer", "SSL Issuer"],
  ["suspicious_scripts", "Suspicious Scripts"],
  ["redirect_chain", "Redirect Chain"],
] as const;

export interface ExportBundle {
  mode: "live" | "replay";
  case: CaseSnapshot | null;
  target: TargetState | null;
  report: TargetReport | null;
  validation: TargetState["validation"];
  indicators: Indicator[];
  graph: Graph | null;
  ledger_head: VerifyResult | null;
}

export function dossierUrl(mode: "live" | "replay", caseId: string): string {
  const id = encodeURIComponent(caseId);
  if (mode === "replay") return `/replay/cases/${id}/dossier?print=1`;
  return `/cases/${id}/dossier?print=1`;
}

export function buildExportBundle(input: {
  mode: "live" | "replay";
  case: CaseSnapshot | null;
  target: TargetState | null;
  report: TargetReport | null;
  graph: Graph | null;
  ledgerHead: VerifyResult | null;
}): ExportBundle {
  return {
    mode: input.mode,
    case: input.case,
    target: input.target,
    report: input.report,
    validation: input.target?.validation ?? null,
    indicators: input.target?.indicators ?? [],
    graph: input.graph,
    ledger_head: input.ledgerHead,
  };
}

export function evidenceRows(report: TargetReport | null): EvidenceItem[] {
  if (!report) {
    return EVIDENCE_FIELDS.map(([, label]) => ({ label, value: "—", severity: "empty" }));
  }
  return report.evidence.map((row) => ({
    label: row.label,
    value: row.value,
    severity: row.severity,
  }));
}

export function validationView(
  target: Pick<TargetState, "phase" | "validation"> | null,
  forceInvalid: boolean,
): { state: ValidationState; chips: ValidationChip[] } {
  const checks = target?.validation?.checks ?? null;
  let state: ValidationState = "waiting";
  if (forceInvalid) state = "invalid";
  else if (checks) state = checks.some((check) => !check.passed) ? "invalid" : "validated";
  else if (target?.phase === "validate_payload") state = "validating";

  const chips = EVIDENCE_FIELDS.map(([field, label]) => {
    const check = checks?.find((row) => row.field === field);
    if (state === "validating" && !check) return { label, status: "checking" as const };
    if (!check) return { label, status: "pending" as const };
    if (!check.passed) return { label, status: "failed" as const, reason: check.reason };
    return { label, status: "passed" as const };
  });
  return { state, chips };
}

export async function copyText(value: string): Promise<void> {
  const clipboard = navigator.clipboard;
  if (clipboard && typeof clipboard.writeText === "function") {
    try {
      await clipboard.writeText(value);
      return;
    } catch {
      // Fall through to the textarea path when the async clipboard API rejects.
    }
  }
  const area = document.createElement("textarea");
  area.value = value;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  const copied = document.execCommand("copy");
  area.remove();
  if (!copied) throw new Error("copy failed");
}

export function download(filename: string, contents: string, type: string): void {
  const link = document.createElement("a");
  const objectUrl = URL.createObjectURL(new Blob([contents], { type }));
  link.href = objectUrl;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(objectUrl);
}
