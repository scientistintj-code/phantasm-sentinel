import { useEffect, useRef } from "react";
import { LuTerminal } from "react-icons/lu";

export interface TerminalLine {
  id: string;
  time: string;
  tag: "START" | "FINISH" | "TRACE" | "THREAT";
  tone: "info" | "ok" | "warn" | "risk";
  module: string;
  message: string;
}

export function Terminal({ lines }: { lines: TerminalLine[] }) {
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (body && typeof body.scrollTo === "function") {
      body.scrollTo({ top: body.scrollHeight });
    }
  }, [lines]);

  return (
    <div className="terminal">
      <div className="terminal-head">
        <span>
          <LuTerminal size={14} /> LIVE EXECUTION LOG
        </span>
        <small>{lines.length} EVENTS</small>
      </div>
      <div className="terminal-body" ref={bodyRef}>
        {lines.length === 0 ? (
          <div className="empty-log">
            $ awaiting mission deployment
            <span className="cursor">_</span>
          </div>
        ) : (
          lines.map((line) => (
            <div className={`log log-${line.tone}`} key={line.id}>
              <time>[{line.time}]</time>
              <b>{line.tag}</b>
              <span>
                {line.module ? <strong className="log-module">{line.module}:</strong> : null} {line.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
