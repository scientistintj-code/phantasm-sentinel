import labCaseNdjson from "@phantasm/core/fixtures/lab-case.ndjson?raw";
import labGraphRaw from "@phantasm/core/fixtures/lab-graph.json?raw";
import labReportsRaw from "@phantasm/core/fixtures/lab-reports.json?raw";
import keysHealthRaw from "@phantasm/core/fixtures/keys-health.json?raw";
import { graphSchema, keyHealthListSchema, targetReportSchema, type Graph, type KeyHealth, type TargetReport } from "@phantasm/core";

export const labCaseText = labCaseNdjson;

export const labGraph: Graph = graphSchema.parse(JSON.parse(labGraphRaw));

function parseReports(raw: string): TargetReport[] {
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error("Lab reports fixture must be an array");
  }
  return parsed.map((row) => targetReportSchema.parse(row));
}

export const labReports: TargetReport[] = parseReports(labReportsRaw);

export const labKeys: KeyHealth[] = keyHealthListSchema.parse(JSON.parse(keysHealthRaw));

export function reportForTarget(targetId: string): TargetReport | null {
  return labReports.find((report) => report.target_id === targetId) ?? null;
}
