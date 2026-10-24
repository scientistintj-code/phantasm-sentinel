import type { ApiClient, LedgerEntry, VerifyResult } from "@phantasm/core";

export function shortHash(hash: string): string {
  return hash.slice(0, 10);
}

export function isReplayQuery(value: string | string[] | undefined): boolean {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === "1" || raw === "true" || raw === "recording";
}

export function hmacStatus(signatureOk: boolean | null): string {
  if (signatureOk === null) return "HMAC unverified";
  return signatureOk ? "HMAC valid" : "HMAC invalid";
}

export function ledgerFileName(caseId: string): string {
  const safe = caseId.replace(/[^a-zA-Z0-9._-]+/g, "_");
  return `ledger-${safe}.json`;
}

export function ledgerDocument(caseId: string, entries: readonly LedgerEntry[]): string {
  return JSON.stringify({ case_id: caseId, entries }, null, 2);
}

export function firstBrokenSeq(entries: readonly LedgerEntry[]): number | null {
  for (let index = 1; index < entries.length; index += 1) {
    const previous = entries[index - 1];
    const current = entries[index];
    if (!previous || !current) continue;
    if (current.prev_hash !== previous.entry_hash) return current.seq;
  }
  return null;
}

function flipHex(hash: string): string {
  const first = hash[0];
  if (first === undefined) return hash;
  const digit = first === "0" ? "1" : "0";
  return `${digit}${hash.slice(1)}`;
}

/** Flips one displayed entry. The input array and its objects are left unchanged. */
export function tamperChain(entries: readonly LedgerEntry[]): {
  entries: LedgerEntry[];
  brokenSeq: number | null;
} {
  const target = entries[0];
  if (!target) return { entries: [], brokenSeq: null };
  const next = entries.map((entry, index) =>
    index === 0 ? { ...entry, entry_hash: flipHex(entry.entry_hash) } : entry,
  );
  return { entries: next, brokenSeq: firstBrokenSeq(next) ?? target.seq };
}

export async function loadLedgerEntries(
  client: Pick<ApiClient, "getLedger">,
  caseId: string,
): Promise<LedgerEntry[]> {
  const entries: LedgerEntry[] = [];
  let cursor: string | undefined;
  const seen = new Set<string>();
  for (;;) {
    const page = await client.getLedger(caseId, cursor);
    entries.push(...page.entries);
    if (page.next_cursor === null) return entries;
    if (seen.has(page.next_cursor)) return entries;
    seen.add(page.next_cursor);
    cursor = page.next_cursor;
  }
}

export function sealCount(result: VerifyResult, localBrokenSeq: number | null): number | null {
  if (localBrokenSeq !== null || !result.ok) return null;
  return result.entries_checked;
}
