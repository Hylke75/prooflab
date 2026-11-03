import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { IconSprite } from "@/components/Icon";
import "./globals.css";

// Fonts are downloaded at build time and served from our own domain (no Google request per visit).
// Koppen: Plus Jakarta Sans (600–700). Body en UI: Inter (400/500/600). Zie docs/REDESIGN_INSTRUCTIE.md.
const inter = Inter({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-inter", display: "swap" });
const jakarta = Plus_Jakarta_Sans({ subsets: ["latin"], weight: ["500", "600", "700", "800"], variable: "--font-jakarta", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ProofLab", template: "%s · ProofLab" },
  description: "Van beslisvraag naar onderbouwd besluit: marktonderzoek met bronnen, echte experimenten en controleerbaar bewijs.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#ffffff" };

// Every page renders per request: the Content-Security-Policy nonce (proxy.ts) can only be applied to the
// framework's scripts at request time, never to a page prerendered at build time.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="nl" className={`${inter.variable} ${jakarta.variable}`}>
      <body>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
