import { ApiError, type ApiClient, type CaseRecord, type Graph, type TargetReport } from "@phantasm/core";

import { targetIds } from "./dossier";

export type CaseListClient = Pick<ApiClient, "listCases" | "getGraph" | "getReport">;

export type CaseOverviewClient = Pick<ApiClient, "getCase" | "getGraph" | "getReport">;

export type RiskLabel = "LOW" | "MEDIUM" | "HIGH";

export interface RiskScore {
  score: number;
  label: RiskLabel;
}

export interface CaseListRow {
  id: string;
  number: string;
  title: string;
  status: CaseRecord["status"];
  targets: number;
  riskLabel: RiskLabel | null;
  run: "LIVE" | "REPLAY";
  createdAt: string;
}

export interface CaseOverviewModel {
  record: CaseRecord;
  targetCount: number;
  clusters: Graph["clusters"];
  riskLabel: RiskLabel | null;
}

const RISK_ORDER: Record<RiskLabel, number> = { LOW: 0, MEDIUM: 1, HIGH: 2 };

export function requestErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail ?? error.title;
  return fallback;
}

export function caseRunBadge(replay: boolean): "LIVE" | "REPLAY" {
  return replay ? "REPLAY" : "LIVE";
}

export function casePath(caseId: string, replay: boolean, leaf?: "ledger" | "dossier"): string {
  const encoded = encodeURIComponent(caseId);
  const path = leaf === undefined ? `/cases/${encoded}` : `/cases/${encoded}/${leaf}`;
  return replay ? `${path}?replay=1` : path;
}

export function consolePath(caseId: string): string {
  return `/console/?case=${encodeURIComponent(caseId)}`;
}

export function riskBadgeClass(label: RiskLabel): string {
  if (label === "LOW") return "badge badge-healthy";
  if (label === "MEDIUM") return "badge badge-cooling";
  return "badge badge-invalid";
}

export function runBadgeClass(run: "LIVE" | "REPLAY"): string {
  return run === "LIVE" ? "badge badge-healthy" : "badge badge-cooling";
}

/** Highest stored score, then HIGH over MEDIUM over LOW when scores tie. */
export function highestRiskLabel(risks: readonly RiskScore[]): RiskLabel | null {
  let best: RiskScore | null = null;
  for (const risk of risks) {
    if (
      best === null ||
      risk.score > best.score ||
      (risk.score === best.score && RISK_ORDER[risk.label] > RISK_ORDER[best.label])
    ) {
      best = risk;
    }
  }
  return best === null ? null : best.label;
}

function isMissing(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

async function readGraph(client: Pick<ApiClient, "getGraph">, caseId: string): Promise<Graph | null> {
  try {
    return await client.getGraph(caseId);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readReport(
  client: Pick<ApiClient, "getReport">,
  caseId: string,
  targetId: string,
): Promise<TargetReport | null> {
  try {
    return await client.getReport(caseId, targetId);
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
}

async function readRisks(
  client: Pick<ApiClient, "getReport">,
  caseId: string,
  ids: readonly string[],
): Promise<RiskScore[]> {
  const reports = await Promise.all(ids.map((targetId) => readReport(client, caseId, targetId)));
  const risks: RiskScore[] = [];
  for (const report of reports) {
    if (!report) continue;
    risks.push({ score: report.risk.score, label: report.risk.label });
  }
  return risks;
}

export async function loadCaseRows(client: CaseListClient, replay: boolean): Promise<CaseListRow[]> {
  const records = await client.listCases();
  const run = caseRunBadge(replay);
  const rows: CaseListRow[] = [];
  for (const record of records) {
    const graph = await readGraph(client, record.id);
    const ids = graph ? targetIds(graph, []) : [];
    const risks = await readRisks(client, record.id, ids);
    rows.push({
      id: record.id,
      number: record.number,
      title: record.title,
      status: record.status,
      targets: ids.length,
      riskLabel: highestRiskLabel(risks),
      run,
      createdAt: record.created_at,
    });
  }
  return rows;
}

export async function loadCaseOverview(
  client: CaseOverviewClient,
  caseId: string,
): Promise<CaseOverviewModel> {
  const record = await client.getCase(caseId);
  const graph = await readGraph(client, caseId);
  const ids = graph ? targetIds(graph, []) : [];
  const risks = await readRisks(client, caseId, ids);
  return {
    record,
    targetCount: ids.length,
    clusters: graph?.clusters ?? [],
    riskLabel: highestRiskLabel(risks),
  };
}
