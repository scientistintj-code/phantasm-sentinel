import {
  ApiError,
  type ApiClient,
  type CaseRecord,
  type Graph,
  type LedgerEntry,
  type SentinelEvent,
  type TargetReport,
  type VerifyResult,
} from "@phantasm/core";

import { loadLedgerEntries } from "./ledger";

export const CASE_BUNDLE_SCHEMA = "phantasm.case.v1" as const;

/** Used only when sentinel/graph/risk.py cannot be read. */
export const FALLBACK_SEVERITY_WEIGHTS = { safe: 0, medium: 8, high: 16 } as const;

const LEADS = "Findings are leads requiring verification.";

export type DossierClient = Pick<
  ApiClient,
  "getCase" | "getGraph" | "getLedger" | "getReport" | "verifyLedger"
>;

export interface CaseBundleV1 {
  schema: typeof CASE_BUNDLE_SCHEMA;
  case: CaseRecord;
  replayed_from_recording: boolean;
  reports: TargetReport[];
  graph: {
    version: number;
    insight: string;
    clusters: Graph["clusters"];
  };
  ledger: {
    head_hash: string;
    ok: boolean;
    entries_checked: number;
    signature_ok: boolean;
    first_broken_seq?: number;
    reason?: string;
  };
}

export interface DossierModel {
  bundle: CaseBundleV1;
}

export function isPrintQuery(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1";
}

function eventTargetId(event: SentinelEvent): string | null {
  if ("target_id" in event && typeof event.target_id === "string" && event.target_id !== "") {
    return event.target_id;
  }
  return null;
}

export function targetIds(graph: Graph, entries: readonly LedgerEntry[]): string[] {
  const ids = new Set<string>();
  for (const node of graph.nodes) {
    if (node.target_id) ids.add(node.target_id);
  }
  for (const cluster of graph.clusters) {
    for (const member of cluster.members) ids.add(member);
  }
  for (const entry of entries) {
    const id = eventTargetId(entry.payload);
    if (id) ids.add(id);
  }
  return [...ids].sort((a, b) => a.localeCompare(b));
}

function braceDelta(line: string): number {
  const code = line.split("#")[0] ?? "";
  const open = code.match(/\{/g)?.length ?? 0;
  const close = code.match(/\}/g)?.length ?? 0;
  return open - close;
}

/** Assignment blocks whose names mention weight or severity, braces included. */
export function extractHeuristicBlocks(source: string): string {
  const lines = source.split(/\n/);
  const chunks: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    if (!/^[A-Za-z_]/.test(trimmed)) continue;
    if (!/weight|severity/i.test(trimmed)) continue;
    if (!trimmed.includes("=") && !trimmed.includes("{")) continue;
    let block = line;
    let depth = braceDelta(line);
    let cursor = index;
    while (depth > 0 && cursor + 1 < lines.length) {
      cursor += 1;
      const next = lines[cursor] ?? "";
      block += `\n${next}`;
      depth += braceDelta(next);
    }
    if (depth === 0 && block.includes("{")) {
      chunks.push(block.trim());
      index = cursor;
    }
  }
  return chunks.join("\n\n");
}

export function methodologyFromSource(source: string | null): string {
  const intro = "Heuristic risk weights implemented in sentinel/graph/risk.py:";
  if (source) {
    const blocks = extractHeuristicBlocks(source);
    if (blocks !== "") return `${intro}\n${blocks}\n${LEADS}`;
  }
  const weights = FALLBACK_SEVERITY_WEIGHTS;
  return `${intro} safe ${weights.safe}, medium ${weights.medium}, high ${weights.high}.\n${LEADS}`;
}

function ledgerView(verify: VerifyResult): CaseBundleV1["ledger"] {
  const ledger: CaseBundleV1["ledger"] = {
    head_hash: verify.head_hash,
    ok: verify.ok,
    entries_checked: verify.entries_checked,
    signature_ok: verify.signature_ok,
  };
  if (verify.first_broken_seq !== undefined) ledger.first_broken_seq = verify.first_broken_seq;
  if (verify.reason !== undefined) ledger.reason = verify.reason;
  return ledger;
}

export function caseBundle(
  record: CaseRecord,
  graph: Graph,
  reports: readonly TargetReport[],
  verify: VerifyResult,
  replay: boolean,
): CaseBundleV1 {
  return {
    schema: CASE_BUNDLE_SCHEMA,
    case: record,
    replayed_from_recording: replay,
    reports: [...reports].sort((a, b) => a.target_id.localeCompare(b.target_id)),
    graph: {
      version: graph.version,
      insight: graph.insight,
      clusters: graph.clusters,
    },
    ledger: ledgerView(verify),
  };
}

export function dossierDocument(bundle: CaseBundleV1): string {
  return JSON.stringify(bundle, null, 2);
}

export function dossierFileName(caseId: string): string {
  const safe = caseId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `case-${safe}.phantasm.case.v1.json`;
}

export function dossierErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.title;
  return "Dossier request failed.";
}

export async function loadDossier(
  client: DossierClient,
  caseId: string,
  replay: boolean,
): Promise<DossierModel> {
  const [record, graph, entries, verify] = await Promise.all([
    client.getCase(caseId),
    client.getGraph(caseId),
    loadLedgerEntries(client, caseId),
    client.verifyLedger(caseId),
  ]);
  const ids = targetIds(graph, entries);
  const reports = await Promise.all(ids.map((targetId) => client.getReport(caseId, targetId)));
  return { bundle: caseBundle(record, graph, reports, verify, replay) };
}

const armedPrints = new Set<string>();

function fontsReady(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  const ready = document.fonts?.ready;
  if (ready === undefined) return Promise.resolve();
  return Promise.resolve(ready)
    .then(() => undefined)
    .catch(() => undefined);
}

/** Schedules window.print once per key, after document.fonts.ready. */
export function armDossierPrint(key: string, print: () => void): void {
  if (armedPrints.has(key)) return;
  armedPrints.add(key);
  void fontsReady().then(print);
}

export function clearDossierPrints(): void {
  armedPrints.clear();
}
