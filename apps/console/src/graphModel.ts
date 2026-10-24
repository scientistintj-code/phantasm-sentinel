import type { Graph } from "@phantasm/core";

export interface Point {
  x: number;
  y: number;
}

const DOMAIN_TYPES = new Set<Graph["nodes"][number]["type"]>(["domain"]);

export function sharedMerchantCount(graph: Graph): number {
  return countLinked(graph, "merchant", 2);
}

export function hostClusterCount(graph: Graph): number {
  return countLinked(graph, "host", 2);
}

export function asnAnnotation(graph: Graph): string | null {
  const host = graph.nodes.find((node) => node.type === "host" && /\bASN\s*\d+/i.test(node.label));
  return host?.label ?? null;
}

export function clusterTitle(index: number, memberCount: number, confidence: number): string {
  const letter = index < 26 ? String.fromCharCode(65 + index) : `C${index + 1}`;
  const noun = memberCount === 1 ? "target" : "targets";
  return `CLUSTER ${letter} - ${memberCount} ${noun} ${Math.round(confidence * 100)}%`;
}

export function memberLabels(graph: Graph, members: readonly string[]): string[] {
  return members.map((targetId) => {
    const domain = graph.nodes.find((node) => node.type === "domain" && node.target_id === targetId);
    return domain?.label ?? targetId;
  });
}

export function clusterNodeIds(graph: Graph, members: readonly string[]): string[] {
  const memberSet = new Set(members);
  const ids = new Set(
    graph.nodes
      .filter((node) => node.target_id !== undefined && memberSet.has(node.target_id))
      .map((node) => node.id),
  );
  for (const edge of graph.edges) {
    if (ids.has(edge.a)) ids.add(edge.b);
    else if (ids.has(edge.b)) ids.add(edge.a);
  }
  return [...ids];
}

export function neighborIds(graph: Graph | null, nodeId: string | null): Set<string> {
  const neighbors = new Set<string>();
  if (!graph || nodeId === null) return neighbors;
  for (const edge of graph.edges) {
    if (edge.a === nodeId) neighbors.add(edge.b);
    else if (edge.b === nodeId) neighbors.add(edge.a);
  }
  return neighbors;
}

export function convexHull(points: readonly Point[]): Point[] {
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  if (sorted.length <= 2) return sorted;
  const cross = (origin: Point, a: Point, b: Point) =>
    (a.x - origin.x) * (b.y - origin.y) - (a.y - origin.y) * (b.x - origin.x);
  const lower: Point[] = [];
  for (const point of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0) lower.pop();
    lower.push(point);
  }
  const upper: Point[] = [];
  for (let index = sorted.length - 1; index >= 0; index -= 1) {
    const point = sorted[index]!;
    while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0) upper.pop();
    upper.push(point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

export function inflateHull(points: readonly Point[], pad: number): Point[] {
  if (points.length === 0) return [];
  const center = centroid(points);
  return points.map((point) => {
    const dx = point.x - center.x;
    const dy = point.y - center.y;
    const length = Math.hypot(dx, dy) || 1;
    return { x: point.x + (dx / length) * pad, y: point.y + (dy / length) * pad };
  });
}

export function centroid(points: readonly Point[]): Point {
  const total = points.reduce((sum, point) => ({ x: sum.x + point.x, y: sum.y + point.y }), { x: 0, y: 0 });
  return { x: total.x / points.length, y: total.y / points.length };
}

export function hullPath(points: readonly Point[], pad: number): string | null {
  if (points.length === 0) return null;
  if (points.length < 3) {
    const center = centroid(points);
    const radius = 42 + pad;
    return `M ${center.x - radius} ${center.y} a ${radius} ${radius} 0 1 0 ${radius * 2} 0 a ${radius} ${radius} 0 1 0 ${-radius * 2} 0`;
  }
  const hull = inflateHull(convexHull(points), pad);
  const [first, ...rest] = hull;
  if (!first) return null;
  return `M ${first.x.toFixed(1)} ${first.y.toFixed(1)} ${rest.map((point) => `L ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(" ")} Z`;
}

function countLinked(graph: Graph, type: "merchant" | "host", minimumDomains: number): number {
  const domains = new Set(graph.nodes.filter((node) => DOMAIN_TYPES.has(node.type)).map((node) => node.id));
  return graph.nodes.filter((node) => node.type === type).filter((node) => {
    const linked = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.a === node.id && domains.has(edge.b)) linked.add(edge.b);
      if (edge.b === node.id && domains.has(edge.a)) linked.add(edge.a);
    }
    return linked.size >= minimumDomains;
  }).length;
}
