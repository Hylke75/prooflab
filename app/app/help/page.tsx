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

const GLOSSARY: [string, string][] = [
  ["Validatiesprint", "Een vast traject van 4 tot 6 weken: week 1 onderzoek, week 2 aannames en testontwerp, daarna testen, en de laatste week besluit en rapport. ProofLab laat zien als het dossier achterloopt op de week."],
  ["Beslisvraag", "De beslissing die het onderzoek moet ondersteunen, bijvoorbeeld \"investeren we €25.000 in een eerste versie?\". Alles in het dossier is daaraan gekoppeld."],
  ["Bevinding met bron", "Een uitspraak over de markt met een letterlijk citaat uit een bron. ProofLab zoekt het citaat zelf terug; een AI-tekst is nooit een bron."],
  ["Aanname", "Iets wat waar moet zijn voordat het idee kan slagen. De risicokaart zet de belangrijkheid af tegen het bewijs dat er al is."],
  ["Test Card", "Het testplan dat vóór de start wordt vastgelegd: wat we denken, hoe we het toetsen, wat we meten en wanneer het klopt of niet. Na goedkeuring zijn de drempels vergrendeld."],
  ["95%-interval", "De bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt. Bij weinig deelnemers is die breed; een test is pas geslaagd als het hele interval boven de drempel ligt."],
  ["Learning Card", "De samenvatting na een test: wat we verwachtten, wat we zagen, wat we daaruit leren en wat we daarom doen, met de betrouwbaarheid van de data."],
  ["Reality Check", "Een verplichte controle vóór elk besluit en rapport. Hij zoekt naar tegenbewijs, zwakke data, valkuilen en conclusies die het bewijs niet draagt, en geeft een advies."],
  ["Besluit", "Doorgaan, bijsturen, verder testen, pauzeren of stoppen. De consultant legt het vast, de opdrachtgever bevestigt het in ProofLab."],
  ["Rapportversie", "Een vaste momentopname van het dossier. Een gedeelde versie verandert nooit meer; de opdrachtgever ziet alleen gedeelde versies."],
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
      <div className="card mt-18" id="begrippen">
        <div className="section-title">
          <h2 className="as-h3">Begrippen</h2>
          <span className="pill gray">Kort uitgelegd</span>
        </div>
        <dl className="glossary">
          {GLOSSARY.map(([term, text]) => (
            <div key={term}>
              <dt>{term}</dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
      </div>
      <div className="grid-2 mt-18">
        <div className="card">
          <h2 className="as-h3">Status van koppelingen</h2>
          <div className="data-row"><span>AI-onderzoek (Claude, webzoeken)</span><span className={`pill ${aiConfigured() ? "green" : "orange"}`}>{aiConfigured() ? "Verbonden" : "Niet verbonden"}</span></div>
          <div className="data-row"><span>Cookieloze meting op testpagina&apos;s</span><span className={`pill ${trackingConfigured() ? "green" : "orange"}`}>{trackingConfigured() ? "Actief" : "Niet geconfigureerd"}</span></div>
          <div className="data-row"><span>Advertentiekanalen (LinkedIn, Meta)</span><span className="pill gray">Handmatig via kanaallinks</span></div>
          <div className="data-row"><span>Betalingen</span><span className="pill gray">Niet in deze versie</span></div>
          <p className="tiny mt-12">Zonder AI werkt alles handmatig: bronnen toevoegen, citaten vastleggen, interviews coderen. Er worden nooit gesimuleerde resultaten getoond als echte.</p>
        </div>
        <div className="card">
          <h2 className="as-h3">Privacy en rechten</h2>
          <p className="sub mt-8">
            Testpagina&apos;s plaatsen geen cookies en tellen bezoekers met een niet-herleidbare code die per test verschilt. E-mailadressen worden alleen
            met toestemming bewaard (180 dagen). Interviews vragen vastgelegde toestemming en een pseudoniem. Opdrachtgevers zien geen ruwe
            persoonsgegevens. ProofLab is onafhankelijk en niet verbonden aan Strategyzer of de auteurs van Testing Business Ideas.
          </p>
        </div>
      </div>
    </PageFrame>
  );
}
