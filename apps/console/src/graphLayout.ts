import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  type SimulationLinkDatum,
  type SimulationNodeDatum,
} from "d3-force";
import type { Graph } from "@phantasm/core";

export interface PlacedNode {
  id: string;
  x: number;
  y: number;
}

export interface FrozenLayout {
  width: number;
  height: number;
  nodes: PlacedNode[];
}

const WIDTH = 930;
const TICKS = 160;
const cache = new Map<string, FrozenLayout>();
const CACHE_LIMIT = 8;

interface SimNode extends SimulationNodeDatum {
  id: string;
}

export function layoutGraph(graph: Graph): FrozenLayout {
  const key = layoutKey(graph);
  const cached = cache.get(key);
  if (cached) return cached;
  const frozen = computeLayout(graph, key);
  cache.set(key, frozen);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return frozen;
}

function layoutKey(graph: Graph): string {
  const nodes = graph.nodes.map((node) => node.id).join("|");
  const edges = graph.edges.map((edge) => `${edge.a}>${edge.b}`).join("|");
  return `${graph.version}:${nodes}:${edges}`;
}

function computeLayout(graph: Graph, key: string): FrozenLayout {
  const height = Math.max(365, Math.ceil(Math.sqrt(Math.max(graph.nodes.length, 1)) * 70));
  if (graph.nodes.length === 0) return { width: WIDTH, height, nodes: [] };
  const random = mulberry32(hashString(key));
  const count = graph.nodes.length;
  const nodes: SimNode[] = graph.nodes.map((node, index) => {
    const angle = (index / count) * Math.PI * 2;
    const ring = 48 + (index % 11) * 16;
    return { id: node.id, x: Math.cos(angle) * ring, y: Math.sin(angle) * ring };
  });
  const links: Array<SimulationLinkDatum<SimNode>> = graph.edges.map((edge) => ({
    source: edge.a,
    target: edge.b,
  }));
  const simulation = forceSimulation<SimNode>()
    .alpha(1)
    .alphaDecay(0.045)
    .velocityDecay(0.42)
    .stop();
  simulation.randomSource(random);
  simulation.nodes(nodes);
  simulation.force(
    "link",
    forceLink<SimNode, SimulationLinkDatum<SimNode>>(links)
      .id((node) => node.id)
      .distance(72)
      .strength(0.55),
  );
  simulation.force("charge", forceManyBody<SimNode>().strength(-80).distanceMax(280));
  simulation.force("center", forceCenter(0, 0));
  simulation.force("collide", forceCollide<SimNode>(22));
  for (let tick = 0; tick < TICKS; tick += 1) simulation.tick();
  simulation.stop();
  return { width: WIDTH, height, nodes: fit(nodes, WIDTH, height) };
}

function fit(nodes: readonly SimNode[], width: number, height: number): PlacedNode[] {
  if (nodes.length === 1) {
    const only = nodes[0]!;
    return [{ id: only.id, x: width / 2, y: height / 2 }];
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of nodes) {
    const x = node.x ?? 0;
    const y = node.y ?? 0;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const pad = 72;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  return nodes.map((node) => ({
    id: node.id,
    x: pad + (((node.x ?? 0) - minX) / spanX) * (width - pad * 2),
    y: pad + (((node.y ?? 0) - minY) / spanY) * (height - pad * 2),
  }));
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let next = state;
    next = Math.imul(next ^ (next >>> 15), next | 1);
    next ^= next + Math.imul(next ^ (next >>> 7), next | 61);
    return ((next ^ (next >>> 14)) >>> 0) / 4294967296;
  };
}
