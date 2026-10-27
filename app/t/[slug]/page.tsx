import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAnon } from "@/lib/supabase/server";
import { consentText, variantFor, visitorFromRequest } from "@/lib/public-test";
import { HONEST_REVEAL } from "@/lib/domain/labels";
import type { PricingConfig } from "@/lib/experiment-metrics";
import { PublicTest } from "./PublicTest";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Public, brand-neutral test page. No cookies, no third-party scripts, no ProofLab branding
// (that would bias the test). A transparent footer names who runs the research.
export default async function TestPage({ params }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  if (!/^[a-f0-9]{14}$/.test(slug)) notFound();
  const { data } = await supabaseAnon().rpc("get_public_test", { p_slug: slug });
  if (!data) notFound();
  const test = data as { type: "landing" | "pricing" | "interview"; state: string; config: PricingConfig; ends_at: string | null };
  if (test.type === "interview") notFound();
  const c = test.config;
  const visitor = await visitorFromRequest(slug);
  const price = test.type === "pricing" ? c.price_points[variantFor(visitor.hash, c.price_points.length)] ?? null : null;
  const live = test.state === "live";
  const closed = ["ended", "analyzed", "decided"].includes(test.state);

  return (
    <div className="tp">
      {!live && !closed && <div className="banner-preview">Voorbeeld: deze test is nog niet gepubliceerd. Bezoeken en klikken worden niet geteld.</div>}
      {test.state === "paused" && <div className="banner-preview">Deze test is tijdelijk gepauzeerd.</div>}
      <main className="tp-main">
        {closed ? (
          <div className="tp-card">
            <h1 style={{ fontSize: 34 }}>Dit onderzoek is afgerond.</h1>
            <p>Bedankt voor je belangstelling.</p>
          </div>
        ) : (
          <PublicTest
            slug={slug}
            live={live}
            kind={test.type}
            headline={c.headline}
            subline={c.subline}
            offer={c.offer}
            ctaLabel={c.cta_label}
            collectEmail={c.collect_email}
            revealMessage={c.reveal_message}
            honestReveal={HONEST_REVEAL}
            consentText={consentText(c.researcher)}
            price={price}
          />
        )}
      </main>
      <footer className="tp-foot">
        Dit is een marktonderzoek van {c.researcher}. Er worden geen cookies geplaatst en er wordt niets verkocht. Je bezoek wordt
        anoniem en zonder tracking meegeteld.
      </footer>
    </div>
  );
}
