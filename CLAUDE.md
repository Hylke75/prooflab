# CLAUDE.md — ProofLab: bouwopdracht en visuele contracten

> **Dit bestand hoort in de root van het Claude Code-project. Lees eerst alle drie de bestanden:**
>
> 1. **CLAUDE.md** (dit bestand) — bindende bouw-, UX- en designafspraken.
> 2. **design/REFERENCE_MOCKUPS.html** — de gezaghebbende visuele én interactieve referentie. Alle HTML, CSS, responsive regels en demo-interacties zijn beschikbaar.
> 3. **docs/FUNCTIONEEL_ONTWERP.md** — volledig functioneel/technisch productontwerp, inclusief marktvalidatiemethode en acceptatietests.
>
> **Live referentie:** https://prooflab-interactieve-mockups.rosycomet4.chatgpt.site

## 1. Hoofdopdracht

Bouw ProofLab als een echte, productiegerichte webapp voor ideeënvalidatie: intuïtieve onboarding, diepgaand brongebonden marktonderzoek, concurrentieonderzoek, TAM/SAM/SOM, klantonderzoek, aannames, hypotheses, experimenten, evidence, besluiten en hoogwaardige rapporten.

**De visuele opdracht is een zo exact mogelijke reproductie van de HTML-mock-ups.** Behandel design/REFERENCE_MOCKUPS.html als de design source of truth. Voer geen eigen redesign door zonder aantoonbare UX-, toegankelijkheids- of technische reden.

**De functionele opdracht is een werkende app, niet een demo.** De huidige mock-up gebruikt bewust fictieve cijfers en gebeurtenissen. In de echte applicatie verwijder je nepresultaten. Data komt uit toegestane bronnen, handmatige invoer en meetbare echte experimenten. Ontbreekt een externe connector, toon dan een eerlijke niet-verbonden-status met een bruikbaar handmatig alternatief.

## 2. Voorrangsregels

1. **Veiligheid, privacy, bronbetrouwbaarheid en functionaliteit:** functioneel ontwerp plus dit bestand.
2. **Look & feel, exacte kleuren, spacing, typografie, icoonvorm en responsive gedrag:** de werkende HTML.
3. **Bedieningsflow:** de HTML-mock-up, aangevuld met de productievereisten van het functioneel ontwerp.
4. **Techniek:** Next.js, React, TypeScript strict, Tailwind, toegankelijke componenten, Postgres/Supabase en getypeerde backend.

Let op: het eerste ontwerpdocument bevat bij enkele kleuren kleine verschillen met de later gemaakte mock-ups. **Bij visuele verschillen wint altijd de definitieve HTML-mock-up.**

## 3. Definitief design system

Gebruik de CSS-tokens uit de HTML letterlijk of map ze op identieke waarden in je Tailwind-theme:

~~~css
:root {
  --ink: #151b28;
  --blue: #4557f4;
  --blueDark: #3041d8;
  --coral: #ff7962;
  --lime: #e0f49d;
  --mint: #d5f2e6;
  --cream: #f7f7f3;
  --white: #fff;
  --line: #e6e8e5;
  --muted: #747d8e;
  --soft: #f2f3ef;
  --red: #d65b60;
  --amber: #a66a23;
  --green: #177f60;
  --shadow: 0 10px 30px rgba(25,33,44,.055);
  --radius: 20px;
}
~~~

- Display, headings en woordmerk: **Space Grotesk**, gewichten zoals origineel.
- Body, formulieren, labels en buttons: **DM Sans**.
- App-achtergrond: warm off-white; kaarten wit; sidebar donker.
- Primair blauw: #4557f4. Meeste buttons 43px minimaal en border-radius 12px.
- Hoofdkaarten: 20px radius, heel subtiele rand en schaduw.
- Headerlabel/eyebrow: uppercase 10px, tracking .14em, weight 800.
- Icons: hergebruik de consistente lijn-SVG-symbolen uit de originele bron, geen gemengde iconfonts.
- Grafieken rustig en precies, met zichtbare eenheden en labels.
- Interacties .18–.25s, met ondersteuning voor reduced-motion.

### Layout bij desktop

~~~css
.app { display:grid; grid-template-columns:236px minmax(0,1fr) 310px; min-height:100vh; }
.sidebar { position:sticky; top:0; height:100vh; }
.topbar { height:83px; position:sticky; top:0; }
.workspace { padding:36px clamp(20px,3vw,46px) 60px; }
.coach { position:sticky; top:0; height:100vh; }
~~~

- Bij maximaal 1480px: sidebar 214px en coach 278px.
- Bij maximaal 1160px: coach als slide-over via zwevende knop.
- Bij maximaal 850px: sidebar als mobiele drawer.
- Bij maximaal 560px: kaarten en hoofdgrids naar één kolom, eenvoudiger concurrentieweergave.
- Houd touch targets minimaal 44px en focus states duidelijk. WCAG 2.2 AA is de kwaliteitsdoelstelling.

## 4. Componentinventaris (exacte HTML-referentie)

