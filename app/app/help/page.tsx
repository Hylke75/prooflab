import type { Metadata } from "next";
import { PageFrame } from "@/components/shell/PageFrame";
import { configuredProviders, trackingConfigured } from "@/lib/env";
import { PROVIDERS, PROVIDER_LABELS } from "@/lib/ai/providers/config";

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
  ["Test Card", "Het testplan dat vóór de start wordt vastgelegd: wat we denken, hoe we het toetsen, wat we meten, de beslisregel en wanneer het klopt of niet. ProofLab rekent vooraf uit hoeveel deelnemers nodig zijn bij de verwachte uitkomst en waarschuwt als dat niet haalbaar is in de looptijd. Na goedkeuring zijn drempels, beslisregel en dat aantal vergrendeld."],
  ["95%-interval", "De bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt. Bij weinig deelnemers is die breed. In methode 2026-11-b staat het ter informatie naast het oordeel; ligt bij een geslaagde test ook de ondergrens boven de drempel, dan heet de uitkomst \"sterk bewezen\". In methode 2026-11-a is een test alleen geslaagd als het hele interval boven de drempel ligt."],
  ["Kansregel", "De beslisregel voor tests die een percentage meten (landingpagina, prijstest op klikniveau, enquête, interviews). Geslaagd als de kans dat het echte percentage boven de succesdrempel ligt minstens 80% is; niet geslaagd als de kans dat het boven de faaldrempel ligt 20% of minder is; daartussen onbeslist. Voor sterke handelingen zoals aanbetalingen geldt in plaats daarvan een vast aantal, bijvoorbeeld \"minstens 3 aanbetalingen uit 15 gesprekken\"."],
  ["Learning Card", "De samenvatting na een test: wat we verwachtten, wat we zagen, wat we daaruit leren en wat we daarom doen, met de beslisregel, de kans of het aantal, het 95%-interval, het label en de betrouwbaarheid van de data. Een goedgekeurde kaart verandert nooit meer."],
  ["Plafond", "De hoogste kans die een aanname kan krijgen bij het bewijs dat er is: met alleen meningen, enquêtes en bureauonderzoek 40%, met een probleem in eigen gedrag 50%, met een kleine handeling 60%, met een gekozen prijsaanbod 75%, met een aanbetaling 90%; een herhaalaankoop heeft geen plafond. ProofLab toont dan bijvoorbeeld \"begrensd: nog geen aanbetaling\". De eigenaar van de werkruimte kan de plafonds aanpassen."],
  ["Methodeversie", "De vaste rekenwijze van een dossier, zodat elke kans en elk oordeel te reproduceren is. 2026-11-a is de oude rekenwijze (intervalregel, geen samenvoegen per bron, geen plafonds); 2026-11-b voegt de beslisregels, één factor per bron en de plafonds toe. Bestaande dossiers kunnen overstappen na een overzicht van wat er verandert; elk rapport vermeldt de versie."],
  ["Reality Check", "Een verplichte controle vóór elk besluit en rapport. Hij zoekt naar tegenbewijs, zwakke data, valkuilen en conclusies die het bewijs niet draagt, en geeft een advies."],
  ["Besluit", "Doorgaan, bijsturen, verder testen, pauzeren of stoppen. De consultant legt het vast, de opdrachtgever bevestigt het in ProofLab."],
  ["Rapportversie", "Een vaste momentopname van het dossier. Een gedeelde versie verandert nooit meer; de opdrachtgever ziet alleen gedeelde versies."],
];

export default function HelpPage() {
  return (
    <PageFrame crumbs={["Werkruimte", "Zo werkt ProofLab"]} coach="other">
      <div className="section-row">
        <div>
          <div className="eyebrow">Zo werkt ProofLab</div>
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
        <span id="methode" />
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
          {PROVIDERS.map((p) => (
            <div className="data-row" key={p}><span>AI-onderzoek ({PROVIDER_LABELS[p].name}, webzoeken)</span><span className={`pill ${configuredProviders().includes(p) ? "green" : "orange"}`}>{configuredProviders().includes(p) ? "Verbonden" : "Niet verbonden"}</span></div>
          ))}
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
