import type { Metadata, Viewport } from "next";
import { connection } from "next/server";
import { DM_Sans, Space_Grotesk } from "next/font/google";
import { IconSprite } from "@/components/Icon";
import "./globals.css";

// Fonts are downloaded at build time and served from our own domain (no Google request per visit).
const dmSans = DM_Sans({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-dm-sans", display: "swap" });
const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-space-grotesk", display: "swap" });

export const metadata: Metadata = {
  title: { default: "ProofLab", template: "%s · ProofLab" },
  description: "Van beslisvraag naar onderbouwd besluit: marktonderzoek met bronnen, echte experimenten en controleerbaar bewijs.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { themeColor: "#151b28" };

// Every page renders per request: the Content-Security-Policy nonce (proxy.ts) can only be applied to the
// framework's scripts at request time, never to a page prerendered at build time.
export default async function RootLayout({ children }: LayoutProps<"/">) {
  await connection();
  return (
    <html lang="nl" className={`${dmSans.variable} ${spaceGrotesk.variable}`}>
      <body>
        <IconSprite />
        {children}
      </body>
    </html>
  );
}
