# Implementation status

Stand: 3 november 2026. Bouwvolgorde volgens het besluit "eerst één complete route" (analyse §12.4–12.5).
Legenda: ✅ gebouwd en getest · 🟡 gebouwd, test of koppeling hangt af van een externe stap · ⬜ nog niet gebouwd.

## Externe stappen die nog openstaan

| Stap | Waarom | Wie |
|---|---|---|
| ~~Migraties toepassen~~ | Gedaan 28-10: `core_schema`, `security`, `hardening` staan op project `prooflab`; ingest-sleutel geregistreerd | ✅ |
| Migraties `integrity` (29-10), `prediction` en `coach_and_signals` (3-11) toepassen en migratiegeschiedenis rechtzetten | Zonder deze migraties werken testpagina's, inloglinks, sprints, rapport delen, voorspellingen, coach en koppelingen niet tegen de live database | Claude, na bevestiging in Supabase |
| Auth-hook "Before user created" → `public.hook_before_user_created` (Authentication → Hooks) | Registratie alleen op uitnodiging, ook bij directe aanroepen van Supabase Auth | Hylke |
| E-mailsjabloon "Magic Link": link naar `{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email&next={{ .RedirectTo }}` | Uitnodigingen werken dan op elk apparaat | Hylke |
| Eigen adres of domein op de toegangslijst (`insert into public.signup_allowlist (entry) values ('naam@bureau.nl')`) | Registratie staat dicht; consultants hebben een plek op de lijst nodig | Claude of Hylke |
| "Leaked password protection" aanzetten (Authentication → Passwords) | Enige resterende security-advieswaarschuwing die geen bewuste keuze is | Hylke |
| Minstens één van `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY` als secret (Vercel) | AI-onderzoek, AI-aannames, interviewcodering, coach, AI-vragen in de Reality Check; met meer sleutels zoeken en voorspellen de aanbieders los van elkaar | Hylke |
| Eigen SMTP (bijv. Resend) in Supabase Auth | Uitnodigingen aan opdrachtgevers buiten het Supabase-team | Hylke |
| Vercel-project + domein (na merkcheck) | Publieke testpagina's en app online | Hylke |
| LinkedIn Advertising API-aanvraag | Doorlooptijd weken tot maanden | Hylke |

## Systeemreview 29 oktober: 20 verbeterpunten

Onafhankelijke review (beveiliging, rekenlogica, UX/toegankelijkheid) plus advisors en tests. Alle 20 punten zijn
opgelost in code; de databasekant wordt live zodra migratie `integrity` is toegepast.

| # | Punt | Oplossing | Bewijs |
|---|---|---|---|
| 1 | Consultant kon "namens de klant" bevestigen | Uitnodiging zonder account; alleen bevestigde e-mail claimt; organisatieleden kunnen nooit bevestigen | DB-test `never lets a consultant act as the client` |
| 2 | Testresultaten op te blazen | Bezoekerscode per test (HMAC), klik pas na weergave, inzending pas na klik, 30 acties/min per netwerk, alleen same-origin JSON, geen framing | DB-test ingest + unit `clientIp` |
| 3 | AI kon bron promoveren tot "officieel" | Brontype uit vaste domeinlijst; model kan alleen omschrijven; webtekst met willekeurige scheidingstags | Unit `aiSourceType` |
| 4 | Getallencontrole liet "3 miljoen" vs "30 miljoen" door | Schaalwoorden, %, beide decimaalstijlen; kleine getallen tellen mee | Unit `figures with scale words` |
| 5 | Grote tests afgekapt op 1000 regels | Telling in SQL (`experiment_event_counts`) | DB-test ingest |
| 6 | Learning Card dubbel = bewijs dubbel | Eén concept en één goedgekeurde kaart per experiment, systeemobservatie hergebruikt, AI-citaten uniek | DB-test `tamper-proof` |
| 7 | Dagelijks wisselende code verstoorde tests | Stabiele code per test, zelfde prijsvariant | Unit tracking |
| 8 | Onveranderlijkheid alleen in schermen | Triggers: rapporten, Reality Checks, goedgekeurde kaarten, einddatum lopende test, besluit op laatste check | DB-tests |
| 9 | AI-kosten onbegrensd | Maandplafond per werkruimte uit onveranderlijke `ai_runs`; runbudget vast; kosten atomair; elke aanroep gelogd | DB-test budget |
| 10 | Openbare registratie | Alleen uitnodiging of toegangslijst; auth-hook; zelfde antwoord voor iedereen | DB-test `creates accounts by invitation` |
| 11 | SSRF-omzeiling | Eén keer opzoeken en vastzetten, volledige blokkadelijst incl. IPv4-in-IPv6, alleen standaardpoorten | Unit `fetch-page` + live controle |
| 12 | Audit trail met gaten | Alle bewijstabellen, gewijzigde waarden, blijft na verwijderen idee (zichtbaar voor eigenaar) | DB-test audit |
| 13 | Privacybeloftes niet afgedwongen | Dagelijkse opschoning (pg_cron), klanten zien geen letterlijke citaten | DB-test observaties |
| 14 | Coach stuurde verkeerde kant op | Volgende stap per toestand, suggesties per scherm, vraagveld alleen met AI | Unit `coach` |
| 15 | Sprint onzichtbaar | Startdatum en duur in intake, week X van Y, mijlpalen, "loopt achter", beslisdatum | Unit `sprint` |
| 16 | Geen opdrachtgeversroute | Eigen startscherm, "Actie nodig: bevestig", rapport delen + "bekeken", inloglink opnieuw, werkt op elk apparaat | Typecheck/unit; live na migratie |
| 17 | Toegankelijkheid | Eén toegankelijk Drawer-component (focus, Escape, inert), skiplink, 44 px, kopvolgorde, risicokaart zonder overlap, avatarmenu | Keyboard-script 18/18 (agent), unit `risk-layout` |
| 18 | Migratiegeschiedenis klopte niet | Rechtgezet in dezelfde stap als migratie `integrity` | Na toepassen |
| 19 | 56 FK's zonder index, ontbrekende tests | Index op elke foreign key; 25 nieuwe tests | Advisors na toepassen |
| 20 | Geen CI | GitHub Actions: lint, types, unit/eval, DB-tests op Postgres 16, build | `.github/workflows/ci.yml` |

## Route v1

| Onderdeel | Status | Bewijs |
|---|---|---|
| Inloggen (wachtwoord, magic link, account), sessie via proxy, uitloggen | ✅ | E2E `public.spec.ts` + journey |
| Werkruimte aanmaken, klanten, opdrachtgevers uitnodigen (beslist mee / kijkt mee) | ✅ | RLS-tests; live project (uitnodigingsmail vereist eigen SMTP) |
| Intake: beslisvraag eerst, projecttype, branche, opdrachtgever | ✅ | Typecheck/build; E2E-journey |
| Onderzoekskaart ≤ 5 vragen (sjabloon per projecttype en branche, AI-voorstel, bewerken) | ✅ / 🟡 AI | Unit `research plan templates` |
| Bronnenbibliotheek: fragment i.p.v. volledig document, live paginacontrole (SSRF-beveiligd) | ✅ | `lib/fetch-page.ts` |
| Bevinding met letterlijk citaat, live controle in het formulier, berekende status (5 statussen) | ✅ | Unit `verify.test.ts`, eval #1–#17 |
| Onafhankelijkheid (zelfde persbericht telt één keer), tegenspraak, actualiteit per soort gegeven | ✅ | Eval #7–#12 |
| AI-onderzoeksrun: webzoeken + ophalen met citaten, alleen letterlijke passages, afwijzen van niet-terug te vinden citaten, kosten per stap, budgetplafond, herstartbaar | 🟡 | Code; live eval vereist API-sleutel |
| Tegenargumenten (advocaat van de duivel) in diep onderzoek | 🟡 | Vereist API-sleutel |
| Concurrentieradar: direct/indirect/alternatief/niets doen, prijs alleen met peildatum, detaildrawer | ✅ | — |
| Doelgroepen: gebruiker, betaler/beslisser, aanbodzijde | ✅ | — |
| Marktomvang van onderaf, drie scenario's, bron of "nog te toetsen" per factor, formule zichtbaar, zonder LLM | ✅ | Unit `market sizing` |
| Financiële haalbaarheid: marge, terugverdientijd, klantwaarde, LTV/CAC, break-even | ✅ | Unit `unit economics` |
| Aannamekaart belangrijk × berekend bewijs, blinde-vlekkencheck, bevindingen koppelen | ✅ | Unit `evidence strength` |
| Experimentaanbeveler (snel / sterker / meest overtuigend) met wat een test níét bewijst | ✅ | — |
| Test Card met hypothesecoach, steekproefadvies, bereikcheck, kanalen | ✅ | Unit `hypothesis coach` |
| Review → expliciete goedkeuring met controlepunten → vergrendeling → publicatie | ✅ | RLS-test `locks the hypothesis…` |
| Publieke testpagina: geen cookies, eerlijke uitleg na klik, honeypot, botfilter, prijsvariant server-side | ✅ | E2E-journey controleert 0 cookies en ontdubbeling |
| Ingest via RPC met sleutel, ontdubbeld per bezoeker/dag | ✅ | RLS-test `only accepts deduplicated test events…` |
| Live meting per kanaal en per prijspunt; geen oordeel vóór de eindconditie | ✅ | Unit `pre-registered verdict`, eval #18–#23 |
| Interviews: toestemming verplicht, pseudoniem, DMU-rol, bekenden, codering met letterlijk citaat, AI-codering | ✅ / 🟡 AI | — |
| Learning Card (concept uit ruwe metingen, bewerken, goedkeuren → status aanname) | ✅ | E2E-journey |
| Bewijsladder en sterkte langs vier dimensies; synthetisch telt nooit | ✅ | Unit + eval #16 |
| Reality Check (regels altijd, AI-vragen optioneel), blokkades, verouderde check na nieuw bewijs | ✅ | Unit `reality check`, eval #24–#30 |
| Besluit (5 opties) met motivering; opdrachtgever bevestigt; besluiten onveranderlijk | ✅ | RLS-test `keeps decisions immutable…` |
| Dossierlabels op controleerbare regels | ✅ | Unit `dossier labels` |
| Rapport: onveranderlijke versies, bronvoetnoten, ruwe aantallen, intervallen, beperkingen, tegenargumenten, besluit, methode; print/PDF; JSON-export | ✅ | E2E-journey |
| Coach: inhoud berekend uit dossierstand; vraagveld met AI | ✅ / 🟡 AI | — |
| Audit trail, AI-gebruikslog (model, promptversie, tokens, kosten) | ✅ | RLS-test controleert audit |

