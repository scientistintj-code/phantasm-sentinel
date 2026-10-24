import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { clusterNodeIds, clusterTitle, hullPath, memberLabels, neighborIds } from "../graphModel";
import { layoutGraph, type PlacedNode } from "../graphLayout";
import { Panel } from "./Panel";

const LEGEND = [
  ["domain", "Scam Domain"],
  ["gateway", "Payment Gateway"],
  ["merchant", "Merchant ID"],
  ["host", "Host IP"],
  ["bank", "Bank / UPI"],
  ["contact", "Contact"],
] as const;

const LEGEND_LABEL: Record<Graph["nodes"][number]["type"], string> = {
  domain: "Scam Domain",
  gateway: "Payment Gateway",
  merchant: "Merchant ID",
  host: "Host IP",
  bank: "Bank / UPI",
  contact: "Contact",
};

const NODE_ICONS: Record<Graph["nodes"][number]["type"], IconType> = {
  domain: LuGlobe,
  merchant: LuFingerprint,
  gateway: LuCreditCard,
  host: LuServer,
  bank: LuBuilding2,
  contact: LuUserRound,
};

type GraphNodeData = Graph["nodes"][number];

export const GraphPanel = memo(function GraphPanel({
  graph,
  riskColor,
  onSelectTarget,
}: {
  graph: Graph | null;
  riskColor: string;
  onSelectTarget: (targetId: string) => void;
}) {
  const [zoom, setZoom] = useState(1);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drags, setDrags] = useState<Record<string, { x: number; y: number }>>({});
  const [table, setTable] = useState(false);
  const [openCluster, setOpenCluster] = useState<number | null>(null);
  const layout = useMemo(() => (graph && graph.nodes.length > 0 ? layoutGraph(graph) : null), [graph]);
  const version = graph?.version ?? -1;

  useEffect(() => {
    setDrags({});
    setSelectedId(null);
    setOpenCluster(null);
  }, [version]);

  const positions = useMemo(() => {
    const map = new Map<string, PlacedNode>();
    for (const node of layout?.nodes ?? []) {
      const drag = drags[node.id];
      map.set(node.id, drag ? { id: node.id, x: drag.x, y: drag.y } : node);
    }
    return map;
  }, [layout, drags]);

  const neighbors = useMemo(() => neighborIds(graph, selectedId), [graph, selectedId]);
  const height = layout?.height ?? 365;
  const width = layout?.width ?? 930;

  const graphRef = useRef(graph);
  graphRef.current = graph;
  const onSelectRef = useRef(onSelectTarget);
  onSelectRef.current = onSelectTarget;

  const selectNode = useCallback((id: string) => {
    setSelectedId(id);
    const node = graphRef.current?.nodes.find((item) => item.id === id);
    if (node?.type === "domain" && node.target_id) onSelectRef.current(node.target_id);
  }, []);

  const moveNode = useCallback((id: string, x: number, y: number) => {
    setDrags((current) => ({ ...current, [id]: { x, y } }));
  }, []);

  const clusters = graph?.clusters ?? [];
  const open = openCluster === null ? null : clusters[openCluster];
  const openTitle = open && openCluster !== null ? clusterTitle(openCluster, open.members.length, open.confidence) : "";

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
          <button type="button" aria-pressed={table} onClick={() => setTable((value) => !value)}>
            Table view
          </button>
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
        {table ? (
          <table className="graph-table">
            <caption>Infrastructure clusters</caption>
            <thead>
              <tr>
                <th>Cluster</th>
                <th>Members</th>
                <th>Confidence</th>
              </tr>
            </thead>
            <tbody>
              {clusters.length === 0 ? (
                <tr>
                  <td colSpan={3}>No clusters yet</td>
                </tr>
              ) : (
                clusters.map((cluster, index) => (
                  <tr key={cluster.id}>
                    <td>
                      <button type="button" onClick={() => setOpenCluster(index)}>
                        {clusterTitle(index, cluster.members.length, cluster.confidence)}
                      </button>
                    </td>
                    <td>{graph ? memberLabels(graph, cluster.members).join(", ") : cluster.members.join(", ")}</td>
                    <td>{Math.round(cluster.confidence * 100)}%</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        ) : (
          <>
            {(layout?.nodes.length ?? 0) === 0 ? <div className="empty-state">No infrastructure graph yet</div> : null}
            <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Interactive scam infrastructure network">
              <g className="graph-zoom" transform={`translate(${(width / 2) * (1 - zoom)} ${(height / 2) * (1 - zoom)}) scale(${zoom})`}>
                {graph
                  ? clusters.map((cluster, index) => {
                      const ids = clusterNodeIds(graph, cluster.members);
                      const points = ids.flatMap((id) => {
                        const point = positions.get(id);
                        return point ? [point] : [];
                      });
                      const path = hullPath(points, 28);
                      if (!path) return null;
                      const title = clusterTitle(index, cluster.members.length, cluster.confidence);
                      const top = points.reduce((best, point) => (point.y < best.y ? point : best), points[0]!);
                      const midX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
                      return (
                        <g key={cluster.id}>
                          <path className="cluster-hull" d={path} />
                          <g
                            className="cluster-chip"
                            transform={`translate(${midX} ${top.y - 22})`}
                            role="button"
                            tabIndex={0}
                            aria-label={title}
                            onClick={() => setOpenCluster(index)}
                            onKeyDown={(event) => {
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              setOpenCluster(index);
                            }}
                          >
                            <rect x={-title.length * 2.7} y={-10} width={title.length * 5.4} height={16} rx={2} />
                            <text textAnchor="middle" y={2}>
                              {title}
                            </text>
                          </g>
                        </g>
                      );
                    })
                  : null}
                {(graph?.edges ?? []).map((edge, index) => {
                  const from = positions.get(edge.a);
                  const to = positions.get(edge.b);
                  if (!from || !to) return null;
                  const lit = selectedId !== null && (edge.a === selectedId || edge.b === selectedId);
                  return (
                    <line
                      key={`${edge.a}-${edge.b}-${index}`}
                      x1={from.x}
                      y1={from.y}
                      x2={to.x}
                      y2={to.y}
                      className={lit ? "lit" : edge.weight >= 0.75 ? "hot" : ""}
                    />
                  );
                })}
                {(graph?.nodes ?? []).map((node) => {
                  const placed = positions.get(node.id);
                  if (!placed) return null;
                  return (
                    <GraphNodeView
                      key={node.id}
                      node={node}
                      x={placed.x}
                      y={placed.y}
                      selected={selectedId === node.id}
                      neighbor={neighbors.has(node.id)}
                      dimmed={selectedId !== null && selectedId !== node.id && !neighbors.has(node.id)}
                      onSelect={selectNode}
                      onMove={moveNode}
                    />
                  );
                })}
              </g>
            </svg>
          </>
        )}
        <div className="graph-insight" style={{ ["--risk-color" as string]: riskColor }}>
          <LuRadar size={16} />
          <div>
            <small>NETWORK INSIGHT</small>
            <strong>{graph?.insight || "Awaiting network data"}</strong>
          </div>
          <LuChevronRight size={16} />
        </div>
        {open ? (
          <div className="cluster-dialog" role="dialog" aria-label={openTitle}>
            <strong>{openTitle}</strong>
            <p>{open.explanation}</p>
            <button type="button" onClick={() => setOpenCluster(null)}>
              Close
            </button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
});

const GraphNodeView = memo(function GraphNodeView({
  node,
  x,
  y,
  selected,
  neighbor,
  dimmed,
  onSelect,
  onMove,
}: {
  node: GraphNodeData;
  x: number;
  y: number;
  selected: boolean;
  neighbor: boolean;
  dimmed: boolean;
  onSelect: (id: string) => void;
  onMove: (id: string, x: number, y: number) => void;
}) {
  const drag = useRef<{ pointer: number; x: number; y: number; nodeX: number; nodeY: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const Icon = NODE_ICONS[node.type];
  const radius = node.type === "domain" && node.target_id ? 21 : node.type === "domain" ? 12 : 17;
  const label = `${LEGEND_LABEL[node.type]} ${node.label}`;

  const select = () => onSelect(node.id);

  return (
    <g
      className={`node ${node.type}${selected ? " selected" : ""}${neighbor ? " neighbor" : ""}${dimmed ? " dimmed" : ""}`}
      transform={`translate(${x} ${y})`}
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false;
          return;
        }
        select();
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        select();
      }}
      onPointerDown={(event) => {
        const group = event.currentTarget.parentElement;
        if (!(group instanceof SVGGElement)) return;
        const point = localPoint(group, event);
        drag.current = { pointer: event.pointerId, x: point.x, y: point.y, nodeX: x, nodeY: y, moved: false };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const active = drag.current;
        if (!active || active.pointer !== event.pointerId) return;
        const group = event.currentTarget.parentElement;
        if (!(group instanceof SVGGElement)) return;
        const point = localPoint(group, event);
        const dx = point.x - active.x;
        const dy = point.y - active.y;
        if (Math.hypot(dx, dy) > 3) active.moved = true;
        if (active.moved) onMove(node.id, active.nodeX + dx, active.nodeY + dy);
      }}
      onPointerUp={(event) => {
        const active = drag.current;
        if (active?.pointer === event.pointerId && active.moved) suppressClick.current = true;
        drag.current = null;
      }}
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
});

function localPoint(group: SVGGElement, event: { clientX: number; clientY: number }): { x: number; y: number } {
  const svg = group.ownerSVGElement;
  const matrix = group.getScreenCTM();
  if (!svg || !matrix) return { x: 0, y: 0 };
  const point = svg.createSVGPoint();
  point.x = event.clientX;
  point.y = event.clientY;
  const next = point.matrixTransform(matrix.inverse());
  return { x: next.x, y: next.y };
}

function roundZoom(value: number): number {
  return Math.round(value * 100) / 100;
}
