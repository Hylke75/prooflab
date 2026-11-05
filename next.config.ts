import type { NextConfig } from "next";

// Cache Components stays off: every page sits behind a login and renders per request.
const nextConfig: NextConfig = {
  poweredByHeader: false,
  // PDF-tekstextractie (lib/pdf-text.ts) draait alleen op de server; niet bundelen, Node laadt het pakket zelf.
  serverExternalPackages: ["unpdf"],
  // Fase 1 · punt 3: een transcriptbestand gaat alleen in het geheugen naar een server action (nooit naar Storage).
  // Bestanden tot 4 MB (lib/domain/transcript-parse.ts) plus de formuliervelden; Vercel staat 4,5 MB per verzoek toe.
  experimental: {
    serverActions: { bodySizeLimit: "4.5mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  // Gebruikerstest A9: "besluit" staat op de pagina Bewijs & besluit; een oud of zelf getypt adres komt daar uit.
  async redirects() {
    return [{ source: "/app/ideas/:id/decision", destination: "/app/ideas/:id/evidence", permanent: false }];
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
