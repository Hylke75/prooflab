# ProofLab — analyse van het ontwerp v1.0 en voorgestelde verbeteringen (v1.1)

**Datum:** 27 oktober 2026
**Basis:** `docs/FUNCTIONEEL_ONTWERP.md` (versie 1.0), `CLAUDE.md` en `design/REFERENCE_MOCKUPS.html` (handoffpakket)
**Doel:** gaten, tegenstrijdigheden en risico's in het ontwerp benoemen en oplossen *voordat* er code wordt geschreven. Waar dit document afwijkt van v1.0, geldt dit document zodra de opdrachtgever akkoord geeft.

---

## 1. Oordeel in het kort

Het ontwerp is inhoudelijk sterk: de gouden regel (AI-output is hypothese, geen bewijs), de bewijstypologie, de vooraf vergrendelde drempels en de rode vlaggen zijn precies wat dit product onderscheidt. De methodische kern hoeft niet anders.

De grootste risico's zitten niet in de visie, maar in **uitvoerbaarheid**:

1. **De scope is die van een volwassen SaaS, niet van een v1.** 21 routes, 13 agents, 27 tabellen, 7 volledig uitgevoerde experimenttypen, 5 integraties, PDF-rapportage en multi-tenant RLS. Zo duurt het lang voordat er iets bruikbaars is.
2. **De bouwvolgorde sluit de kernlus te laat.** Fase 2 (diep marktonderzoek) wordt eerst helemaal uitgebouwd; pas in fase 4–5 bestaan experimenten, bewijs en besluiten. Het onderscheidende punt — de keten *claim → aanname → test → meting → besluit* — wordt dan pas laat zichtbaar en getest.
3. **De datamodellen spreken elkaar op een aantal punten tegen** (zie §3). Dat moet vóór de eerste migratie opgelost zijn, anders betaal je er later voor met migraties en UI-herbouw.
4. **Een aantal juridische en statistische randvoorwaarden ontbreekt**: cookies/tracking op testpagina's, fake-door- en pre-orderregels, de AI-verordening en een concrete beslisregel voor "onbeslist".
5. **De grootste concurrent staat niet in de benchmark**: generieke deep research in ChatGPT, Claude, Gemini en Perplexity. Daar moet de positionering tegen kunnen.

---

## 2. Productstrategie

### 2.1 Voeg het belangrijkste substituut toe aan de benchmark

Voor het marktonderzoeksdeel is het echte alternatief niet Rapidly of IdeaBuddy, maar "ik vraag ChatGPT/Claude/Perplexity om deep research". Dat is gratis of goedkoop, snel en levert bronvermeldingen. ProofLab moet hier expliciet beter in zijn, en dat kan alleen op punten die een chatinterface niet levert:

| Generieke deep research | ProofLab |
|---|---|
| Rapport als lap tekst | Claims als losse records met status, bron, peiljaar en eenheid |
| Bronvermelding, maar geen controle of het citaat klopt | Een **deterministische citaatcheck**: het geciteerde fragment moet letterlijk in de opgeslagen brontekst staan |
| Cijfers die in de prose worden berekend | Rekenmotor met bewerkbare factoren, zonder LLM |
| Geen geheugen tussen runs | Versies, verschillenrapport, verouderde bronnen markeren |
| Stopt bij het rapport | Gaat door naar aanname → test → echte meting → besluit |

**Voorstel:** neem deze tabel op in §1 en gebruik "van onderzoek naar echte test in één werkruimte" als kernbelofte. De rest van de benchmark kan blijven.

### 2.2 Kies de doelgroep voor v1 nu, niet in §20

§20 laat open of ProofLab een interne tool, een consultancytool of een SaaS-product wordt. Die keuze bepaalt de bouw al in fase 0 (organisaties, rollen, facturering, white-label, onboarding van vreemden).

**Voorstel:** v1 = **tool voor Hylke/Link & Lead met kleine teams en uitgenodigde klanten**. Het schema blijft multi-tenant (`organizations`, RLS), maar zonder zelfregistratie voor het publiek, zonder facturering en met één eenvoudig rollenmodel. Zo is de SaaS-route open zonder dat het de MVP opblaast.

### 2.3 Definieer "first value" concreet

Het ontwerp belooft "in 10 minuten een idee structureren", maar het traject heeft negen stappen. Leg vast wat de gebruiker na de eerste sessie in handen heeft:

> **Binnen 15 minuten:** een bevestigde Idee-Brief, een *voorlopige* Snelle Marktcheck met bronnen, de drie risicovolste aannames en één voorgestelde eerste test met een concept-Test Card.

Dit wordt de eerste E2E-test en de maatstaf voor `time_to_first_test_card`.

### 2.4 Schrap voor v1 wat nog niet ontworpen is

- **"Lerend portfolio" (§1 punt 6)** wordt nergens verder uitgewerkt en raakt aan vertrouwelijkheid tussen klanten. Naar v2.
- **Maandelijkse monitoring, panels en betaalde datasets** staan al in fase 6. Goed zo.
- **Positioneringskaart, A/B-varianten, DOCX-export**: naar v2.

---

## 3. Inconsistenties in het ontwerp die vóór de bouw opgelost moeten zijn

### 3.1 Eén begrip: idee of project

Routes gebruiken `/app/ideas/[id]`, de API `/api/projects/:id` en de database `projects`. **Voorstel:** in de UI heet het overal **idee**, in code en database **`ideas`**. De API wordt `/api/ideas/:id`. Eén naam scheelt bugs en verwarring.

### 3.2 Drie verschillende labelsystemen voor bewijs

| Plek | Labels |
|---|---|
| §6.1 businessmodel | `bekend`, `bronondersteund`, `aangenomen` |
| §8.2 informatietypes | 8 types (`official_statistic` … `synthetic_simulation`) |
| §12.2 claim_type | `measured_fact`, `third_party_estimate`, `inference`, `assumption` |
| §13.4 `claims.kind` | niet gespecificeerd |

**Voorstel:** één taxonomie met twee assen.

- **`evidence_type`** (wát voor informatie, §8.2 is leidend): `official_statistic`, `third_party_estimate`, `primary_source_document`, `qualitative_observation`, `self_reported_intent`, `observed_action`, `verified_transaction`, `ai_inference`, `internal_assumption`, `synthetic_simulation`.
  Toegevoegd: `primary_source_document` (prijspagina, jaarverslag; dat valt nu nergens onder) en `ai_inference` (wat §12.2 `inference` noemt).
- **`claim_status`** (hoe goed onderbouwd, §8.3): `verified`, `supported`, `tentative`, `contested`, `unknown`, `needs_recheck`.
  `needs_recheck` wordt in §9.1 gebruikt maar staat niet in de lijst.

De drie labels uit §6.1 worden een **weergave** die hiervan wordt afgeleid, geen apart veld.

### 3.3 Statussen ontbreken of zijn niet als state machine gedefinieerd

Voor aannames, hypotheses en experimenten staan wel statusvelden in het model, maar geen toegestane waarden en overgangen. Dat is juist waar de methodische strengheid wordt afgedwongen.

**Voorstel:**

```text
Aanname:     untested → testing → supported | refuted | inconclusive → (bij nieuw bewijs terug naar testing)
Hypothese:   draft → locked (bij goedkeuring experiment) → superseded (nieuwe versie met motivering)
Experiment:  draft → ready_for_review → approved → live → ended → analyzed → decided
             live → paused → live | ended      (elke overgang in audit_events)
Learning Card: draft (AI) → reviewed → approved
```

Regels die in code (niet alleen UI) worden afgedwongen:
- Een experiment kan niet naar `approved` zonder een volledige Test Card.
- Bij `approved` wordt de hypothese `locked`; daarna is wijzigen alleen nog mogelijk door een nieuwe versie met motivering, en die is zichtbaar in het rapport.
- Een aanname wordt nooit automatisch `supported`: dat vereist een goedgekeurde Learning Card en een menselijk besluit.

