import { useEffect, useState } from "react";
import { STREAM_ALLOW, STREAM_LOAD_TIMEOUT_MS, STREAM_SANDBOX, allowedStreamUrl } from "../streamFrame";

function reduceMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

export function StreamFrame({
  streamingUrl,
  origins,
  recorded,
}: {
  streamingUrl: string | null;
  origins: readonly string[];
  recorded: boolean;
}) {
  const allowed = allowedStreamUrl(streamingUrl, origins);
  const [phase, setPhase] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    setPhase("loading");
    if (!allowed || recorded) return;
    const timer = setTimeout(() => {
      setPhase((current) => (current === "ready" ? current : "failed"));
    }, STREAM_LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [allowed, recorded]);

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
