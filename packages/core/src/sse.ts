import { parseSentinelEventJson, type SentinelEvent } from "./schemas";

export type EventStreamState = "connecting" | "live" | "reconnecting" | "closed";

export interface EventSourceLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string; lastEventId?: string }) => void) | null;
  onerror: (() => void) | null;
  close: () => void;
}

export type EventSourceFactory = new (
  url: string,
  init?: { withCredentials?: boolean; headers?: Record<string, string> },
) => EventSourceLike;

export interface ConnectEventStreamOptions {
  url: string;
  lastSeq?: number;
  onEvent: (event: SentinelEvent) => void;
  onState: (state: EventStreamState) => void;
  EventSource?: EventSourceFactory;
  random?: () => number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

const BACKOFF_BASE_MS = 250;
const BACKOFF_CAP_MS = 15_000;

export function backoffMs(attempt: number, random: () => number): number {
  const exponent = Math.min(attempt, 6);
  const ceiling = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** exponent);
  return Math.floor(random() * ceiling);
}

export function connectEventStream(options: ConnectEventStreamOptions): () => void {
  const Impl =
    options.EventSource ??
    (globalThis.EventSource as unknown as EventSourceFactory | undefined);
  if (!Impl) throw new Error("EventSource is not available");
  const random = options.random ?? Math.random;
  const schedule = options.setTimeout ?? ((fn, ms) => globalThis.setTimeout(fn, ms));
  const cancel = options.clearTimeout ?? ((handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>));

  let stopped = false;
  let attempt = 0;
  let lastSeq = options.lastSeq;
  let source: EventSourceLike | null = null;
  let timer: unknown = null;

  const open = (initial: boolean) => {
    if (stopped) return;
    options.onState(initial ? "connecting" : "reconnecting");
    const headers: Record<string, string> = {};
    if (lastSeq !== undefined) headers["Last-Event-ID"] = String(lastSeq);
    const es = new Impl(options.url, { withCredentials: false, headers });
    source = es;
    let handledError = false;
    es.onopen = () => {
      if (stopped || source !== es) return;
      attempt = 0;
      options.onState("live");
    };
    es.onmessage = (message) => {
      if (stopped || source !== es) return;
      let event: SentinelEvent;
      try {
        event = parseSentinelEventJson(message.data);
      } catch {
        return;
      }
      lastSeq = event.seq;
      options.onEvent(event);
    };
    es.onerror = () => {
      if (handledError || stopped) return;
      handledError = true;
      es.onerror = null;
      es.close();
      if (source === es) source = null;
      options.onState("reconnecting");
      const wait = backoffMs(attempt, random);
      attempt += 1;
      timer = schedule(() => {
        timer = null;
        open(false);
      }, wait);
    };
  };

  open(true);

  return () => {
    stopped = true;
    if (timer !== null) {
      cancel(timer);
      timer = null;
    }
    source?.close();
    source = null;
    options.onState("closed");
  };
}
