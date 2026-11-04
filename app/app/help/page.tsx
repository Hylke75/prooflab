import type { Metadata } from "next";
import { PageFrame } from "@/components/shell/PageFrame";
import { configuredProviders, trackingConfigured } from "@/lib/env";
import { PROVIDERS, PROVIDER_LABELS } from "@/lib/ai/providers/config";

export const metadata: Metadata = { title: "Zo werkt ProofLab" };

const STEPS = [
  ["Beslissing en idee", "Je begint bij de beslissing die het onderzoek moet ondersteunen. ProofLab maakt een onderzoekskaart van maximaal vijf beslissende vragen."],
  ["Markt", "Bevindingen tellen alleen met een letterlijk citaat uit een bron. ProofLab controleert het citaat zelf en berekent de status: geverifieerd, onderbouwde schatting, onvoldoende bewijs, tegenstrijdig (bronnen bevestigen én spreken tegen), weerlegd (alleen tegensprekende bronnen) of verouderd."],
  ["Aannames", "Wat moet waar zijn? De risicokaart zet belangrijkheid af tegen de berekende kans dat een aanname klopt. Kans en rangorde worden uit gekoppeld bewijs berekend, niet geschat. Een gekoppelde bevinding die (nog) niet meetelt, bijvoorbeeld omdat bronnen elkaar tegenspreken, staat apart met de reden."],
  ["Testen", "Je legt vóór de test vast wat je meet en wanneer het klopt. Na goedkeuring is dat vergrendeld. Testpagina's meten zonder cookies en zijn eerlijk over wat er (nog) niet bestaat."],
  ["Besluiten", "Een uitspraak volgt pas na de eindconditie, met een 95%-interval. De Reality Check zoekt tegenbewijs en valkuilen; daarna besluit je: doorgaan, bijsturen, verder testen, een verlengde testfase, pauzeren of stoppen. ProofLab toetst het besluit aan de vooraf vastgelegde beslisregel; de opdrachtgever bevestigt na de samenvatting \"Wat ging tegen\"."],
];

