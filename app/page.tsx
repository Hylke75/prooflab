import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Landing } from "@/components/landing/Landing";
import { getUser } from "@/lib/data";

const TITLE = "ProofLab · Van idee naar bewijs in vijf weken";
const DESCRIPTION =
  "Validatiesprints voor consultants: onderzoek met controleerbare bronnen, tests met vooraf vastgelegde drempels en een besluit dat je opdrachtgever kan narekenen.";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000"),
  title: { absolute: TITLE },
  description: DESCRIPTION,
  alternates: { canonical: "/" },
  // De publieke voorkant mag gevonden worden; de app zelf blijft noindex (root layout).
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "nl_NL", siteName: "ProofLab", title: TITLE, description: DESCRIPTION, url: "/" },
  twitter: { card: "summary_large_image", title: TITLE, description: DESCRIPTION },
};

// Alleen "Naar de app" tonen als er een geldige sessie is. Zonder Supabase-configuratie of sessiecookie
// slaan we de controle over, zodat de pagina altijd werkt en geen onnodige aanroep doet.
async function isSignedIn(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return false;
  const store = await cookies();
  if (!store.getAll().some((c) => c.name.startsWith("sb-") && c.name.includes("auth-token"))) return false;
  try {
    return (await getUser()) !== null;
  } catch {
    return false;
  }
}

export default async function Home() {
  return <Landing signedIn={await isSignedIn()} />;
}
