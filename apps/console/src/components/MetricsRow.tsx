import { LuFingerprint, LuGlobe, LuServer, LuWaypoints } from "react-icons/lu";
import type { Graph } from "@phantasm/core";

export function MetricsRow({
  graph,
  riskText,
}: {
  graph: Graph | null;
  riskText: string;
}) {
  const domains = graph?.nodes.filter((node) => node.type === "domain") ?? [];
  const hosts = graph?.nodes.filter((node) => node.type === "host") ?? [];
  const relationships = graph?.edges.length ?? 0;
  const shared = graph ? sharedMerchantCount(graph) : 0;
  const confidence = graph?.clusters.reduce((best, cluster) => Math.max(best, cluster.confidence), 0) ?? 0;
  const domainLabel = domains.length <= 1 && riskText === "LOW RISK" ? "SAFE DOMAIN" : "OBSERVED DOMAINS";

  return (
    <div className="metrics">
      <div>
        <LuGlobe />
        <span>
          <strong>{domains.length}</strong>
          <small>{domainLabel}</small>
        </span>
        <em>{riskText || "—"}</em>
      </div>
      <div>
        <LuFingerprint />
        <span>
          <strong>{shared}</strong>
          <small>SHARED MERCHANTS</small>
        </span>
        <em>{shared > 0 ? "Critical link" : "None found"}</em>
      </div>
      <div>
        <LuServer />
        <span>
          <strong>{hosts.length}</strong>
          <small>HOST CLUSTER</small>
        </span>
        <em>{hosts.length > 0 ? (hosts[0]?.label ?? "Unlinked") : "Unlinked"}</em>
      </div>
      <div>
        <LuWaypoints />
        <span>
          <strong>{relationships}</strong>
          <small>RELATIONSHIPS</small>
        </span>
        <em>{graph ? `${Math.round(confidence * 100)}% confidence` : "—"}</em>
      </div>
    </div>
  );
}

function sharedMerchantCount(graph: Graph): number {
  const domains = new Set(graph.nodes.filter((node) => node.type === "domain").map((node) => node.id));
  return graph.nodes.filter((node) => node.type === "merchant").filter((merchant) => {
    const neighbors = new Set<string>();
    for (const edge of graph.edges) {
      if (edge.a === merchant.id && domains.has(edge.b)) neighbors.add(edge.b);
      if (edge.b === merchant.id && domains.has(edge.a)) neighbors.add(edge.a);
    }
    return neighbors.size >= 2;
  }).length;
}
