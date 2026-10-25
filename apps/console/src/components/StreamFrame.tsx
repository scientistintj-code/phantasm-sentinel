import { useEffect, useRef, useState } from "react";
import type { PhaseName } from "@phantasm/core";
import { STREAM_ALLOW, STREAM_LOAD_TIMEOUT_MS, STREAM_SANDBOX, allowedStreamUrl } from "../streamFrame";

const SIMULATED_ORIGIN = "https://stream.invalid";

function streamOrigin(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function simulatedStream(
  streamingUrl: string | null,
  origins: readonly string[],
  recorded: boolean,
): boolean {
  if (streamingUrl && streamOrigin(streamingUrl) === SIMULATED_ORIGIN) return true;
  return recorded && allowedStreamUrl(streamingUrl, origins) === null;
}

function SimulatedFrame({ host, runPhase }: { host: string; runPhase: PhaseName | null }) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const phaseRef = useRef(runPhase);
  phaseRef.current = runPhase;

  const post = () => {
    const phase = phaseRef.current;
    const target = frameRef.current?.contentWindow;
    if (!phase || !target) return;
    try {
      target.postMessage({ type: "phase", phase }, window.location.origin);
    } catch {
      return;
    }
  };

  useEffect(() => {
    post();
  }, [runPhase]);

  return (
    <iframe
      ref={frameRef}
      title="Simulated agent stream"
      src={`/mock-stream/index.html?host=${encodeURIComponent(host)}`}
      sandbox="allow-scripts allow-same-origin"
      referrerPolicy="no-referrer"
      onLoad={post}
    />
  );
}

function reduceMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StreamFrame({
  streamingUrl,
  origins,
  recorded,
  host = "",
  runPhase = null,
}: {
  streamingUrl: string | null;
  origins: readonly string[];
  recorded: boolean;
  host?: string;
  runPhase?: PhaseName | null;
}) {
  const allowed = allowedStreamUrl(streamingUrl, origins);
  const simulated = simulatedStream(streamingUrl, origins, recorded);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    setPhase("loading");
    if (!allowed || recorded || simulated) return;
    const timer = setTimeout(() => {
      setPhase((current) => (current === "ready" ? current : "failed"));
    }, STREAM_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [allowed, recorded, simulated]);

  if (simulated) {
    return <SimulatedFrame host={host} runPhase={runPhase} />;
  }

  if (recorded) {
    return (
      <div className="stream-fallback">
        <p>Recorded run</p>
        {allowed ? (
          <a href={allowed} target="_blank" rel="noopener noreferrer">
            Open in new tab
          </a>
        ) : null}
      </div>
    );
  }

  if (!allowed) {
    if (streamingUrl) {
      return (
        <div className="stream-fallback">
          <p>Stream unavailable</p>
        </div>
      );
    }
    return <div className="empty-state">Awaiting live stream</div>;
  }

  if (phase === "failed") {
    return (
      <div className="stream-fallback">
        <p>Stream unavailable</p>
        <a href={allowed} target="_blank" rel="noopener noreferrer">
          Open in new tab
        </a>
      </div>
    );
  }

  return (
    <>
      {phase === "loading" && !reduceMotion() ? <div className="scanline" /> : null}
      <iframe
        key={allowed}
        title="Live agent stream"
        src={allowed}
        sandbox={STREAM_SANDBOX}
        allow={STREAM_ALLOW}
        referrerPolicy="no-referrer"
        onLoad={() => setPhase("ready")}
        onError={() => setPhase("failed")}
      />
    </>
  );
}
