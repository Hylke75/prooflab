import type { NextConfig } from "next";

// Cache Components stays off: every page sits behind a login and renders per request.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      {
        // Nothing in ProofLab may be framed by another site (clickjacking, silent test clicks). The full
        // Content-Security-Policy (with frame-ancestors 'none') is set per request with a nonce in proxy.ts.
        source: "/(.*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        // Survey links can carry a personal token (?u=…): never pass the address on as a referrer.
        source: "/s/:path*",
        headers: [{ key: "Referrer-Policy", value: "no-referrer" }],
      },
    ];
  },
};

export default nextConfig;
