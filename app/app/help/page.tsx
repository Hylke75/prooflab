import type { Metadata } from "next";
import { PageFrame } from "@/components/shell/PageFrame";
import { aiConfigured, trackingConfigured } from "@/lib/env";

export const metadata: Metadata = { title: "Zo werkt ProofLab" };

const STEPS = [
  ["Beslissing en idee", "Je begint bij de beslissing die het onderzoek moet ondersteunen. ProofLab maakt een onderzoekskaart van maximaal vijf beslissende vragen."],
  ["Markt", "Bevindingen tellen alleen met een letterlijk citaat uit een bron. ProofLab controleert het citaat zelf en berekent de status: geverifieerd, onderbouwde schatting, onvoldoende bewijs, tegenstrijdig of verouderd."],
  ["Aannames", "Wat moet waar zijn? De risicokaart zet belangrijkheid af tegen bewijs. De bewijsas wordt berekend, niet geschat."],
  ["Testen", "Je legt vóór de test vast wat je meet en wanneer het klopt. Na goedkeuring is dat vergrendeld. Testpagina's meten zonder cookies en zijn eerlijk over wat er (nog) niet bestaat."],
  ["Besluiten", "Een uitspraak volgt pas na de eindconditie, met een 95%-interval. De Reality Check zoekt tegenbewijs en valkuilen; daarna besluit je: doorgaan, bijsturen, verder testen, pauzeren of stoppen."],
];

export default function HelpPage() {
  return (
    <PageFrame crumbs={["Werkruimte", "Zo werkt ProofLab"]} coach="other">
      <div className="section-row">
        <div>
          <div className="eyebrow">ZO WERKT PROOFLAB</div>
          <h1>Eén heldere stap tegelijk.</h1>
          <p className="sub">Een AI-antwoord is een hypothese of een bevinding met bron, nooit automatisch bewijs dat de markt zal kopen.</p>
        </div>
      </div>
      <div className="card">
        {STEPS.map(([t, d], i) => (
          <div className="quickline" key={t}>
            <span className="num">{i + 1}</span>
            <div><strong>{t}</strong><span>{d}</span></div>
          </div>
        ))}
      </div>
      <div className="grid-2 mt-18">
        <div className="card">
          <h3>Status van koppelingen</h3>
          <div className="data-row"><span>AI-onderzoek (Claude, webzoeken)</span><span className={`pill ${aiConfigured() ? "green" : "orange"}`}>{aiConfigured() ? "Verbonden" : "Niet verbonden"}</span></div>
          <div className="data-row"><span>Cookieloze meting op testpagina&apos;s</span><span className={`pill ${trackingConfigured() ? "green" : "orange"}`}>{trackingConfigured() ? "Actief" : "Niet geconfigureerd"}</span></div>
          <div className="data-row"><span>Advertentiekanalen (LinkedIn, Meta)</span><span className="pill gray">Handmatig via kanaallinks</span></div>
          <div className="data-row"><span>Betalingen</span><span className="pill gray">Niet in deze versie</span></div>
          <p className="tiny mt-12">Zonder AI werkt alles handmatig: bronnen toevoegen, citaten vastleggen, interviews coderen. Er worden nooit gesimuleerde resultaten getoond als echte.</p>
        </div>
        <div className="card">
          <h3>Privacy en rechten</h3>
          <p className="sub mt-8">
            Testpagina&apos;s plaatsen geen cookies en tellen bezoekers met een dagelijks wisselende, niet-herleidbare code. E-mailadressen worden alleen
            met toestemming bewaard (180 dagen). Interviews vragen vastgelegde toestemming en een pseudoniem. Opdrachtgevers zien geen ruwe
            persoonsgegevens. ProofLab is onafhankelijk en niet verbonden aan Strategyzer of de auteurs van Testing Business Ideas.
          </p>
        </div>
      </div>
    </PageFrame>
  );
}
