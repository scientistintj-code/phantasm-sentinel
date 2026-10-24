import { LuFingerprint, LuGlobe, LuServer, LuWaypoints } from "react-icons/lu";
import type { Graph } from "@phantasm/core";
import { asnAnnotation, hostClusterCount, sharedMerchantCount } from "../graphModel";

export function MetricsRow({ graph }: { graph: Graph | null }) {
  const domains = graph?.nodes.filter((node) => node.type === "domain").length ?? 0;
  const shared = graph ? sharedMerchantCount(graph) : 0;
  const hosts = graph ? hostClusterCount(graph) : 0;
  const relationships = graph?.edges.length ?? 0;
  const hostNote = graph ? (asnAnnotation(graph) ?? "—") : "—";

  return (
    <div className="metrics">
      <div>
        <LuGlobe />
        <span>
          <strong>{domains}</strong>
          <small>OBSERVED DOMAINS</small>
        </span>
        <em>—</em>
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
          <strong>{hosts}</strong>
          <small>HOST CLUSTERS</small>
        </span>
        <em>{hostNote}</em>
      </div>
      <div>
        <LuWaypoints />
        <span>
          <strong>{relationships}</strong>
          <small>RELATIONSHIPS</small>
        </span>
        <em>—</em>
      </div>
    </div>
  );
}