| React-component | Originele class of ID | Gedrag |
|---|---|---|
| AppShell | .app, .workspace | Driekoloms desktop, responsive |
| SidebarNav | .sidebar, .nav-link | Actieve route, mobiel drawer |
| Topbar | .topbar, .crumb | Context, account, help |
| AICoachPanel | .coach, .coach-toggle | Schermcontext en suggesties |
| HeroBanner | .hero | Illustratieve collage en CTA |
| IdeaCard | .idea, .progress | Idee, status, volgende stap |
| GuidedIntake | .wizard-step, .choice | Eén vraag tegelijk, terug/volgende |
| ResearchTabs | .tabs, .tab-panel | Vijf tabs zonder paginaverlies |
| CompetitorComparison | .competitor-row, .filter-btn | Filters en detail |
| MarketSizingCalculator | .scenario-inputs | Live, deterministische formule |
| RiskMatrix | .risk-grid, .risk-dot | Klikbare punten en lijstsync |
| ExperimentPicker | .exp-options | Drie testtypes |
| TestCard | .form-line, .double-field | Hypothese, doelgroep, criteria |
| ExperimentPreview | .preview-mini | Live voorbeeld zonder publiceren |
| EvidenceTimeline | .evidence-event | Herleidbaar bewijs en tegenbewijs |
| DecisionSelector | .decision-option | Expliciet menselijke keuze |
| ExecutiveReport | .report-paper | Printable/PDF-layout |
| Toast en Modal | .toast, .modal | Heldere feedback |

## 5. Exacte schermen en informatiehiërarchie

### A. Dashboard — #screen-dashboard

1. Hero met zachte paarse/blauwe ondergrond, kop **Van goed idee naar sterk bewijs.**, één primaire actie **Nieuw idee onderzoeken**.
2. Rechts geometrische compositie: gedraaid elektrisch blauw blok, wit pictogram, zwevende labels, koraal cirkel en dunne omtrek.
3. Drie eenvoudige KPI-kaarten. In productie echte projecttotalen, niet de demo-aantallen.
4. Twee IdeaCards met icoon, status, titel, één-regel-propositie, voortgang en next action.
5. Onderaan aanbevolen vervolgacties en een mintgroen uitlegkaartje.
6. Rechts coach met maximaal drie suggesties, afgestemd op de huidige stap.

### B. Intake — #screen-intake

- Headline **Elk sterk idee begint met een goede vraag.**
- Een stapbalk met ronde nummers, maar slechts één actieve vraag.
- Vier vragen: idee, doelgroep, land/regio, eerste onderzoeksvraag.
- Antwoordkeuzes zijn grote klikbare kaarten met blauw kader bij selectie.
- Donkere ondersteunende advieskaart rechts.
- Onderaan **Vorige** en **Volgende stap**.
- Bij afronding moet productie een echt project aanmaken, opslaan en de onderzoeksfase openen.

### C. Marktverkenning — #screen-research

**Dit scherm verdient de meeste ontwikkeltijd.** Het bevat vijf tabs:

1. **Marktbeeld:** kerngegevens, echte trendgrafiek, kansenhypotheses, drie soorten alternatieven.
2. **Concurrenten:** filters alles/direct/indirect/huidig alternatief; scanbare vergelijking; klikbaar brongebonden profiel met prijspeildatum.
3. **Doelgroepen:** eindgebruiker, betaler/beslisser, aanbodzijde; echte JTBD; onderzoeksvragen.
4. **Marktpotentieel:** links bewerkbare aannames, rechts donker scenarioresultaat met zichtbare formule en bron-/onzekerheidsstatus.
5. **Bronnen:** origineel rapport/dataset/URL, datum, fragment, kwaliteitslabel, herkomst en koppeling naar concrete claim.

Gebruik researchjobs met echte voortgang, echte bronnen en broncontrole. Een geschat websitebezoek is geen bewezen marktomvang. Een LLM-tekst is geen bron. Alle ontbrekende data expliciet als onbekend tonen.

### D. Aannames — #screen-assumptions

- Kop **Wat moet waar zijn?**
- Links visuele 2×2-risicokaart met klikbare punten.
- Rechts risicoprioriteitenlijst, één selectie, details en advies.
- Bij een andere selectie verandert de detailkaart zonder page reload.
- Heldere primaire CTA **Kies een passende test**.

### E. Experimentenstudio — #screen-experiment

- Kop **Niet raden. Testen.**
- Drie opties bovenaan: landingpage-test, klantinterview, prijs-/aanbodtest.
- Onderin links het Test Card-formulier; rechts een live preview van wat de klant ziet.
- Wisselen van testtype past de preview direct aan.
- Vanaf **Start** maakt productie eerst een controleerbare experimenteerconfiguratie; publicatie/budget pas na expliciet akkoord.
- Daarna een echt live dashboard op basis van ingestuurde en gededupliceerde events.

### F. Bewijs & besluit — #screen-evidence

