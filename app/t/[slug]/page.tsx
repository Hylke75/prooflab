import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { supabaseAnon } from "@/lib/supabase/server";
import { consentText, variantFor, visitorFromRequest } from "@/lib/public-test";
import { HONEST_REVEAL, revealMessageFor } from "@/lib/domain/labels";
import type { PricingConfig } from "@/lib/experiment-metrics";
import { PublicTest } from "./PublicTest";
import { privacyNotice, privacyOf } from "@/lib/domain/test-privacy";
import { depositText } from "@/lib/integrations/mollie";
import { mollieEnvironment } from "@/lib/integrations/mollie-server";

export const metadata: Metadata = { robots: { index: false, follow: false } };

// Public, brand-neutral test page. No cookies, no third-party scripts, no ProofLab branding
// (that would bias the test). A transparent footer names who runs the research.
export default async function TestPage({ params, searchParams }: PageProps<"/t/[slug]">) {
  const { slug } = await params;
  const sp = await searchParams;
  if (!/^[a-f0-9]{14}$/.test(slug)) notFound();
  const { data } = await supabaseAnon().rpc("get_public_test", { p_slug: slug });
  if (!data) notFound();
  const test = data as { type: "landing" | "pricing" | "interview" | "survey"; state: string; config: PricingConfig; ends_at: string | null };
  if (test.type === "interview" || test.type === "survey") notFound(); // surveys have their own public page
  const c = test.config;
  const visitor = await visitorFromRequest(slug);
  const price = test.type === "pricing" ? c.price_points[variantFor(visitor.hash, c.price_points.length)] ?? null : null;
  const live = test.state === "live";
  const closed = ["ended", "analyzed", "decided"].includes(test.state);
  const privacy = privacyOf(c);
  // Fase 2 · punt 4: de betaalstap alleen als hij in de goedgekeurde configuratie staat en Mollie hier is ingesteld.
  const depositAmount = Number(c.deposit?.amount_eur);
  const deposit =
    c.deposit?.enabled && depositAmount > 0 && mollieEnvironment().ready
      ? { amount: depositAmount, lines: depositText(depositAmount, c.product_name, privacy?.controller_name || c.researcher) }
      : null;

  return (
    <div className="tp">
      {!live && !closed && <div className="banner-preview">Voorbeeld: deze test is nog niet gepubliceerd. Bezoeken en klikken worden niet geteld.</div>}
      {test.state === "paused" && <div className="banner-preview">Deze test is tijdelijk gepauzeerd.</div>}
      <main className="tp-main">
        {sp.reservering === "1" && !closed ? (
          // Terug van Mollie. De status komt van Mollie zelf (webhook); deze pagina zegt niets over "betaald".
          <div className="tp-card">
            <h1 style={{ fontSize: 34 }}>Dank je wel.</h1>
            <p>Zodra Mollie je aanbetaling bevestigt, telt je reservering mee. Je krijgt het volledige bedrag terug na afloop van het onderzoek.</p>
            <p style={{ fontSize: 14 }}>Heb je de betaling afgebroken? Dan is er niets afgeschreven en hoef je niets te doen.</p>
          </div>
        ) : closed ? (
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
            revealMessage={revealMessageFor(c.reveal_message, !!c.collect_email)}
            honestReveal={HONEST_REVEAL}
            consentText={consentText(c.researcher)}
            price={price}
            deposit={deposit}
          />
        )}
      </main>
      <footer className="tp-foot">
        {/* Bevinding 10: met de AVG-tekst eronder staat de uitleg over cookies en meetellen daar één keer. */}
        {privacy
          ? `Dit is een marktonderzoek van ${c.researcher}. Er wordt niets verkocht.`
          : `Dit is een marktonderzoek van ${c.researcher}. Er worden geen cookies geplaatst en er wordt niets verkocht. Je bezoek wordt anoniem en zonder tracking meegeteld.`}
        {/* Fase 2 · punt 4: AVG-tekst met de verwerkingsverantwoordelijke (nieuwe tests; oudere tests houden de tekst hierboven). */}
        {privacy && (
          <section aria-label="Privacy" style={{ marginTop: 10 }}>
            {privacyNotice(privacy, { deposit: !!c.deposit?.enabled, researcher: c.researcher }).map((line) => (
              <p key={line} style={{ margin: "4px 0" }}>{line}</p>
            ))}
          </section>
        )}
      </footer>
    </div>
  );
}
