"use client";

import { createApiClient, type ApiClient } from "@phantasm/core";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  casePath,
  caseRunBadge,
  consolePath,
  loadCaseOverview,
  requestErrorMessage,
  riskBadgeClass,
  runBadgeClass,
  type CaseOverviewModel,
} from "@/lib/cases";
import { dossierDocument, dossierFileName, loadDossier, type DossierClient } from "@/lib/dossier";

import { StateMessage } from "./StateMessage";

function downloadBundle(caseId: string, body: string, filename: string): void {
  const blob = new Blob([body], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function CaseOverview({
  caseId,
  replay = false,
  client,
}: {
  caseId: string;
  replay?: boolean;
  client?: DossierClient;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [model, setModel] = useState<CaseOverviewModel | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);
  const run = caseRunBadge(replay);

  useEffect(() => {
    const previous = document.title;
    document.title = model
      ? `${model.record.number} · Phantasm Sentinel`
      : "Case · Phantasm Sentinel";
    return () => {
      document.title = previous;
    };
  }, [model]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setModel(null);
    setExportError(null);
    loadCaseOverview(api, caseId)
      .then((next) => {
        if (!active) return;
        setModel(next);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(requestErrorMessage(reason, "Case request failed."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, caseId]);

  async function onExport(dossier: DossierClient & Pick<ApiClient, "getCase">): Promise<void> {
    setExporting(true);
    setExportError(null);
    try {
      const loaded = await loadDossier(dossier, caseId, replay);
      downloadBundle(caseId, dossierDocument(loaded.bundle), dossierFileName(caseId));
    } catch (reason: unknown) {
      setExportError(requestErrorMessage(reason, "Export failed."));
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="case-title" aria-busy={loading}>
      <h1 id="case-title" className="panel-title">
        {model?.record.number ?? "CASE"}
        <i />
      </h1>
      {model ? (
        <p>
          {model.record.title} · {model.record.status} ·{" "}
          <time dateTime={model.record.created_at}>{model.record.created_at}</time>
        </p>
      ) : null}
      <p>
        <span className={runBadgeClass(run)}>{run}</span>
      </p>
      <div className="ledger-actions">
        <a className="btn" href={consolePath(caseId)}>
          Open in console
        </a>
        <a className="btn" href={casePath(caseId, replay, "ledger")}>
          Ledger
        </a>
        <a className="btn" href={casePath(caseId, replay, "dossier")}>
          Dossier
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => void onExport(api)}
          disabled={loading || model === null || exporting}
          aria-busy={exporting}
        >
          <Download aria-hidden="true" size={16} strokeWidth={1.5} />
          Export JSON
        </button>
      </div>
      {loading ? <StateMessage kind="loading">Loading case.</StateMessage> : null}
      {error ? <StateMessage kind="error">{error}</StateMessage> : null}
      {exportError ? <StateMessage kind="error">{exportError}</StateMessage> : null}
      {model ? (
        <>
          <div className="stat-grid">
            <section className="stat-tile" aria-label="Targets">
              <span>Targets</span>
              <strong>{model.targetCount}</strong>
            </section>
            <section className="stat-tile" aria-label="Clusters">
              <span>Clusters</span>
              <strong>{model.clusters.length}</strong>
            </section>
            <section className="stat-tile" aria-label="Highest risk">
              <span>Highest risk</span>
              {model.riskLabel ? (
                <strong>
                  <span className={riskBadgeClass(model.riskLabel)}>{model.riskLabel}</span>
                </strong>
              ) : (
                <strong className="muted">none</strong>
              )}
            </section>
          </div>
          {model.targetCount === 0 ? <StateMessage kind="empty">No targets.</StateMessage> : null}
          <div>
            <h2 id="clusters-title" className="panel-title">
              CLUSTERS
              <i />
            </h2>
            {model.clusters.length === 0 ? (
              <StateMessage kind="empty">No clusters.</StateMessage>
            ) : (
              <ol className="cluster-list">
                {model.clusters.map((cluster) => (
                  <li key={cluster.id}>
                    <p>{cluster.explanation}</p>
                    <p className="muted">
                      {cluster.id} · {cluster.members.join(", ") || "no members"} · confidence{" "}
                      {cluster.confidence}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </>
      ) : null}
    </section>
  );
}
