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
      {
        source: "/mock-stream/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value:
              "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'self'",
          },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
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
