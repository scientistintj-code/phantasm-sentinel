"use client";

import { createApiClient } from "@phantasm/core";
import { useEffect, useMemo, useState } from "react";

import {
  casePath,
  loadCaseRows,
  requestErrorMessage,
  riskBadgeClass,
  runBadgeClass,
  type CaseListClient,
  type CaseListRow,
} from "@/lib/cases";

import { StateMessage } from "./StateMessage";

export function CasesTable({
  replay = false,
  client,
}: {
  replay?: boolean;
  client?: CaseListClient;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [rows, setRows] = useState<CaseListRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setRows([]);
    loadCaseRows(api, replay)
      .then((next) => {
        if (!active) return;
        setRows(next);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(requestErrorMessage(reason, "Cases request failed."));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, replay]);

  return (
    <section className="panel" aria-labelledby="cases-title" aria-busy={loading}>
      <h1 id="cases-title" className="panel-title">
        CASES
        <i />
      </h1>
      {loading ? <StateMessage kind="loading">Loading cases.</StateMessage> : null}
      {error ? <StateMessage kind="error">{error}</StateMessage> : null}
      {!loading && error === null && rows.length === 0 ? (
        <div className="empty-action">
          <StateMessage kind="empty">No cases.</StateMessage>
          <a className="btn" href="/console/">
            Open in console
          </a>
        </div>
      ) : null}
      {!loading && error === null && rows.length > 0 ? (
        <table className="data-table">
          <thead>
            <tr>
              <th scope="col">Number</th>
              <th scope="col">Title</th>
              <th scope="col">Status</th>
              <th scope="col">Targets</th>
              <th scope="col">Highest risk</th>
              <th scope="col">Mode</th>
              <th scope="col">Created</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  <a href={casePath(row.id, replay)}>{row.number}</a>
                </td>
                <td>{row.title}</td>
                <td>{row.status}</td>
                <td>{row.targets}</td>
                <td>
                  {row.riskLabel ? (
                    <span className={riskBadgeClass(row.riskLabel)}>{row.riskLabel}</span>
                  ) : (
                    <span className="muted">none</span>
                  )}
                </td>
                <td>
                  <span className={runBadgeClass(row.run)}>{row.run}</span>
                </td>
                <td>
                  <time dateTime={row.createdAt}>{row.createdAt}</time>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </section>
  );
}
