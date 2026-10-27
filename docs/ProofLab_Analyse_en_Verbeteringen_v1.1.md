# ProofLab — analyse van het ontwerp v1.0 en voorgestelde verbeteringen (v1.1)

**Datum:** 27 oktober 2026
**Basis:** `ProofLab_Functioneel_Ontwerp_v1.md` (versie 1.0)
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
