import type { NextConfig } from "next";

import { env } from "./src/lib/env";
import {
  contentSecurityPolicy,
  securityHeaders,
} from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  async headers() {
    const apiOrigin = new URL(env.NEXT_PUBLIC_API_BASE_URL).origin;
    const dev = process.env.NODE_ENV !== "production";
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(apiOrigin, dev),
          },
          ...securityHeaders(),
        ],
      },
    ];
  },
};

export default nextConfig;