### 3.4 De negen stappen en de vijf fasen zijn niet aan elkaar gekoppeld

§3 noemt negen stappen en daarnaast de fasen Concept / Onderzoek / Testen / Beslissen / Opschalen. **Voorstel:** Concept = stap 1; Onderzoek = stappen 2–4; Testen = stappen 5–7; Beslissen = stappen 8–9; Opschalen = na een besluit "Doorgaan" met een herhaald gedragsbewijs.

### 3.5 Velden in de tekst passen niet bij de tabellen

| Onderwerp | In de tekst | In §13.4 | Voorstel |
|---|---|---|---|
| Hypothese | doelgroep, gedrag, context, meetwijze, n, periode, succesdrempel, stopregel, vertekeningen | statement, metric, threshold_json | Getypeerde kolommen, plus `success_rule`, `fail_rule`, `min_sample`, `max_duration_days` |
| Aanname | evidence_coverage, user_owner, dependencies | ontbreken | Toevoegen; `evidence_coverage` wordt *berekend*, niet opgeslagen |
| Concurrent | ±19 velden (§4.6) | attributes_json | Kernvelden als kolommen (filter- en sorteerbaar); `features[]`, `differentiators[]` als JSON |
| TAM/SAM/SOM | elke factor met bron of aanname | assumptions_json | Aparte tabel `sizing_factors` met `claim_id` of `assumption_id` per factor |
| Rapportsecties M1–M9 | conclusies met claim IDs | geen tabel | Tabel `research_sections` met `section_key` (M1–M9), tekst en gekoppelde claims |

### 3.6 Tabellen die ontbreken

- **`idea_members`** — §11 noemt "projectrollen" en §13.5 "publicatie na projecttoestemming", maar er zijn alleen organisatierollen.
- **`source_excerpts`** — opgeslagen fragmenten met positie in de brontekst; nodig voor de citaatcheck en voor auteursrecht (zie §5.4).
- **`interviews`** en **`transcript_segments`** — interviews met tijdcodes; nu valt alles in `observations.payload_json`.
- **`surveys`**, **`survey_questions`**, **`survey_responses`** — de native form-builder heeft een eigen model nodig.
- **`landing_pages`** en **`page_variants`** — `experiment_assets.config_json` is te vaag voor een publiceerbare pagina.
- **`consents`** — grondslag, doel, bewaartermijn, versie van de privacytekst en het tijdstip, per participant.
- **`ai_runs`** — modelversie, promptversie, run-ID, tokens, kosten en QualityGate-uitkomst (eis 10 uit §12.1 heeft nu geen plek).
- **`tasks`** — §5.2 en §9.1 maken taken aan, maar er is geen tabel voor.

### 3.7 Rollen

Vijf organisatierollen zijn veel voor een v1. **Voorstel:** `owner`, `editor`, `viewer` op organisatieniveau, plus `idea_members` voor toegang per idee. `admin` en `analyst` kunnen later zonder migratiepijn worden toegevoegd.

---

## 4. Methode en statistiek

### 4.1 Een concrete beslisregel, inclusief "onbeslist"

De Test Card vraagt om succes-, faal- en onbeslist-criteria, maar het ontwerp zegt niet hoe het systeem die toetst. Met de kleine aantallen uit het voorbeeld ("15% van 80") is toeval groot: bij 12 van de 80 ligt het 95%-interval ongeveer tussen 9% en 24%.

**Voorstel (deterministisch, in `lib/evidence/verdict.ts`):**

- Toon bij elke conversie een **Wilson-interval (95%)**, niet alleen het puntpercentage.
- **Geslaagd:** de ondergrens van het interval ligt boven de succesdrempel.
- **Mislukt:** de bovengrens ligt onder de faaldrempel.
- **Onbeslist:** alles daartussen, of de vooraf afgesproken `min_sample` is niet gehaald.
- Een verdict kan pas worden berekend als de afgesproken eindconditie bereikt is (n of looptijd). Daarvoor toont het dashboard alleen "loopt — nog geen uitspraak".
- De hypothesebouwer berekent bij het invullen hoeveel deelnemers nodig zijn om de drempel betekenisvol te kunnen toetsen, en waarschuwt als het plan te klein is.

Dit vervangt de vage formulering "waarschuw voor lage aantallen" met iets dat te testen is.

### 4.2 Dossierlabels als harde regels

§8.4 zegt dat de labels door "controleerbare regels" worden bepaald, maar geeft die regels niet. **Voorstel:**

| Label | Voorwaarden (alle) |
|---|---|
| Verkenning | Idee-Brief bevestigd |
| Onderbouwd marktbeeld | ≥ 3 claims met status `verified`/`supported` uit ≥ 2 onafhankelijke domeinen, waarvan ≥ 1 `official_statistic` of `primary_source_document`; ≥ 3 concurrenten of substituten incl. "niets doen"; marktomvang berekend of expliciet "niet vastgesteld" |
| Eerste gedragsbewijs | Bovenstaande + ≥ 1 experiment `decided` op basis van `observed_action` of `verified_transaction`, met vergrendelde hypothese |
| Herhaald marktgedragsbewijs | Bovenstaande + ≥ 2 afgeronde gedragsexperimenten in verschillende periodes of kanalen, met hetzelfde resultaat |

### 4.3 Bewijskracht per hypothesetype

"Bewijskracht is hypotheseafhankelijk" is correct, maar moet als tabel in code staan, zodat de experimentaanbeveler en het verdict er gebruik van kunnen maken. Bijvoorbeeld: voor een hypothese over **betaalbereidheid** telt `self_reported_intent` als zwak, `observed_action` (klik op prijs) als middel en `verified_transaction` als sterk; voor een hypothese over **probleemherkenning** is `qualitative_observation` sterk.

---

## 5. Juridisch en privacy — wat nog ontbreekt

### 5.1 Tracking op testlandingspagina's

Voor bezoekersmeting met cookies of vergelijkbare technieken is in Nederland toestemming nodig (Telecommunicatiewet, art. 11.7a). Een cookiebanner op een testpagina verlaagt de conversie en vertekent de test.

**Voorstel:** de native testpagina meet **zonder cookies en zonder persistente identifiers**: een first-party, kortlevende sessie-hash (bijvoorbeeld een dagelijks roterende salt over IP + user agent, alleen server-side, niet opgeslagen), alleen geaggregeerde paginabezoeken en expliciete acties (klik, formulier). Persoonsgegevens alleen na een actieve formulierinzending met privacytekst. PostHog/GA4 alleen optioneel en dan mét consentbanner. Laat dit door een jurist bevestigen vóór commercieel gebruik.

### 5.2 Fake-door- en pre-ordertests

Een aanbod dat nog niet bestaat kan onder de regels voor oneerlijke handelspraktijken vallen als het misleidend is (ACM). **Voorstel, als vaste productregels:**

- Na de CTA van een fake-door-test verschijnt altijd een eerlijke vervolgpagina ("dit product is in ontwikkeling; laat je e-mail achter als je op de hoogte wilt blijven"). Die is niet uit te zetten.
- Pre-orders: in v1 alleen een **betaalintentie** (een klik op een prijs) of een **terugbetaalbare aanbetaling** met duidelijke voorwaarden, leverdatum en een terugbetaalprocedure. Geen echte verkoop zonder een leveringsverplichting die de gebruiker zelf heeft vastgelegd.
- Stripe-integratie pas in een latere fase, na een juridische check.

### 5.3 AI-verordening