- Kop **Wat weten we nu echt?**
- Een menselijke samenvatting bovenaan, inclusief onzekerheden.
- Links meetbare bewijsitems én ontbrekend bewijs.
- Rechts een compacte, exclusieve lijst met vervolgbesluiten.
- Klik **Bewaar mijn keuze** → maak een echte beslissing met auditinformatie → rapport bijwerken.

### G. Rapportage — #screen-report

- Premium witte rapportpagina midden op de rustige appcanvas.
- Cover met ProofLab-merk, rapportstatus, projectnaam en managementsamenvatting.
- Duidelijke hoofdstukken met strakke typografie en rustige KPI-blokken.
- Printstylesheet verbergt navigatie en coach.
- Echte rapporten hebben bronvoetnoten, onderzoeksdatum, beperkingen, ruwe meetdata, tegenargumenten, besluit en implementatieadvies.

## 6. Interacties die behouden moeten blijven

1. Actieve navigatieknop verandert bij routewisseling.
2. Het coachpaneel verandert inhoud en suggesties per scherm.
3. Intake gaat één vraag vooruit of terug; opties krijgen direct een zichtbare selectie.
4. Onderzoekstabs switchen instant zonder dat de rest verdwijnt.
5. Concurrentfilters werken; detail opent een panel/modal.
6. Marktgrootte-sliders rekenen onmiddellijk door. Geen LLM nodig voor de berekening.
7. Risicopunt en aannamelijst synchroniseren.
8. Experimentselectie actualiseert direct preview en criteria.
9. Teststart gaat naar lopende teststatus met evidence-records.
10. Besluitkeuze verschijnt in rapport en database.
11. Overlays sluiten met Escape; mobile heeft drawer en coachknop.
12. Loading, error, empty, retry en success zijn echte ontworpen states.

## 7. Bouwfasen

### Fase 0 — Inspectie en baseline

- Behoud bestaande bestanden. Lees alle meegeleverde documenten volledig.
- Start de bijgevoegde HTML lokaal en maak vergelijkbare screenshots op desktop/tablet/mobiel.
- Maak componentenplan en een overzicht van bestaande projectafhankelijkheden.

### Fase 1 — Design 1-op-1 overnemen

- Gebruik Next.js/TypeScript/Tailwind en bouw de exacte shell, kleuren, lettertypen, SVG's en componenten.
- Port alle schermen met consistente state/routes en de beschreven interacties.
- Houd de demonstratiemodus duidelijk gelabeld tot echte data gekoppeld is.
- Maak visuele screenshots en corrigeer afwijkingen. Geen herontwerp.

### Fase 2 — Echte bedrijfslogica

- Auth, organisaties, projectdata, rollen en RLS.
- Persistente intake en ideeën.
- Diepgaand marktonderzoek met legitieme providers en bronbibliotheek.
- Concurrentie-, klanten-, markt- en scenarioanalyse.
- Aannames, hypotheses, experiments, evidence, besluiten en rapporten.
- Echte observaties en verifieerbare uitkomsten, nooit nepvalidatie.

### Fase 3 — Productiekwaliteit

- Mobiel, tablet, desktop visueel gecontroleerd.
- Accessibility, foutmeldingen, back/undo, goede empty states.
- Typecheck, tests, database migrations, sample env, documentatie.
- Event ingestion idempotent, geen dode knoppen, privacycontroles.

## 8. Verplichte acceptatiecriteria

- [ ] Layout, kleuren, typografie, afstanden en kaarten komen nauw overeen met de HTML bij gelijke viewport.
- [ ] Hero, sidebar, coach en bovenbalk hebben dezelfde verhoudingen.
- [ ] Headline-wrapping en CTA-grootte wijken niet onnodig af.
- [ ] Alle schermen hebben dezelfde visuele hiërarchie.
- [ ] Intake, tabs, filters, scenario calculator, risicokaart, experimentselectie en besluit werken.
- [ ] Mobiele interacties zijn ontworpen, niet simpelweg mini-desktop.
- [ ] Elke claim in onderzoek toont de juiste bron of is zichtbaar een hypothese.
- [ ] Een AI-bewering wordt nooit als echt klantbewijs geteld.
- [ ] Ruwe observaties en rapporten blijven herleidbaar.
- [ ] Visuele afwijkingen worden bijgehouden in DESIGN_DIFF_LOG.md.
- [ ] Alle fases worden bijgehouden in IMPLEMENTATION_STATUS.md.
- [ ] E2E-journey idee → onderzoek → risico → test → bewijs → besluit → rapport slaagt.

## 9. Werkwijze en oplevering

Begin onmiddellijk met het lezen van de drie bestanden en het inspecteren van de repository. Start daarna met een visueel vrijwel exacte React-reproductie van de schermen. Bouw vervolgens volgens het functioneel ontwerp de echte functies. Lever na iedere fase een werkende toestand, uitgevoerde tests, eventuele ontbrekende toegangsgegevens en een concreet voortgangsoverzicht.

Vraag alleen om noodzakelijke toegang, externe uitgaven en publicatiegoedkeuring. Houd de app bruikbaar wanneer externe API's nog niet zijn gekoppeld. **Claim nooit dat een functie af is wanneer hij alleen demo-uitvoer toont.**