const GLOSSARY: [string, string][] = [
  ["Validatiesprint", "Een vast traject van 4 tot 6 weken: week 1 onderzoek, week 2 aannames en testontwerp, daarna testen, en de laatste week besluit en rapport. ProofLab laat zien als het dossier achterloopt op de week."],
  ["Beslisvraag", "De beslissing die het onderzoek moet ondersteunen, bijvoorbeeld \"investeren we €25.000 in een eerste versie?\". Alles in het dossier is daaraan gekoppeld."],
  ["Bevinding met bron", "Een uitspraak over de markt met een letterlijk citaat uit een bron. ProofLab zoekt het citaat zelf terug; een AI-tekst is nooit een bron."],
  ["Aanname", "Iets wat waar moet zijn voordat het idee kan slagen. De risicokaart zet de belangrijkheid af tegen het bewijs dat er al is."],
  ["Test Card", "Het testplan dat vóór de start wordt vastgelegd: wat we denken, hoe we het toetsen, wat we meten, de beslisregel en wanneer het klopt of niet. ProofLab rekent vooraf uit hoeveel deelnemers nodig zijn bij de verwachte uitkomst en waarschuwt als dat niet haalbaar is in de looptijd. Na goedkeuring zijn drempels, beslisregel en dat aantal vergrendeld."],
  ["95%-interval", "De bandbreedte waarbinnen de werkelijke waarde vrijwel zeker ligt. Bij weinig deelnemers is die breed. In methode 2026-11-b en 2026-11-c staat het ter informatie naast het oordeel; ligt bij een geslaagde test ook de ondergrens boven de drempel, dan heet de uitkomst \"sterk bewezen\". In methode 2026-11-a is een test alleen geslaagd als het hele interval boven de drempel ligt."],
  ["Kansregel", "De beslisregel voor tests die een percentage meten (landingpagina, prijstest op klikniveau, enquête, interviews). Geslaagd als de kans dat het echte percentage boven de succesdrempel ligt minstens 80% is; niet geslaagd als de kans dat het boven de faaldrempel ligt 20% of minder is; daartussen onbeslist. Voor sterke handelingen zoals aanbetalingen geldt in plaats daarvan een vast aantal, bijvoorbeeld \"minstens 3 aanbetalingen uit 15 gesprekken\"."],
  ["Learning Card", "De samenvatting na een test: wat we verwachtten, wat we zagen, wat we daaruit leren en wat we daarom doen, met de beslisregel, de kans of het aantal, het 95%-interval, het label met het bewijsniveau en de betrouwbaarheid van de data. Een goedgekeurde kaart verandert nooit meer."],
  ["Plafond", "De hoogste kans die een aanname kan krijgen bij het bewijs dat er is: met alleen meningen, enquêtes en bureauonderzoek 40%, met een probleem in eigen gedrag 50%, met een kleine handeling 60%, met een gekozen prijsaanbod 75%, met een aanbetaling 90%; een herhaalaankoop heeft geen plafond. ProofLab toont dan bijvoorbeeld \"begrensd: nog geen aanbetaling\". De eigenaar van de werkruimte kan de plafonds aanpassen."],
  ["Methodeversie", "De vaste rekenwijze van een dossier, zodat elke kans en elk oordeel te reproduceren is. 2026-11-a is de oude rekenwijze (intervalregel, geen samenvoegen per bron, geen plafonds); 2026-11-b voegt de beslisregels, één factor per bron en de plafonds toe; 2026-11-c laat herhaling binnen dezelfde wervingsgroep afnemend meetellen, telt AI-codering pas na beoordeling en laat alleen de hoofdtest over een aanname beslissen; 2026-11-d telt ook tegenbewijs per bron één keer, zodat vijf bezwaren van één geïnterviewde de kans één keer verlagen; 2026-11-e (standaard voor nieuwe dossiers) laat een weerlegde bevinding waarop een aanname leunt meetellen als tegenbewijs. Bestaande dossiers kunnen alleen vooruit overstappen, na een overzicht van wat er verandert; elk rapport vermeldt de versie."],
  ["Niet gekalibreerd", "Zolang je werkruimte minder dan 10 dossiers met een vastgelegde uitkomst heeft, kunnen we niet toetsen of onze kansen kloppen. Daarom tonen we een kans dan in een band van 10 procentpunt, bijvoorbeeld \"40–50%\", met het label \"niet gekalibreerd\". De exacte waarde staat in de tooltip."],
  ["Wervingsgroep", "Via welke weg de deelnemers van een test zijn geworven: eigen netwerk (mensen die je kent, ook bekenden in interviews), warm contact (via een introductie of community), koud (zonder eerdere relatie), betaald panel of onbekend. Verplicht bij enquête-, landing- en prijstests. In methode 2026-11-c telt herhaling binnen dezelfde groep afnemend mee: drie enquêtes onder je eigen netwerk zijn geen drie onafhankelijke bewijzen."],
  ["Startkans", "De kans dat een aanname klopt vóór enig bewijs; standaard 50%. Een andere waarde vraagt een korte onderbouwing, zoals het basispercentage. Zodra er bewijs aan de aanname hangt, is de startkans vergrendeld: wijzigen kan dan alleen met een reden, en die komt in het auditspoor."],
  ["Hoofdtest", "Per aanname wijs je vóór de goedkeuring één hoofdtest aan; de andere tests heten verkennend. In methode 2026-11-c beslist alleen de hoofdtest over de aanname. Bij een geslaagde kansregel staat de kans op toeval erbij (1 − de kans boven de drempel)."],
  ["Alle tests", "Elk rapport bevat verplicht de lijst van alle vooraf vastgelegde tests, ook afgebroken, mislukte en verkennende tests, met het aantal tests per aanname. Zo kan niemand achteraf kiezen welke test telt."],
  ["Bewijsniveau", "Naast elke uitkomst staat wat de test meet, volgens de niveaus van de plafonds: bijvoorbeeld \"Geslaagd · niveau: mening\" bij een enquête. Een geslaagde enquête is iets anders dan een geslaagde aanbetalingstest."],
  ["Brier-score", "Hoe dicht voorspelde kansen bij de echte uitkomsten lagen: 0 is perfect, 0,25 is wat altijd 50% zeggen oplevert. Onder 30 uitkomsten staat erbij: te weinig dossiers voor een betrouwbaar oordeel."],
  ["AI-concept", "Onderzoeksvragen, enquêtes en promoberichten kan AI voorstellen. ProofLab bewaart het AI-origineel en toont of een mens het heeft aangepast, met het aantal gewijzigde regels. AI-codering van interviews telt in methode 2026-11-c pas mee na jouw beoordeling."],
  ["Reality Check", "Een verplichte controle vóór elk besluit en rapport. Hij zoekt naar tegenbewijs, zwakke data, valkuilen en conclusies die het bewijs niet draagt, en geeft een advies."],
  ["Besluit", "Doorgaan, bijsturen, verder testen, doorgaan met testen (verlengde testfase), pauzeren of stoppen. De consultant legt het vast, de opdrachtgever bevestigt het in ProofLab."],
  ["Beslisregel", "Vóór de eerste goedgekeurde test leg je vast wanneer je doorgaat: welke aannames boven welke kans moeten uitkomen en welke hoofdtest moet slagen. Bij de eerste goedgekeurde test gaat de regel op slot. Bij het besluit toont ProofLab per voorwaarde of die is gehaald. Doorgaan zonder gehaalde regel, of stoppen terwijl hij wel is gehaald, kan alleen met een motivering; die staat in het auditspoor en in het rapport."],
  ["Wat ging tegen", "De samenvatting die de opdrachtgever ziet voordat hij een besluit bevestigt: mislukte tests, tegenbewijs, aannames die door hun bewijsniveau zijn begrensd en afwijkingen van de beslisregel. Bevestigen kan pas na het openen of aanvinken ervan."],
  ["Verlengde testfase", "Een optionele periode van 2 tot 8 weken na de sprint om meer gedragsbewijs te verzamelen, met het tussenbesluit \"doorgaan met testen\". Eén keer per dossier. Het definitieve besluit en de uitkomstklok starten pas daarna."],
  ["Eerst voorspellen", "Op elk voorspelmoment geef je eerst je eigen kans dat het doel wordt gehaald. Tot dan blijven de berekende kansen op de aanname- en bewijspagina en de voorspellingen van anderen vergrendeld, zodat niemand ankert. Dat geldt ook voor de opdrachtgever. De AI-modellen tellen samen als één stem: hun gemiddelde."],
  ["Uitkomst en inzet", "Zes maanden na het definitieve besluit leg je vast of het doel is gehaald, met bewijs en de inzet: gestart ja/nee, uren en budget ten opzichte van het plan. Is er niet gestart of minder dan de helft van het plan uitgevoerd, dan kan een consultant het dossier met een reden uit de kalibratie halen."],
  ["Terechte stop", "Na een stop- of pauzebesluit vervalt de uitkomstvraag. Zes maanden later volgt de vraag \"Was stoppen achteraf terecht?\" (ja, nee of onbekend, met bewijs). Gestopte dossiers tellen niet mee in de kalibratie van slagingskansen; ze krijgen een eigen telling op Voorspelkwaliteit."],
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
