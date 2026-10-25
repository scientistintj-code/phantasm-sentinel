import type { NextConfig } from "next";

import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  transpilePackages: ["@phantasm/core"],
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders(),
      },
    ];
  },
  async rewrites() {
    return [
      { source: "/console", destination: "/console/index.html" },
      { source: "/console/", destination: "/console/index.html" },
    ];
  },
};

export default nextConfig;
