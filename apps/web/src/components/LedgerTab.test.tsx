import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import type { ApiClient, LedgerEntry, VerifyResult } from "@phantasm/core";

import { LedgerTab } from "./LedgerTab";

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const HASH_C = "c".repeat(64);
const HEAD = "d".repeat(64);

function entry(seq: number, prev: string, hash: string, eventType: string): LedgerEntry {
  return {
    seq,
    ts: "2026-10-24T12:00:00.000Z",
    event_type: eventType,
    payload: {} as LedgerEntry["payload"],
    prev_hash: prev,
    entry_hash: hash,
  };
}

const rows = [
  entry(1, HASH_A, HASH_B, "CaseCreated"),
  entry(2, HASH_B, HASH_C, "PhaseChanged"),
];

function client(verify: VerifyResult | (() => Promise<VerifyResult>)): ApiClient {
  return {
    getLedger: vi.fn().mockResolvedValue({ entries: rows, next_cursor: null }),
    verifyLedger: vi.fn(typeof verify === "function" ? verify : async () => verify),
  } as unknown as ApiClient;
}

const intact: VerifyResult = {
  ok: true,
  entries_checked: 2,
  head_hash: HEAD,
  signature_ok: true,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function renderLedger(api: ApiClient, replay = false) {
  render(<LedgerTab caseId="case-1" replay={replay} client={api} />);
  expect(await screen.findByText("CaseCreated")).toBeTruthy();
}

test("renders the chain, copies a full hash, and seals an intact verify", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  const api = client(intact);
  await renderLedger(api, true);

  expect(screen.getByText("1")).toBeTruthy();
  expect(screen.getByText("PhaseChanged")).toBeTruthy();
  expect(screen.getAllByText("2026-10-24T12:00:00.000Z").length).toBe(2);
  expect(screen.getByRole("button", { name: `Copy entry hash ${HASH_B}` }).textContent).toBe(
    "bbbbbbbbbb",
  );
  expect(screen.getByText("Replayed from recording")).toBeTruthy();
  expect(screen.getByText(HASH_C)).toBeTruthy();
  expect(screen.getByText("HMAC unverified")).toBeTruthy();

  fireEvent.click(screen.getByRole("button", { name: `Copy entry hash ${HASH_B}` }));
  await waitFor(() => expect(writeText).toHaveBeenCalledWith(HASH_B));

  fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
  expect(await screen.findByText("INTACT")).toBeTruthy();
  expect(screen.getByText("2 entries checked")).toBeTruthy();
  expect(screen.getByText(HEAD)).toBeTruthy();
  expect(screen.getByText("HMAC valid")).toBeTruthy();
  expect(api.verifyLedger).toHaveBeenCalledWith("case-1");
});

test("shows a scanning line, then highlights the broken seq from verify", async () => {
  let finish: (result: VerifyResult) => void = () => undefined;
  const pending = new Promise<VerifyResult>((resolve) => {
    finish = resolve;
  });
  const api = client(() => pending);
  await renderLedger(api);

  fireEvent.click(screen.getByRole("button", { name: "Verify chain" }));
  expect(document.querySelector(".ledger-scan")).not.toBeNull();

  finish({
    ok: false,
    entries_checked: 2,
    first_broken_seq: 2,
    reason: "hash mismatch",
    head_hash: HEAD,
    signature_ok: false,
  });

  expect(await screen.findByText("hash mismatch")).toBeTruthy();
  expect(document.querySelector(".ledger-scan")).toBeNull();
  expect(document.querySelector('[data-seq="2"]')?.className).toContain("ledger-entry-broken");
  expect(document.querySelector('[data-seq="1"]')?.className).not.toContain("ledger-entry-broken");
  expect(screen.queryByText("INTACT")).toBeNull();
  expect(screen.getByText("HMAC invalid")).toBeTruthy();
});

test("simulate tamper flips a displayed hash and does not call the API", async () => {
  const exported: { blob: Blob | null } = { blob: null };
  const createObjectURL = vi.fn((blob: Blob) => {
    exported.blob = blob;
    return "blob:ledger";
  });
  const revokeObjectURL = vi.fn();
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => undefined);
  const api = client(intact);
  await renderLedger(api);

  fireEvent.click(screen.getByRole("button", { name: "Simulate tamper" }));

  expect(api.verifyLedger).not.toHaveBeenCalled();
  expect(api.getLedger).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[data-seq="2"]')?.className).toContain("ledger-entry-broken");
  expect(screen.getAllByRole("button", { name: /Copy entry hash/ })[0]?.textContent).toBe(
    "0bbbbbbbbb",
  );
  expect(screen.queryByText("INTACT")).toBeNull();

  fireEvent.click(screen.getByRole("button", { name: "Export ledger (.json)" }));
  expect(createObjectURL).toHaveBeenCalledTimes(1);
  if (exported.blob === null) throw new Error("export blob was not created");
  const body = await exported.blob.text();
  expect(body).toContain(HASH_B);
  expect(click).toHaveBeenCalled();
  const anchor = click.mock.instances[0];
  expect(anchor).toBeInstanceOf(HTMLAnchorElement);
  if (anchor instanceof HTMLAnchorElement) expect(anchor.download).toBe("ledger-case-1.json");
  expect(revokeObjectURL).toHaveBeenCalledWith("blob:ledger");
});
