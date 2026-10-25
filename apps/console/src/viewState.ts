import {
  ApiError,
  connectEventStream,
  type ConnectEventStreamOptions,
  type InvestigationState,
  type InvestigationStore,
  type KeyHealth,
  type TargetStatus,
} from "@phantasm/core";

export interface KeyPoolRow {
  state: KeyHealth["state"];
  recoversAt?: string | null;
}

export interface TargetTabModel {
  id: string;
  label: string;
  status: TargetStatus;
  dot: TargetStatus;
  failureMessage: string | null;
  halted: boolean;
}

export function caseIdFromSearch(search: string): string | null {
  const value = new URLSearchParams(search).get("case");
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "" || trimmed.length > 200) return null;
  if (/[\s/?#\\]/.test(trimmed)) return null;
  return trimmed;
}

export function caseFileHref(caseId: string): string {
  return `/cases/${encodeURIComponent(caseId)}`;
}

export const CASE_ID_STORAGE_KEY = "phantasm.caseId";

export function caseIdFromStorage(storage: Pick<Storage, "getItem">): string | null {
  let raw: string | null = null;
  try {
    raw = storage.getItem(CASE_ID_STORAGE_KEY);
  } catch {
    return null;
  }
  if (raw === null) return null;
  return caseIdFromSearch(`?case=${encodeURIComponent(raw)}`);
}

export function caseIdToResume(search: string, storages: ReadonlyArray<Pick<Storage, "getItem">>): string | null {
  const fromSearch = caseIdFromSearch(search);
  if (fromSearch) return fromSearch;
  for (const storage of storages) {
    const stored = caseIdFromStorage(storage);
    if (stored) return stored;
  }
  return null;
}

export function storeCaseId(storage: Pick<Storage, "setItem">, caseId: string): void {
  try {
    storage.setItem(CASE_ID_STORAGE_KEY, caseId);
  } catch {
    return;
  }
}

export function isMissingCase(error: unknown): boolean {
  return error instanceof ApiError && error.status === 404;
}

export function clearFailedCase(input: {
  caseId: string;
  storages: ReadonlyArray<Pick<Storage, "getItem" | "removeItem">>;
  href: string;
}): string {
  for (const storage of input.storages) {
    if (caseIdFromStorage(storage) !== input.caseId) continue;
    try {
      storage.removeItem(CASE_ID_STORAGE_KEY);
    } catch {
      continue;
    }
  }
  const url = new URL(input.href, "http://console.local");
  if (caseIdFromSearch(url.search) === input.caseId) url.searchParams.delete("case");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function keyPoolBanner(keys: readonly KeyPoolRow[]): string | null {
  if (keys.length === 0) return null;
  const blocked = keys.every((key) => key.state === "exhausted" || key.state === "cooling");
  if (!blocked) return null;
  const times = keys
    .map((key) => key.recoversAt)
    .filter((value): value is string => typeof value === "string" && Number.isFinite(Date.parse(value)))
    .sort((left, right) => Date.parse(left) - Date.parse(right));
  const earliest = times[0];
  if (!earliest) return "All keys exhausted or cooling";
  return `All keys exhausted or cooling. Earliest recovery ${earliest}`;
}

export function targetTabs(state: InvestigationState): TargetTabModel[] {
  return Object.values(state.targets).map((target) => {
    const halted = state.safetyHalts.some((halt) => halt.targetId === target.id);
    let failureMessage: string | null = null;
    for (const event of state.log) {
      if (event.type === "TargetFailed" && event.target_id === target.id) failureMessage = event.message;
    }
    const dot: TargetStatus = halted || target.status === "failed" ? "failed" : target.status;
    return {
      id: target.id,
      label: target.host || target.id,
      status: target.status,
      dot,
      failureMessage,
      halted,
    };
  });
}

export function displayHost(target: { host: string; url: string | null } | null): string {
  if (!target) return "";
  if (target.host) return target.host;
  if (!target.url) return "";
  try {
    return new URL(target.url).host;
  } catch {
    return "";
  }
}

export function visiblePivots(state: InvestigationState, targetId: string | "all", hidden: ReadonlySet<string>) {
  return state.pivots.filter((pivot) => {
    if (hidden.has(pivot.pivotId)) return false;
    if (targetId !== "all" && pivot.targetId !== targetId) return false;
    return true;
  });
}

export function lastAppliedSeq(state: InvestigationState): number | undefined {
  let last: number | undefined;
  for (const seq of state.appliedSeqs) last = last === undefined ? seq : Math.max(last, seq);
  return last;
}

export function attachCase(input: {
  client: { eventsUrl(caseId: string): string };
  store: InvestigationStore;
  caseId: string;
  connect?: (options: ConnectEventStreamOptions) => () => void;
  onCaseId?: (caseId: string) => void;
}): { stopStream: () => void } {
  const connect = input.connect ?? connectEventStream;
  input.onCaseId?.(input.caseId);
  const stopStream = connect({
    url: input.client.eventsUrl(input.caseId),
    lastSeq: lastAppliedSeq(input.store.getState()),
    onEvent: (event) => {
      input.store.getState().apply(event);
      input.onCaseId?.(event.case_id);
    },
    onState: (connection) => input.store.getState().setConnection(connection),
  });
  return { stopStream };
}
