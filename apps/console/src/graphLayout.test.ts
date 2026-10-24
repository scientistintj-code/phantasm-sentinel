import { expect, it } from "vitest";
import type { Graph } from "@phantasm/core";
import { layoutGraph } from "./graphLayout";
import { clusterTitle, convexHull, hostClusterCount, sharedMerchantCount } from "./graphModel";

const linked: Graph = {
  version: 1,
  nodes: [
    { id: "d1", type: "domain", label: "a.example", target_id: "t1" },
    { id: "d2", type: "domain", label: "b.example", target_id: "t2" },
    { id: "d3", type: "domain", label: "c.example", target_id: "t3" },
    { id: "m1", type: "merchant", label: "MID" },
    { id: "m2", type: "merchant", label: "ONLY" },
    { id: "h1", type: "host", label: "ASN 9009" },
    { id: "h2", type: "host", label: "203.0.113.10" },
  ],
  edges: [
    { a: "d1", b: "m1", weight: 1, kind: "merchant_id" },
    { a: "d2", b: "m1", weight: 1, kind: "merchant_id" },
    { a: "d3", b: "m2", weight: 1, kind: "merchant_id" },
    { a: "d1", b: "h1", weight: 1, kind: "ip" },
    { a: "d2", b: "h1", weight: 1, kind: "ip" },
    { a: "d3", b: "h2", weight: 1, kind: "ip" },
  ],
  clusters: [{ id: "clu", members: ["t1", "t2"], confidence: 0.94, explanation: "shared host" }],
  insight: "linked",
};

it("counts shared merchants and host clusters from edges", () => {
  expect(sharedMerchantCount(linked)).toBe(1);
  expect(hostClusterCount(linked)).toBe(1);
  expect(clusterTitle(0, 4, 0.94)).toBe("CLUSTER A - 4 targets 94%");
  const hull = convexHull([
    { x: 0, y: 0 },
    { x: 2, y: 0 },
    { x: 2, y: 2 },
    { x: 0, y: 2 },
    { x: 1, y: 1 },
  ]);
  expect(hull).toHaveLength(4);
});

it("freezes a deterministic layout and reuses it", () => {
  const first = layoutGraph(linked);
  const second = layoutGraph(linked);
  expect(second).toBe(first);
  expect(first.nodes.map((node) => [node.id, node.x, node.y])).toEqual(
    layoutGraph({ ...linked, nodes: [...linked.nodes], edges: [...linked.edges] }).nodes.map((node) => [node.id, node.x, node.y]),
  );
  for (const node of first.nodes) {
    expect(Number.isFinite(node.x)).toBe(true);
    expect(Number.isFinite(node.y)).toBe(true);
  }
});

it("lays out 300 nodes once", () => {
  const graph = syntheticGraph(60, 300);
  const started = performance.now();
  const layout = layoutGraph(graph);
  expect(layout.nodes).toHaveLength(300);
  expect(performance.now() - started).toBeLessThan(2000);
  const cached = performance.now();
  expect(layoutGraph(graph)).toBe(layout);
  expect(performance.now() - cached).toBeLessThan(30);
});

function syntheticGraph(domains: number, total: number): Graph {
  const nodes: Graph["nodes"] = [];
  for (let index = 0; index < total; index += 1) {
    if (index < domains) {
      nodes.push({ id: `d${index}`, type: "domain", label: `d${index}.example`, target_id: `t${index}` });
    } else if (index % 5 === 0) {
      nodes.push({ id: `h${index}`, type: "host", label: `203.0.113.${index % 200}` });
    } else if (index % 5 === 1) {
      nodes.push({ id: `m${index}`, type: "merchant", label: `MID${index}` });
    } else if (index % 5 === 2) {
      nodes.push({ id: `g${index}`, type: "gateway", label: `gw${index}.example` });
    } else if (index % 5 === 3) {
      nodes.push({ id: `c${index}`, type: "contact", label: `c${index}@example.com` });
    } else {
      nodes.push({ id: `b${index}`, type: "bank", label: `BANK ${index}` });
    }
  }
  const edges: Graph["edges"] = [];
  for (let index = 0; index < domains; index += 1) {
    const other = nodes[domains + (index % (total - domains))]!;
    edges.push({ a: `d${index}`, b: other.id, weight: 0.8, kind: "domain" });
  }
  return { version: 7, nodes, edges, clusters: [], insight: "synthetic" };
}
