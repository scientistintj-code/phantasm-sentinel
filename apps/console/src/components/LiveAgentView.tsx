import { LuLock, LuMonitor } from "react-icons/lu";
import { Panel } from "./Panel";
import { Stepper } from "./Stepper";
import { Terminal, type TerminalLine } from "./Terminal";

export function LiveAgentView({
  address,
  live,
  streamingUrl,
  phaseIndex,
  complete,
  lines,
  onStreamError,
}: {
  address: string;
  live: boolean;
  streamingUrl: string | null;
  phaseIndex: number;
  complete: boolean;
  lines: TerminalLine[];
  onStreamError: () => void;
}) {
  return (
    <Panel title="LIVE AGENT VIEW" icon={LuMonitor} className="center-panel">
      <div className="browser">
        <div className="browser-bar">
          <div className="traffic">
            <i />
            <i />
            <i />
          </div>
          <div className="address">
            <LuLock size={13} />
            {address}
          </div>
          {live ? (
            <span className="live">
              <i />
              LIVE
            </span>
          ) : null}
        </div>
        <div className="browser-body">
          <div className="scanline" />
          {streamingUrl ? (
            <iframe
              title="Live agent stream"
              src={streamingUrl}
              sandbox="allow-scripts allow-same-origin"
              referrerPolicy="no-referrer"
              onError={onStreamError}
              style={{ width: "100%", height: "100%", border: 0, position: "relative", zIndex: 1 }}
            />
          ) : (
            <div className="empty-state">Awaiting live stream</div>
          )}
        </div>
      </div>
      <Stepper phaseIndex={phaseIndex} complete={complete} />
      <Terminal lines={lines} />
    </Panel>
  );
}
