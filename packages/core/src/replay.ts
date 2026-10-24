import { replayCueSchema, type ReplayCue, type SentinelEvent } from "./schemas";
import type { InvestigationStore } from "./store";

export type ReplaySpeed = 1 | 2 | 4 | 8;

export interface ReplayTimerApi {
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
  now: () => number;
}

const defaultTimers: ReplayTimerApi = {
  setTimeout: (fn, ms) => globalThis.setTimeout(fn, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

interface PendingTimer {
  handle: unknown;
  armedAt: number;
  fromCursor: number;
  waitReal: number;
  gap: number;
}

export function parseReplayNdjson(text: string): ReplayCue[] {
  const cues: ReplayCue[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim() === "") continue;
    let json: unknown;
    try {
      json = JSON.parse(line);
    } catch {
      throw new SyntaxError(`Malformed JSON on line ${index + 1}`);
    }
    cues.push(replayCueSchema.parse(json));
  }
  return cues;
}

export class ReplayDriver {
  private readonly cues: ReplayCue[];
  private readonly timers: ReplayTimerApi;
  private index = 0;
  private cursor = 0;
  private speed: ReplaySpeed = 1;
  private playing = false;
  private ended = false;
  private pending: PendingTimer | null = null;
  private readonly endHandlers = new Set<() => void>();

  constructor(
    ndjsonText: string,
    private readonly store: InvestigationStore,
    timers: ReplayTimerApi = defaultTimers,
  ) {
    this.cues = parseReplayNdjson(ndjsonText);
    this.timers = timers;
    this.store.getState().reset();
    this.store.getState().setMode("replay");
  }

  play(): void {
    if (this.playing) return;
    if (this.index >= this.cues.length) {
      this.finish();
      return;
    }
    this.ended = false;
    this.playing = true;
    this.pump();
  }

  pause(): void {
    if (!this.playing) return;
    this.syncCursor();
    this.playing = false;
  }

  seek(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) {
      throw new RangeError("seek expects a non-negative number of milliseconds");
    }
    const wasPlaying = this.playing;
    this.playing = false;
    this.clearTimer();
    this.ended = false;
    this.store.getState().reset();
    this.store.getState().setMode("replay");
    this.index = 0;
    this.cursor = 0;
    this.applyThrough(ms);
    this.cursor = ms;
    if (this.index >= this.cues.length) {
      this.ended = true;
      if (wasPlaying) this.finish();
      return;
    }
    this.playing = wasPlaying;
    if (wasPlaying) this.pump();
  }

  setSpeed(speed: ReplaySpeed): void {
    if (speed !== 1 && speed !== 2 && speed !== 4 && speed !== 8) {
      throw new RangeError("speed must be 1, 2, 4, or 8");
    }
    if (speed === this.speed) return;
    if (this.playing) this.syncCursor();
    this.speed = speed;
    if (this.playing) this.pump();
  }

  onEnd(handler: () => void): void {
    if (this.ended) handler();
    else this.endHandlers.add(handler);
  }

  private apply(event: SentinelEvent): void {
    this.store.getState().apply(event);
  }

  private applyThrough(ms: number): void {
    while (this.index < this.cues.length) {
      const cue = this.cues[this.index];
      if (!cue || cue.t_ms > ms) return;
      this.apply(cue.event);
      this.index += 1;
    }
  }

  private pump(): void {
    if (!this.playing) return;
    while (this.index < this.cues.length) {
      const cue = this.cues[this.index];
      if (!cue) break;
      if (cue.t_ms > this.cursor) {
        const gap = cue.t_ms - this.cursor;
        const waitReal = gap / this.speed;
        const handle = this.timers.setTimeout(() => this.fire(), waitReal);
        this.pending = {
          handle,
          armedAt: this.timers.now(),
          fromCursor: this.cursor,
          waitReal,
          gap,
        };
        return;
      }
      const stamp = cue.t_ms;
      this.cursor = Math.max(this.cursor, stamp);
      while (this.index < this.cues.length && this.cues[this.index]?.t_ms === stamp) {
        const next = this.cues[this.index];
        if (!next) break;
        this.apply(next.event);
        this.index += 1;
      }
    }
    this.finish();
  }

  private fire(): void {
    this.pending = null;
    if (!this.playing) return;
    const cue = this.cues[this.index];
    if (!cue) {
      this.finish();
      return;
    }
    this.cursor = Math.max(this.cursor, cue.t_ms);
    const stamp = cue.t_ms;
    while (this.index < this.cues.length && this.cues[this.index]?.t_ms === stamp) {
      const next = this.cues[this.index];
      if (!next) break;
      this.apply(next.event);
      this.index += 1;
    }
    this.pump();
  }

  private syncCursor(): void {
    if (!this.pending) return;
    const elapsed = Math.max(0, this.timers.now() - this.pending.armedAt);
    const advanced = Math.min(this.pending.gap, elapsed * this.speed);
    this.cursor = this.pending.fromCursor + advanced;
    this.clearTimer();
  }

  private clearTimer(): void {
    if (!this.pending) return;
    this.timers.clearTimeout(this.pending.handle);
    this.pending = null;
  }

  private finish(): void {
    if (this.ended) return;
    this.ended = true;
    this.playing = false;
    this.clearTimer();
    for (const handler of this.endHandlers) handler();
  }
}