## Acceptatiecriteria (CLAUDE.md §8 en ontwerp §17)

- [x] Kleuren, typografie, kaarten en layout uit de HTML (CSS letterlijk overgenomen; afwijkingen in DESIGN_DIFF_LOG)
- [x] Intake, tabs, filters, rekenmodule, risicokaart, experimentselectie en besluit werken
- [x] Mobiel: drawer, coach als slide-over, één kolom (E2E `@mobile` slaagt; geen horizontale overloop op 320/390 px)
- [x] Elke bevinding toont bron en citaat of is zichtbaar onvoldoende onderbouwd
- [x] Een AI-bewering telt nooit als klantbewijs
- [x] Ruwe observaties en rapporten blijven herleidbaar (snapshots, audit)
- [x] Onboarding volledig handmatig zonder AI-sleutel
- [x] Onbekende concurrentieprijs blijft "niet publiek"
- [x] TAM/SAM/SOM met formule en bewerkbare factoren; herberekening zonder LLM
- [x] Drempels niet stil achteraf aan te passen (DB-trigger)
- [x] Dubbele events/refreshes tellen niet dubbel (unieke index + RPC)
- [x] Synthetische respondenten beïnvloeden geen oordeel
- [x] Elk rapport noemt tegenbewijs en open vragen
- [x] Cross-tenant lezen/schrijven geweigerd (RLS-tests)
- [x] Publiceren of extern versturen alleen na menselijke goedkeuring
- [x] Bronnen zijn data, geen instructies (systeemprompt + geen tools bij extractie + letterlijke citaatcontrole; eval #14)
- [x] E2E-journey idee → onderzoek → risico → test → bewijs → besluit → rapport tegen het echte Supabase-project (`tests/e2e/journey.spec.ts`, 1,1 min)
- [x] Visuele controle 1440/768/390/320 van alle ingelogde schermen; overloop opgelost (DESIGN_DIFF_LOG #17)
- [x] Dogfood-dossier "ProofLab op ProofLab" in de app, ingevoerd via de echte UI (`npm run dogfood`): beslisvraag, 3 bronnen met letterlijk fragment dat live is teruggevonden (Strategyzer, ValidatorAI, IdeaProof), 6 aanbieders/alternatieven (Rapidly: website blokkeert broncontrole → positionering en prijs onbekend), aannamekaart, interview-Test Card als concept (niet gepubliceerd). Staat nu in de E2E-werkruimte; na je eerste login draai je het script met `DOGFOOD_EMAIL`/`DOGFOOD_PASSWORD` voor je eigen werkruimte

## Testresultaten (laatste run, 3-11)

- `npm run lint` en `npm run typecheck` — schoon
- `npm test` — 224 geslaagd, 3 overgeslagen (live eval zonder API-sleutel)
- `npm run test:db` — 36 geslaagd (RLS, integriteit, voorspellingen, coach, outreach, onderzoeksmethodes)
- `npm run build` — geslaagd
- Niet gedaan: E2E en visuele controle van de nieuwe schermen; die vragen het live project met de nieuwe migraties
  (laatste geslaagde E2E: 28-10, 5/5). De E2E-specs zijn bijgewerkt voor de nieuwe intakestap en de besluitvoorspelling.

## Voorspellus (3 november, ontwerp `ProofLab_Voorspelkracht_v1` 3.1–3.4, termijn zes maanden)

- ✅ Uitkomstdefinitie in de intake ("Wanneer is dit geslaagd?"), vast zodra er voorspellingen zijn
- ✅ Basispercentage per dossier uit een referentieklasse met bron, of eigen percentage vanaf 10 afgeronde dossiers; vast zodra er voorspellingen zijn
- ✅ Blinde voorspellingen op vier momenten (intake, onderzoek, experiment, besluit) door consultant, opdrachtgever en optioneel AI (apart, telt niet mee)
- ✅ Besluit vraagt eerst de eigen besluitvoorspelling; de klok van zes maanden start bij het besluit (datum opgeslagen)
- ✅ Tussenstand na drie maanden en uitkomst na zes maanden, met herinneringen op het dashboard en Brier-score per voorspelling
- ✅ Pagina "Voorspelkwaliteit": Brier per voorspeller en per moment, kalibratiegrafiek, eigen basispercentages
- ✅ Rapport toont uitkomstdefinitie, basispercentage, voorspellingen, tussenstanden, uitkomst, kans per aanname, simulatie en klantsignalen

## Coach die meekijkt en klantsignalen uit meer bronnen (3 november)

- ✅ 20 vaste coachregels (tips, waarschuwingen, vragen, complimenten) die zichzelf sluiten als het punt is opgelost; AI-coach (max. 3 rondes per dossier per dag, binnen het maandbudget) bij echte wijzigingen; feed in het coachpaneel, teller op de ideekaarten
- ✅ Expandi-webhook per dossier (token alleen als hash, contacten gepseudonimiseerd, berichten 180 dagen), cijfers per campagne, antwoorden omzetten in klantsignalen
- ✅ Bulkimport (plakken of CSV, max. 2.000 regels) en losse pagina's ophalen als klantsignalen
- ⬜ AI-gemodereerde interviews: besloten voor na de eerste sprints

## Voorspelkracht: bewijs kwantificeren (3 november, ontwerp `ProofLab_Voorspelkracht_v1` 3.5–3.10)

Alles deterministisch (geen LLM), met unit-tests in `tests/unit/quantify.test.ts` en databasetests in `tests/db/quantify.test.ts`.

- ✅ 3.5 + 3.7 Kans per aanname: Bayes in odds met een zichtbare factor per bewijssoort (`lib/domain/evidence.ts`), afnemende meeweging, tegenbewijs, intentiecorrectie (mening × 1,1), AI-codering half tot beoordeeld. Bandbreedte (factoren ±50%) en top 3 bijdragen op de risicokaart; x-as = geschatte kans dat het klopt.
- ✅ 3.9 Informatiewaarde: rangschikking op aannamepagina en in de experimentaanbeveler, met een uitleg per aanname (`lib/domain/recommend.ts`).
- ✅ 3.6 Bayesiaanse schatting naast het Wilson-interval, prior uit eerdere afgeronde tests van hetzelfde type in de organisatie (max. 20 pseudo-waarnemingen), pas na de eindconditie. Het vooraf vastgelegde oordeel is ongewijzigd.
- ✅ 3.10 Pre-mortem in de Reality Check: redenen worden aannames (`origin = 'premortem'`); waarschuwing zonder pre-mortem.
- ✅ 3.8 Monte Carlo marktomvang: 90%-bandbreedte per factor, 5.000 trekkingen met vaste startwaarde, P10/P50/P90, kans op break-evenomzet, grootste onzekerheidsbron.
- ✅ Beginwaarde per aanname opslaan (`assumptions.prior`), te zetten op de risicokaart.
- ⬜ Factoren ijken op afgeronde dossiers (fase D).

## Gevonden en opgelost tijdens de live E2E

- Formulieren werden na verzenden door React leeggemaakt, waardoor de intake bij een fout invoer verloor (`keepValuesOnSubmit`)
- Intake: de knop "Volgende" wisselde tijdens de klik van type en verstuurde te vroeg
- Bevinding toevoegen: een verouderde fragmentselectie na het toevoegen van een nieuw fragment
- Contrast loginpagina op mobiel; horizontale overloop op smalle schermen

## Nog niet gebouwd (na de route)

- ⬜ AI-gemodereerde chatinterviews (spraak later) — besloten: na de eerste sprints
- ⬜ Weekritmes: leersessie en besluitsessie met de klant, Fathom-import
- ⬜ Koppelingen met de Meta- en LinkedIn-advertentie-API's (nu: kanaallinks + handmatig live zetten)
- ⬜ Experimentencatalogus (±40 methodes met metadata) en begeleide handmatige sjablonen
- ⬜ Propositie- en businessmodelcanvas
- ⬜ Automatische maandelijkse concurrentiecheck (handmatig starten kan al), verschillenrapport tussen onderzoeksversies
- ⬜ Betalingen/aanbetalingen (na juridische check), Stripe
- ⬜ Server-side PDF-rendering (nu printstylesheet)
- ⬜ Gebruiksniveaus (begeleid / verdiepend / expert)

## Onderzoeksmethodes en AI (Voorspelkracht v1, hoofdstuk 7)

Alle AI-functies werken met minstens één van `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` of `GEMINI_API_KEY`; zonder sleutel tonen ze "AI niet verbonden" met het handmatige alternatief.
AI-uitkomsten zijn gelabeld als AI-voorstel tot een consultant ze accepteert.

- [x] 7.1 Steuncontrole: draagt het letterlijke citaat de bewering? Automatisch in de onderzoeksrun (na de letterlijke controle; "draagt niet" wordt niet opgeslagen, "deels" wel met label), op verzoek per citaat, en een consultantoordeel dat altijd wint. "Draagt niet" telt als mislukte citaatcontrole in de claimstatus (`lib/domain/support.ts`, `lib/claims.ts`)
- [x] 7.9 AI-kwaliteit: overeenstemming steuncontrole (≥ 90%) en acceptatie AI-codering (≥ 70% over ≥ 10 beoordelingen), kaart op Bronnen en bij het experiment (`lib/domain/ai-quality.ts`)
- [x] 7.4 Leidraadcontrole (hypothetisch, sturend, pitch, gesloten, dubbel) met herschrijfpatroon, in de Test Card en bij het experiment; transcriptcontrole op interviewerbeurten (`lib/domain/interview-audit.ts`)
- [x] 7.4 Accepteren/afwijzen van AI-codering; afgewezen codering telt niet meer mee voor de aanname
- [x] 7.3 Klantsignalen (reviewsite, forum, outreach; blog/nieuws/overig als handmatig toegevoegd): AI-groepering, alleen letterlijke citaten, handmatig toevoegen/verwijderen, pijnpunt → aanname
- [x] 7.2 Concurrentiecheck per aanbieder en "alles opnieuw controleren" (handmatig te starten; nog geen automatische maandplanning). Verdwenen citaten maken de bevinding "verouderd"; niets wordt verwijderd
- [x] 7.6 AI-varianten voor landing- en prijstests plus deterministische eerlijkheidscontrole
- [x] 7.8 Rode team per kritieke aanname (zoekt alleen tegenbewijs, zelfde citaat- en steuncontrole, koppeling "spreekt tegen")
- [x] AI-oordeel en hercontrole in eigen kolommen (`claim_sources.ai_support_check`, `live_found`, `live_checked_at`; `sources.live_checked_at`, `live_error`); notities blijven wat mensen schreven

## Enquêtes: bouwer en resultaten (3 november, Voorspelkracht 7.5)

- [x] Enquête als vierde testvorm in de aanbeveling (niet in de informatiewaarde-keuze) en de Test Card; editor met titel, introductie, wie vraagt, duur, bedanktekst en vragenlijst (toevoegen, verwijderen, verplaatsen met toetsenbord; één keuze, meerdere keuzes, schaal, getal, open; opties; schaaluiteinden; "toon alleen als" op een eerdere keuzevraag) (`components/survey/SurveyEditor.tsx`, `lib/domain/survey-editor.ts`)
- [x] Kernvraag en succesopties vullen teller en noemer van de Test Card; validatie met `SurveyConfigSchema` in het Nederlands; vraagcontrole (hypothetisch, sturend, pitch, dubbel) per vraag; opslag in `experiments.config` (vergrendeld na goedkeuring door de database)
- [x] Coach-opzet "Laat de coach een eerste opzet maken" (`lib/ai/survey.ts`, `runAi("survey_draft")`, dossier omheind), nabewerking: hypothetische/sturende/verkopende vragen herschreven naar recent gedrag of weggelaten, maximaal 12 vragen, kernvraag uit het sjabloon als de voorgestelde onbruikbaar is, "Waarom deze vragen" (`lib/domain/survey-draft.ts`). Zonder AI of bij bereikt budget: het sjabloon, als sjabloon gelabeld
- [x] Coachregel `survey_suggest`: kritieke aanname met interviewbewijs maar minder dan 20 datapunten en nog geen enquête
- [x] Meting: kernvraag over alle geloofwaardige antwoorden (oordeel pas na de eindconditie), plus splitsing per herkomst en kanaal; waarschuwingen open link > 50%, te snelle antwoorden, te weinig uitgenodigde respondenten (`lib/domain/survey-results.ts`, `lib/experiment-metrics.ts`)
- [x] Resultaten op de experimentpagina, CSV-export voor het onderzoeksteam (geen e-mailadressen; contactgegevens in open antwoorden verwijderd), open antwoorden als bron van het type enquête voor de klantsignalen
- [x] Learning Card met observatie `survey_answer` (nooit gedrag); dossierlabel telt enquêtes niet als gedragsexperiment; Reality Check "Enquête positief, gedrag nog niet gezien"; rapport: "zelfrapportage, geen waargenomen gedrag" en splitsing per herkomst
- [x] Opdrachtgevers zien op de experimentpagina alleen de kernvraag (uitkomst, splitsing per herkomst, 95%-interval) via `survey_key_answers`; overige antwoorden blijven bij het onderzoeksteam
- [ ] Visuele controle in de browser tegen een database met de enquêtemigratie (de live Supabase heeft die migratie nog niet)

## Enquêtes verspreiden en uitnodigingsberichten (3 november)

- ✅ Publieke enquêtepagina `/s/<slug>` (cookieloos, merkneutraal, alle vragen op één pagina met foutoverzicht, voorwaardelijke vragen, toestemming, honeypot, invulduur); persoonlijke links `?u=<token>`, open links `?utm_source=<kanaal>`; gesloten/gepauzeerd/al ingevuld/afgemeld netjes afgevangen; `POST /api/s/<slug>` met dezelfde regels als `/api/t`
- ✅ Afmelden `/s/afmelden` (bevestigingsknop, niets op GET) en one-click `List-Unsubscribe` (`/api/s/afmelden`); afmeldlijst per organisatie op HMAC van het adres
- ✅ Verspreiden bij het experiment: open link per kanaal, bulkuitnodigingen (plakken of CSV, max. 2.000, ontdubbeld, afgemelde en al uitgenodigde adressen overgeslagen, verplichte grondslag, bewerkbare e-mail met voorbeeld), versturen in batches met voortgang, één herinnering na ≥ 3 dagen
- 🟡 Versturen via Resend vraagt `RESEND_API_KEY` en `EMAIL_FROM`; zonder koppeling "e-mail niet gekoppeld" en een CSV met persoonlijke links en afmeldlinks
- ✅ Uitnodigingsberichten per platform (LinkedIn, LinkedIn-DM via Expandi, Instagram, Facebook, X, WhatsApp, nieuwsbrief) voor enquêtes, landing- en prijstests: sjablonen met lengtelimieten en kanaallink, AI-concepten (`promo_posts`) met eerlijkheidscontrole, bewerken, kopiëren, opnieuw genereren
- ✅ Eén herinnering vastgelegd in `survey_invitations.reminded_at`; afmelden zet de opgeslagen adres-hash op de afmeldlijst (`email_hash`); de publieke enquête geeft kernvraag en succescriteria niet prijs

## Achtergrondtaken en PDF (4 november)

- ✅ Postgres-takenwachtrij `public.jobs` (migratie `20261104120000_jobs.sql`): status queued/running/done/failed/cancelled, pogingen, `run_after`, lease (`locked_until`), voortgang en laatste fout. Claimen met `FOR UPDATE SKIP LOCKED` in `claim_jobs` (SECURITY DEFINER, alleen met de ingest-sleutel); verlopen leases worden opnieuw opgepakt of na de laatste poging als mislukt gemarkeerd; een afgeronde taak is definitief en verliest de namen uit de payload. Inplannen (`enqueue_job`, één actieve verzending per enquête) en stoppen (`cancel_job`) alleen door consultants van het dossier; zichtbaar via RLS (`can_write_idea`), opdrachtgevers en andere organisaties zien niets
- ✅ Worker `/api/jobs/run` (Bearer `CRON_SECRET`, ~50 s per run, oplopende wachttijd bij tijdelijke fouten, tijdsplakken zodat meerdere taken aan de beurt komen), `vercel.json`-cron elke minuut; fallback zonder minutencron: start direct na inplannen (`after()`) en bij het pollen van de voortgang
- ✅ Enquête-uitnodigingen en herinneringen als taak: één taak per verzendverzoek met de uitnodigings-id's; de handler claimt elke uitnodiging in de database vóór het mailen (`job_survey_mark`), dus geen dubbele mail bij herhaling, crash of dubbelklik; drie tijdelijke fouten op rij → later opnieuw vanaf die plek. Voortgang en "Stop verzending" in het Verspreiden-paneel; het tabblad mag dicht. Zonder `RESEND_API_KEY` wordt niets ingepland
- 🟡 Minutencron vraagt Vercel Pro en `CRON_SECRET`; op Hobby draait de fallback (zie README → Achtergrondtaken)
- ⬜ Onderzoeksruns (`/api/research/<run>/advance`) en de coachreview (`after()`) blijven zoals ze waren: ze draaien onder de sessie van de gebruiker (RLS) en hebben voor een worker zonder sessie eigen SECURITY DEFINER-functies per tabel nodig. Dat is geen kleine wijziging; de wachtrij is er klaar voor (nieuwe `kind` + handler)
- ✅ Server-PDF van een rapportversie: `/app/ideas/<id>/report/pdf?v=<n>` met `@react-pdf/renderer` (geen headless browser). Omslag (merk, status, project, onderzoeksperiode), managementsamenvatting met KPI-blokken, alle hoofdstukken van de rapportpagina, tegenbewijs en beperkingen, besluit met auditgegevens, implementatieadvies, genummerde bronnen (URL, datums, kwaliteitslabel) en bijlage met ruwe meetdata (n, successen, kanaalverdeling; kernvraag per herkomst als zelfrapportage). Voorspellingen blijven verborgen tot de uitkomst bekend is; opdrachtgevers krijgen alleen gedeelde versies (RLS). Knop "Download PDF" naast de printknop
- 🟡 PDF in Helvetica: Space Grotesk en DM Sans staan niet als bestand in de repository (DESIGN_DIFF_LOG #41)
- ✅ Afgestemd op privacy en bounces (migratie `20261104150000_jobs_reconcile.sql`): taken slaan uitnodigingen met een `delivery_issue` over (ook de database weigert de claim), maken links met de zoutversie van de uitnodiging, controleren de afmeldlijst onder elke zoutversie (`job_suppressed_hashes`) en bewaren het Resend-bericht-id (`provider_message_id` / `reminder_message_id`, `job_survey_sent`) voor de bounce-webhook. Tegels onbestelbaar en spam gemeld staan naast de voortgang
- Tests: `tests/unit/jobs.test.ts` (backoff, idempotente handler met nep-database, annuleren, opnieuw proberen, tijdsplakken), `tests/unit/report-pdf.test.ts` (inhoud en echte PDF-rendering), `tests/db/jobs.test.ts` (skip locked, ingest-sleutel, RLS, annuleren, claim per uitnodiging, verlopen lease)


## Leren van uitkomsten (4 november)

Migratie `20261104130000_learning.sql`, rekenwerk in `lib/domain/calibration.ts`, getoond op Voorspelkwaliteit (`/app/forecasts`).

- ✅ Geleerde bewijsfactoren per soort observatie en testtype: per afgerond dossier de netto richting (ondersteunend/tegen), vergeleken tussen dossiers die het doel wel en niet haalden, met een prior die naar de standaardfactor krimpt; pas vanaf 8 dossiers met zo'n uitkomst ("nog te weinig dossiers: x/8"). In gebruik geklemd op 1–20
- ✅ Instelling `organizations.use_learned_weights` (standaard uit); elke consultant schakelt via `set_learned_weights`, de database stempelt wie en wanneer. Aan: `assumptionProbability` gebruikt de geleerde factoren (aparte factor voor tegenbewijs); klant en consultant rekenen met dezelfde factoren (`idea_uses_learned_weights`, `idea_learning_counts`). Rapport en aannamepagina vermelden welke factoren zijn gebruikt
- ✅ Enquête tegenover gedrag: overeenstemming van de kernvraag met een landing- of prijstest op dezelfde aanname (`survey_behaviour_agreement`)
- ✅ Coachtips: per regel geplaatst, gedaan, niet relevant, mediaan dagen, nuttig-stemmen en (beschrijvend, samenhang) de Brier-score van het besluit bij gevolgd versus genegeerd (`coach_note_stats`); "Was deze tip nuttig? ja/nee" bij open notities (`coach_notes.helpful`, de vergrendeltrigger laat alleen status en deze stem toe)
- ✅ Startkalibratie: coachregel `forecast_overconfident` (meer dan 25 procentpunt van het basispercentage zonder afgeronde gedragstest, zolang de werkruimte < 10 afgeronde dossiers heeft; noemt geen waarde, persoon of richting) en een ijkhulp op de uitkomstpagina met de eigen voorspellingen naast het basispercentage en een gemengde schatting (mensen, AI, basispercentage) als suggestie, alleen na de eigen voorspelling
- ⬜ Geleerde testfactoren ook gebruiken in de keuze van de volgende test (informatiewaarde); nu alleen ter informatie
- ⬜ "Gedaan" onderscheidt nog niet tussen zelf afgevinkt en door de coach gesloten omdat het punt was opgelost
- ⬜ Visuele controle van de nieuwe secties tegen een database met deze migratie

## Privacy, bounces en outreach (4 november)

Migratie `20261104100000_privacy_and_outreach.sql`.

- ✅ Resend-webhook `POST /api/email/resend`: Svix-handtekening (HMAC-SHA256 over `id.timestamp.body`, base64-geheim zonder `whsec_`), tijdstempel maximaal 5 minuten afwijkend, vergelijking in constante tijd; idempotent per `svix-id` (`email_webhook_events`, 30 dagen bewaard). Harde bounce (`email.bounced` met `bounce.type = Permanent`) of `email.complained` → uitnodiging mislukt met Nederlandse reden, `delivery_issue` gezet, adres-hash op de afmeldlijst (`email_suppressions.reason`). Zachte bounces, `email.delivered` en `email.delivery_delayed` veranderen niets. Schrijven via `record_email_event` (security definer, ingest-sleutel). Het Resend-id van de eerste mail en van de herinnering staat in `provider_message_id` / `reminder_message_id`. Een trigger voorkomt dat een consultant een bounce wist of een gebouncet adres opnieuw verstuurt
- ✅ Verspreiden toont onbestelbaar en spam gemeld; zonder `RESEND_WEBHOOK_SECRET` staat er eerlijk dat bounces niet worden bijgehouden
- 🟡 Vraagt in Resend een webhook naar `/api/email/resend` en `RESEND_WEBHOOK_SECRET`. Een bounce die binnenkomt vóór het Resend-id is opgeslagen (enkele milliseconden na het versturen) wordt als onbekend genegeerd
- ✅ Link per bericht: elke uitnodigingspost heeft een eigen postcode (`promo_posts.code`, bijv. `dm-k3f9x`) en link met `utm_content`; enquêteantwoorden (`survey_responses.content`) en test-events (`test_events.content`) bewaren die code via `submit_survey`, `record_test_event` en `submit_test_form` (extra optionele parameter `p_content`, verder ongewijzigd). Bestaande posts kregen een code en (als het past) de code in hun link. Experimentpagina: tabel "Per bericht" (respondenten of bezoekers, succesmaat, ratio), met vervangen posts en "zonder postcode" apart
- ✅ Geheim roteren: `TRACKING_SALTS="v2:…,v1:…"` (eerste = huidig, `TRACKING_SALT` = `v1`); `survey_invitations.salt_version`; tokens, afmeldlinks en CSV-links met de versie van de uitnodiging; de afmeldlijst wordt onder alle versies gecontroleerd
- 🟡 Bezoekerscodes van testpagina's en Expandi-contactcodes gebruiken altijd het huidige geheim (niet triviaal over versies heen te ontdubbelen): roteer tussen tests, niet tijdens
- ✅ Privacyverzoeken `/app/privacy` (link in de werkruimtenavigatie, alleen eigenaren): één e-mailadres zoeken in uitnodigingen (ook op adres-hash onder alle sleutelversies), enquêteantwoorden via die uitnodigingen, aanmeldingen op testpagina's, afmeldlijst, interviews (pseudoniem of letterlijk in het transcript), teamaccount en meekijktoegang; download als JSON; verwijderen (adres geanonimiseerd zoals de bewaartermijn doet, antwoorden via die uitnodigingen gewist, aanmeldingen leeggemaakt, optioneel op de afmeldlijst, eerdere auditkopieën van die rijen ingekort) met `audit_events` zonder het adres. RPC's `dsr_search` / `dsr_erase` (security definer, `is_org_owner`, alleen rijen van de eigen organisatie). Uitleg wat niet te vinden is (open links, Expandi, bronfragmenten, externe diensten)
- ✅ Expandi: per experiment een campagne-webhook-URL (`expandi_campaign_hooks`, alleen consultants, niet in de audittrail); bij het LinkedIn-DM-bericht contacten (profiel-URL;voornaam, max. 100 per keer) naar de campagne sturen met `{prooflab_message}` en `{prooflab_link}` (`utm_source=outreach&utm_content=<postcode>`), of een CSV voor de Expandi-import. Alleen https naar `api.liaufa.com` of `*.expandi.io`, DNS één keer opgelost en vastgepind, geen doorverwijzingen. Profiel-URL's worden niet in ProofLab bewaard
- 🟡 Expandi-beperking (help.expandi.io, "Reversed Webhooks"): de webhook voegt alleen contacten met placeholders toe; het berichtsjabloon van de campagne stel je in Expandi zelf in. Niet getest tegen een echte Expandi-campagne
- ✅ Tests: `tests/unit/privacy-outreach.test.ts` (handtekening incl. foute en oude, zoutversies, utm_content, Expandi-payload en CSV, DSR-samenvatting) en `tests/db/privacy-outreach.test.ts` (bounce-RPC idempotent + afmeldlijst, klacht op herinnering, contentkolommen en telling per post, postcodes, Expandi-URL alleen voor consultants, DSR alleen eigenaar en eigen organisatie)

## Operationeel (4 november)

- ✅ CI op elke push en PR (`.github/workflows/ci.yml`): job `check` ongewijzigd (lint, typecheck, unit/eval, database, build) plus job `e2e`: lokale Supabase-stack via de Supabase CLI (`supabase/config.toml`, alle migraties, auth-hook aan), controle dat elke migratie is toegepast, seed (`scripts/e2e-seed.sh`: ingest-sleutel, toegangslijst, bevestigde testgebruiker), build met de lokale URL/sleutel, Playwright Chromium (journey + publieke pagina's, desktop en mobiel); bij een fout het HTML-rapport, traces en containerlogs als artifact
- ✅ Lokaal geverifieerd met dezelfde stappen (Supabase CLI 3.0.0 + Docker): 10/10 migraties toegepast, seed herhaalbaar, 9/9 E2E-tests geslaagd. De workflow zelf is niet op GitHub Actions gedraaid
- ✅ Journey-spec bijgewerkt: na "Leg het basispercentage vast" en "Leg mijn voorspelling vast" verdwijnt het formulier (met zijn bevestiging) en verschijnt het vastgelegde resultaat; daar toetst de test nu op
- ✅ Foutmonitoring zonder vendor lock-in: `instrumentation.ts` (`onRequestError`) → `lib/log.ts` (gestructureerde JSON-regels, `redact()` zonder persoonsgegevens) → optioneel `SENTRY_DSN` via een eigen envelope-POST (`lib/monitoring.ts`, geen SDK). Logpunten: `runAi`, AI-kostenregistratie, e-mail versturen, onderzoeksrun en -route, Expandi-webhook, coachreview. Lokaal end-to-end gecontroleerd met een nep-DSN-ontvanger
- ✅ Systeemstatus voor eigenaren (`/app/status`, link in de zijbalk): laatste migratie, markers per onderdeel, auth-hook-functie, opschoontaak (pg_cron, laatste run), AI/e-mail/meting/monitoring ingesteld, AI-uitgaven deze maand tegen het plafond. Via `system_status()` (migratie `20261104110000_ops.sql`, alleen eigenaar). Op de lokale Supabase-stack gecontroleerd, inclusief een gesimuleerde cron-run
- ✅ Nonce-gebaseerde Content-Security-Policy op elke pagina, ook `/t` en `/s` (`proxy.ts`, `lib/csp.ts`); alle pagina's per verzoek gerenderd. Gecontroleerd met `curl` (header, nonce op alle 13 scripts van `/login`) en in Chromium zonder CSP-meldingen (`/login`, `/t` 404, `/s` 404, ingelogde journey, statuspagina)
- ✅ Draaiboek `docs/OPERATIONS.md`: staging (branch of tweede project), migratievolgorde, migratiegeschiedenis herstellen, back-ups, geheimen roteren, auth-hook, cron-controle, monitoring, CSP, CI
- ✅ Tests: `tests/unit/ops.test.ts` (redact, logger, DSN/envelope, instrumentation, CSP-builder), `tests/db/ops.test.ts` (`system_status`: eigenaar ja; editor, eigenaar van een andere organisatie en anoniem nee)
- 🟡 Migratie `20261104110000_ops.sql` nog toepassen op het live project; daarna toont `/app/status` de echte stand
- 🟡 `SENTRY_DSN` (optioneel) en een alarmregel op `request_failed` / `ai_ledger_insert_failed` in de gekozen dienst

## Enquêtekwaliteit (4 november)

- ✅ Screeningsvraag: één keuzevraag (altijd de eerste, niet de kernvraag) met doelgroepantwoorden. Wie buiten de doelgroep valt, krijgt na die vraag een vriendelijk bedankje en geen verdere vragen; de respons wordt bewaard (`qualified = false`) en telt niet mee in de kernmeting ("buiten doelgroep: n"). Editor, sjabloon (`templateSurvey({ screen: true })`: "nog nooit" valt buiten de doelgroep) en AI-opzet (screeningsvoorstel op basis van de doelgroep, naar boven verplaatst, onbruikbaar voorstel met toelichting weggelaten)
- ✅ Volgorde husselen per respondent: vlag `shuffle` per keuzevraag (standaard aan bij nieuwe keuzevragen, nooit bij schalen; AI geeft per vraag `ordered_options`), optievlag `fixed` ("Anders", "Weet ik niet" blijven op hun plek). Deterministisch per invitatietoken of bezoekerscode: herladen toont dezelfde volgorde (`presentQuestions`)
- ✅ Kwaliteitscontroles naast de invulduur: controlevraag (instructed response, "kies ‘Soms’ bij deze vraag", knop "+ Controlevraag toevoegen") en straightlining (zelfde antwoord op alle ≥ 4 schaalvragen). Niet-geloofwaardige antwoorden tellen apart ("niet geloofwaardig: te snel / controlevraag / zelfde antwoord overal"), ook in CSV, samenvattingen, open antwoorden en Learning Card (`assessResponse` in `lib/domain/survey.ts`)
- ✅ Steekproefplanner (`lib/domain/survey-plan.ts`, `components/survey/SamplePlanner.tsx`) in de Test Card van een enquête en bij Verspreiden: hoeveel volledige antwoorden nodig zijn tot het hele 95%-Wilson-interval boven (of onder) de drempel ligt, met minimum uit de Test Card, en hoeveel uitnodigingen (standaard 15% respons) of open-linkbezoekers (standaard 30% afgerond) dat vraagt, bij 90% bruikbare antwoorden. Zonder verwachting: tabel voor 5–20 punten boven en onder de drempel
- ✅ Kernmeting in de database: `survey_key_counts()` telt per bron × kanaal (antwoorden, geloofwaardig, successen, te snel, buiten doelgroep, controlevraag, straightlining); de pagina laadt geen losse responsrijen meer voor de meting. Eén bron van waarheid: de API-route beoordeelt met `assessResponse()` en `submit_survey()` slaat `qualified`/`quality` op; SQL telt alleen opgeslagen vlaggen. Bestaande rijen eenmalig gevuld met de oude duurregel
- ✅ Delen met de opdrachtgever: consultants kiezen per enquête welke gesloten vragen (keuze, schaal, getal; nooit open antwoorden of controlevragen) opdrachtgevers als samenvatting zien (`survey_shares`, niet vergrendeld); `survey_shared_summaries()` geeft alleen aggregaten over geloofwaardige antwoorden en pas vanaf 5 antwoorden per vraag
- ✅ Opgelost: de publieke enquêtepagina en `/api/s` lazen de (sinds 3 november) gestripte publieke config met het volledige schema en weigerden daardoor elke enquête; nu `PublicSurveyConfigSchema` voor de pagina en `get_survey_config()` (alleen met de ingest-sleutel) voor de server
- Migratie `20261104090000_survey_quality.sql`; tests `tests/unit/survey-quality.test.ts` (22) en `tests/db/survey-quality.test.ts` (5, waaronder SQL-telling gelijk aan de TypeScript-regel)
- ✅ Samengevoegd met privacy/outreach: `20261104140000_survey_reconcile.sql` laat één `submit_survey` over (postcode én kwaliteitsvlaggen) en `survey_key_counts` telt ook per postcode, zodat "Per bericht" voor enquêtes dezelfde geloofwaardigheidsregels volgt als het oordeel
- [ ] Migratie nog toepassen op de live Supabase; visuele controle van editor, publieke screeningstap en deelkaart in de browser

## Drie AI-aanbieders (5 november)

- ✅ Eén interface voor tekst/JSON met systeemprompt, optioneel webzoeken, tokenplafond en gebruik (input, output, zoekopdrachten): `lib/ai/providers/` met adapters voor Claude (Anthropic SDK, bestaand gedrag: web_search + web_fetch met citaten, server-side fallback), ChatGPT (OpenAI Responses API via `fetch`, tool `web_search`, strikt JSON-schema) en Gemini (`models/{model}:generateContent` via `fetch`, tool `google_search`, `responseJsonSchema`). Time-out, nieuwe pogingen bij 429/5xx (met Retry-After, begrensd) en eigen foutsoorten (sleutel geweigerd, limiet, time-out); de sleutel komt nooit in een foutmelding
- ✅ Model-ID's alleen in `lib/ai/providers/config.ts`, per aanbieder te overschrijven met `ANTHROPIC_MODEL`, `OPENAI_MODEL`, `GEMINI_MODEL`; prijstabel (USD per miljoen input-/outputtokens en per zoekopdracht) op dezelfde plek, gebruikt door het `ai_runs`-grootboek. Het maandplafond telt alle aanbieders samen
- ✅ `aiConfigured()` is waar bij minstens één sleutel; `configuredProviders()` geeft de verbonden aanbieders
- ✅ Keuze per werkruimte (`org_ai_settings`): standaard-aanbieder plus optioneel per taak (marktonderzoek, coach, enquête-opzet, uitnodigingsberichten, voorspelling) en een schakelaar "alle verbonden aanbieders" voor webonderzoek en voorspelling. Kaart "AI-aanbieders" op Systeemstatus (eigenaren) met per aanbieder "verbonden"/"niet verbonden", nooit de sleutel. Gekozen aanbieder zonder sleutel → een verbonden aanbieder neemt over (getoond op de kaart)
- ✅ `runAi` kiest de aanbieder per taak (of krijgt er één bij een ensemble) en boekt provider, model en kosten per aanroep
- ✅ Webonderzoek: per onderzoeksvraag zoekt elke gekozen aanbieder los; bronnen worden per URL samengevoegd. Bij ChatGPT en Gemini haalt ProofLab de genoemde pagina's zelf op (SSRF-veilige `fetchPageText`) en bewaart alleen de letterlijke alinea waarin het citaat staat; een citaat dat niet op de pagina staat, vervalt (`lib/ai/web-evidence.ts`). De bestaande letterlijke citaatcontrole en steuncontrole daarna zijn ongewijzigd en aanbieder-onafhankelijk. `sources.found_by` vermeldt welke aanbieder(s) de pagina vonden; overeenstemming staat erbij als informatie, niet als extra bewijsgewicht. Rode-teamzoektocht op de aannamepagina gebruikt dezelfde route
- ✅ Onderzoekspaneel toont per aanbieder verbonden/niet verbonden en werkt met elk van de drie; zonder sleutel blijft de eerlijke melding, met voor de eigenaar welke variabelen in Vercel moeten
- ✅ Voorspelling als ensemble: elke verbonden aanbieder voorspelt los met dezelfde omheinde dossierprompt en wordt apart opgeslagen via `record_ai_forecast` (één AI-voorspelling per model per moment, hooguit drie; blinde regels ongewijzigd). Uitkomst-/bewijspagina tonen elk getal en het gemiddelde; ijkhulp en rapport gebruiken het gemiddelde met één keer het AI-gewicht
- ✅ Coach, enquête-opzet en uitnodigingsberichten gebruiken de gekozen aanbieder voor die taak (overige onderzoeksstappen volgen de keuze voor marktonderzoek)
- ✅ Migratie `20261105090000_ai_providers.sql`: tabel `org_ai_settings` (RLS: lezen en schrijven door leden van de organisatie, niet verwijderen, gestempeld), `ai_runs.provider`, `sources.found_by`, unieke index per model voor AI-voorspellingen en `record_ai_forecast` met model verplicht en maximaal drie
- ✅ Tests: `tests/unit/ai-providers.test.ts` (per adapter met nep-`fetch`: verzoekvorm, tekst, gebruik, citaten/grounding, weigering, 401/403, 429 met en zonder herstel, time-out), `tests/unit/ai-selection.test.ts` (keuze en terugval, ensemble, gemiddelde, prijzen, citaatverificatie en samenvoegen), `tests/unit/ai-search.test.ts` (zoekvraag via ChatGPT end-to-end met nep-API en nep-pagina), `tests/db/ai-providers.test.ts` (RLS instellingen, provider in grootboek en bronnen, ensemble-uniciteit en blinde regel). Geen echte API-aanroepen
- 🟡 Niet getest tegen de echte OpenAI- en Gemini-API (geen sleutels in deze omgeving); modelnamen en prijzen nagekeken op de documentatie van 3 november. Gemini's gratis zoekquotum is bewust niet verrekend (plafond nooit te laag)
- 🟡 Migratie nog toepassen op de live Supabase; daarna sleutels in Vercel zetten en per aanbieder één onderzoeksrun en één voorspelling controleren

## Intake, coach en navigatie (6 november)

- ✅ Intake: inzet (bedrag, tijd of capaciteit met een getal; `ideas.stake_kind`, `ideas.stake_value`) en beslisdatum zijn verplicht voor nieuwe intakes; bestaande ideeën blijven geldig. Vaagheidscontrole van de beslisvraag (`lib/domain/decision-quality.ts`): waarschuwing met herschrijfvoorbeeld, nooit een blokkade
- ✅ Succescriterium: naast het aantal een minimumbedrag per klant of een omzetdoel (minstens één verplicht voor nieuwe definities) en een optionele meetdatum na de beslisdatum, binnen zes maanden. De vergrendeling (`guard_outcome_definition`) dekt de nieuwe kolommen; bij het besluit wordt een passende meetdatum de uitkomstdatum
- ✅ "Laat AI een referentie met bron voorstellen" op /outcome: websearch via `runAi`, ProofLab haalt de pagina zelf op en bewaart een voorstel alleen als het citaat met het percentage letterlijk op de pagina staat (`reference_proposals`, alleen via `record_reference_proposal` met de ingest-sleutel)
- 🟡 Vaste referentieklasse "Nieuwe B2B-dienst / bureau-aanbod, klanten binnen 6 maanden" niet toegevoegd: geen betrouwbare, citeerbare bron met een letterlijk percentage gevonden
- ✅ Coach: opvolging van de uitkomst eerst, daarna de sprintvolgorde onderzoek → aannames → test → besluit; uitkomstdefinitie, basispercentage en voorspelling zijn een neventip, behalve bij het besluit. `forecast_missing` vraagt pas om een voorspelling na een gekozen basispercentage (anders `base_rate_missing`). Nieuwe regel `assumptions_early` (aannames en pre-mortem in week 1, nadruk op betalingsbereidheid)
- ✅ "Gedaan" controleert per regelcode of het werk gedaan is (`checkNoteDone`); zo niet, dan een bevestigingsvraag, en na bevestiging legt `coach_notes.confirmed_without_data` (met audit) vast dat het zonder data is afgerond
- ✅ Dossieroverzicht op /app/ideas/[id] (beslisvraag, sprintweek en stap, voortgang per stap met aantallen, volgende actie, open coachtips, snelkoppelingen); opdrachtgevers gaan naar het rapport
- ✅ Uitnodigingen aan opdrachtgevers als eigen e-mail via Resend; standaard een link naar /login?email=… (geen token in de mail, geen service-rol nodig), optioneel een eenmalige link via Supabase admin generateLink met `SUPABASE_SERVICE_ROLE_KEY`; zonder Resend "E-mail niet gekoppeld" met kopieerbare link. Resend-SMTP voor Supabase Auth in `docs/OPERATIONS.md` §10
- ✅ Migratie `20261106100000_intake_coach.sql`; tests: `tests/unit/decision-quality.test.ts`, `reference-proposal.test.ts`, `invite.test.ts`, uitbreidingen in `forecast.test.ts`, `coach.test.ts`, `coach-rules.test.ts`, en `tests/db/intake-coach.test.ts`
- 🟡 Migratie nog toepassen op de live Supabase; Resend als SMTP instellen in het Supabase-dashboard; e2e-journey (aangepast voor inzet, beslisdatum, omzetdoel en het overzicht) niet lokaal gedraaid

## Methode 2026-11-b: beslisregels en bewijsfactoren (6 november)

- ✅ 6a Beslisregels per testtype (`lib/domain/stats.ts`: `betaCdf`, `probabilityAbove`, `verdictV2`, `requiredSample`, `sampleFeasibility`): kansregel (P(p > drempel) ≥ 0,80 geslaagd, P(p > faaldrempel) ≤ 0,20 niet geslaagd, Beta(1,1)) en aantalregel voor sterke handelingen (in de code: aanbetaling of herhaalaankoop in interviews). Label "sterk bewezen" als ook de Wilson-ondergrens boven de drempel ligt. De Test Card vraagt de verwachte uitkomst en beschikbare deelnemers per week, toont vóór goedkeuring het benodigde aantal met waarschuwingen; de server rekent `required_n` opnieuw en vergrendelt het met de drempels. Experimentpagina en Learning Card tonen regel, kans of aantal, 95%-interval en label (`learning_cards.metrics`)
- ✅ 6b Eén factor per bron per aanname (`assumptionProbabilityV2`, definitie in `evidenceSourceKey`: source_id, campagne, experiment_id, interview_id; tegenbewijs niet samengevoegd) en plafond per bewijsniveau (standaard 40/50/60/75/90%, herhaalaankoop geen plafond; `org_evidence_caps`, eigenaren passen aan op Voorspelkwaliteit). Aannamepagina toont "n signalen uit … samengevoegd" en "begrensd op …: nog geen …"
- ✅ 6c Methodeversie per dossier (`lib/domain/method/`: rekenmodule per versie, `ideas.method_version`). Bestaande dossiers houden 2026-11-a; nieuwe starten op 2026-11-b. Pagina `/app/ideas/[id]/method` toont vooraf per aanname de kans oud/nieuw en per test de uitkomst oud/nieuw; overstappen via `switch_method_version` (alleen vooruit, met audit en het overzicht). Goedgekeurde Learning Cards blijven ongewijzigd; hun uitkomst onder de nieuwe methode staat ernaast. Rapport en PDF vermelden methodeversie, beslisregels en plafonds; Help legt Test Card, 95%-interval, kansregel, Learning Card, plafond en methodeversie uit; methodedocument hoofdstuk 9
- ✅ Migratie `20261106110000_method_v2.sql`; tests `tests/unit/decision-rules.test.ts`, `tests/unit/evidence-v2.test.ts`, `tests/unit/method.test.ts`, `tests/db/method-v2.test.ts` (vergrendeling van de nieuwe hypothesekolommen, RLS en audit op de plafonds, bronherkomst voor consultant en opdrachtgever, overstap)
- 🟡 Bekende beperking: bij drempels ≤ 20% geeft de vlakke prior zonder data al een kans ≥ 0,80; de minimale steekproef draagt dan het oordeel (zie methodedocument 9.1)
- 🟡 Een getekende offerte en een prijstest met echte betaling hebben nog geen eigen meting; de aantalregel is daarom alleen voor interviews beschikbaar
- [ ] Migratie nog toepassen op de live Supabase; visuele controle van de Test Card, de overstappagina en de plafondkaart in de browser

## Onderzoeksketen: bronnen, budget, vragen (6 november)

Aanleiding: een snelle run deed 8 zoekopdrachten over 3 vragen, bewaarde 0 bronnen en kostte $3,54 bij een budget van $1,50.

- ✅ **Zoeklogboek** (`research_search_log`, migratie `20261106090000_research_search_log.sql`): per zoekterm de gevonden URL's met status en reden (`bewaard`, `pdf_geen_tekst`, `lege_pagina`, `geblokkeerd`, `geen_relevante_alinea`, `citaat_niet_letterlijk`, `niet_opgehaald`) en het aantal bewaarde passages. RLS: alleen het onderzoeksteam (`can_write_idea`) leest en schrijft; alleen-toevoegen; `check_idea_refs`. Zoektermen uit Claude's `server_tool_use`, ChatGPT's `web_search_call` en Gemini's `webSearchQueries` (anders de vraag zelf)
- ✅ **PDF's**: base64-PDF's uit Claude's web_fetch en PDF's die ProofLab zelf ophaalt (max. 10 MB) worden server-only naar tekst omgezet (`lib/pdf-text.ts`, pakket `unpdf`, in `serverExternalPackages`; niet in de clientbundel). HTML met minder dan 200 tekens tekst krijgt `lege_pagina`
- ✅ **Onderzoeksrun-paneel**: per vraag een uitklapbaar logboek; bij 0 passages staan de URL's als kandidaat-bronnen met "Voeg toe als bron" (opent het bronformulier met URL en titel; het citaat plakt de gebruiker zelf, niets telt automatisch)
- ✅ **Budget**: vóór elke modelaanroep en elke zoekronde een schatting (invoer tot nu toe plus max. uitvoer, maal de prijs, +20%) tegen wat de run nog mag uitgeven (`lib/ai/budget.ts`). Past het niet, dan stopt de lus met wat er al is; taak en run leggen "Budget van deze run bereikt" vast en de overige taken worden overgeslagen. Zoek- en ophaaltegoed geldt voor de hele lus, niet per ronde; een eerste ronde zonder bruikbare URL stopt de vraag
- ✅ **Onderzoeksmodel** per aanbieder (`DEFAULT_RESEARCH_MODELS`, te overschrijven met `ANTHROPIC_RESEARCH_MODEL`, `OPENAI_RESEARCH_MODEL`, `GEMINI_RESEARCH_MODEL`) voor zoeken, uitlezen en steuncontrole; het zware model alleen voor onderzoekskaart en reality-check. Prijzen in de prijstabel (bij een prijsstap de hoogste)
- ✅ **Hergebruik**: dezelfde vraag van hetzelfde idee binnen 7 dagen hergebruikt de bewaarde passages en logregels zonder nieuwe aanroep (alleen als er toen passages waren); eerdere zoektermen gaan als "al gezocht" mee in de prompt
- ✅ **Verbindingstest**: lage denkstand en 1024 tokens, zodat Gemini een antwoord geeft
- ✅ **Onderzoeksvragen**: sjabloon vult doelgroep, regio en branche in (geen plaatshouders); elke vraag enkelvoudig met meeteenheid en verwacht brontype (migratie `20261106090100_research_question_fields.sql`); het AI-plan verbiedt samengestelde vragen en de code splitst ze (max. 5). Brontype en meeteenheid staan op de onderzoekskaart en zijn te bewerken
- ✅ **CBS StatLine** (`lib/integrations/cbs.ts`, tabel 81589NED "Bedrijven; bedrijfstak", open data-API OData v4): aantal bedrijven per grootteklasse en SBI-branche voor de meest recente periode, als bron van het type officiële statistiek met letterlijke tabelregels als fragment. Automatisch bij omvangvragen met verwacht brontype officiële statistiek, en via de knop "Haal CBS-cijfers op". Alleen `datasets.cbs.nl`, via het SSRF-veilige ophalen
- ✅ **Melding bij 0 bronnen**: twee opeenvolgende runs van hetzelfde idee zonder passages → `log.error("research_zero_sources")`; Systeemstatus toont "Onderzoeksruns zonder bronnen (7 dagen)"
- ✅ Tests: `tests/unit/research-run.test.ts` (hele run met gemockte Claude-respons: citaten, alleen gelezen pagina's, alleen zoekresultaten; met PDF en lege pagina), `research-search-log.test.ts`, `research-budget.test.ts` (run blijft onder budget_usd), `research-plan.test.ts`, `cbs.test.ts`, `research-health.test.ts`, `tests/db/research-search-log.test.ts` (RLS: team leest, opdrachtgever en buitenstaanders niet)
- 🟡 Migraties nog toepassen op de live Supabase. Niet getest tegen de echte AI-API's of de live CBS-API vanuit de app (alleen de vorm van de CBS-antwoorden is met de echte API vergeleken)
- 🟡 De kostenschatting rekent met het gevraagde model; levert de server-side fallback bij een weigering een duurder model, dan kan één aanroep boven de schatting uitkomen

## Golf C: onderzoek en herleidbaarheid (7 november)

Verbeterplan `docs/VERBETERPLAN_WERKWIJZE.md`, punten 7, 8, 10 en 19; methodedocument hoofdstuk 10. Migratie `20261107110000_golf_c.sql`.

- ✅ **7 Populatie, regio en peildatum per bevinding.** `claims.population`, `claims.reference_date` (JJJJ, JJJJ-MM, JJJJ-MM-DD of "onbekend") en `claims.region` verplicht (bestaande lege regio's → "onbekend"; peildatum uit het laatste jaartal van de oude periode). AI-extractie vraagt de drie velden; `groundedScope` houdt een veld alleen als het uit citaat of fragment blijkt. `compareWithIntake` (`lib/domain/claim-scope.ts`) vergelijkt met doelgroep, regio en beslisdatum (verouderingstermijn per soort gegeven); een afwijking geeft een waarschuwing bij de bevinding en `claims.relevance = 'indirect'` (gezet in `recomputeClaim`). Handmatig formulier vraagt de drie velden; rapport toont ze. `relevanceWeight()` (indirect = 0,5) staat klaar, maar wordt door 2026-11-a en 2026-11-b niet gebruikt: de weging komt bij het samenvoegen met golf A in methodeversie 2026-11-c
- ✅ **8 Jaar en regio per sizing-factor.** `sizing_factors.year` en `.region` (leeg = onbekend), invoer per factor in het Marktpotentieel (voorgesteld uit de gekoppelde bevinding). `factorConsistency` (`lib/domain/sizing.ts`): meer dan 2 jaar verschil of een andere regio → waarschuwing (scherm en rapport) en `simulateSizing(..., { widen })` verbreedt elke bandbreedte ×1,5 per soort verschil (×2 bij beide). Zonder verschil is de simulatie ongewijzigd
- ✅ **10 Verplichte zoekopdracht naar tegenbewijs.** Per vraag een eigen stap `counter` (na zoeken en uitlezen), binnen `RunBudget`, met het onderzoeksmodel. Zoektermen in `research_search_log` met `kind = 'counter'`; hergebruik binnen 7 dagen alleen binnen hetzelfde soort. Passages worden fragmenten; alleen tegenbevindingen worden bewaard, met relatie `contradicts` en dezelfde citaat- en steuncontrole (`storeExtractedClaims`). Marktbeeld toont "Tegenbewijs" apart: stap per vraag, eigen zoeklogboek en de tegenbevindingen per vraag
- ✅ **19 Momentopname van aantallen.** `reports.snapshot.tallies` (`lib/domain/report-counts.ts`): per test n en successen, per bron, per kanaal, per wervingsgroep (interviews: bekenden/onbekenden, alleen aantal) en de kernvraag van enquêtes per bron; geen persoonsgegevens. Rapport toont de tabel "Momentopname van de aantallen". Geen aparte tabel nodig: rapporten zijn onveranderlijk en de opruimtaak raakt ze niet
- ✅ Tests: `tests/unit/claim-scope.test.ts`, `tests/unit/sizing-origin.test.ts`, `tests/unit/counter-search.test.ts` (gemockte zoekrespons: log met kind 'counter', alleen tegenbevindingen met letterlijk citaat als 'contradicts', onderzoeksmodel, niets gevonden, budget op), `tests/unit/report-counts.test.ts`, `tests/db/golf-c.test.ts` (kolommen en checks, stap `counter`, `purge_expired_personal_data` laat de momentopname staan)
- 🟡 Populatie wordt alleen grof vergeleken (soort doelgroep: zakelijk, consument, publiek, intern); een andere branche binnen B2B is geen vastgestelde afwijking. Regio's buiten Nederland, België, Luxemburg, Benelux, Europa en wereldwijd worden op het woord vergeleken
- 🟡 Wervingsgroep in de momentopname is nu alleen bekend/onbekend bij interviews; de wervingsgroep van golf A (punt 4) komt er bij het samenvoegen bij
- [ ] Migratie nog toepassen op de live Supabase; visuele controle van de tegenbewijskaart, de factorvelden en de rapporttabel in de browser

## Golf A: bewijs en testen (7 november)

Punten 3, 4, 5, 11, 12, 13, 14, 16 en 17 uit `docs/VERBETERPLAN_WERKWIJZE.md`; methodedocument hoofdstuk 10. Rekenwijzigingen horen bij de nieuwe methodeversie **2026-11-c** (standaard voor nieuwe dossiers); weergavepunten gelden voor alle versies. Bestaande dossiers op 2026-11-a en 2026-11-b rekenen ongewijzigd.

- ✅ **Methode 2026-11-c** (`lib/domain/method/2026-11-c.ts`, `assumptionProbabilityV3`): overstappen van a of b naar c via `/app/ideas/[id]/method` (alleen vooruit, met overzicht en audit); de pagina noemt per versie wat er verandert. Rekenmodules hebben vlaggen `usesRules` en `primaryDecides`
- ✅ **3 Niet gekalibreerd** (`lib/domain/probability-display.ts`, `components/ui/Probability.tsx`, `resolved_dossiers_for_idea`): onder 10 opgeloste dossiers kansen per aanname in banden van 10 procentpunt met "niet gekalibreerd", exacte waarde in de tooltip; risicokaart, bewijspagina, methodepagina, rapport en PDF. Het rapport bewaart de kalibratie in de momentopname
- ✅ **4 en 13 Wervingsgroep** (`lib/domain/recruitment.ts`): per test, interview en observatie (eigen netwerk, warm contact, koud, betaald panel, onbekend); verplicht op de Test Card bij enquête-, landing- en prijstests (app en server), per gesprek bij interviews; een bekende is eigen netwerk (trigger); vergrendeld na goedkeuring. In 2026-11-c telt herhaling binnen dezelfde groep over bronnen heen afnemend mee; de UI toont "x signalen uit dezelfde wervingsgroep"
- ✅ **5 Startkans** (`lib/domain/prior.ts`, `guard_assumption_prior`, `change_assumption_prior`): afwijking van 50% vraagt een onderbouwing; vergrendeld bij het eerste gekoppelde bewijs (blijvend); daarna alleen wijzigen met een reden; elke wijziging in het auditspoor. Database én risicokaart
- ✅ **11 Hoofdtest** (`lib/domain/primary-test.ts`, `assumptions.primary_experiment_id`): aanwijzen vóór de goedkeuring (Test Card of testpagina), daarna vast; de rest heet verkennend. In 2026-11-c beslist alleen de hoofdtest over de status van de aanname. Kans op toeval (1 − P) bij een geslaagde kansregel. Voor golf B: `primaryTestFor(assumptionId, assumptions)` en `primaryExperimentId` per aanname
- ✅ **12 Alle tests** (`lib/domain/all-tests.ts`): verplichte lijst in rapport en PDF, ook afgebroken, mislukte, onbesliste en verkennende tests, met het aantal tests per aanname
- ✅ **14 Bewijsniveau** (`testEvidenceLevel`, `outcomeWithLevel`): "Geslaagd · niveau: mening" op Learning Card, rapport en PDF; nieuwe kaarten bewaren het niveau
- ✅ **16 Brier-scores**: onder 30 uitkomsten "te weinig dossiers voor een betrouwbaar oordeel" op Voorspelkwaliteit
- ✅ **17 AI** (`lib/domain/ai-draft.ts`, `ai_drafts`, `ai_original`): in 2026-11-c telt onbeoordeelde AI-codering niet; AI-origineel van onderzoeksvragen, enquête-opzet en promoberichten bewaard (onveranderlijk) met "door mens aangepast: ja/nee" en het aantal gewijzigde regels
- ✅ Migratie `20261107090000_golf_a.sql`; tests `tests/unit/probability-display.test.ts`, `evidence-v3.test.ts`, `prior.test.ts`, `primary-test.test.ts`, `all-tests.test.ts`, `brier-warning.test.ts`, `ai-draft.test.ts`, `report-golf-a.test.ts`, `method.test.ts`; `tests/db/golf-a.test.ts` (methodeversie, kalibratietelling met RLS, wervingsgroep en vergrendeling, startkans met trigger en audit, hoofdtest, AI-origineel en RLS, dossier verwijderen)
- 🟡 Tests van vóór golf A hebben geen wervingsgroep en tellen na een overstap naar 2026-11-c als "onbekend" (één groep); de overstappagina laat het effect vooraf zien
- 🟡 Bestaande aannames met bewijs zijn bij de migratie vergrendeld; een eerder opgeslagen startkans anders dan 50% zonder onderbouwing blijft staan, maar opnieuw opslaan vraagt een onderbouwing
- [ ] Migratie nog toepassen op de live Supabase; visuele controle van Test Card, risicokaart, testpagina, rapport en PDF in de browser; de e2e-journey kiest nu een wervingsgroep maar is niet opnieuw gedraaid

## Golf B: besluit en voorspelling (7 november)

Uit `docs/VERBETERPLAN_WERKWIJZE.md`, golf B (punten 1, 2, 6, 15, 18 en 20). Migratie `20261107100000_golf_b.sql`; methodedocument hoofdstuk 10; Help (begrippen Beslisregel, Wat ging tegen, Verlengde testfase, Eerst voorspellen, Uitkomst en inzet, Terechte stop).

- ✅ **1. Uitkomst na stop of pauze**: `ideas.outcome_question` (`success` / `stop_review`), door de database vastgelegd bij de start van de uitkomstklok (trigger `stamp_outcome_question`; bij stop/pauze vraagdatum = besluit + 6 maanden) en daarna onveranderlijk. Tabel `stop_reviews` (ja/nee/onbekend + bewijs, eenmalig). `idea_outcomes` weigert stopdossiers (`OUTCOME_STOPPED`), `open_forecast_moment` sluit na de stop, `forecast_visible` opent na het antwoord. Kalibratie en eigen basisrate alleen met de succesvraag; telling "terechte stops" (`stop_review_counts`) op Voorspelkwaliteit. Herinnering op het overzicht, coachregel `stop_review_due`, geen tussenstand; uitkomstpagina, rapport en PDF tonen dat de voorspellingen niet worden gescoord
- ✅ **2. Inzet bij de uitkomst**: `idea_outcomes.started`, `effort_hours`, `budget_pct_of_plan`; `execution_insufficient` berekend door de database (`execution_insufficient()`, zelfde regel als `lib/domain/effort.ts`). `calibration_exclusions` (consultant, met reden, alleen bij onvoldoende uitvoering; uitsluiten en weer meetellen met reden in het auditspoor). Uitgesloten dossiers tellen niet mee in scores, kalibratie en eigen basisrate
- ✅ **6. Beslisregel**: `decision_rules` (hoofdtest = `primary_experiment_id`) en `decision_rule_assumptions` (minimale kans 5–95%), alleen te schrijven via `save_decision_rule`. Op slot bij de eerste goedgekeurde test (trigger op `experiments`) of uiterlijk bij het eerste definitieve besluit; later vastgelegd = meteen op slot en "achteraf vastgelegd". Aannamepagina: vastleggen; bewijspagina: toets per voorwaarde. Besluit bewaart `rule_met` en `rule_evaluation`; afwijken vraagt `rule_deviation_reason` (database dwingt af, audit `rule_deviation`); rapport en PDF vermelden toets en motivering. Coachregel `decision_rule_missing`
- ✅ **15. Eerst voorspellen**: `forecastFirstLock` vergrendelt op bewijs- en aannamepagina de berekende kansen, de bewijssterkte, de Reality Check en andermans voorspellingen tot de gebruiker (ook de opdrachtgever) het open moment heeft voorspeld; knop "Geef eerst je voorspelling". De AI telt als één stem (gemiddelde per dossier en moment) in `forecast_scores` en `forecast_calibration` (`calibration_votes_internal`), de voorspellingslijst, de Brier-tabel, Voorspelkwaliteit en het rapport
- ✅ **18. Opdrachtgever bevestigt**: samenvatting "Wat ging tegen" (`lib/domain/against.ts`: mislukte tests, tegenbewijs, begrensde aannames, afwijkingen van de beslisregel); bevestigen pas na openen of aanvinken. `confirm_decision(uuid, text, jsonb)` eist een gelezen, complete samenvatting en telt mislukte tests en de afwijking na; opgeslagen als `decisions.reviewed_against_summary` (daarna onveranderlijk). De oude `confirm_decision(uuid, text)` is verwijderd
- ✅ **20. Verlengde testfase**: besluittype `extend` (check op `decisions.action` uitgebreid) met `extend_weeks` 2–8; één keer per dossier, niet na een definitief besluit. Tijdens de fase weigert de database een definitief besluit en de start van de uitkomstklok (`EXTEND_ACTIVE`); `extended_phase_end`. Bewijspagina toont de fase, coachregel `extension_ending`, rapport en PDF vermelden haar
- ✅ Tests: `tests/unit/stop-review.test.ts`, `effort.test.ts`, `decision-rule.test.ts`, `forecast-first.test.ts`, `against.test.ts`, `extension.test.ts`; `tests/db/golf-b.test.ts` (kalibratie zonder stop- en uitgesloten dossiers, AI als één stem, vergrendeling van de beslisregel, afwijken met motivering en audit, bevestigen alleen met de samenvatting, verlengde fase en de klok). `tests/db/rls.test.ts` gebruikt de nieuwe `confirm_decision`; de e2e-journey volgt "eerst voorspellen"
- 🟡 **Gevolgen voor bestaande dossiers**: dossiers waarvan de klok door een stop of pauze is gestart, krijgen de stopvraag; een al vastgelegde uitkomst blijft staan maar telt niet meer in de kalibratie. Bestaande uitkomsten hebben geen inzet (onbekend) en kunnen dus niet worden uitgesloten. Bestaande besluiten hebben geen beslisregeltoets. Een opdrachtgever die bevestigt met een oude, openstaande pagina krijgt een foutmelding tot hij de pagina ververst
- 🟡 Golf A voegt parallel `is_primary` toe; de beslisregel kiest de hoofdtest als experiment-id. Na samenvoegen controleren dat de hoofdtest van de regel een `is_primary`-test is
- 🟡 Het goedkeuren van de eerste test wordt niet geblokkeerd zonder beslisregel (coach waarschuwt, regel heet dan "achteraf vastgelegd")
- 🟡 Het voorspelmoment "bij het besluit" is één moment: wie vóór de verlengde testfase voorspelde, voorspelt na afloop niet opnieuw
- [ ] Migratie nog toepassen op de live Supabase; e2e-journey en visuele controle van de nieuwe kaarten in de browser

## Fase 3: menu en afronding (3 november)

- ✅ **Menu**: ideekiezer bovenaan (huidig idee, andere ideeën, + Nieuw idee) in plaats van "Huidig idee", ideekaart en "Dossieroverzicht"; daaronder Overzicht van dit idee, 1 Markt, 2 Aannames, 3 Testen, 4 Besluit, Rapport; onder een scheidingslijn Alle ideeën en Klanten. Consultant op een ideepagina: 9 zichtbare items (ideekiezer + 8 links). Eén gedeelde `STEPS`-definitie in `lib/steps.ts` voor menu en stappenbalk; status per stap uit `getDossierStatus()` (✓ klaar, • loopt, leeg). Elk item een eigen icoon (nieuw: layout-dashboard, scale, lightbulb). Opdrachtgevers zien geen overzicht en geen Klanten
- ✅ **Tabbladen** als links tussen bestaande adressen: Markt (Marktverkenning | Bronnen & koppelingen, alleen team) en Besluit (Bewijs & besluit | Voorspelling & uitkomst); adressen ongewijzigd, geen redirects nodig
- ✅ **Avatarmenu**: Voorspelkwaliteit (team), Privacyverzoeken en Systeemstatus (alleen eigenaren), Uitloggen
- ✅ **Eén kop** op alle ideepagina's (ook /outcome): sprintbalk, stappenbalk en tabbladen in `PageFrame` (prop `section`)
- ✅ /evidence: `loading.tsx` met skelet voor inhoud én coachpaneel
- ✅ Coach: op werkruimtepagina's het lopende idee; eigen `integrations`-tekst; op /ideas/new is het paneel rechts ingeklapt (één coach)
- ✅ Klanten: alleen "Komt de uitnodiging niet aan? Kopieer de link." met kopieerknop; e-mailuitleg op Systeemstatus
- ✅ Rapport: één knop "Download als PDF"; delen met de opdrachtgever via een bevestigingsvenster ("kan niet worden teruggedraaid")
- ✅ Intake: per vraag welke velden optioneel en later aan te vullen zijn
- ✅ Tests: `tests/unit/menu.test.ts`, uitbreiding `tests/unit/coach.test.ts`; e2e-journey vergelijkt menu en stappenbalk en opent Systeemstatus via het avatarmenu. Visueel gecontroleerd op 1440 px en 390 px tegen de live omgeving (alleen lezen)
- 🟡 De menustatus komt na het laden van de pagina (de layout kent het open idee niet); tot dan staan de stappen zonder teken. De e2e-journey is niet gedraaid

## Fase B6: beslisblad en rapport (4 november)

- ✅ **Beslisblad als pagina 1** van het rapport (web en PDF): besluit **Doorgaan / Stoppen / Nog niet beslisbaar** met het bewijsniveau en de telling per persoon; de 3 sterkste bewijsstukken (geverifieerde bronnen en echte, niet-oefen, niet-synthetische waarnemingen; per persoon of test één stuk; op bewijsniveau gesorteerd), elk in één zin met bron (voetnoot en link); wat níét bewezen is (beslissende vraag, kritieke aannames, ontbrekende metingen; max. 3); de volgende stap met datum (einde testperiode, meetdatum, einde sprint of beslisdatum; anders eerlijk "Nog geen datum vastgelegd"). Pure logica in `lib/report-sheet.ts`; bewaard in de momentopname (`sheet`); oudere rapporten krijgen een afgeleid beslisblad met die vermelding. Het volledige dossier volgt als bijlage in de bestaande opbouw
- ✅ "Nog niet beslisbaar" als: geen definitief besluit (doorgaan/stoppen), geen stap met echt bewijs (`getDossierStatus`), of doorgaan zonder afgeronde test met uitslag
- ✅ Eén PDF-knop en bevestiging bij delen ("kan niet worden teruggedraaid"): gecontroleerd, al gedaan in fase 3
- ✅ **Verder testen** en de verlengde testfase zijn één keuze met een duur (2–8 weken). Opgeslagen als `extend` (met weken) als het dossier die fase nog niet had, anders als `test_more` met de streefdatum in de volgende stap. Geen migratie; bestaande besluiten ongewijzigd
- ✅ Reality Check: een onbekende regio telt niet meer als "andere regio" maar als aparte melding "onbekende regio"
- ✅ Rapport: "Niet vastgesteld" met reden in plaats van "€ 0" bereikbare jaaromzet (KPI en scenariotabel)
- ✅ Tests: `tests/unit/report-sheet.test.ts`, uitbreiding `tests/unit/report-pdf.test.ts`; e2e `tests/e2e/b6-beslisblad.spec.ts` en één extra controle in de journey
- 🟡 De e2e-tests zijn niet gedraaid (geen lokale Supabase in deze omgeving)

## Uitlegtooltips en zoeken binnen een dossier (4 november)

- ✅ **Woordenboek** `lib/glossary.ts` met 31 vaktermen (o.a. beslissende vraag, kritieke aanname, hoofdtest, succes-/faaldrempel, kansregel, aantalregel, plafond, informatiewaarde, Reality Check, Learning Card, go-regel, wervingsgroep, TAM/SAM/SOM, Brier-score, kalibratie), uitleg volgens `lib/domain/*`
- ✅ **`<Term k="…">`** (`components/ui/Term.tsx`): hover, focus, tik (opent/sluit), Escape, aria-describedby, portal zonder layoutverschuiving, past op 390 px; niet in de PDF. Geplaatst op Test Card, risicokaart, experimentpagina, bewijs & besluit, rapport (scherm), voorspelling/voorspelkwaliteit en marktverkenning
- ✅ **Zoeken in een dossier**: knop en sneltoets `/` in de kop van elke ideepagina; server action met de sessie van de gebruiker (RLS) over bevindingen, aannames, bronnen en (als de tabel bestaat) eigen notities; per kolom een eigen `ilike` met ge-escapete jokers (geen `.or()`-filterstring); max. 30 resultaten, eerlijk verdeeld per soort; markering, lege staat, laadstatus, pijltjes/Enter; links naar `#claim-…`, `?select=…` en `?tab=sources#bron-…`. Geen zoeken in citaten of persoonlijke bronfragmenten
- ✅ Tests: `tests/unit/glossary.test.ts`, `tests/unit/dossier-search.test.ts` (o.a. filterinjectie via een echte PostgREST-querybouwer); e2e `tests/e2e/tooltips-zoeken.spec.ts`
- 🟡 De e2e-tests zijn niet gedraaid (geen lokale Supabase in deze omgeving); geen migratie nodig
