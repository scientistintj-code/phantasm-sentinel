import { useEffect, useRef, useState } from "react";
import { LuTerminal } from "react-icons/lu";

export interface TerminalLine {
  id: string;
  time: string;
  tag: "START" | "FINISH" | "TRACE" | "THREAT";
  tone: "info" | "ok" | "warn" | "risk";
  module: string;
  message: string;
  card?: "halt";
}

const ANNOUNCE_MS = 1000;

export function Terminal({ lines, resetKey }: { lines: TerminalLine[]; resetKey: string }) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const pendingRef = useRef(0);
  const previousLength = useRef(0);
  const announcedRef = useRef(0);
  const linesRef = useRef(lines);
  const timerRef = useRef<number | null>(null);
  const [pending, setPending] = useState(0);
  const [liveText, setLiveText] = useState("");
  linesRef.current = lines;

  useEffect(() => {
    stick.current = true;
    pendingRef.current = 0;
    previousLength.current = 0;
    announcedRef.current = 0;
    setPending(0);
    setLiveText("");
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, [resetKey]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (lines.length <= announcedRef.current || timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      const current = linesRef.current;
      const fresh = current.slice(announcedRef.current);
      announcedRef.current = current.length;
      if (fresh.length === 0) return;
      const latest = fresh[fresh.length - 1];
      if (!latest) return;
      const detail = `${latest.tag} ${latest.module ? `${latest.module}: ` : ""}${latest.message}`.replace(/\s+/g, " ").trim();
      setLiveText(fresh.length === 1 ? detail : `${fresh.length} new events. ${detail}`);
    }, ANNOUNCE_MS);
  }, [lines, liveText]);

  useEffect(() => {
    const added = lines.length - previousLength.current;
    previousLength.current = lines.length;
    if (added > 0 && !stick.current) {
      pendingRef.current += added;
      setPending(pendingRef.current);
      return;
    }
    if (!stick.current) return;
    pendingRef.current = 0;
    setPending(0);
    scrollToEnd(bodyRef.current);
  }, [lines]);

  function onScroll() {
    const body = bodyRef.current;
    if (!body) return;
    const gap = body.scrollHeight - body.scrollTop - body.clientHeight;
    const atBottom = gap <= 12;
    stick.current = atBottom;
    if (atBottom && pendingRef.current !== 0) {
      pendingRef.current = 0;
      setPending(0);
    }
  }

  function jump() {
    stick.current = true;
    pendingRef.current = 0;
    setPending(0);
    scrollToEnd(bodyRef.current);
  }

  return (
    <div className="terminal">
      <div className="sr-only" role="log" aria-live="polite" aria-atomic="true" aria-relevant="additions text">
        {liveText}
      </div>
      <div className="terminal-head">
        <span>
          <LuTerminal size={14} /> LIVE EXECUTION LOG
        </span>
        <small>{lines.length} EVENTS</small>
      </div>
      <div className="terminal-body" ref={bodyRef} onScroll={onScroll}>
        {lines.length === 0 ? (
          <div className="empty-log">
            $ awaiting mission deployment
            <span className="cursor">_</span>
          </div>
        ) : (
          lines.map((line) =>
            line.card === "halt" ? (
              <div className="halt-card" role="note" key={line.id}>
                {line.message}
              </div>
            ) : (
              <div className={`log log-${line.tone}`} key={line.id}>
                <time>[{line.time}]</time>
                <b>{line.tag}</b>
                <span>
                  {line.module ? <strong className="log-module">{line.module}:</strong> : null} {line.message}
                </span>
              </div>
            ),
          )
        )}
      </div>
      {pending > 0 ? (
        <button type="button" className="new-events" onClick={jump}>
          {pending} new events
        </button>
      ) : null}
    </div>
  );
}

function scrollToEnd(body: HTMLDivElement | null) {
  if (body && typeof body.scrollTo === "function") {
    body.scrollTo({ top: body.scrollHeight });
  }
}