Sinds augustus 2026 gelden de transparantieverplichtingen van de AI-verordening (art. 50). Voor ProofLab betekent dat in elk geval: de gebruiker weet dat hij met een AI-coach werkt, en AI-gegenereerde content die publiek wordt (testpagina-copy, uitnodigingen) is herkenbaar als zodanig waar de wet dat vereist. **Voorstel:** neem een AI-transparantie-eis op in §14 en laat de precieze reikwijdte juridisch toetsen.

### 5.4 Auteursrecht op opgeslagen bronnen

Het ontwerp slaat opgehaalde documenten op (`sources.storage_path`). Volledige kopieën van artikelen en rapporten van derden opslaan en tonen is juridisch riskant. **Voorstel:** sla per bron de metadata, een content-hash en alleen de relevante fragmenten op (`source_excerpts`). Volledige tekst alleen tijdelijk voor de verwerking, of bij uploads die de gebruiker zelf aanlevert.

### 5.5 Webfonts

Google Fonts rechtstreeks vanaf de Google-CDN laden stuurt IP-adressen naar Google; daar is in de EU rechtspraak over. **Voorstel:** fonts zelf hosten via `next/font` (dat doet dit standaard tijdens de build).

---

## 6. Architectuur — concrete keuzes en valkuilen

### 6.1 Drizzle en Supabase RLS gaan niet vanzelf samen

Als de server met Drizzle via een directe Postgres-verbinding met de service-rol werkt, wordt **RLS volledig omzeild**. Dan zijn de RLS-tests in §17 groen terwijl de app ze niet gebruikt.

**Voorstel:** kies één van beide en leg het vast:
- **A (aanbevolen voor v1):** gebruikersverzoeken lopen via `supabase-js` met de JWT van de gebruiker, zodat RLS altijd geldt. Drizzle (of SQL-bestanden) wordt alleen gebruikt voor migraties en schema-types. De service-rol alleen in background jobs en webhooks, met expliciete autorisatiechecks in code.
- **B:** Drizzle met per transactie `set local role authenticated` en `request.jwt.claims`. Kan ook, maar is foutgevoeliger.

### 6.2 Lange researchjobs en serverless-timeouts

Diep onderzoek duurt minuten. Serverless-functies (Vercel) hebben een tijdslimiet. **Voorstel:** één jobsysteem kiezen vóór fase 0. Aanbeveling: **Inngest** of **Trigger.dev** (stappen met retries, idempotentie en hervatten na een fout zitten erin). Elke agentstap is een eigen jobstap met opgeslagen tussenresultaat, zodat een fout halverwege niet het hele onderzoek kost.

### 6.3 Zoekprovider: begin met de webzoektool van de AI-provider

