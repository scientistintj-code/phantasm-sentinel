"use client";

import { createApiClient, type TargetReport, type VerifyResult } from "@phantasm/core";
import { Download } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  armDossierPrint,
  dossierDocument,
  dossierErrorMessage,
  dossierFileName,
  loadDossier,
  type CaseBundleV1,
  type DossierClient,
} from "@/lib/dossier";
import { hmacStatus } from "@/lib/ledger";
import { StateMessage } from "./StateMessage";

function severityClass(severity: TargetReport["evidence"][number]["severity"]): string {
  if (severity === "safe") return "badge badge-healthy";
  if (severity === "medium") return "badge badge-cooling";
  return "badge badge-invalid";
}

function downloadBundle(caseId: string, bundle: CaseBundleV1): void {
  const blob = new Blob([dossierDocument(bundle)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = dossierFileName(caseId);
  link.click();
  URL.revokeObjectURL(url);
}

function ReportSection({ report }: { report: TargetReport }) {
  return (
    <section className="dossier-block" aria-labelledby={`report-${report.target_id}`}>
      <h2 id={`report-${report.target_id}`}>
        {report.host} <span className="muted">{report.target_id}</span>
      </h2>
      <p>
        {report.risk.label} {report.risk.score}/100 · coverage {report.risk.evidence_coverage}
      </p>
      <p>{report.risk.verdict}</p>
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Evidence</th>
            <th scope="col">Value</th>
            <th scope="col">Severity</th>
            <th scope="col">Source</th>
          </tr>
        </thead>
        <tbody>
          {report.evidence.map((row) => (
            <tr key={row.field}>
              <th scope="row">{row.label}</th>
              <td>{row.value}</td>
              <td>
                <span className={severityClass(row.severity)}>{row.severity}</span>
              </td>
              <td>{row.source}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function LedgerSection({ ledger }: { ledger: VerifyResult }) {
  return (
    <section className="dossier-block" aria-labelledby="ledger-head-title">
      <h2 id="ledger-head-title">Ledger</h2>
      <p>
        Head <code>{ledger.head_hash}</code>
      </p>
      <p>
        Verification status: {ledger.ok ? "intact" : "failed"}. {hmacStatus(ledger.signature_ok)}.{" "}
        {ledger.entries_checked} entries checked.
      </p>
      {ledger.first_broken_seq !== undefined ? <p>First broken seq {ledger.first_broken_seq}.</p> : null}
      {ledger.reason !== undefined ? <p>{ledger.reason}</p> : null}
    </section>
  );
}

export function Dossier({
  caseId,
  replay = false,
  autoPrint = false,
  methodology,
  client,
}: {
  caseId: string;
  replay?: boolean;
  autoPrint?: boolean;
  methodology: string;
  client?: DossierClient;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [bundle, setBundle] = useState<CaseBundleV1 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setBundle(null);
    loadDossier(api, caseId, replay)
      .then((model) => {
        if (!active) return;
        setBundle(model.bundle);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(dossierErrorMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, caseId, replay]);

  useEffect(() => {
    if (!autoPrint || bundle === null) return;
    armDossierPrint(`${caseId}|print`, () => window.print());
  }, [autoPrint, bundle, caseId]);

  const record = bundle?.case;
  const verify = bundle?.ledger;

  return (
    <article className="dossier-sheet" aria-busy={loading}>
      <header className="dossier-cover">
        <p className="dossier-kicker">Case dossier</p>
        <h1>{record?.number ?? caseId}</h1>
        {record ? (
          <>
            <p>{record.title}</p>
            <p>{record.status}</p>
            <time dateTime={record.created_at}>{record.created_at}</time>
          </>
        ) : null}
        {replay ? <p className="badge">Replayed from recording</p> : null}
      </header>
      <div className="dossier-actions">
        <button
          type="button"
          className="btn"
          onClick={() => {
            if (bundle) downloadBundle(caseId, bundle);
          }}
          disabled={loading || bundle === null}
        >
          <Download aria-hidden="true" size={16} strokeWidth={1.5} />
          Download JSON bundle
        </button>
      </div>
      {loading ? <StateMessage kind="loading">Loading dossier.</StateMessage> : null}
      {error ? (
        <p className="muted" role="alert">
          {error}
        </p>
      ) : null}
      {bundle
        ? bundle.reports.map((report) => <ReportSection key={report.target_id} report={report} />)
        : null}
      {bundle && bundle.reports.length === 0 && error === null && !loading ? (
        <p className="muted">No target reports.</p>
      ) : null}
      {bundle ? (
        <section className="dossier-block" aria-labelledby="clusters-title">
          <h2 id="clusters-title">Clusters</h2>
          <p>Graph version {bundle.graph.version}</p>
          <p>{bundle.graph.insight}</p>
          {bundle.graph.clusters.length === 0 ? <p className="muted">No clusters.</p> : null}
          {bundle.graph.clusters.map((cluster) => (
            <article key={cluster.id}>
              <h3>{cluster.id}</h3>
              <p>Confidence {cluster.confidence}</p>
              <p>Members {cluster.members.join(", ")}</p>
              <p>{cluster.explanation}</p>
            </article>
          ))}
        </section>
      ) : null}
      {verify ? (
        <LedgerSection
          ledger={{
            ok: verify.ok,
            entries_checked: verify.entries_checked,
            head_hash: verify.head_hash,
            signature_ok: verify.signature_ok,
            ...(verify.first_broken_seq !== undefined
              ? { first_broken_seq: verify.first_broken_seq }
              : {}),
            ...(verify.reason !== undefined ? { reason: verify.reason } : {}),
          }}
        />
      ) : null}
      <section className="dossier-block" aria-labelledby="methodology-title">
        <h2 id="methodology-title">Methodology</h2>
        <p className="dossier-weights">{methodology}</p>
      </section>
    </article>
  );
}
