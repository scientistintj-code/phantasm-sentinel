"use client";

import { ApiError, createApiClient, type ApiClient, type LedgerEntry, type VerifyResult } from "@phantasm/core";
import { Download, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  firstBrokenSeq,
  hmacStatus,
  ledgerDocument,
  ledgerFileName,
  loadLedgerEntries,
  shortHash,
  tamperChain,
} from "@/lib/ledger";

declare global {
  interface ImportMeta {
    readonly env?: {
      readonly DEV?: boolean;
    };
  }
}

function showSimulateTamper(): boolean {
  return import.meta.env?.DEV === true || process.env.NODE_ENV === "development";
}

function failureMessage(error: unknown): string {
  if (error instanceof ApiError) return error.detail ?? error.title;
  return "Ledger request failed.";
}

function downloadLedger(caseId: string, entries: readonly LedgerEntry[]): void {
  const blob = new Blob([ledgerDocument(caseId, entries)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = ledgerFileName(caseId);
  link.click();
  URL.revokeObjectURL(url);
}

export function LedgerTab({
  caseId,
  replay = false,
  client,
}: {
  caseId: string;
  replay?: boolean;
  client?: ApiClient;
}) {
  const api = useMemo(() => client ?? createApiClient(), [client]);
  const [stored, setStored] = useState<LedgerEntry[]>([]);
  const [display, setDisplay] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [brokenSeq, setBrokenSeq] = useState<number | null>(null);
  const [seal, setSeal] = useState<number | null>(null);
  const [head, setHead] = useState<VerifyResult | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setStored([]);
    setDisplay([]);
    setBrokenSeq(null);
    setSeal(null);
    setHead(null);
    setVerifyError(null);
    loadLedgerEntries(api, caseId)
      .then((entries) => {
        if (!active) return;
        setStored(entries);
        setDisplay(entries);
      })
      .catch((reason: unknown) => {
        if (!active) return;
        setError(failureMessage(reason));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [api, caseId]);

  async function copyHash(hash: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(hash);
    } catch {
      setCopied(null);
    }
  }

  function simulateTamper(): void {
    const next = tamperChain(display);
    setDisplay(next.entries);
    setBrokenSeq(next.brokenSeq);
    setSeal(null);
    setVerifyError("Displayed chain link is broken. Stored ledger was not modified.");
  }

  async function verifyChain(): Promise<void> {
    setVerifying(true);
    setVerifyError(null);
    try {
      const result = await api.verifyLedger(caseId);
      const localBroken = firstBrokenSeq(display);
      setHead(result);
      if (localBroken !== null) {
        setBrokenSeq(localBroken);
        setSeal(null);
        setVerifyError("Displayed chain link is broken. Stored ledger was not modified.");
      } else if (!result.ok) {
        setBrokenSeq(result.first_broken_seq ?? null);
        setSeal(null);
        setVerifyError(result.reason ?? "Chain verification failed.");
      } else {
        setBrokenSeq(null);
        setSeal(result.entries_checked);
        setVerifyError(null);
      }
    } catch (reason: unknown) {
      setVerifyError(failureMessage(reason));
    } finally {
      setVerifying(false);
    }
  }

  const headHash = head?.head_hash ?? stored.at(-1)?.entry_hash ?? null;
  const signature = head === null ? null : head.signature_ok;
  const hmacClass =
    signature === true ? "badge badge-healthy" : signature === false ? "badge badge-invalid" : "badge";

  return (
    <section className="panel" aria-labelledby="ledger-title">
      <h1 id="ledger-title" className="panel-title">
        LEDGER
        <i />
      </h1>
      <div className="ledger-head">
        <code>{headHash ?? "none"}</code>
        {replay ? <span className="badge">Replayed from recording</span> : null}
        <span className={hmacClass}>{hmacStatus(signature)}</span>
      </div>
      <div className="ledger-actions">
        <button
          type="button"
          className="btn btn-accent"
          onClick={() => void verifyChain()}
          disabled={loading || verifying || error !== null}
          aria-busy={verifying}
        >
          <ShieldCheck aria-hidden="true" size={16} strokeWidth={1.5} />
          Verify chain
        </button>
        {showSimulateTamper() ? (
          <button
            type="button"
            className="btn"
            onClick={simulateTamper}
            disabled={loading || verifying || display.length === 0}
            title="Flips one displayed entry. Does not modify stored data."
          >
            Simulate tamper
          </button>
        ) : null}
        <button
          type="button"
          className="btn"
          onClick={() => downloadLedger(caseId, stored)}
          disabled={loading || stored.length === 0}
        >
          <Download aria-hidden="true" size={16} strokeWidth={1.5} />
          Export ledger (.json)
        </button>
      </div>
      {seal !== null ? (
        <p className="badge badge-healthy ledger-seal" role="status">
          <strong>INTACT</strong>
          <span>{seal} entries checked</span>
        </p>
      ) : null}
      {error ? <p className="muted">{error}</p> : null}
      {verifyError ? (
        <p className="muted" role="status">
          {verifyError}
        </p>
      ) : null}
      <div className={`ledger-chain-wrap${verifying ? " is-scanning" : ""}`} aria-busy={verifying}>
        {verifying ? <div className="ledger-scan" aria-hidden="true" /> : null}
        {loading ? <p className="muted">Loading ledger.</p> : null}
        {!loading && display.length === 0 && error === null ? (
          <p className="muted">No ledger entries.</p>
        ) : null}
        <ol className="ledger-chain">
          {display.map((entry) => {
            const broken = brokenSeq === entry.seq;
            return (
              <li
                key={entry.seq}
                data-seq={entry.seq}
                className={broken ? "ledger-entry ledger-entry-broken" : "ledger-entry"}
              >
                <span
                  className={broken ? "ledger-link ledger-link-broken" : "ledger-link"}
                  aria-hidden="true"
                />
                <span className="ledger-node" aria-hidden="true" />
                <div className="ledger-meta">
                  <span className="ledger-seq">{entry.seq}</span>
                  <time dateTime={entry.ts}>{entry.ts}</time>
                  <span>{entry.event_type}</span>
                  <button
                    type="button"
                    className="btn ledger-hash"
                    onClick={() => void copyHash(entry.entry_hash)}
                    aria-label={`Copy entry hash ${entry.entry_hash}`}
                  >
                    {shortHash(entry.entry_hash)}
                  </button>
                  {copied === entry.entry_hash ? <span className="badge">Copied</span> : null}
                </div>
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