§20 laat de zoekprovider open, terwijl dit fase 2 blokkeert. **Voorstel:** de `SearchProvider`-interface krijgt als eerste implementatie de server-side webzoek- en webfetch-tools van de Claude API (die geven URL's en citaten terug). Een tweede implementatie (bijvoorbeeld Brave Search of Exa) kan later. CBS StatLine en Eurostat zijn open API's en kunnen al in v1 als aparte, gestructureerde bron.

### 6.4 Citaatverificatie zonder LLM

Voeg aan de `QualityGate` een **deterministische check** toe: elk citaat in `claim_sources.quote_span` moet (na normalisatie van witruimte en aanhalingstekens) letterlijk voorkomen in de opgeslagen brontekst. Getallen in een claim moeten in het citaat terugkomen. Faalt dat, dan wordt de claim `tentative` en gaat hij naar handmatige review. Dit is de goedkoopste en sterkste bescherming tegen verzonnen bronnen.

### 6.5 Evaluatieset voor AI-kwaliteit

"Aantal foutpositieve AI-conclusies in steekproeven" (§14.4) vraagt om een vaste testset. **Voorstel:** 5–10 vaste testideeën (waaronder de twee uit §16) met per idee verwachte eigenschappen (geen verzonnen prijzen, "niets doen" als alternatief genoemd, minstens één tegenargument). Draai deze evaluaties bij elke wijziging aan prompts of modellen.

### 6.6 PDF-rapporten

Headless Chromium draait slecht in serverless-functies. **Voorstel:** rapport = één print-geoptimaliseerde HTML-route (die ook op het scherm het rapport is). PDF wordt in de background-worker gemaakt met Playwright/Chromium, of met een externe renderdienst. Het rapport is altijd een snapshot (`report_versions.source_snapshot_json`), dus reproduceerbaar.

### 6.7 Taal

Advies uit §20 (Nederlandse UI, meertalige bronnen, rapport optioneel Engels) overnemen, maar **i18n vanaf dag één** inbouwen (`next-intl`), met Nederlands als enige taal in v1. Achteraf teksten uit componenten halen is duur.

### 6.8 Spraak naar tekst

§5.2 rekent op transcriptie van interviewopnamen, maar er staat geen transcriptieprovider in de stack. **Voorstel:** in v1 alleen notities en het uploaden van een bestaand transcript (bijv. uit Teams, Zoom of Fathom). Eigen transcriptie in v2, via een `TranscriptionProvider`-interface.

---

## 7. Design

Het design system is goed uitgewerkt. Twee correcties en een paar aanvullingen:

- **Contrast koraal:** `--color-coral` (#FF765C) haalt op wit een contrastverhouding van ongeveer 2,6:1. Dat is te laag voor tekst en voor witte tekst op een koraal knop (AA vraagt 4,5:1). **Regel:** koraal alleen decoratief of voor grote vlakken met donkere tekst (#141A24 op koraal is ruim voldoende).
- De overige kernkleuren zijn in orde: `--color-muted` op canvas ≈ 4,7:1, `--color-electric` op wit ≈ 5,3:1, `--color-warning` op wit ≈ 5,2:1. Toch automatisch testen (axe in Playwright).
- **Dark mode:** niet verplicht in v1, maar definieer de tokens nu al als semantische namen (`--bg`, `--fg`, `--accent`), zodat dark mode later alleen nieuwe waarden vraagt.
- **Statuskleuren:** leg per claimstatus en evidence-type vast welke kleur, welk icoon en welke tekst erbij hoort. Dat voorkomt dat elk scherm zijn eigen badges maakt.

---

## 8. Herziene bouwvolgorde: eerst een dunne lus, dan diepte

In plaats van fase 2 volledig af te bouwen voordat experimenten bestaan, eerst een **walking skeleton**: de hele keten werkt, dun maar echt, en daarna komt de diepte.

| Fase | Inhoud | Definitie van klaar |
|---|---|---|
| **0 — Fundament** | Next.js, TS strict, lint/test, design tokens, logo, layout, i18n, Supabase (auth, RLS, migraties), jobsysteem, AI-provider-interface | Inloggen, organisatie, lege dashboardstaten; RLS-test cross-tenant groen |
| **1 — Dunne kernlus** | Idee-intake (met AI én handmatig) → bron handmatig toevoegen (URL/tekst) → claim met citaat → aanname → hypothese → Test Card → **native landingpage met cookieloze meting** → events → Learning Card (concept) → besluit → eenvoudig HTML-rapport | De E2E-test uit §16 werkt, met handmatige bronnen en een echte publieke testpagina |
| **2 — Diep marktonderzoek** | Scope-wizard, research-pipeline als jobs, Claude-webzoeken + CBS/Eurostat, citaatverificatie, M1–M9, concurrenten, TAM/SAM/SOM-rekenmotor, tegenspraak-agent | Dossier op live bronnen, zonder verzonnen bronnen; zonder provider een eerlijke handmatige modus |
| **3 — Aannames en model** | Businessmodel (simpel/canvas), aannamemachine, risicomatrix, blinde-vlekkencheck, hypothesebouwer met steekproefadvies | Eén aanname is traceerbaar tot een vergrendelde hypothese, met een berekend verdict |
| **4 — Meer experimenten** | Survey Studio, interviews (notities/transcript-upload, themamatrix), demo-booking, B2B-LOI, concierge | Vijf experimenttypen leveren getypeerde observaties |
| **5 — Bewijs en rapport** | Evidence timeline, dossierlabels, PDF, portfolio, CSV/JSON-export | Een externe reviewer klikt vanuit het rapport terug naar bron, meting en besluit |
| **6 — Uitbreidingen** | Stripe (na juridische check), Calendly, Tally, PostHog, monitoring, panels | Optionele integraties breken de basisapp niet |

**Wat verandert ten opzichte van v1.0:**
- Experimenten in v1: eerst **landingpage/fake door, interviews en survey** volledig; demo-booking, LOI en concierge in fase 4 (grotendeels handmatige registratie, dus relatief goedkoop). **Pre-order met echte betaling** gaat naar fase 6.
- De E2E-test uit §16 wordt al in fase 1 de leidende test, niet pas aan het eind.

---

## 9. Beslissingen die de opdrachtgever nu moet nemen

1. **Doelgroep v1:** interne/consultancytool met uitgenodigde gebruikers (aanbevolen) of direct publiek SaaS?
2. **Infrastructuur:** Supabase (EU-regio, bijv. Frankfurt) + Vercel als hosting, en een nieuw Supabase-project voor ProofLab aanmaken?
3. **Jobsysteem:** Inngest of Trigger.dev (vereist een account) — of eerst een eenvoudige Postgres-queue?
4. **Zoekprovider v1:** Claude-webzoeken via de API (aanbevolen) of een andere provider?
5. **Bouwvolgorde:** de herziene volgorde uit §8 (dunne kernlus eerst) of de oorspronkelijke fasering?
6. **Domein voor testpagina's:** een eigen (sub)domein voor publieke testpagina's, bijvoorbeeld `test.<domein>.nl`, los van de app.

---

## 9a. Genomen beslissingen (27 oktober 2026)

| Vraag | Besluit |
|---|---|
| Doelgroep v1 | Eigen tool + uitgenodigde gebruikers (multi-tenant schema, geen publieke registratie of facturering) |
| Bouwvolgorde | **Originele fasering v1.0** (fase 0 → 6); de walking-skeleton-aanbeveling uit §8 is dus niet overgenomen |
| Infrastructuur | Supabase-project `prooflab` (EU, eu-west-1) + Vercel |
| Zoekprovider | Claude API-webzoeken + CBS/Eurostat |

---

## 9b. Aanvullend onderzoek (27 oktober 2026)

### Concurrentie: scherper dan v1.0 aanneemt

- **[Rapidly](https://www.exponentially.com/rapidly)** doet al bijna de hele lus: een Lean Canvas, de risicovolste aanname als meetbare hypothese, een *onderzochte* slaagdrempel (voorbeeld: 15% koopt binnen 30 dagen), een voorstel voor de kleinste test, een landingspagina met **terugbetaalbare aanbetaling**, en besluiten (stoppen, bijsturen, financieren) in een portfolio. Er is ook een MCP-koppeling voor AI-agents. Prijs: **US$20 per gebruiker per maand**. ProofLab wint dus niet op "de lus bestaat". Het moet winnen op diepte en betrouwbaarheid van het onderzoek, op de uitvoering, of op een niche.
- **AI-validators** ([IdeaProof](https://ideaproof.io/features), ValidatorAI; ca. $0–99) leveren direct marktanalyse en een score van 0–100. Ze noemen "source-linked evidence", maar beschrijven geen bronverificatie en bevatten geen experimenten. Dat bevestigt het gat waar ProofLab in wil zitten: controleerbaar bewijs.
- **AI-gemodereerde klantinterviews** zijn in 2026 een eigen categorie met meer dan twintig aanbieders ([vergelijking](https://usercall.co/post/best-ai-moderated-interview-software-in-2026-tools-tradeoffs-and-what-to-look-for)), bijvoorbeeld Listen Labs, Koji, Outset en GetWhy (Kopenhagen). Echte respondenten, een AI-interviewer, ca. $30–60 per interview ([overzicht](https://www.userintuition.ai/posts/best-idea-validation-platforms/)). Dit is de belangrijkste nieuwe mogelijkheid voor stap 3 en 8: ofwel zelf bouwen, ofwel koppelen.
- **Strategyzer** verkoopt zijn Innovation Platform vooral via training en licenties (44 experimenten), niet als zelfstandige AI-tool.

### Gat in v1.0: waar komen de testbezoekers vandaan?

Een landingpage- of pre-ordertest is waardeloos zonder relevant verkeer. Het ontwerp beschrijft de pagina en de meting, maar niet de **werving**. Mogelijke bronnen: eigen netwerk en LinkedIn (gratis, maar met een vertekende steekproef), betaalde advertenties (Meta, LinkedIn, Google; kost geld en vraagt goedkeuring), outreach naar een zelf samengestelde lijst (AVG en spamregels), of panels. De Test Card moet een verplicht veld **wervingskanaal + verwacht bereik** krijgen. De hypothesebouwer moet waarschuwen als het verwachte bereik de `min_sample` niet haalt.

### Juridische punten bevestigd

- **AI-verordening art. 50** (transparantie) is niet uitgesteld door het Digital Omnibus (Verordening (EU) 2026/1744) en geldt sinds 2 augustus 2026. Alleen de verplichtingen voor hoog-risicosystemen zijn verschoven naar december 2027 en augustus 2028 ([overzicht](https://www.aiacto.eu/en/blog/digital-omnibus-ai-act-report-2027)).
- **Analytics zonder toestemming:** volgens secundaire bronnen accepteert de AP analytics zonder toestemming als die first-party en geanonimiseerd is: geen delen met derden, geen profilering, geen cross-site tracking ([toelichting](https://clickport.io/blog/privacy-analytics-netherlands)). Dit ondersteunt de cookieloze meting uit §5.1. De officiële AP-tekst moet nog worden gecontroleerd.
- **Fake door:** er is geen specifieke ACM-regel gevonden. De ACM handhaaft wel actief op misleidende online praktijken, zoals nepkortingen ([2023](https://www.dutchnews.nl/2023/11/consumer-watchdog-is-going-after-fake-webshop-discounts/)) en de boete van €270.000 voor House of Tickets (mei 2026). De eerlijke vervolgpagina uit §5.2 blijft dus verplicht.

### Techniek bevestigd

- **Claude-webzoeken:** $10 per 1.000 zoekopdrachten plus tokenkosten. Web fetch heeft geen extra tarief, alleen tokens ([prijzen](https://docs.claude.com/ja/docs/about-claude/pricing)). Een diep onderzoek van ca. 50–150 zoekopdrachten kost dus $0,50–1,50 aan zoekkosten. De tokenkosten voor het lezen van bronnen zijn waarschijnlijk groter. Een budgetlimiet per run blijft nodig.
- **CBS StatLine:** de huidige tabel *Vestigingen van bedrijven; bedrijfstak, regio* (81578NED, SBI 2008) is bruikbaar voor bottom-up TAM in B2B ([CBS](https://www.cbs.nl/nl-nl/cijfers/detail/81578NED)). Let op: CBS stapt over op **SBI 2025**, dus tabel-ID's en codes kunnen veranderen. Leg daarom per factor tabel-ID, peiljaar en SBI-versie vast.

---

## 9c. Productrichting na de tweede vragenronde

| Vraag | Antwoord | Gevolg voor het ontwerp |
|---|---|---|
| Hoofdgebruik | **Consultancy voor klanten** | Een idee hoort bij een **klant** (nieuwe tabel `clients`). Een traject heeft een opdrachtgever, een looptijd en een budget. Het beslisrapport is het eindproduct en weegt daarom zwaarder dan v1.0 aanneemt (fase 5 eerder of beter). |
| Onderscheid ten opzichte van Rapidly | Controleerbaar onderzoek, **en** echte uitvoering, **en** een rapport voor beslissers, **en** de Nederlandse markt | Alle vier: de onderscheidende combinatie is "Nederlands consultancyniveau met een bronnenspoor". Dat rechtvaardigt een hogere prijs per traject dan $20 per maand. |
| Testverkeer | Eigen netwerk/LinkedIn, **betaalde advertenties** en outreach | De Test Card krijgt een verplicht veld *wervingskanalen + verwacht bereik per kanaal*. Elke link krijgt UTM-tags per kanaal, zodat de conversie **per kanaal** zichtbaar is (verkeer uit een warm netwerk converteert anders dan koud advertentieverkeer). |
| Interviews | **AI-gemodereerd in de app** | Nieuwe module: een respondent opent een publieke link en voert een chatinterview met een AI-interviewer. |
| Rol van de klant | **Alleen meekijken** | Rol `client_viewer` per idee: alleen lezen, geen interne notities, geen ruwe participantgegevens (alleen gepseudonimiseerde citaten), geen kosten tenzij gedeeld. Alle goedkeuringen blijven bij jou. |
| Branding | **ProofLab** | Rapporten en het app-merk zijn ProofLab. Een **merk- en domeincheck is nu urgent**, omdat de naam richting klanten gaat. Testpagina's blijven merkneutraal of krijgen de naam van het geteste aanbod; een ProofLab-logo op een fake-door-pagina vertekent de test. |
| Advertenties | **LinkedIn + Meta, eigen account, doorbelasten** | Zie hieronder. |
| AI-interview | **Eerst tekst, spraak later** | Fase 4: chatinterview; spraak via een `VoiceProvider` in fase 6. |

### Advertenties via je eigen account: wat dit vraagt

- **Meta:** voor eigen advertentieaccounts volstaat de laagste toegangslaag met `ads_management`; app review en Full Access zijn alleen nodig voor accounts van anderen ([Meta](https://developers.facebook.com/docs/marketing-api/access)). Bedrijfsverificatie van Link & Lead is wel verstandig.
- **LinkedIn:** de Advertising API vereist een aanvraag. Je start in de *Development tier* (één testaccount via de API) en moet daarna een upgrade naar Standard krijgen, naar LinkedIn's eigen oordeel ([LinkedIn](https://learn.microsoft.com/en-us/linkedin/marketing/lms-faq)). Doorlooptijd: van enkele weken tot maanden. **Vraag dit nu al aan**, ook al bouwen we de koppeling pas in fase 4/6.
- **Accountrisico:** fake-door-advertenties voor een product dat nog niet bestaat kunnen botsen met het beleid van Meta en LinkedIn tegen misleiding. Een afgekeurd of geblokkeerd account raakt al je klanten tegelijk. Daarom: de advertentietekst belooft niets wat niet waar is ("binnenkort", "meld je aan voor de pilot"), de eerlijke vervolgpagina is verplicht, en de app checkt de advertentieteksten op absolute claims.
- **Doorbelasten:** het `cost_ledger` krijgt `client_id` en `billable`. De app maakt per traject een kostenoverzicht van media, panels en AI, dat op de factuur kan.
- **Tot de API-koppelingen klaar zijn:** de app maakt advertentieteksten, doelgroepvoorstellen en UTM-links; jij zet de campagne zelf live in Ads Manager en voert de uitgaven in; de app meet de bezoekers en conversies via de UTM's.

### AI-gemodereerd tekstinterview: ontwerpregels

1. De respondent krijgt **vooraf** te horen dat een AI het gesprek voert (AI-verordening art. 50), wie de opdrachtgever is (of "een onderzoeksbureau" als dat nodig is om vertekening te voorkomen), het doel, de bewaartermijn, en dat stoppen altijd mag. Toestemming wordt vastgelegd in `consents`.
2. De interviewer volgt een **goedgekeurde leidraad**: neutrale vragen over gedrag in het verleden, maximaal twee doorvragen per onderwerp, geen pitch, geen suggestieve vragen. Een tweede model controleert elke vraag op sturing voordat die wordt verstuurd.
3. Harde grenzen: een maximale duur en maximaal aantal beurten, geen bijzondere persoonsgegevens vragen, weigeren als de respondent instructies geeft ("negeer je opdracht").
4. Opslag: het volledige transcript met tijdstempels per beurt. Uitspraken worden `qualitative_observation` met de vlag `ai_moderated = true`, zodat het rapport kan laten zien welk bewijs uit AI-interviews komt.
5. Werving gaat via dezelfde kanalen als het testverkeer (netwerk, advertenties, outreach), met een screener vooraf op segment en rol, zodat niet-doelgroep-respondenten niet meetellen.
6. Synthese per interview **en** over interviews heen (themamatrix), met elke conclusie terug te leiden naar letterlijke fragmenten.

### Klanten, trajectvorm en taal

| Vraag | Antwoord | Gevolg |
|---|---|---|
| Klanttypes | MKB/ondernemers, events/MICE en venues, media/cultuur/publiek | Drie **branchesjablonen** met passende aannames, bronnen en experimenten (zie hieronder). Dit is ook de "vergelijkingstest" uit §16 van v1.0: de begeleiding mag niet hardcoded zijn op één branche. |
| Trajectvorm | **Vaste validatiesprint van 4–6 weken** | Een sjabloon `ValidatieSprint` met een weekplanning, mijlpalen en een vaste rapportdatum (zie hieronder). |
| Taal | **Alleen Nederlands** | Geen i18n-framework in v1; teksten wel centraal in `lib/copy/`, zodat vertalen later mogelijk blijft. Bronnen mogen meertalig zijn. |

**Sprintsjabloon (voorstel, aan te passen per klant):**

| Week | Fase | Mijlpaal | Klant ziet |
|---|---|---|---|
| 1 | Intake + marktverkenning | Idee-Brief bevestigd; marktdossier v1 | Brief en eerste marktbeeld |
| 2 | Klant en model, aannames | Top 3 risicovolle aannames; hypotheses vergrendeld | Risicokaart en testplan |
| 3–4 (–5) | Tests live (2–3 parallel) | Werving gestart; tussenstand (zonder verdict) | Voortgang zonder voorlopige conclusies |
| laatste | Analyse en besluit | Learning Cards; beslisrapport | Eindrapport en besluitadvies |

De app toont per sprint wat achterloopt, bijvoorbeeld "werving haalt de min_sample niet vóór de einddatum". Dan kun je bijsturen met extra budget, een extra kanaal of een langere looptijd, met een changelog.

**Branchesjablonen: wat verschilt:**

- **MKB/ondernemers:** het klassieke koopgedrag. Sterkste bewijs is een betaling of aanbetaling; TAM via CBS-vestigingen of huishoudens.
- **Events/MICE/venues:** een B2B-DMU (eventmanager, inkoop, directie) en sterk seizoensgebonden. Signalen zijn offerteaanvragen, optieboekingen en LOI's. Let op: leadtijden van maanden passen slecht in een sprint van 4–6 weken, dus test eerder met *aanvragen* dan met *boekingen*.
- **Media/cultuur/publiek:** er is vaak **geen betaling**. "Levensvatbaarheid" gaat dan over subsidie, leden, donaties, bereik of deelname. De bewijstypologie krijgt daarom naast `verified_transaction` ook `verified_commitment` (lidmaatschap, inschrijving, toegezegde subsidie of partnerbijdrage). Het businessmodel krijgt een variant voor de publieke en non-profitsector (publieke waarde, financiers, doelgroepbereik).

---

## 10. Wijzigingen samengevat (changelog v1.0 → v1.1)

- Benchmark: generieke deep research als belangrijkste substituut toegevoegd.
- Doelgroep v1 vastgelegd; lerend portfolio naar v2.
- Begrip *idee* overal; `projects` → `ideas`.
- Eén taxonomie voor `evidence_type` en `claim_status` (incl. `primary_source_document`, `ai_inference`, `needs_recheck`).
- State machines voor aanname, hypothese, experiment en Learning Card.
- Ontbrekende tabellen toegevoegd: `idea_members`, `source_excerpts`, `interviews`, `transcript_segments`, `surveys`, `survey_questions`, `survey_responses`, `landing_pages`, `page_variants`, `consents`, `ai_runs`, `tasks`, `sizing_factors`, `research_sections`.
- Rollen v1: `owner`, `editor`, `viewer` + rechten per idee.
- Verdict met Wilson-interval, `min_sample` en een expliciete "onbeslist"-uitkomst.
- Harde regels voor dossierlabels.
- Cookieloze meting, regels voor fake door en pre-order, AI-verordening, opslag van bronfragmenten, zelfgehoste fonts.
- RLS-strategie vastgelegd (supabase-js met gebruikers-JWT).
- Jobsysteem, zoekprovider, citaatverificatie, AI-evaluatieset, PDF-aanpak, i18n en transcriptie expliciet gemaakt.
- Koraal niet als tekstkleur; semantische tokens voor latere dark mode.
- Bouwvolgorde: eerst een dunne kernlus, daarna diepte.

---

## 11. Verbeteringen op basis van *Testing Business Ideas* en de mock-ups

Het boek (Bland & Osterwalder, Wiley/Strategyzer) is de methodische basis van ProofLab. Het ontwerp v1.0 neemt de Test Card, het idee van bewijskracht en experimenten over, maar laat een aantal kernonderdelen van de methode liggen. Hieronder staan de gaten en de voorstellen. **Rechten:** we gebruiken de methode, maar schrijven alle teksten, kaarten en beschrijvingen zelf. Geen overgenomen boektekst, afbeeldingen, kaartontwerpen of exacte beoordelingen; geen suggestie van een officiële band met Strategyzer (zie v1.0 §18.7).

### 11.1 Methode-onderdelen die ontbreken of anders moeten

| # | Onderdeel in de methode | Status in v1.0 / mock-up | Voorstel voor ProofLab |
|---|---|---|---|
| 1 | **Team vóór het idee**: een multidisciplinair team, met benodigde vaardigheden per experiment | Ontbreekt | Een stap *Team & opdracht* in de intake: wie zit in het traject (consultant, klantstakeholders), welke vaardigheden zijn er (ontwerp, techniek, marketing, sales, data, juridisch, financieel). De experimentaanbeveler filtert op wat het team kan uitvoeren of meldt "vraagt vaardigheid X". |
| 2 | **Ontwerplus** (bedenken → businessprototype → beoordelen) vóór de **testlus** (hypothese → experiment → leren → besluiten) | Negen lineaire stappen | De stappenbalk toont twee lussen. Na elk besluit "Bijsturen" springt de app terug naar de ontwerplus (model/propositie aanpassen) en worden de geraakte aannames opnieuw beoordeeld. |
| 3 | **Waardepropositie** (klanttaken, pijnen, winsten ↔ producten, pijnverzachters, winstmakers) naast het **businessmodel** | Alleen JTBD en een eenvoudig model; de mock-up heeft géén modelscherm | Een scherm *Propositie & model* met twee eigen canvasweergaven (zelf vormgegeven), elk blok gelabeld als `bronondersteund` of `aangenomen`, en aannames die direct uit de blokken worden afgeleid. |
| 4 | **Aannamekaart: belangrijk × hoeveel bewijs** | Het ontwerp en de mock-up gebruiken *impact × onzekerheid* (een gok) | De horizontale as wordt **berekend uit gekoppeld bewijs** (aantal en sterkte), niet geschat. Zo verschuift een aanname automatisch naar "veel bewijs" zodra een test iets oplevert. Dat is precies wat ProofLab onderscheidt. Belangrijkheid blijft een menselijke inschatting. |
| 5 | **Hypothesekwaliteit**: toetsbaar, precies (wie, wat, wanneer) en enkelvoudig (één ding) | Wel velden, geen kwaliteitscheck | Een hypothesecoach controleert de drie criteria live en stelt splitsing voor als er twee beweringen in één zin staan. |
| 6 | **Test Card** met vier delen: geloof, test, meting, criterium; plus kosten, betrouwbaarheid en tijd | De mock-up vraagt "Wat geloof je / Succesdrempel / Looptijd / Voor wie" | De volledige kaart in eigen woorden: *Wij denken dat… / Dat toetsen we door… / We meten… / Het klopt als…* + faal- en onbeslist-criterium, noemer, min. n, wervingskanalen, kosten, eigenaar. |
| 7 | **Learning Card**: verwachting, observatie, geleerd, actie | Wel in het ontwerp, niet in de mock-up | Het bewijsscherm krijgt per experiment een Learning Card: *We dachten… / We zagen… / Daaruit leren we… / Daarom gaan we…*, met betrouwbaarheid van de data en de benodigde actie. |
| 8 | **Bewijssterkte langs vier dimensies**: mening ↔ feit, zeggen ↔ doen, labo ↔ echte wereld, kleine ↔ grote inzet | Alleen een indeling op type | Elke observatie krijgt deze vier kenmerken; de sterkte wordt **daaruit berekend** en is zichtbaar als uitleg ("sterk: echte betaling in een echte context"). Synthetisch en AI blijft nul. |
| 9 | **Twee soorten experimenten: ontdekken** (snel, goedkoop, zwakker) **en valideren** (sterker, duurder) | Zeven tests zonder fase | Elk experiment in de catalogus is *ontdekken* of *valideren*. De aanbeveler waarschuwt bij valideren zonder ontdekkingsbewijs ("eerst begrijpen, dan bewijzen") en stelt na een positief resultaat een sterkere vervolgtest voor. |
| 10 | **Experimentbibliotheek** met per test: kosten, voorbereidingstijd, looptijd, bewijssterkte, benodigde vaardigheden, geschikt voor D/F/V | Zeven uitgewerkte tests | Een **eigen beschreven catalogus van ±40 generieke methodes** (interview, enquête, zoektrendanalyse, landingspagina, concierge, LOI, mock sale enz.: generieke methodenamen, eigen teksten) met deze metadata. Zeven tot negen zijn volledig **uitvoerbaar** in de app; de rest is een begeleide **handmatige** template met observatieformulier. |
| 11 | **Experimentreeksen**: logische opeenvolging per type bedrijf | Ontbreekt | Sjablonen per branche (MKB, events/MICE, media/cultuur) en per type (B2B-dienst, B2C-product, platform) met een aanbevolen volgorde. |
| 12 | **Besluiten: doorgaan, bijsturen of stoppen** | De mock-up kent vier opties zonder **stoppen** of **doorgaan** | De keuzes worden: *Doorgaan · Bijsturen · Opnieuw testen · Parkeren · Stoppen*. Stoppen is een volwaardige, gewaardeerde uitkomst ("je bespaart de klant geld"). |
| 13 | **Managen in ritmes**: wekelijkse planning, korte standup, wekelijks leren, regelmatig besluiten met stakeholders | Ontbreekt | Past perfect bij de sprint: de app maakt per week een **leersessie** en een **besluitsessie met de klant**, met een agenda, de Learning Cards en een besluitvoorstel. Een notulenimport (bijv. Fathom of Teams) koppelt afspraken aan besluiten. |
| 14 | **Experiment-Kanban**: backlog → voorbereiden → loopt → leren | Genoemd, niet ontworpen | Een kanban per traject met de statussen uit §3.3. |
| 15 | **Valkuilen** van de methode: tijdgebrek, analyseverlamming, onvergelijkbare data, zwakke data, bevestigingsbias, te weinig experimenten, niet bijsturen, **testen uitbesteden** | Deels in de rode vlaggen | Een **automatische valkuilcheck** per traject: geen test gestart na X dagen; alleen onderzoek, geen experimenten; metrics die niet vergelijkbaar zijn; alleen "zeggen"-data; alleen positieve citaten; één experiment per kritieke aanname; Learning Card zonder besluit; klant niet bij leer- of besluitsessie. |

**Belangrijk inzicht voor het consultancymodel:** de methode waarschuwt expliciet tegen *het uitbesteden van testen*, omdat het leren dan bij de buitenstaander blijft. Als de klant alleen meekijkt, loopt ProofLab precies in die valkuil. Daarom stellen we voor: de klant blijft read-only voor het werk, maar **neemt deel aan de besluitsessies en bevestigt het eindbesluit** (een lichte uitbreiding van de rol `client_viewer`).

### 11.2 Verbeteringen aan de mock-ups

| Scherm | Bevinding | Voorstel |
|---|---|---|
| Algemeen | Geen klant- of trajectcontext ("voor wie werk ik nu?") | Een trajectkiezer in de topbar: *Klant · Idee · Sprintweek 2 van 5*, plus een indicator "volgende besluitsessie". |
| Algemeen | Schermen ontbreken: inloggen, propositie/model, hypotheses, bronnenbibliotheek, portfolio, sprintplanning, instellingen, **publieke testpagina**, **AI-interview voor respondenten**, klantweergave | Ontwerpen in dezelfde stijl. De publieke pagina's (test en interview) krijgen een **merkneutrale** variant. |
| Dashboard | KPI's gaan over aantallen | In productie: *Kritieke aannames met sterk bewijs*, *Lopende experimenten (dag X van Y)*, *Openstaande besluiten*. Dat zijn bewijsmetrics, geen activiteitsmetrics (v1.0 §14.4). |
| Marktverkenning | Een sterk scherm; mist status en kosten van de onderzoeksrun | Een runkaart met echte stappen (gevonden bronnen, gecontroleerde citaten, kosten tot nu toe, budget) en een *verschil sinds de vorige run*. |
| Aannames | Assen *effect × onzekerheid*; prioriteitsnummers in brede grijze balken (oogt als een layoutfout) | Assen *belangrijk × bewijs* (§11.1-4); compacte nummerbadges. |
| Experimenten | De Test Card is te mager (zie §11.1-6); maar drie testtypes | De volledige kaart, met een "meer experimenten"-knop naar de catalogus. Start = **Ter review**, pas daarna "Publiceer" (akkoord). |
| Bewijs & besluit | Geen **Stoppen** of **Doorgaan**; geen Learning Card | Zie §11.1-7 en -12; plus de nieuwe positie op de aannamekaart ("deze aanname schuift naar…"). |
| Rapport | Mist bronvoetnoten, methode, beperkingen, tegenbewijs en een bijlage met ruwe data | Rapportstructuur volgens v1.0 §4.4; ProofLab-cover met "opgesteld door Link & Lead voor [klant]". |
| Techniek | Google Fonts via de CDN | Zelf hosten via `next/font` (AVG). |
| Toegankelijkheid | Koraal en lichtgrijze teksten (`--muted` #747d8e op crème ≈ 3,9:1) | `--muted` haalt AA niet voor kleine tekst; donkerder variant voor tekst kleiner dan 18px (in `DESIGN_DIFF_LOG.md` als onderbouwde afwijking). |

### 11.3 Wat "volledig werkend" vraagt: benodigde accounts en sleutels

| Onderdeel | Nodig | Status |
|---|---|---|
| Database, auth, opslag | Supabase | ✅ project `prooflab` (eu-west-1) |
| AI + webzoeken | Anthropic API-sleutel | ⏳ door jou aan te leveren |
| Hosting app en testpagina's | Vercel-project + domein(en), bijv. `app.prooflab.nl` en een apart testdomein | ⏳ domein kiezen na de merkcheck |
| Achtergrondjobs (onderzoek, interviews, verversing) | Inngest of Trigger.dev (gratis tier volstaat in het begin) | ⏳ keuze |
| E-mail (uitnodigingen, inlog, meldingen) | Transactionele mailprovider, bijv. Resend, met een geverifieerd domein | ⏳ |
| Outreach | Verzenden vanuit je eigen mailbox na akkoord (Gmail/Outlook-koppeling) | ⏳ |
| Advertenties | Meta Business-account + app; LinkedIn Advertising API-aanvraag | ⏳ LinkedIn nu aanvragen |
| Marktdata | CBS/Eurostat (gratis); KVK API (abonnement, optioneel) | — |
| Betalingen (later) | Stripe | Fase 6 |

Zonder een sleutel werkt het betreffende onderdeel in de eerlijke handmatige modus (v1.0 §18.2); de rest van de app blijft volledig bruikbaar.

### 11.4 Realistische verwachting

"Volledig werkend" volgens v1.0 plus deze verbeteringen is een groot product: in omvang vergelijkbaar met enkele maanden werk voor een klein team. Ik bouw het fase voor fase in deze repository; elke fase levert een draaiende, geteste app op en wordt bijgehouden in `IMPLEMENTATION_STATUS.md`. Er komen geen knoppen die alleen op papier werken.

### 11.5 Besluiten over de methode (27 oktober 2026)

| Vraag | Besluit |
|---|---|
| Rol van de klant | **De klant beslist mee:** read-only voor het werk, maar neemt deel aan de besluitsessies en bevestigt het eindbesluit in de app (rol `client_decider`, vervangt `client_viewer`). |
| Experimentencatalogus | **±40 zelf beschreven methodes met metadata; 7–9 volledig uitvoerbaar**, de rest als begeleide handmatige template. |
| Aannamekaart | **Belangrijk × bewijs**; de bewijsas wordt berekend uit gekoppelde observaties. Afwijking van de mock-up, vastgelegd in `DESIGN_DIFF_LOG.md`. |
| Ritmes | **Wekelijkse leersessie + besluitsessie met de klant**, met agenda en besluitvoorstel uit de app en **import van Fathom-notulen** (gekoppeld aan besluiten). |

---

## 12. Analyse van de "twintig verbeteringen" (externe review, 27 oktober 2026)

### 12.1 Oordeel

De review is sterk en komt op de belangrijkste punten onafhankelijk tot dezelfde conclusie als deze analyse: **eerst één volledig werkende route** (vergelijk §8, de walking skeleton), **verificatie per bewering**, **bottom-up marktomvang**, **onzekerheid bij kleine aantallen** en **gedrag zwaarder dan meningen**. Twee onafhankelijke analyses die op hetzelfde punt uitkomen, zijn een sterk signaal om de eerder gekozen "originele fasering" te herzien.

Nieuw en waardevol in de review:

| # | Verbetering | Waarom waardevol | Inpassing |
|---|---|---|---|
| 1 | **Begin met de beslissing** | Geeft elk onderzoek een doel en een stopcriterium. Past perfect bij consultancy: de beslisvraag van de klant *is* de opdracht. | Eerste intakevraag: "Welke beslissing wil je nemen?" + bedrag/tijd/budget + grootste onzekerheid. Wordt het hoofdstuk 1 van het rapport. |
| 2 | **Adaptief traject per projecttype** | Voorkomt dat elk idee alle negen stappen doorloopt | Vijf projecttypes bepalen welke modules zichtbaar en verplicht zijn; de negen stappen blijven het datamodel. Te combineren met de branchesjablonen (§9c). |
| 4 | **Inzichtkaart: "wat ondersteunt dit / wat bewijst dit nog niet"** | De beste concrete UI-vertaling van de gouden regel | Wordt het standaardcomponent `InsightCard` voor elke conclusie (vervangt losse `EvidenceChip`'s). |
| 6 | **Onderzoeksplan met max. vijf beslissende vragen** | Stuurt het onderzoek op beslisrelevantie in plaats van volume; maakt "genoeg onderzocht" meetbaar | De `MarketScopeAgent` levert een onderzoekskaart; per vraag: benodigde data, geschikte bronnen, automatisch of klantonderzoek, en een *klaar-criterium*. M1–M9 worden ondersteunende categorieën, geen verplichte hoofdstukken. |
| 13 | **Experimentkeuze op vijf criteria** (onzekerheidsreductie, bewijssterkte, kosten, duur, kan het de beslissing veranderen) | Maakt experimentontwerp toegankelijk zonder expertise | De aanbeveler toont drie opties *Snel / Sterker / Meest overtuigend* met uitleg. Criterium 5 sluit mooi aan op verbetering 1. |
| 15 | **Verplichte Reality Check** | Tegenwicht tegen AI die enthousiast meewerkt | Verplicht vóór elk besluit en elk rapport; tussendoor licht (in de inzichtkaarten). Advies: Doorgaan / Bijsturen / Verder testen / Pauzeren / Stoppen. |
| 16 | **Financiële haalbaarheid** (marge, CAC, klantwaarde, terugverdientijd, break-even) | Een grote markt is geen rendabel bedrijf | Deterministische rekenmodule naast TAM/SAM/SOM; elke invoer gekoppeld aan een claim of een "nog te toetsen"-label. Fase 2 van de review. |
| 18 | **30 vaste testcases voor de AI** | Het verschil tussen een AI-app en een onderzoekssysteem | Uitbreiding van §6.5 (5–10 cases) naar 30, inclusief een bron met prompt-injectie, verkeerde geografie en tegenstrijdige cijfers; plus kosten per run. |
| 20 | **Valideer ProofLab zelf eerst** | Consequent toepassen van de eigen methode | Zie §12.3: in het consultancymodel kan dat goedkoop en snel. |

### 12.2 Spanningen met eerdere besluiten: die moeten worden beslist

| Onderwerp | Eerder besluit | Review | Advies |
|---|---|---|---|
| **Voor wie** | Consultancytool voor Link & Lead; de klant kijkt mee en beslist mee | Gaat uit van een zelfstandige gebruiker ("zo min mogelijk werk voor de gebruiker", drie gebruiksniveaus, betalen voor een onderzoek) | **Nog een keuze nodig.** Beide kan, maar niet tegelijk in v1. In v1 is de consultant de gebruiker en is de eenvoud voor de klantweergave; zelfbediening is een latere stap, *als* de validatie (§12.3) dat ondersteunt. |
| **Fasering** | Originele fasering v1.0 (eerst volledig marktonderzoek) | Eerst één complete route | **Overstappen op de route.** Twee analyses komen hier onafhankelijk op uit. |
| **Advertenties** | LinkedIn + Meta via je eigen account | Geen automatische campagnes in de eerste versie | v1: advertenties *voorbereiden* (tekst, doelgroep, UTM-links) en resultaten meten; jij zet ze handmatig live. API-koppelingen later. De LinkedIn-aanvraag wel nu starten (doorlooptijd). |
| **Catalogus** | ±40 beschreven, 7–9 uitvoerbaar | Geen grote bibliotheek in v1 | v1: **3 uitvoerbaar** (zoals de mock-up: landingspagina, interview, prijs-/aanbodtest) + ±10 beschreven met metadata voor de aanbeveler. Uitbreiden na de route. |
| **AI-interviews** | AI-gemodereerde chat in de app | Klantonderzoek professionaliseren (werving, transcriptie, analyse) | In de eerste route: interviews **zelf voeren + transcript of notities uploaden + analyse**. Het AI-gemodereerde interview direct daarna (fase 2). |
| **Ritmes/Fathom** | Weekritmes met Fathom-import | Samenwerking pas in een latere fase | Na de route; in v1 alleen besluitbevestiging door de klant. |
| **Coach** | Mock-up: permanente derde kolom (bindend volgens CLAUDE.md) | Standaard ingeklapt, alleen actief als het iets toevoegt | Afwijking van de mock-up met een onderbouwde UX-reden → `DESIGN_DIFF_LOG.md`. Dat is toegestaan volgens CLAUDE.md §1. |

### 12.3 Wat de review mist of te optimistisch ziet

1. **"Zo min mogelijk werk" heeft een grens.** Sterk bewijs (gesprekken, aanmeldingen, aanbetalingen) vraagt echte mensen en dus echte inspanning en werving. ProofLab kan de overhead minimaliseren, niet het contact met klanten. De werving van testverkeer (§9b) staat niet in de review, maar is de belangrijkste praktische drempel.
2. **Juridische randvoorwaarden** ontbreken: cookieloze meting, eerlijke fake-door-pagina's (ACM), AI-transparantie (art. 50), toestemming van respondenten, opslag van bronfragmenten (§5). Die horen al in de eerste route, omdat daarin een echte testpagina live gaat.
3. **De vier claimstatussen** dekken *verouderd* niet. Voorstel: Geverifieerd · Onderbouwde schatting · Onvoldoende bewijs · Tegenstrijdige bronnen · **Verouderd** (opnieuw controleren). Technisch gemapt op §3.2.
4. **"De oorspronkelijke bron vinden"** is niet altijd mogelijk (paywall, niet-openbaar rapport). De status moet dat dan eerlijk zeggen ("primaire bron niet toegankelijk; alleen secundair geciteerd") in plaats van te blijven zoeken.
5. **ProofLab valideren in het consultancymodel** kan goedkoper dan een gebruikerstest met 10–15 mensen: verkoop 2–3 **betaalde** validatiesprints aan echte klanten en voer ze uit met de eerste route plus handwerk. Dat is precies de *concierge*-test uit het boek, toegepast op ProofLab zelf: betaling is het sterkste bewijs, en wat je bij elke klant opnieuw handmatig doet, is wat je daarna moet bouwen. Daarnaast: gebruik ProofLab op ProofLab zelf als eerste dossier (dogfooding) en als E2E-test.
6. **Minder agents:** eens. De 13 agents uit v1.0 worden vier pijplijnstappen: *plannen → bronnen verzamelen en verifiëren → analyseren + Reality Check → rapporteren*, met deterministische controles ertussen.

### 12.4 Geconsolideerd voorstel voor de eerste route (v1)

**Belofte:** van beslisvraag naar onderbouwd besluit, met zichtbare kwaliteit van elk bewijsstuk.

```text
Beslisvraag → Idee & projecttype → Onderzoeksplan (≤5 vragen)
→ Marktverkenning met verificatie per bewering (+ handmatige bronnen)
→ Bottom-up marktomvang (scenario's) → Aannamekaart (belangrijk × bewijs)
→ Eén experiment uit drie (landingspagina live met cookieloze meting | interview met transcriptupload | prijs-/aanbodtest)
→ Bewijs met onzekerheid en bewijsladder → Reality Check → Besluit (klant bevestigt)
→ Rapport (HTML + PDF) met bronnen, beperkingen en tegenbewijs
```

Uitgewerkt in vijf zichtbare stappen voor de gebruiker (Idee · Markt · Aanname · Test · Besluit), met de mock-upstijl als visuele basis. Klaar is het als het fictieve idee uit §16 van v1.0, **en** een tweede, totaal ander idee, **en** ProofLab zelf de hele route doorlopen met echte bronnen, een echte testpagina en een reproduceerbaar rapport, en de 30 AI-testcases slagen.
