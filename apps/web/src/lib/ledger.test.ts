import { expect, test, vi } from "vitest";
import type { LedgerEntry } from "@phantasm/core";

import {
  firstBrokenSeq,
  hmacStatus,
  isReplayQuery,
  ledgerDocument,
  ledgerFileName,
  loadLedgerEntries,
  shortHash,
  tamperChain,
} from "./ledger";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);

function entry(seq: number, prev: string, hash: string): LedgerEntry {
  return {
    seq,
    ts: "2026-10-24T12:00:00.000Z",
    event_type: "CaseCreated",
    payload: {} as LedgerEntry["payload"],
    prev_hash: prev,
    entry_hash: hash,
  };
}

test("shortens a hash to 10 characters and names a replay query", () => {
  expect(shortHash(HASH_A)).toBe("aaaaaaaaaa");
  expect(isReplayQuery("1")).toBe(true);
  expect(isReplayQuery("recording")).toBe(true);
  expect(isReplayQuery(undefined)).toBe(false);
  expect(hmacStatus(null)).toBe("HMAC unverified");
  expect(hmacStatus(true)).toBe("HMAC valid");
  expect(hmacStatus(false)).toBe("HMAC invalid");
});

test("tamper flips one entry in a copy and points at the broken seq", () => {
  const stored = [entry(1, HASH_A, HASH_B), entry(2, HASH_B, HASH_C)];
  const tampered = tamperChain(stored);

  expect(stored[0]?.entry_hash).toBe(HASH_B);
  expect(tampered.entries[0]?.entry_hash).not.toBe(HASH_B);
  expect(tampered.entries[1]).toEqual(stored[1]);
  expect(tampered.brokenSeq).toBe(2);
  expect(firstBrokenSeq(stored)).toBeNull();
  expect(ledgerDocument("case 1", stored)).toContain(HASH_B);
  expect(ledgerFileName("case 1")).toBe("ledger-case_1.json");
});

test("loads every ledger page and stops on a repeated cursor", async () => {
  const getLedger = vi
    .fn()
    .mockResolvedValueOnce({
      entries: [entry(1, HASH_A, HASH_B)],
      next_cursor: "1",
    })
    .mockResolvedValueOnce({
      entries: [entry(2, HASH_B, HASH_C)],
      next_cursor: null,
    });

  const entries = await loadLedgerEntries({ getLedger }, "case-1");

  expect(getLedger).toHaveBeenNthCalledWith(1, "case-1", undefined);
  expect(getLedger).toHaveBeenNthCalledWith(2, "case-1", "1");
  expect(entries.map((row) => row.seq)).toEqual([1, 2]);
});
