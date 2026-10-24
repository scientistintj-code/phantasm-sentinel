import { useState } from "react";
import type { IconType } from "react-icons";
import {
  LuBuilding2,
  LuChevronRight,
  LuCreditCard,
  LuCrosshair,
  LuFingerprint,
  LuGlobe,
  LuRadar,
  LuServer,
  LuShare2,
  LuUserRound,
  LuZoomIn,
  LuZoomOut,
} from "react-icons/lu";
import type { Graph } from "@phantasm/core";
import { Panel } from "./Panel";

const LEGEND = [
  ["domain", "Scam Domain"],
  ["gateway", "Payment Gateway"],
  ["merchant", "Merchant ID"],
  ["host", "Host IP"],
  ["bank", "Bank / UPI"],
] as const;

const NODE_ICONS: Record<Graph["nodes"][number]["type"], IconType> = {
  domain: LuGlobe,
  merchant: LuFingerprint,
  gateway: LuCreditCard,
  host: LuServer,
  bank: LuBuilding2,
  contact: LuUserRound,
};

export function GraphPanel({ graph, riskColor }: { graph: Graph | null; riskColor: string }) {
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const placed = placeNodes(graph?.nodes ?? []);
  const height = Math.max(365, 40 + Math.ceil(placed.length / 6) * 78);
  const nodesById = new Map(placed.map((node) => [node.id, node]));

  return (
    <Panel title="THREAT INFRASTRUCTURE NETWORK" icon={LuShare2} className="graph-panel">
      <div className="graph-toolbar">
        <div className="legend">
          {LEGEND.map(([type, label]) => (
            <span key={type}>
              <i className={type} />
              {label}
            </span>
          ))}
        </div>
        <div className="graph-actions">
          <button type="button" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(0.65, roundZoom(value - 0.15)))}>
            <LuZoomOut size={15} />
          </button>
          <button type="button" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.45, roundZoom(value + 0.15)))}>
            <LuZoomIn size={15} />
          </button>
          <button type="button" aria-label="Reset view" onClick={() => setZoom(1)}>
            <LuCrosshair size={15} />
          </button>
        </div>
      </div>
      <div className="graph-canvas">
        {placed.length === 0 ? <div className="empty-state">No infrastructure graph yet</div> : null}
        <svg viewBox={`0 0 930 ${height}`} role="img" aria-label="Interactive scam infrastructure network">
          <g transform={`translate(${465 * (1 - zoom)} ${(height / 2) * (1 - zoom)}) scale(${zoom})`}>
            {(graph?.edges ?? []).map((edge, index) => {
              const from = nodesById.get(edge.a);
              const to = nodesById.get(edge.b);
              if (!from || !to) return null;
              return (
                <line
                  key={`${edge.a}-${edge.b}-${index}`}
                  x1={from.x}
                  y1={from.y}
                  x2={to.x}
                  y2={to.y}
                  className={edge.weight >= 0.75 ? "hot" : ""}
                />
              );
            })}
            {placed.map((node) => {
              const Icon = NODE_ICONS[node.type];
              const radius = node.type === "domain" && node.target_id ? 21 : node.type === "domain" ? 12 : 17;
              return (
                <g
                  key={node.id}
                  className={`node ${node.type} ${selectedId === node.id ? "selected" : ""}`}
                  transform={`translate(${node.x} ${node.y})`}
                  onClick={() => setSelectedId(node.id)}
                  role="button"
                >
                  <circle r={radius} />
                  <circle className="pulse" r={node.target_id ? 28 : 22} />
                  <foreignObject x={-9} y={-9} width={18} height={18}>
                    <div>
                      <Icon />
                    </div>
                  </foreignObject>
                  <text y={node.type === "domain" ? 25 : 31}>{node.label}</text>
                </g>
              );
            })}
          </g>
        </svg>
        <div className="graph-insight" style={{ ["--risk-color" as string]: riskColor }}>
          <LuRadar size={16} />
          <div>
            <small>NETWORK INSIGHT</small>
            <strong>{graph?.insight || "Awaiting network data"}</strong>
          </div>
          <LuChevronRight size={16} />
        </div>
      </div>
    </Panel>
  );
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}

function placeNodes(nodes: Graph["nodes"]): Array<Graph["nodes"][number] & { x: number; y: number }> {
  return nodes.map((node, index) => ({
    ...node,
    x: 90 + (index % 6) * 145,
    y: 48 + Math.floor(index / 6) * 78,
  }));
}
