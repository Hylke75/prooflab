# Implementation status

Stand: 3 november 2026. Bouwvolgorde volgens het besluit "eerst één complete route" (analyse §12.4–12.5).
Legenda: ✅ gebouwd en getest · 🟡 gebouwd, test of koppeling hangt af van een externe stap · ⬜ nog niet gebouwd.

## Externe stappen die nog openstaan

| Stap | Waarom | Wie |
|---|---|---|
| ~~Migraties toepassen~~ | Gedaan 28-10: `core_schema`, `security`, `hardening` staan op project `prooflab`; ingest-sleutel geregistreerd | ✅ |
| ~~Migraties `integrity` t/m `method_d` en `b3_intake` t/m `interviews_import`~~ | Toegepast op project `prooflab` (gecontroleerd 6-11 met de migratielijst) | ✅ |
| ~~Migratie `20261114090000_fase1_weergave.sql` toepassen (Snel en Grondig)~~ | Toegepast op project `prooflab` (gecontroleerd 6-11) | ✅ |
| ~~Migratie `20261115090000_interviews_import.sql` toepassen (interviews importeren, thema's, Fathom-sleutel)~~ | Toegepast op project `prooflab` (gecontroleerd 6-11) | ✅ |
| ~~Migratie `20261117090000_fase2_werving.sql` toepassen (werving bijhouden)~~ | Toegepast op project `prooflab` op 9-11 (via de Management API, functies vergeleken met de lokale referentie) | ✅ |
| Optioneel: `FATHOM_ENABLED=1` (Vercel) en een Fathom-API-sleutel op `/app/status` | Opnames rechtstreeks uit Fathom kiezen; zonder koppeling werkt importeren via een bestand | Hylke |
| ~~Migratie `20261116090000_fase2_testen.sql` toepassen (testen uitvoeren)~~ | Toegepast op project `prooflab` op 9-11 (via de Management API, functies vergeleken met de lokale referentie) | ✅ |
| Optioneel: `SECRETS_ENCRYPTION_KEY` + `MOLLIE_ENABLED=1` (Vercel) en een Mollie-sleutel op `/app/status` | Terugbetaalbare aanbetalingen; zonder: "Mollie niet ingesteld", betaalstap niet te kiezen | Hylke |
| ~~Auth-hook "Before user created" → `public.hook_before_user_created`~~ | Aangezet op 9-11; getest: een niet-uitgenodigd adres krijgt "ProofLab werkt op uitnodiging" en er komt geen account | ✅ |
| ~~E-mailsjabloon "Magic Link" naar `/auth/confirm?token_hash=…`~~ | Ingesteld op 9-11 (Nederlandse tekst); Site URL `https://www.proof-lab.nl`, redirects `https://www.proof-lab.nl/**` en `https://proof-lab.nl/**` | ✅ |
| Eigen adres op de toegangslijst | Gedaan (migratie `allowlist_hylke`). Nieuwe consultants of testers die zelf een idee maken, moeten er ook op (`signup_allowlist`); daar is geen scherm voor | ✅ (nieuwe adressen: Claude) |
| "Leaked password protection" aanzetten (Authentication → Passwords) en minimale wachtwoordlengte naar 10 | Gecontroleerd 10-11: staat nog uit, minimum is 6 tekens. Enige security-advieswaarschuwing die geen bewuste keuze is; vraagt een betaald Supabase-plan | Hylke |
| ~~AI-sleutels (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`) in Vercel~~ | Gedaan; gecontroleerd 9-11 via geslaagde AI-aanroepen in productie (Anthropic, OpenAI en Gemini) | ✅ |
| ~~Eigen SMTP (Resend) in Supabase Auth~~ | Ingesteld op 9-11: `ProofLab <onderzoek@proof-lab.nl>` via smtp.resend.com, domein proof-lab.nl geverifieerd in Resend, 30 mails per uur | ✅ |
| ~~Vercel-project + domein~~ | Live op https://www.proof-lab.nl (proof-lab.nl stuurt door); productie gecontroleerd 10-11, geen runtimefouten in 48 uur | ✅ |
| LinkedIn Advertising API-aanvraag | Doorlooptijd weken tot maanden | Hylke |
| Supabase-toegangstoken intrekken dat in de chat is geplakt (supabase.com/dashboard/account/tokens) en de netwerkgeheimen-regel "Supabase access token" verwijderen | Gecontroleerd 10-11: het token werkt nog; een token dat in een chat stond, hoort ingetrokken | Hylke |
| Oude branches verwijderen (15 × `claude/…`, alle gemerged) | Claude mag alleen de eigen werkbranch wijzigen; verwijderen via GitHub → Branches | Hylke |
| Gebruikerstest met drie mensen (`docs/GEBRUIKERSTEST_3_GEBRUIKERS.md`) | Deelnemers werven, testdossier klaarzetten, sessies doen; aantekeningen naar Claude voor analyse | Hylke |
| ~~Migraties `ai_interviews`, `experiment_catalog` en `canvas` toepassen~~ | Toegepast op project `prooflab` op 9-11; migratiegeschiedenis bijgewerkt. Supabase-adviezen: geen nieuwe waarschuwingen buiten de bewuste keuzes (tabellen zonder policies die alleen via functies werken, publieke functies achter de ingest-sleutel) | ✅ |

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

## Testresultaten (laatste run, 6-11, na samenvoegen fase 2)

- `npm run lint` en `npm run typecheck` — schoon
- `npm test` — 1387 geslaagd, 10 overgeslagen (live evals zonder API-sleutel)
- `npm run test:db` — 169 geslaagd in 26 bestanden (Postgres 16, alle 38 migraties)
- `npm run build` — geslaagd
- Live Supabase (`prooflab`): alle migraties toegepast behalve `20261116090000_fase2_testen` en `20261117090000_fase2_werving`
- Niet gedaan: E2E (Playwright) en visuele controle met login; geen E2E-account of Supabase-sleutels in deze omgeving

## Testresultaten (run 3-11)

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

- 🟡 AI-gemodereerde chatinterviews (tekst gebouwd; spraak later) — zie "AI-gemodereerde interviews (7 november)"; echte modelaanroepen alleen met een API-sleutel te controleren
- ⬜ Weekritmes: leersessie en besluitsessie met de klant (Fathom-import is gebouwd: zie "Fase 1 · punt 3: Interviews importeren en analyseren")
- ⬜ Koppelingen met de Meta- en LinkedIn-advertentie-API's (nu: kanaallinks + handmatig live zetten)
- ✅ Experimentencatalogus (41 methodes met metadata) en begeleide handmatige sjablonen — zie "Experimentencatalogus en begeleide handmatige sjablonen (7 november)"
- ✅ Propositie- en businessmodelcanvas — zie sectie "Propositie- en businessmodelcanvas (7 november)" onderaan
- ⬜ Automatische maandelijkse concurrentiecheck (handmatig starten kan al), verschillenrapport tussen onderzoeksversies
- 🟡 Betalingen/aanbetalingen: terugbetaalbare aanbetalingen via Mollie gebouwd ("Fase 2 · punt 4"); Stripe niet; live gebruik na juridische check
- ✅ Server-side PDF-rendering (`@react-pdf/renderer`, zie "Achtergrondtaken en PDF")
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

## Methode 2026-11-d: tegenbewijs per bron (4 november)

Methodedocument hoofdstuk 13. Bestaande dossiers op 2026-11-a t/m 2026-11-c rekenen ongewijzigd; nieuwe dossiers starten op 2026-11-d.

- ✅ **Tegenbewijs per bron** (`assumptionProbabilityV4`, optie `contraPerSource` in `lib/domain/evidence.ts`; `lib/domain/method/2026-11-d.ts`): per bron telt alleen het sterkste tegensignaal; over bronnen heen afnemend per soort; plafonds ongewijzigd; geen wervingsgroep-demping voor tegenbewijs
- ✅ **Weergave**: samengevoegde tegensignalen apart op aannamepagina, methodepagina en rapport (`explainMerged`, `mergedShort`); helptekst "Methodeversie" bijgewerkt
- ✅ Migratie `20261109100000_method_d.sql` (akkoord product owner): `'2026-11-d'` toegestaan en standaard voor nieuwe dossiers, rangorde en overstapbewaking bijgewerkt, geen bestaande rijen gewijzigd
- ✅ Tests `tests/unit/evidence-v4.test.ts`, `method.test.ts`; `tests/db/method-d.test.ts`, bijgewerkt `golf-a.test.ts` en `method-v2.test.ts`
- ✅ Migratie live op Supabase (4 november, na de productie-deploy van `16323ce`): nieuwe dossiers starten op 2026-11-d; bestaande dossiers ongewijzigd (6 op 2026-11-a, 15 op 2026-11-c). Versie in de migratiegeschiedenis gelijkgetrokken met de repo (`20261109100000`)

## Fase B2: onderzoek dat de grootste onzekerheid eerst raakt (8 november)

Aanleiding: sjabloonvragen met de brede doelgroep, de prijsvraag niet onderzocht, $1,57 van max $1,50, de run liep alleen met een open tabblad, "Gemini: mislukt" zonder reden en de belangrijkste bevinding (een gratis alternatief) verstopt tussen 18 andere. Migratie `20261109090000_b2_onderzoek.sql` (nog niet live; de app werkt ook zonder, met het oude gedrag).

- ✅ **1 Vragen uit de intake**: specifieke doelgroep, gebied, aanbod en genoemde prijs (`lib/research-questions.ts`); één beslissende vraag (`research_questions.is_decisive`, hooguit één per idee). Bestaande sjabloonvragen per rij bijwerken met "Vragen afleiden uit de intake" (gebeurt ook automatisch bij de start van een run); de consultant kan de beslissende vraag verplaatsen. `dossier.decisiveQuestion` gebruikt de gemarkeerde vraag
- ✅ **2 Volgorde**: de beslissende vraag altijd eerst (zoeken, citaten, tegenbewijs); snelle check = die kern, daarna de rest zolang het budget het toelaat (`lib/research-steps.ts`)
- ✅ **3 Hard plafond**: bovengrens per stap uit de prijstabel; een stap start alleen als uitgegeven + bovengrens ≤ plafond, en mag binnen de stap niet meer reserveren. Schatting vóór de start ("geschat: $x–$y van max $z"). Gedateerde modelvarianten worden als het gevraagde model geprijsd
- ✅ **4 Op de server**: keten van porties via `after()` en `/api/research/[runId]/advance` met het token van de consultant, lease per run (`research_run_leases`), melding als coachnotitie bij afronden (`docs/OPERATIONS.md` §11)
- ✅ **5 Reden bij een mislukte aanbieder** (timeout, quotum, geweigerd, …) en "Opnieuw proberen" per aanbieder of stap
- ✅ **6 Kaart "Wat dit betekent voor je grootste onzekerheid"**: max. 3 bevindingen, "Risico" bij ondermijnend; AI-voorstel als slotstap van de run (regel als terugval), aan te passen door de consultant (`uncertainty_findings`)
- ✅ **7 Samenvoegen**: dezelfde bewering of hetzelfde cijfer uit dezelfde bron wordt één bevinding met meerdere vindplaatsen (`lib/research-dedupe.ts`)
- ✅ Tests: `research-questions`, `research-steps`, `research-worker`, `research-failures`, `research-dedupe`, `research-uncertainty`, `research-b2-acceptance` (snelle check op het testdossier: prijsvraag eerst, binnen $1,50, melding)
- 🟡 Een run duurt hooguit zo lang als het toegangstoken geldig is (minstens een uur na de start); daarna pauzeert hij tot iemand van het team de pagina opent. Previews met Deployment Protection hebben `VERCEL_AUTOMATION_BYPASS_SECRET` nodig
- ✅ Migratie live op Supabase (4 november): kolom, index, leasetabel en -functies, `uncertainty_findings` met RLS en triggers, en de nieuwe controles gecontroleerd; Supabase-advies meldt niets nieuws. Versie in de migratiegeschiedenis gelijkgetrokken met de repo (`20261109090000`)
- [ ] Snelle check op het testdossier met de echte API's en visuele controle van de kaart en het paneel

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

## Fase B3: intake in drie vragen en één bevestiging (10 november)

Aanleiding: 6 vragen met ongeveer 20 velden, eerst "wanneer geslaagd" en dan pas het idee, doelgroep en prijs dubbel, de grootste onzekerheid achteraan in één regel, opdrachtgever standaard "+ Nieuwe opdrachtgever". Migratie `20261110090000_b3_intake.sql` (nog niet live; de intake werkt ook zonder, dan zonder AI-voorstel en met de prijs in de beschrijving).

- ✅ **Drie vragen**: 1 het idee en voor wie (één tekstvak), 2 de beslissing met inzet en datum (inzet en datum worden direct herkend en getoond), 3 de grootste onzekerheid (meerregelig, met voorbeeld)
- ✅ **Voorstel** (`lib/intake-proposal.ts`, `lib/ai/intake.ts`): succesdefinitie (maatstaf, doelwaarde, minimumbedrag, zin), doelgroep, soort klant, regio, branche, type project, prijs, inzet, beslisdatum en sprintduur. AI via `runOrgAi` (budgetstop en grootboek op de organisatie, want er is nog geen idee); zonder sleutel, budget of bij een fout de regels (bedragen, datums, prijs, doelgroep na "voor", terugverdienen van de inzet als doelwaarde). Wat letterlijk in de tekst staat wint van de AI
- ✅ **Samenvattingskaart**: alle velden bewerkbaar, herkomst per veld (AI-voorstel / Uit je tekst / Nog invullen), fouten per veld (ActionForm/Field), "Klopt, start de marktverkenning" → idee, onderzoeksvragen (B2), /research. Antwoorden, voorstel en aangepaste velden in `ideas.intake_proposal`
- ✅ **Opdrachtgever**: standaard "Geen (eigen idee)"; een nieuwe alleen na de keuze "+ Nieuwe opdrachtgever…" en met naam
- ✅ Tests: `tests/unit/intake-proposal.test.ts`; e2e `b3-intake.spec.ts` en de intake in journey, testcard en dogfood via `tests/e2e/intake.ts`
- ✅ Telling makelaarsdossier: oud 6 schermen, 23 velden (16 ingevuld, prijs 3× en doelgroep 2×), ±24 klikken; nieuw 3 schermen + 1 bevestiging, 3 tekstvakken + 17 voorgestelde velden op de kaart (0 leeg), 7 klikken (met naam aanpassen 8)
- 🟡 Visueel gecontroleerd op 1440 px en 390 px met een tijdelijke voorbeeldpagina (zonder login); de e2e-tests zijn niet gedraaid (geen E2E-account in deze omgeving)
- ✅ Migratie live op Supabase (4 november)
- [ ] e2e `b3-intake` draaien tegen productie, met en zonder AI-sleutel

## Notities en documenten per stap (10 november)

Opdracht product owner: "per stap zelf ook teksten kan toevoegen en ook documenten". Migratie
`20261110130000_notities_documenten.sql` (live sinds 4 november); beheer in `docs/OPERATIONS.md` §12.

- ✅ **Blok "Notities en documenten"** (`components/steps/StepNotes.tsx`, zelfstandig) onderaan het overzicht van het idee
  en de hoofdpagina's van elke stap (Markt: /research en /integrations; Aannames; Testen; Besluit: /evidence en /outcome),
  geplaatst via `PageFrame` (`noteStepForSection`). Ingeklapt als het leeg is, teller in de kop. Niet in print/PDF
- ✅ **Notities** (`step_notes`): titel en tekst (≤ 20.000 tekens), platte tekst of eenvoudige markdown (koppen, lijsten,
  vet, links met `rel="noopener noreferrer"`), veilig gerenderd als React-elementen (`lib/domain/simple-markdown.ts`).
  Toevoegen, bewerken, verwijderen (eigen of als eigenaar, met bevestiging, geaudit); auteur en datum zichtbaar
- ✅ **Documenten** (`step_documents` + privé bucket `step-documents`): PDF, DOCX, XLSX, PPTX, CSV, TXT, MD, PNG, JPG,
  WEBP tot 20 MB, gecontroleerd in de browser, op de server vóór de uploadlink, na het uploaden (opgeslagen grootte en
  type) en door de bucket. Directe upload naar Storage met een eenmalige link; downloaden via een link van 60 seconden
- ✅ **Rechten**: team voegt toe; opdrachtgever (geen `canWrite`) leest en downloadt alleen; RLS en storage-policies
  dwingen dit ook in de database af
- ✅ **Herleidbaarheid**: een document is geen bron of bewijs. In stap Markt opent "Gebruik als bron" het bestaande
  bronformulier met de titel ingevuld (zonder herladen op /research, via `?tab=sources&bron_titel=` vanaf /integrations);
  de letterlijke citaatcontrole blijft gelden. Notities komen niet in het rapport (hint in het blok)
- ✅ Tests: `tests/unit/step-files.test.ts` (types, grootte, mime/extensie, bestandsnaam, pad), `tests/unit/simple-markdown.test.ts`
  (opmaak, geen HTML, alleen http(s)/mailto); `tests/db/step-notes.test.ts` (RLS, auteur, eigen/eigenaar, audit, bucket,
  storage-policies; storage-shim in `tests/db/supabase-shim.sql`); e2e `tests/e2e/notities.spec.ts`
- ✅ Migratie live op Supabase (4 november), met de bucket `step-documents`. Nog te doen: de e2e
  `notities.spec.ts` draaien. Visueel gecontroleerd op 1440 px en 390 px met voorbeelddata (lokaal, alleen lezen)
- 🟡 Bestanden van een verwijderd idee blijven in de bucket staan; inhoud van bestanden wordt niet gescand

## Bestaand onderzoek importeren (11 november)

Opdracht product owner: "Bij marktonderzoek moet je ook bestaande onderzoeken kunnen uploaden." Geen migratie: een
geïmporteerd rapport is een gewone bron (`sources`) met de uitgelezen tekst als letterlijke fragmenten (`source_excerpts`).

- ✅ **Importeren** (Markt → tab Bronnen, blok "Bestaand onderzoek importeren", `components/research/ReportImport.tsx`):
  een nieuw bestand (PDF, DOCX, TXT, MD, CSV; ≤ 20 MB, ≤ 300 pagina's, ≤ 1 miljoen tekens) of een al geüpload document.
  Het origineel komt bij Notities en documenten (stap Markt). Titel, uitgever/auteur, jaar of peildatum (een los jaar
  wordt 1 januari, met vermelding), type bron, webadres en primair. Ingang ook via **Importeer als onderzoek** bij een
  document in het blok Notities en documenten van Markt (zonder herladen op /research, via `?importeer=` elders)
- ✅ **Uitlezen** (`lib/report-extract.ts`): PDF via unpdf per pagina (geen lettertypen/XFA; vindplaats "p. 4–5"),
  DOCX via een eigen ZIP/XML-lezer zonder nieuwe dependency (`lib/docx-text.ts`; alleen `word/document.xml`, voet- en
  eindnoten; grens op uitgepakte grootte tegen zip-bommen; versleutelde archieven geweigerd), tekstbestanden met
  UTF-8/Windows-1252. Nette meldingen bij een scan zonder tekstlaag, wachtwoord, beschadigd, te groot of te lang
- ✅ **Blokken** (`lib/domain/report-import.ts`): ±4.000 tekens met 800 tekens overlap, zodat elk citaat tot 750 tekens in
  één blok staat; vindplaats "Rapport, blok N van M · p. X". Hetzelfde rapport twee keer importeren wordt geweigerd (inhoudshash)
- ✅ **Bevinding vastleggen** (`saveReportFinding`): de consultant plakt een citaat; ProofLab zoekt zelf het blok, controleert
  het citaat woord voor woord en de getallen uit de bevinding (bestaande `checkQuote`) en weigert anders. Daarna de gewone
  statusberekening (`lib/claim-insert.ts`, gedeeld met het bestaande bevindingformulier)
- ✅ **AI-voorstellen (optioneel)** (`lib/ai/report-findings.ts`): de AI leest het rapport in delen van ±60.000 tekens
  ("Lees het volgende deel"), afgebakend met een willekeurige tag als data. Alleen voorstellen met een letterlijk
  teruggevonden citaat en kloppende getallen blijven over; per voorstel accepteren (controleren, onderzoeksvraag kiezen)
  of verwerpen; pas na accepteren een bevinding (`origin = 'ai'`). Via `runAi` (budget en grootboek, doel
  `research:import_findings`). Zonder AI-sleutel werkt alles behalve de voorstellen
- ✅ Tests: `tests/unit/report-import.test.ts` (blokken en overlap, pagina's, DOCX/zip-bom, PDF met en zonder tekstlaag,
  filter op letterlijke citaten, datum), `tests/unit/report-import-actions.test.ts` (import, dubbel, alleen-lezen,
  scan, voorstellen filteren, bevinding vastleggen en weigeren)
- 🟡 AI-voorstellen worden niet bewaard tot ze geaccepteerd zijn (herladen = opnieuw laten voorstellen). Geen OCR voor
  scans. Geen e2e-test en geen visuele controle met login in deze omgeving

## Markt: klantonderzoek vanuit stap 1 (11 november)

Opdracht product owner: "Bij marktonderzoek moet je verschillende enquêtes kunnen aanmaken, online interviews kunnen
maken", direct vanuit stap 1 Markt. Migratie `20261111090000_markt_klantonderzoek.sql` (**nog niet toegepast**; zonder
de migratie toont het tabblad de bestaande enquêtes en interviews en meldt dat nieuw verkennend onderzoek wacht).

- ✅ **Tabblad "Klantonderzoek"** op Markt (`?tab=klantonderzoek`, `components/research/CustomerResearchPanel.tsx`):
  alle enquêtes en interviews van het idee (status, ontvangen/bruikbare antwoorden, onderzoeksvraag, rol verkennend of
  test uit stap 3), "Nieuwe enquête" en "Nieuw online interview" (`NewStudyForm`), en "Live interview vastleggen" naar
  de lopende interviewronde of, zonder ronde, naar een nieuwe interview-Test Card in stap 3
- ✅ **Verkennend onderzoek** (`lib/domain/customer-research.ts`, `app/app/ideas/[id]/research/study-actions.ts`): een
  experiment van het type `survey` met een hypothese `exploratory = true`, gekoppeld aan een onderzoeksvraag, zonder
  aanname, drempel of beslisregel. Begint met een AI-voorstel (dezelfde coach als de Test Card, `lib/survey-coach.ts`),
  het sjabloon of leeg; daarna de bestaande enquête-editor op de onderzoekspagina (`StudyView`, `StudyEditor`).
  Meerdere per idee. Kernvraag optioneel (zonder drempel)
- ✅ **Online interview (schriftelijk)**: zelfde engine, toestemmingsvraag bovenaan (screening: wie "nee" kiest stopt en
  telt niet), daarna alleen open vragen uit een leidraad over recent gedrag; de leidraadcontrole van
  `interview-audit.ts` waarschuwt bij sturende, hypothetische of dubbele vragen. Publieke pagina toont het label
- ✅ **Poorten**: tests uit stap 3 ongewijzigd (zelfde controlepunten, go-regel, steekproefregels). Verkennend: geen
  pretest-vinkje, geen go-regelblokkade, afronden zonder reden, geen Learning Card, geen oordeel (`decisive()` sluit
  het uit van metingen, methodevergelijking, rapportoordeel en voortgang). Goedkeuren vergrendelt de go-regel van het
  dossier niet en maakt hem niet "achteraf vastgelegd" (migratie)
- ✅ **Telregels**: per persoon (één antwoord per uitnodiging/bezoeker), buiten doelgroep/zonder toestemming en niet
  geloofwaardig tellen niet; zelfrapportage, geen gedrag. Live interviews: alleen echte gesprekken met toestemming
- ✅ Tests: `tests/unit/customer-research.test.ts`; e2e `tests/e2e/klantonderzoek.spec.ts` (niet gedraaid)
- 🟡 Migratie toepassen; daarna de e2e draaien en visueel controleren op 1440 px en 390 px

## Gebruikerstest: verbeterpunten A/B/C (12 november)

Bevindingen uit de gebruikerstest met het dossier "AI-communicatie voor sportclubs", geanalyseerd en goedgekeurd door de
product owner. Drie commits (A bugs, B betrouwbaarheid besluit, C gebruiksvriendelijkheid) en één migratie
`20261112090000_gebruikerstest.sql` (**nog niet toegepast**; zonder de migratie valt de app terug, zie per punt).

### A. Bugs
- ✅ **A1** Prioriteitenlijst leesbaar: nummer en soort op één regel, de aanname eronder over de volle breedte; ook in het
  testbord, "Wat test je eerst?" en de clusterpopup (`app/globals.css`, DESIGN_DIFF_LOG #49)
- ✅ **A2** Gekoppeld bureauonderzoek dat niet meetelt, staat apart met de reden en een link naar de bevinding
  (risicokaart, melding na koppelen, blok "Bureauonderzoek per aanname" op Bewijs & besluit). Eén regel voor alles:
  `deskTally`/`deskVerdict` in `lib/domain/evidence.ts`
- ✅ **A3** "bewijsas" vervangen door gewone taal ("Kans en rangorde zijn opnieuw berekend")
- ✅ **A4** Bevindingstatus als Nederlands label bij het koppelen en in de AI-prompts
- ✅ **A5** Nieuwe status **Weerlegd** (alleen gecontroleerde tegensprekende bronnen); "Tegenstrijdig" alleen bij pro én
  contra. Methode **2026-11-e** (nieuwe dossiers): een weerlegde bevinding waarop een aanname leunt telt als tegenbewijs,
  conservatief met de factor van één secundaire bron (× 1,2; bewijsas 0,6). Een weerlegde tegenbevinding telt niet als
  steun. Dossiers op 2026-11-a t/m d rekenen ongewijzigd. Migratie: check op `claims.status` vervangen, tegenstrijdige
  bevindingen zonder enige gecontroleerde bevestigende bron herberekend naar weerlegd, methodeversie e (check, standaard,
  volgorde). Zonder migratie: `recomputeClaim` valt bij "weerlegd" terug op "tegenstrijdig"
- ✅ **A6** Stap Aannames is pas klaar met een hoofdtest én een vastgelegde beslisregel ("Loopt · Leg de beslisregel vast")
- ✅ **A7** "Kies om nu te testen" werkt direct (`useOptimistic`), en vernieuwt alleen de aannamepagina
- ✅ **A8** Coachlinks springen naar `#ter-review`, `#goedkeuren` en `#publiceren` op de testpagina (DESIGN_DIFF_LOG #50)
- ✅ **A9** `/app/ideas/:id/decision` stuurt door naar Bewijs & besluit (`next.config.ts`)
- ✅ **A10** Prestaties: `revalidatePath` alleen het eigen pad bij koppelen, bevinding toevoegen, kiezen en
  teststatus; Markt laadt van geïmporteerde rapporten alleen het aantal blokken plus 3 voorbeeldblokken (was: alle
  tekst); de tabs Concurrenten, Klantonderzoek en Marktpotentieel worden pas bij openen opgebouwd; de run-voortgang
  ververst niet opnieuw zolang de vorige verversing loopt en vertraagt tot 30 s zonder wijziging; parallelle queries in
  `recomputeClaim`, `loadProgress` en de testpagina (zie het rapport bij de commit voor de tellingen)

### B. Betrouwbaarheid besluit
- ✅ **B1** Go-regel: het voorstel neemt alle kritieke aannames (gekozen om nu te testen én belang 5) mee, plus altijd
  de aanname van de hoofdtest, elk minstens 70%. Per aanname een vinkje (testpagina en aannamepagina); een kritieke
  aanname uitvinken vraagt een motivering van minstens 15 tekens, bewaard als "Uitgesloten: <aanname> – <reden>" in de
  toelichting. Zelfde controle op de server (`excludedCriticalCheck` in `lib/domain/decision-rule-proposal.ts`)
- ✅ **B2** Standaard soort informatie en versheid per brontype (`lib/domain/source-defaults.ts`); het formulier volgt
  het fragment tot je zelf kiest, met de hint "Afwijkend van de standaard voor …"; bij de bevinding een pill (afgeleid).
  De server weigert "officiële statistiek" bij interview, outreach en enquête. Geen apart brontype voor prijspagina's:
  bedrijfswebsite → productinformatie (12 maanden)
- ✅ **B3** Nieuwe soorten aannames **kanaal** en **regelgeving/context** met eigen passende test (outreach-proef of
  landingpage per kanaal; bureauonderzoek/juridische check buiten ProofLab), zonder nieuwe testtypes. Volgorde:
  regelgeving → bouwen met termijn/budget → kanaal → prijs → overige techniek → gedrag → markt, met de categorie als
  terugval. Migratie: `assumptions_kind_check` uitgebreid (zonder migratie werkt alleen het afleiden uit de tekst)
- ✅ **B4** Zelfgoedkeuring: melding "Je keurt je eigen test goed" met verplicht vinkje (ook op de server); migratie
  `experiments.submitted_by` en `experiments.self_approved`, gezet door `guard_experiment` (die ook `owner_id` bewaakt);
  het rapport (web en PDF) zet "zelf goedgekeurd" in de status bij Alle tests. Geen vier-ogenregel (fase 3)

### C. Gebruiksvriendelijkheid
- ✅ **C1** Eén gedeeld richting-veld (`components/ui/DirectionField.tsx`): "Wat doet dit citaat met je bevinding?"
  (Bevestigt / Weerlegt de bevinding) met voorbeeld, bij een bron en bij een geïmporteerd rapport; hetzelfde patroon
  met "aanname" bij het koppelen op de risicokaart en bij een interviewuitspraak, met zichtbaar label
- ✅ **C2** Redenen met de juiste vervoeging ("1 gecontroleerde bron spreekt dit tegen", "2 … spreken …") en een
  vervolgstap; ook bij tegenstrijdige bronnen de bevestigende telling
- ✅ **C3** Drempels vastleggen hoogt de minimale steekproef op tot het berekende aantal ("Automatisch berekend (was
  N)"); lager kan alleen met een motivering (min. 10 tekens), die de server als "Steekproef onder berekend aantal: …"
  bij de Test Card bewaart. Zelfde controle in `validateTestCard`. Alleen bij de kansregel
- ✅ **C4** Voorgestelde naam van een experiment stopt op een woordgrens met "…" (`experimentTitle`), staat zichtbaar
  boven Details met de hint "Aanpasbaar" en wordt niet overschreven als je hem zelf wijzigde
- ✅ **C5** "Wij denken dat …" met een voorbeeldbewering; "Schrijf een bewering, geen vraag." Een afsluitend
  vraagteken geeft een melding en houdt opslaan tegen (scherm en server)
- ✅ **C6** Niet-gekalibreerde kansen in een band rond de waarde (43% → 35–45%, was 40–50%); gelijke waarden als één
  getal; de tooltip noemt alleen de exacte waarde; de kalibratie-uitleg staat één keer per kaart (ook rapport/PDF)
- ✅ **C7** Tot acht aannames op één plek in een ring; daarboven een badge "N ▾" met een popup bij het punt ("N
  aannames op deze plek — kies er één"), die sluit bij Escape en bij een klik buiten
- ✅ **C8** Interview toevoegen: toestemming alleen zichtbaar én verplicht bij een echt gesprek (server idem;
  `consent_recorded` is de werkelijke waarde); één veld voor de wervingsgroep met "Eigen netwerk (bekende: …)", de
  server leidt "bekende" daaruit af; zonder keuze volgt de groep uit het wervingskanaal (`lib/domain/interview-intake.ts`)
- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login; `scripts/test-db.sh`
  (geen bruikbare lokale Postgres). Migratie nog toepassen

## Gebruikerstest: groep D (13 november)

Tweede ronde met het dossier "AI-communicatie voor sportclubs" (analyse goedgekeurd). Drie commits (D1–D4
rapporttekst, D5–D8 markt en intake, D9–D13 Reality Check en besluit) en één migratie
`20261113090000_groep_d.sql` (**nog niet toegepast**; idempotent, wijzigt geen bestaande data; zonder de migratie valt
de app terug, zie per punt).

### Rapporttekst (D1–D4)
- ✅ **D1** Tussenbesluit is nooit definitief: `decisionConfirmation(at, hasClient, action)` kent `not_final`
  ("Tussenbesluit: nog geen definitief besluit") voor verder testen, verlengde testfase, bijsturen en pauzeren. De
  momentopname bewaart `actionCode` (oudere rapporten: afgeleid uit het label). Hoofdstuk 09 komt uit
  `decisionParagraph` (`lib/report-sheet.ts`), voor rapportpagina en PDF; de PDF-auditregel zegt zonder opdrachtgever
  niet meer "Nog niet bevestigd". Ook Bewijs & besluit zegt bij een tussenbesluit niet meer "direct definitief"
- ✅ **D2** De momentopname bewaart `extendUntil`; tekst "De verlengde testfase loopt tot 2 december 2026; daarna …" of
  in de verleden tijd; Nederlandse datums in `testMoreNextStep` en de melding van `extensionBlocker`
- ✅ **D3** `endSentence` (`lib/text.ts`): nooit meer ".." na volgende stap, beslisregel, ontbrekend bewijs of uitkomst
- ✅ **D4** Kansen in hoofdstuk 06 als platte tekst (`assumptionProbabilityText`, gedeeld met de PDF); "niet
  gekalibreerd" één keer in de kolomkop, de uitleg één keer onder de tabel, geen verwijzing naar een tooltip

### Markt en intake (D5–D8)
- ✅ **D5** `annualPriceFromOffer` ("€ 79 per maand" → € 948, "Aanname uit intake: … × 12, niet getoetst"). Een nieuw
  dossier vult de jaaromzet per klant als aanname (geen bevinding); bestaande dossiers krijgen de knop "Neem intakeprijs
  over (aanname)" zolang de waarde 0 is. Een factor op 0 heet in de formule "onbekend" en de uitkomst "Niet vastgesteld"
- ✅ **D6** "Niets doen" uit de intake ("Amateursportclubs houden vast aan hoe het nu gaat: …" of "nog te
  onderzoeken"). Alternatieven die de AI in de Reality Check noemt, worden voorstellen (`competitors.origin =
  'proposal'`): apart en alleen voor consultants, nergens meegeteld (rapport, Reality Check, dossierstatus, coach).
  Overnemen alleen met website of gekoppelde bevinding (`saveCompetitor`). Migratie: check op `origin` en leesregel
  (opdrachtgevers zien geen voorstellen). Zonder migratie slaat de Reality Check geen voorstellen op
- ✅ **D7** Branche "Verenigingen, sport en maatschappelijke organisaties" (`associations`) met eigen aandachtspunten
  (leden, contributie, vrijwilligers, bestuur als beslisser); herkend door regels en AI-intake; nooit MKB bij een
  publieke doelgroep; het sjabloon laat een branche weg die niet bij het soort klant past. Zonder migratie weigert de
  database de nieuwe branche
- ✅ **D8** Korte doelgroep `ideas.audience_short` (max. 60 tekens): voorstel uit AI of regels, aanpasbaar op de
  samenvattingskaart (er is geen aparte dossierinstellingenpagina). `specificAudience` gebruikt eerst de korte vorm.
  Zonder migratie wordt hij steeds afgeleid uit de toelichting

### Reality Check en besluit (D9–D13)
- ✅ **D9** "Geen onafhankelijke marktbron" noemt de brontypes die er echt zijn, of "geen gecontroleerde bron"
- ✅ **D10** `dossierSummaryForAi` zonder ruwe codes (labels, bewijs in procenten) en met de opdracht geen codes te
  noemen; `sanitizeAiText` (`lib/domain/ai-text.ts`) op Reality Check (ook in de onderzoeksrun), coachnotities,
  AI-voorspellingen en oudere AI-vragen in het rapport. Een uitdaging met een resterende code valt weg
- ✅ **D11** Voorbeelden met de korte doelgroep van het dossier, anders neutraal; geen "Eventmanagers" meer buiten
  demo-data
- ✅ **D12** `decisionBlocker` geeft `{ text, href, step }`; boven het besluit "1. Voorspelling (✓/open) – 2. Besluit"
  met links naar wat ontbreekt; de compacte voorspelling staat in de besluitkaart (`#voorspelling`)
- ✅ **D13** Weerlegd overal goed: aparte telling (KPI), geen "(Weerlegd, tegengesproken)", in de PDF als "Weerlegd
  door gecontroleerde bronnen", nooit sterkste bewijs; Reality Check "1 bevinding weerlegd" / "2 bevindingen …";
  tegensprekende bronnen tellen niet als onafhankelijke marktbron
- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login;
  `scripts/test-db.sh`. Migratie nog toepassen. De databasefunctie die de dossierfase bepaalt (golf B) telt een
  voorstel nog als alternatief; de app zelf niet

## Fase 1 · punt 2: Stand van het bewijs (4 november)

Eén beslisscherm per idee, bovenaan Overzicht, Besluit en het rapport. Vijf commits, **geen migratie**. De berekening
van de kansen is ongewijzigd: `tests/unit/probability-golden.test.ts` vergelijkt alle vijf methodeversies (2026-11-a
t/m e) op 181 vaste gevallen bit voor bit met de uitkomsten van vóór de refactor (`fixtures/probability-golden.json`).

- ✅ **Bewijsregister** (`lib/domain/evidence.ts`): `assumptionProbability` en `probabilityCore` geven naast het
  resultaat `items[]` terug: per gekoppelde bevinding of waarneming `fate` (`counted`/`not_counted`), `code` en
  `reason` in gewone taal (oefengesprek of synthetisch, AI niet beoordeeld of afgekeurd, status van de bevinding,
  weerlegd volgens de methodeversie, samengevoegd met een sterker signaal uit dezelfde bron, half gewicht, "telt mee,
  maar het plafond van X% is bereikt"). `computeAssumptions` voegt items uit tests toe die onbeslist zijn of onder de
  steekproef bleven (`excludedRegisterItem`). De risicokaart toont "3 voor (2 tellen mee) · 1 tegen" met uitklapbare
  redenen (`components/evidence/EvidenceRegister.tsx`); de A2-lijst (`deskNotCounted`) is vervangen en het
  bureauonderzoek per aanname op Besluit leest hetzelfde register (`deskRows`)
- ✅ **Eén schaal** (`lib/domain/evidence-scale.ts`): verkenning → mening → gedrag (probleem, kleine handeling,
  prijskeuze) → betaling → herhaling, gekoppeld aan `EVIDENCE_LEVELS`/`KIND_LEVEL`. `EVIDENCE_LADDER` is hiervan
  afgeleid: een demo-aanvraag is overal een kleine handeling. Component `EvidenceScale` (geordende lijst, aria-current)
- ✅ **Berekening en loader** (`lib/domain/evidence-standing.ts`, `lib/standing-data.ts`): zekerheid laag/midden/hoog
  uit de laagste kans onder de kritieke aannames en de zwakste trede (midden ≥ 50% en gedrag, hoog ≥ 70% en gedrag;
  gedocumenteerd in het bestand), "x van y kritieke aannames getest" (kritiek = belangrijkheid ≥ 4 én gekozen om te
  testen; getest = hoofdtest met goedgekeurde uitslag geslaagd/niet geslaagd), sterkste bewijs (trede en personen),
  volgende stap (Overzicht: informatiewaarde; Besluit en rapport: `openDecisionAction`, anders `nextAction`), per
  kritieke aanname kans, telling met redenen en status van de hoofdtest. Alleen bestaande, gecachete ladingen
- ✅ **UI** (`components/evidence/EvidenceStanding.tsx`): bovenaan Overzicht (achter de eigen voorspelling, golf B
  punt 15) en Besluit; één samenvattende regel, schaal, details inklapbaar; "niet gekalibreerd" één keer, de
  bandbreedte in de tooltip (`Probability band`). Geen citaten, ook niet voor opdrachtgevers
- ✅ **Rapport**: veld `standing` in de momentopname (`buildSnapshot`), met terugval `standingFromSnapshot` voor oudere
  rapporten (afgeleid uit belangrijkheid, status, kans en de bewijsladder; dat staat erbij). Hetzelfde blok bovenaan
  het rapport en op pagina 1 van de PDF (`standingPdf`)
- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login (geen
  Supabase-toegang); de 390px-weergave is alleen via de opmaakregels geborgd

## Fase 1 · punt 1: Snel en Grondig (4 november)

Twee standen per dossier: **Snel** (standaard voor nieuwe dossiers) en **Grondig** (bestaande dossiers). Alleen
weergave: geen enkele berekening leest de stand. Vijf commits en één migratie `20261114090000_fase1_weergave.sql`
(**nog niet toegepast**; idempotent; zonder de migratie geldt overal Grondig en meldt de schakelaar dat de stand nog
niet kan worden bewaard).

- ✅ **Migratie**: `ideas.detail_level` (`quick`/`thorough`, check); eerst toegevoegd met standaard `thorough` (alle
  bestaande dossiers), daarna standaard `quick` voor nieuwe. `ideas_touch` gebruikt nu `touch_idea_updated_at`: een
  update die alleen de stand wijzigt laat `updated_at` staan (geen "laatst bijgewerkt", geen coachactiviteit); het
  auditspoor (`audit_row`) legt de wissel vast (oud → nieuw). `defaulted_fields text[]` op `hypotheses`, `assumptions`
  en `interviews`, met een eigen auditregel `defaulted_fields` (velden en waarden) bij insert; `guard_hypothesis_lock`
  bewaakt ook deze lijst na vergrendelen
- ✅ **Context**: `lib/view-mode.ts` (buiten `lib/domain`, zonder imports), `getViewMode` (server, via `getIdea`),
  `ViewModeProvider` in `PageFrame` (één per pagina), `useViewMode()`, `<Detail only="thorough">` en één hint
  "Meer tonen in Grondig" per pagina (`MoreInThorough`, eerste verborgen plek in documentvolgorde)
- ✅ **Schakelaar** "Snel | Grondig" in `.dossier-search-bar` naast Zoeken en Vraag de AI (radiogroep, 44 px,
  pijltjestoetsen, optimistisch); server action `setDetailLevel` (`app/app/ideas/[id]/view-actions.ts`: alleen de twee
  standen, `requireWritableIdea`, revalidate). Opdrachtgevers zien de stand, geen schakelaar
- ✅ **`<Explain k>`**: in Snel de uitleg de eerste keer per pagina, daarna alleen de term met tooltip (kalibratie-uitleg
  op risicokaart, kansdetail en Stand van het bewijs; drempelnote AI-kwaliteit). Per AI-observatie in Snel alleen de
  pil "voorstel". In Grondig overal de volledige uitleg (zoals voorheen)
- ✅ **Snel per pagina**:
  - Aannames: rekenuitleg → link naar de rekenwijze; red team, lijst "Later", "Score en berekening", startkans- en
    soortkeuze in Grondig; samengevoegde signalen/wervingsgroepen/indirect bewijs achter "Waarom deze kans?"; kans als
    één getal met de band in de tooltip; hooguit 3 aannames in de lijst; beslisregel compact
  - Testen: "Hoe is dit berekend?" (met SamplePlanner) in Grondig; Details blijven dicht; go-regelvoorstel compact;
    één test per aanname op het bord (hoofdtest, anders de nieuwste; het zojuist opgeslagen concept altijd)
  - Markt: kengetallen, zoeklogboek, "Hoe is er gezocht naar tegenbewijs?", Tegenargumenten, AI-kwaliteit,
    steuncontrole per citaat (de statuspil blijft), financiële haalbaarheid en Monte Carlo-simulatie in Grondig. De
    bandbreedte-invoer per factor blijft (anders zou opslaan in Snel bestaande bandbreedtes wissen)
  - Testpagina: Bayes-schatting, tabellen per kanaal/prijspunt, resultaten per bericht, leidraad- en transcriptcontrole
    en AI-kwaliteit in Grondig
  - Besluit: ladderpillen en pre-mortem-invoer in Grondig; goedgekeurde Learning Cards als samenvatting (de rest achter
    "Hele Learning Card"); conceptkaarten ongewijzigd (goedkeuren blijft mogelijk)
  - Uitkomst: kalibratiegids, AI-referentie en AI-voorspellingen in Grondig
  - Overzicht: sprintkaart en snelkoppelingen in Grondig (de sprintbalk boven elke pagina blijft)
  - Rapport: op het scherm Stand van het bewijs + beslisblad, de bijlage achter "Volledig dossier tonen"; printen via
    de browser en de server-PDF zijn altijd volledig
  - Overal blijven Notities en documenten en Vraag de AI
- ✅ **Standaardwaarden zichtbaar** (`lib/defaulted-test-card.ts`, `lib/defaulted-fields.ts`): de Test Card toont vóór
  opslaan welke velden nog precies de standaardwaarde hebben (meting, drempels, steekproef, deadline, vertekeningen,
  kanalen, afgeleide wervingsgroep); de server berekent hetzelfde en schrijft het naar `hypotheses.defaulted_fields`.
  Nieuwe aannames zonder eigen startkans krijgen `prior` (weg zodra een mens een startkans bewaart); interviews zonder
  gekozen wervingsgroep `recruitment_group`. Los van de stand: een standaardwaarde is een standaardwaarde. De testpagina
  toont ze bij de Test Card. Zonder migratie wordt opnieuw opgeslagen zonder de lijst
- ✅ **Tests**: `view-mode-identical` (loadDossier, kansen, bewijsregister, dossierstand en Stand van het bewijs zijn
  identiek bij `quick` en `thorough`), `view-mode-isolation` (niets in `lib/` behalve `view-mode.ts`, `data.ts` en de
  types noemt de stand; `lib/domain` kent `defaulted_fields` niet; PDF en momentopname onafhankelijk), `view-mode`
  (Detail, Explain, schakelaar, rapportbijlage), `view-mode-action` (validatie `setDetailLevel`), `defaulted-fields`;
  DB-test `tests/db/fase1-weergave.test.ts`; e2e: bestaande specs zetten nieuwe dossiers eerst op Grondig
  (`setDetailLevel` in `tests/e2e/intake.ts`), nieuwe spec `snel-grondig.spec.ts` (wisselen, bewaren, 390 px)
- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login (geen
  Supabase-toegang), `scripts/test-db.sh` (Postgres kan hier niet als niet-root-gebruiker worden gestart). Migratie
  nog toepassen

## Fase 1 · punt 3: Interviews importeren en analyseren (4 november)

Transcripten uit Teams, Zoom, Fathom, Otter of eigen notities importeren, pseudonimiseren vóór opslag en vóór AI,
citaten markeren en thema's tellen over alle interviews heen. Acht commits en één migratie
`20261115090000_interviews_import.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de test; zonder
de migratie werkt de app zoals voorheen en meldt het importscherm dat de database moet worden bijgewerkt).

- ✅ **Parsers** (`lib/domain/transcript-parse.ts`, `lib/transcript-file.ts`): TXT/MD (ook Otter- en Fathom-notatie),
  DOCX (ook Teams-DOCX met tijdcodes of kopregels), VTT (Teams `<v>`, Zoom "Naam: tekst"), SRT → segmenten → één
  genormaliseerde tekst "[00:12:03] Spreker A: …" met per segment de exacte positie. Grenzen: 4 MB per bestand,
  200.000 tekens (was 60.000; database 250.000), AI-vensters van 40.000 tekens met overlap. Het bestand wordt alleen in
  het geheugen gelezen (server action tot 4,5 MB) en nergens bewaard
- ✅ **Pseudonimiseren** (`lib/domain/pseudonymize.ts`, `components/experiments/PseudonymReview.tsx`): regelgebaseerd
  (sprekers met voor- en achternaam, Nederlandse voornamen met tussenvoegsels, aanspreekvormen, clubs/verenigingen,
  Stichting/BV/NV, e-mail, telefoon, IBAN, postcode) → voorstel {gevonden → label}. Controlescherm met aan/uit (e-mail,
  telefoon en IBAN altijd aan), aanpasbare labels, extra naam markeren (ook via selectie), voorbeeld en de melding dat
  pseudonimiseren geen anonimiseren is. De server stelt het voorstel opnieuw op uit het origineel, legt de keuzes
  erover en controleert het resultaat (`prepareImport`). Bewaard: alleen labels, soorten en aantallen
- ✅ **Migratie**: `interviews.source_format`, `source_hash` (uniek per dossier), `segments` (zonder tekst),
  `pseudonymized_at/_by` (door de database gezet), `pseudonym_labels`, `experiment_id` mag leeg (verkennend);
  bewaartermijn bij import = `held_on` + 12 maanden; bron, pseudonimisering en test liggen vast en het transcript
  verandert niet meer zodra er observaties zijn. `observations.quote_start/quote_end/segment_index` en `theme_only`.
  `dmu_role` met `payer` (Betaler los van Inkoper). `interview_codes` en `observation_codes` met RLS, beoordelingsguards
  en `audit_row`. `interview_theme_counts(p_idea)` voor opdrachtgevers. `purge_expired_personal_data` wist ook
  segmenten en posities; `dsr_search` vindt verkennende interviews; `org_transcript_settings` (Fathom-sleutel, alleen
  via functies). DB-test `tests/db/interviews-import.test.ts` (10 tests)
- ✅ **Import-UI en acties** (`interview-import-actions.ts`, `components/experiments/InterviewImport.tsx`):
  `parseInterviewFile` (voorstel, niets opgeslagen) en `saveImportedInterview` (hercontrole; toestemming alleen bij een
  echt gesprek; wervingsgroep en rol; gespreksdatum niet in de toekomst en niet ouder dan de bewaartermijn; pseudoniem
  mag geen gevonden naam bevatten). Ingangen: op de lopende interviewtest ("Transcript importeren", naast plakken) en
  vanuit Markt › Klantonderzoek als verkennend interview (nieuwe pagina `/app/ideas/[id]/interviews`)
- ✅ **Markeren om te citeren** (`TranscriptMarker`, `transcript-actions.ts`): transcriptpagina's
  `/experiments/[expId]/interviews/[ivId]` en `/interviews/[ivId]`. Selecteren (of typen/plakken; ProofLab zoekt het
  citaat op) → "Maak observatie" met citaat, begin, einde en uitspraak. De server accepteert alleen als
  `transcript.slice(begin, einde)` genormaliseerd gelijk is aan het citaat én `checkQuote` het vindt, binnen één
  uitspraak. Koppelen aan een aanname is per citaat expliciet (standaard niet gekoppeld, met de melding dat de kans
  verandert), alleen bij een interviewtest; per-persoon-ontdubbeling blijft. Een gemiste naam vervangen kan alleen
  zolang er geen observaties zijn
- ✅ **Thema's** (`theme-actions.ts`, `lib/domain/themes.ts`, `ThemePanel`): `suggestThemes` via `runAi` op de
  gepseudonimiseerde tekst in vensters (een zelf geplakt, niet gepseudonimiseerd transcript gaat niet naar de AI); alleen
  letterlijk teruggevonden citaten met positie blijven. Beoordelen per thema en per toewijzing (ook alles van één thema
  tegelijk), handmatig thema's maken en toewijzen. Kwaliteitsmaat "AI-thema's: geaccepteerd" (zelfde drempels) in
  `AiQualityCard`. Thema's tellen nooit mee in de kans: `observations_for_idea` laat thema-citaten weg, de voortgang,
  de testtelling (n) en het ontdekkingsbewijs filteren ze (`withoutThemeOnly`), en een thema-citaat kan niet aan een
  aanname worden gekoppeld
- ✅ **Dwarsdoorsnede** (`lib/domain/theme-counts.ts`, `ThemeCrossTable`): per thema en per aanname "X van N
  geïnterviewden" (N = echte gesprekken met toestemming; X = verschillende interviews met een handmatige of
  geaccepteerde toewijzing), uitsplitsing per rol en wervingsgroep (in Grondig), citaten met doorklik voor het team.
  Op de interviewtest en op de dossierpagina Interviews; opdrachtgevers via de RPC, zonder citaten. Oefeningen buiten N
  en X
- ✅ **Fathom** (`lib/integrations/transcripts/{types,file,fathom,fathom-server}.ts`): interface `TranscriptSource`;
  Fathom achter `FATHOM_ENABLED`, sleutel per werkruimte op `/app/status` (eigenaar), status "niet verbonden" met het
  handmatige alternatief. Instellen: `docs/OPERATIONS.md` §13. Tests met nep-fetch, geen netwerk
- ✅ **Controle C8**: een oefening vraagt geen toestemmingsvinkje en telt nergens mee (ook niet in N of X)
- ✅ **Tests**: unit `transcript-parse`, `pseudonymize`, `interview-import`, `quote-marking`, `themes`, `theme-counts`,
  `transcript-sources` (74 nieuwe tests); DB `interviews-import`. Na elke commit typecheck, lint en vitest groen;
  `next build` groen. `scripts/test-db.sh`-stappen lokaal gedraaid (alle 24 DB-testbestanden groen)
- **Keuze verkennend interview**: `interviews.experiment_id` leeg, met `idea_id` (al aanwezig). Het eenvoudigste dat
  `testOutcomesFrom` en `experimentMetrics` niet raakt (die lezen per test). Waarnemingen uit een verkennend interview
  kunnen niet aan een aanname worden gekoppeld (databaseguard), dus nooit in kans of status. Wel tellen echte
  verkennende gesprekken als ontdekkingsbewijs (`hasDiscoveryEvidence`, alleen de volgorde van testadvies) en in N
- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login (geen
  Supabase-toegang); de 390px-weergave is via de opmaakregels in `components/experiments/interviews.css` geborgd.
  Migratie nog toepassen

## Fase 2 · punt 5: Werving bijhouden (5 november)

Per test (vooral interviewtests, ook andere tests met werving) en per kanaal de trechter **benaderd → gereageerd →
afspraak → gesprek gehouden**, de respons per kanaal met Wilson-interval, "Leg vast als bevinding" en een melding als
de deadline in gevaar komt. Vijf commits op branch `fase2-werving` en één migratie
`20261117090000_fase2_werving.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de DB-test; zonder de
migratie werkt de app zoals voorheen, zie terugval).

- ✅ **Migratie**: `recruitment_entries` (datum, kanaal, stap, aantal, notitie, `corrects_id`) met RLS (lezen en
  toevoegen alleen `can_write_idea`: notities kunnen over personen gaan), `audit_row` en `guard_recruitment_entry`:
  alleen toevoegen (geen update/delete-rechten, en de guard weigert ook de beheerder; alleen een cascade van dossier
  of test haalt regels weg); een correctie is een nieuwe regel met negatief aantal en reden (min. 5 tekens), een
  tegenboeking hoort bij dezelfde test, hetzelfde kanaal en dezelfde stap, en netto komt een stap nooit onder nul
  (advisory lock tegen gelijktijdige correcties). Stappen handmatig: benaderd, gereageerd, afspraak (afspraak alleen
  bij interviewtests); "gesprek gehouden" nooit handmatig. Vanaf een goedgekeurde test, geen datum in de toekomst.
  `recruitment_campaigns` (Expandi-campagne ↔ test, één campagne per dossier zodat contacten nooit in twee tests
  tellen; RLS team-only, audit). Brontype `recruitment_log` ("Eigen wervingsregistratie") in de check op `sources`;
  nooit `is_primary`; het brontype van een bron kan niet naar of van dit type; guards op `claim_sources` en `claims`
  weigeren `official_statistic` en `primary_document` bij zo'n bron. Geen bestaande functie vervangen; `revoke
  execute` op alle nieuwe triggerfuncties
- ✅ **Kanalen**: één lijst, `CHANNELS` uit `lib/domain/tracking.ts` (dezelfde als `utm_source` en
  `interviews.recruited_via`; ook in de DB-check). Expandi telt onder "Outreach (e-mail/DM)", agenda-afspraken (nog
  zonder kanaal) onder "Direct / onbekend"
- ✅ **Rekenen** (`lib/domain/recruitment-funnel.ts`, puur): `buildFunnel` met herkomst per getal (handmatig netto;
  Expandi = unieke gepseudonimiseerde contacten, benaderd = verzoek/bericht/acceptatie/antwoord, gereageerd =
  antwoord; agenda = laatste boeking per persoon, geannuleerd telt niet; gehouden = echte gesprekken met toestemming
  per `recruited_via`, bij andere tests "deelgenomen" uit de meting per kanaal). `responseRate` (Wilson, geen respons
  bij 0 benaderd of meer reacties dan benaderd, met waarschuwing). Gepland = toekomstige agenda-afspraken + (overige
  afspraken − gehouden). `deadlineRisk`: gehouden + gepland + tempo (vanaf 2 dagen looptijd) tegen `min_sample` en
  de eerste van einddatum en beslisdatum; zonder tempo alleen een risico binnen 7 dagen; `missed` na de deadline
- ✅ **Loader** (`lib/recruitment-data.ts`): `loadRecruitment` (gepagineerde outreach-gebeurtenissen, campagnes die
  nog aan geen test hangen), `plannedByExperiment` (coach), `loadDeadlineRisks` (Overzicht).
  **`loadBookedAppointments(experimentId)`** staat in `lib/recruitment-data.ts` en geeft nu een lege lijst: wordt na
  samenvoegen met punt 4 gekoppeld aan `test_bookings` (vorm `BookedAppointment` in `lib/domain/recruitment-funnel.ts`
  = `person_key`, `status`, `booked_at`, `scheduled_for`)
- ✅ **Testpagina** (`components/experiments/RecruitmentFunnel.tsx`, `recruitment-actions.ts`), alleen het team, vanaf
  goedgekeurd: tabel per kanaal met de bron onder elk getal en de respons; "+ Werving registreren" (toevoegen of
  correctie met reden), "Expandi-campagne koppelen" (alleen campagnes die echt in de ontvangen gebeurtenissen staan),
  per kanaal "Leg vast als bevinding". Snel: trechter, percentage, registreren en vastleggen; Grondig: ook het
  95%-interval en de registratie met "Tegenboeken". Tabel scrolt zelf op 390 px
- ✅ **Bevinding**: de server rekent de respons opnieuw uit (nooit getallen uit het formulier) en maakt een bron
  "Eigen wervingsregistratie" (uitgever "ProofLab (eigen wervingsregistratie)", niet primair) met als fragment de
  telling zelf: "Eigen wervingsregistratie, test "…". Kanaal X levert Y% respons (n = …, periode …). Benaderd: …;
  gereageerd: …; 95%-interval (Wilson): … tot …. Herkomst …". Bevinding = "Kanaal X levert Y% respons (n = …, periode
  …)." via `insertClaimWithQuote`; het citaat staat letterlijk in het fragment, dus de citaatcontrole is exact. Soort
  informatie "Waargenomen handeling" (eigen meting); de status volgt uit `recomputeClaim` (één eigen bron = schatting).
  Optioneel direct gekoppeld aan een aanname (kanaal-aannames eerst) met de richting (bestaand patroon
  `assumption_claims`); anders later via Aannames. Het brontype is niet handmatig te kiezen in het bronformulier
- ✅ **Deadline in gevaar**: één regel, drie plekken. Testpagina: melding "Deadline in gevaar" / "Deadline verstreken"
  onder de kerngetallen; Overzicht: één compacte regel "Werving: …" (de test die het eerst in gevaar komt, "en N
  andere tests"), geen tweede volgende stap; coach: `test_pace` gebruikt nu `deadlineRisk` met geplande gesprekken en
  de beslisdatum (zelfde code `test_pace:<test>`, dus nooit een dubbele melding; zonder planning en beslisdatum
  precies het oude tempo). Wervingsregels tellen mee in de vingerafdruk van de coach (alleen als ze er zijn)
- ✅ **Tests**: unit `recruitment-funnel` (trechter, correctie, Expandi-uniek, agenda, andere tests, waarschuwing,
  Wilson, claimtekst + exacte citaatcontrole, brontyperegels, deadline in alle varianten, gelijk aan het oude tempo),
  `coach-rules` (test_pace met gepland, beslisdatum, verstreken), `source-defaults` bijgewerkt; DB
  `tests/db/fase2-werving.test.ts` (8 tests: idempotent, RLS team/opdrachtgever/buitenstaander, alleen toevoegen,
  correctie en netto ≥ 0, vaste regels, één campagne per dossier + audit, brontype-guards, cascade). Typecheck, lint,
  `vitest run tests/unit` (1291) en `scripts/test-db.sh` met eigen database `prooflab_fase2_werving` (25 bestanden,
  159 tests) groen
- **UI-teststappen** (dossier "AI-communicatie voor sportclubs", na het toepassen van de migratie):
  1. Open de lopende interviewtest (Testen → test). Onder de Test Card staat de kaart **Werving** met "Nog niets
     geregistreerd" (of de gehouden gesprekken per kanaal, bron "interviews").
  2. "+ Werving registreren": vandaag, LinkedIn (organisch), Benaderd, 30 → Vastleggen. Daarna Gereageerd 7 en
     Afspraak 4. De rij toont 30 / 7 / 4 / gehouden met "handmatig" eronder en respons 23%.
  3. Correctie: Benaderd 2 als "Correctie" zonder reden → foutmelding; met reden "dubbel geteld" → benaderd 28. In
     Grondig staat onder "Registratie" de oorspronkelijke regel én de correctie; "Tegenboeken" vraagt een reden.
  4. Zijn er Expandi-gebeurtenissen met een campagnenaam: "Expandi-campagne koppelen" → kies de campagne. Onder
     Outreach staan benaderd en gereageerd met "Expandi".
  5. "Leg vast als bevinding: LinkedIn (organisch)" → kies een kanaal-aanname, "Bevestigt de aanname" → de melding
     noemt de bevinding en "letterlijk teruggevonden". Markt → Bronnen toont de bron "Eigen wervingsregistratie"; de
     bevinding staat als schatting; Aannames toont de koppeling.
  6. Bij een lopende test met minder gehouden + geplande gesprekken dan de minimale steekproef en een einddatum of
     beslisdatum binnen een week (of een tempo dat de steekproef niet haalt): de testpagina toont "Deadline in gevaar", Overzicht één regel "Werving: …", de coach één
     notitie "… haalt de steekproef waarschijnlijk niet" (na "Laat de coach meekijken").
  7. Snel: geen interval, geen registratielijst; Grondig: wel. 390 px: alleen de tabel scrolt.
  8. Als opdrachtgever: geen kaart Werving en geen melding (alleen het team ziet de registratie).
- **Open punten**: (1) ~~`loadBookedAppointments` koppelen aan `test_bookings`~~ gedaan na het samenvoegen met punt 4
  (commit 486aced); het kanaal van een boeking is nog "Direct / onbekend"; (2) verkennend klantonderzoek
  (StudyView) toont de trechter nog niet; (3) een verlopen afspraak zonder ingevoerd gesprek telt als gepland (bewuste,
  zichtbare keuze; met agendadata uit punt 4 kan een no-show apart worden geteld); (4) niet gedaan in deze omgeving:
  e2e (Playwright) en visuele controle op 1440/390 px met login (`next build` slaagt sinds 6-11 op de
  samengevoegde branch); (5) migratie nog toepassen

## Fase 2 · punt 6: Nederlandse databronnen (5 november)

CBS StatLine breder (vaste catalogus en generieke client), "Haal uit CBS" bij een factor in het marktpotentieel, en
sectorregisters als CSV met de regel dat een register alleen als primaire bron telt wanneer het origineel erbij ligt
en de aantallen daarin letterlijk staan. Vijf commits op branch `fase2-databronnen`. **Geen migratie**: alles
hergebruikt `sources`, `source_excerpts`, `claims`, `claim_sources` en `sizing_factors`, dus het werkt meteen tegen de
live database.

- ✅ **CBS-catalogus** (`lib/integrations/cbs-catalog.ts`, puur, ook in de browser bruikbaar): zeven tabellen, elk op
  5 november 2026 gecontroleerd tegen de live OData v4-API (`datasets.cbs.nl/odata/v1/CBS/{tabel}`: Dimensions,
  MeasureCodes, alle codelijsten en een echte waarde voor het standaardonderwerp):

  | Tabel | Titel (CBS) | Dimensies | Onderwerpen in ProofLab |
  |---|---|---|---|
  | `03759ned` | Bevolking op 1 januari en gemiddeld; geslacht, leeftijd en regio | burgerlijke staat, geslacht, leeftijd (per jaar), regio (NL, landsdeel, provincie, COROP, gemeente) | bevolking op 1 januari |
  | `70072ned` | Regionale kerncijfers Nederland | regio | bevolking (totaal, geslacht, 6 leeftijdsgroepen), particuliere huishoudens (aantal en %), bedrijfsvestigingen (totaal en 8 sectorgroepen) |
  | `71486ned` | Huishoudens; samenstelling, grootte, regio, 1 januari | leeftijd referentiepersoon, regio | 13 onderwerpen (samenstelling en grootte) |
  | `81589NED` | Bedrijven; bedrijfstak | SBI 2008 (tot 5 cijfers), kwartaal; landelijk | totaal, 10 grootteklassen (werkzame personen), rechtsvorm |
  | `81578NED` | Vestigingen van bedrijven; bedrijfstak, regio | SBI 2008 (tot 5 cijfers), provincie/COROP/grote gemeenten | vestigingen |
  | `81575NED` | Vestigingen van bedrijven; bedrijfstak, gemeente | SBI-sectie (A–U), gemeente | vestigingen |
  | `81644NED` | Vestigingen van bedrijven; grootte, rechtsvorm, bedrijfstak, regio | SBI-sectie (A–U), provincie/COROP | vestigingen, 4 grootteklassen, 4 rechtsvormen |

  Alleen onderwerpen in "aantal" of "%" (geen bedragen in "1 000 euro" of "x 1 000"). Bedrijven naar SBI én
  grootteklasse én regio bestaat bij CBS alleen op sectieniveau (`81644NED`); fijnere SBI-codes zijn er landelijk
  (`81589NED`, met grootteklasse) of regionaal zonder grootteklasse (`81578NED`). Een tabel die niet zo is
  gecontroleerd zou `verified: null` krijgen en in de interface als "Niet geverifieerd" verschijnen; dat is nu bij
  geen enkele tabel het geval. Opnieuw controleren: `CBS_LIVE=1 npx vitest run tests/unit/cbs-live.test.ts`
- ✅ **Generieke client** (`lib/integrations/cbs.ts`, server-only): `fetchCbsMetadata` (dimensies, codes, perioden
  nieuwste eerst, toegestane onderwerpen; meldt `tabel_gewijzigd` als CBS de indeling verandert) en `fetchCbsCell`
  (één onderwerp, één code per dimensie, een periode of "meest recente periode met een waarde"; elke code wordt eerst
  tegen de codelijst gecontroleerd). Geen waarde (geheim, niet van toepassing) blijft `null` met de reden in gewone
  taal, nooit een getal. Letterlijke regel (`cbsCellLine`) met de titels zoals CBS ze levert; peildatum uit de periode
  (`2026JJ00` → 2026, of 2026-01-01 bij een stand op 1 januari). Alleen `datasets.cbs.nl` via `fetchPublic`
  (SSRF-veilig, time-out 10 s), één nieuwe poging bij een netwerkfout
- ✅ **Onderzoeksrunner**: de automatische stap (81589NED, bedrijven per passende branche en grootteklasse bij een
  omvangvraag met verwacht brontype officiële statistiek) loopt via de nieuwe client; tabelregel en gedrag zijn gelijk
  (bestaande fragmenten worden hergebruikt). Een gewijzigde tabel wordt apart gemeld. Bewaren van een officiële bron
  staat in `lib/official-source.ts` (gedeeld met "Haal uit CBS"; zoekt nu ook op brontype)
- ✅ **"Haal uit CBS" bij een factor** (`components/research/CbsFactorPicker.tsx`, `lib/cbs-factor.ts`,
  `app/app/ideas/[id]/research/data-actions.ts`): knop bij elke factor met een aantal of percentage (alleen voor het
  onderzoeksteam). Paneel (drawer, sluit met Escape): tabel kiezen (met "Gecontroleerd op …"), onderwerp in de eenheid
  van de factor, periode, regio (gegroepeerd en doorzoekbaar) en filters → "Toon waarde" met de letterlijke tabelregel →
  "Opslaan". De server haalt de waarde opnieuw op en maakt: bron (officiële statistiek, uitgever CBS, URL naar de
  StatLine-tabel), fragment = de tabelregel, bevinding via `insertClaimWithQuote` (dus `checkQuote` en
  `recomputeClaim`; `quote_check` exact → geverifieerd) met regio, peildatum, periode, eenheid en "bewijst niet", en
  zet de factor op de waarde met jaar en regio. Dezelfde regel opnieuw opslaan hergebruikt bron, fragment en
  bevinding. CBS onbereikbaar: eerlijke melding met "vul de waarde zelf in en koppel een bron onder Bronnen" en
  opnieuw proberen. Telt vanzelf als "officiële statistiek" in het dossierlabel (getest)
- ✅ **Sectorregisters** (`lib/domain/sector-register.ts` puur, `lib/sector-register-data.ts`,
  `components/research/SectorRegisterPanel.tsx`, sjabloon op `/app/ideas/[id]/research/sectorregister-sjabloon.csv`):
  - Sjabloon met de kolommen `uitgever, bron_url, peildatum, categorie, grootteklasse, regio, aantal` en optioneel
    `opmerking`; alleen kolomkoppen, bewust zonder voorbeeldregels (geen verzonnen aantallen). Uitleg per kolom in Grondig
  - Import: puntkomma, komma of tab; verplichte velden, hele getallen (1234 of 1.234), geldige http(s)-URL, peildatum
    (2025, 2025-06, 2025-06-30 of 30-06-2025, niet in de toekomst). Fouten per regel met het echte regelnummer, al in de
    browser vóór het uploaden; de server controleert opnieuw en importeert bij één fout niets. Per uitgever + bron +
    peildatum één bron (`dataset_upload`, niet primair) met elke regel als letterlijk fragment; dezelfde inhoud
    opnieuw importeren hergebruikt de bron
  - Origineel bijvoegen: bestand (PDF, DOCX, TXT, MD, CSV; uitgelezen zoals bij rapportimport) of "Haal bronpagina op"
    (SSRF-veilig). Per regel zoekt ProofLab een passage (één regel, of tot drie regels voor tabelcellen) waarin de
    categorie én het aantal letterlijk staan. Alleen die passages worden bewaard, als fragmenten van een tweede bron
    (`primary_document`, `is_primary`). Per regel "Teruggevonden" of "Nee"
  - Koppelen aan een factor (aantal): één regel die in het origineel is teruggevonden → bevinding op de passage uit het
    origineel (primair document → geverifieerd, telt als primaire bron). Zonder origineel of zonder teruggevonden
    aantal → bevinding op de registerregel als schatting van derden (status schatting, telt niet als officieel of
    primair). Meerdere regels → een uitdrukkelijk door ProofLab berekende optelling als fragment ("geen tekst van de
    uitgever") en een bevinding van het type aanname: altijd schatting. De regel staat in `registerClaimPlan` en is
    getest, ook in het dossierlabel
  - **Keuze opslag**: geen tabellen `registers`/`register_rows`, maar de bestaande bronnen en fragmenten. Redenen: de
    citaatcontrole, statusberekening, RLS, audit, verwijderen met het dossier en de bronnenlijst werken dan ongewijzigd;
    het origineel is een gewone primaire bron; er is geen migratie nodig, dus niets breekt zolang de live database
    achterloopt. De structuur zit in een vast, terug te lezen regelformaat (`registerLine`/`parseRegisterLine`), en een
    register herkent ProofLab aan een vaste markering in de toegangsnotitie. Een toekomstige API-koppeling (bijv. een
    bondsregister) roept `storeRegister(…, { origin: "api" })` aan met dezelfde regels. Nadeel: geen kolomfilters in de
    database; worden registers groot of gedeeld tussen dossiers, dan alsnog aparte tabellen
- ✅ **Tests**: `cbs-catalog` (catalogus, URL- en filterbouw, peildatum, eenheden, metadata en waarde op opgenomen
  API-antwoorden in `tests/unit/fixtures/cbs/` (2 × ~4,5 KB), onbekend/geheim, gewijzigde tabel, ongeldige code, nieuwe
  poging), `sector-register` (sjabloon, validatie per regel, regelnummers, fragment, de primair-regel),
  `databronnen-opslaan` (CBS opslaan → bron/fragment/bevinding gecontroleerd/factor, hergebruik, foutmeldingen;
  register zonder en met origineel, optelling, dossierlabel), bestaande `cbs` aangepast (metadata-controle), en
  `cbs-live` (alleen met `CBS_LIVE=1`, tegen de live API; op 5 november groen). Typecheck, lint, alle unittests en de
  DB-tests (eigen database `prooflab_fase2_data`) groen

**UI-teststappen** (dossier "AI-communicatie voor sportclubs", als lid van het onderzoeksteam):

1. Markt › Marktpotentieel, scenario Realistisch. Bij "Relevante organisaties in het gebied": **Haal uit CBS** → kies
   "Vestigingen van bedrijven; bedrijfstak, regio" (81578NED) → zoek bij Bedrijfstak "sport" en kies "931 Sport" (of
   "9312 Buitensport") → Regio "Nederland" → Periode "Meest recente periode met een waarde" → **Toon waarde**. Je ziet
   het aantal en de letterlijke tabelregel. **Opslaan** → de factor krijgt de waarde, jaar en regio, en de pil "Bron:
   Geverifieerd". Onder Bronnen staat "CBS StatLine 81578NED" (officiële statistiek) met de regel als fragment.
2. Nogmaals opslaan met dezelfde keuzes: geen tweede bron of bevinding ("hergebruikt").
3. Kies een combinatie zonder waarde (bijv. een oude periode bij een nieuwe gemeente): "Onbekend" met de reden van CBS.
4. Bij "Deel met het probleem en budget" toont "Haal uit CBS" alleen de regionale kerncijfers (percentages).
5. Sectorregister: **Download CSV-sjabloon**, vul twee regels in (bijv. aantallen clubs per sport van een bond, met
   echte bron-URL), importeer. Fout in een regel → melding met het regelnummer, niets geïmporteerd.
6. Zonder origineel: kies één regel, factor "Realistisch scenario: Relevante organisaties in het gebied", **Koppel aan
   factor** → bevinding "Schatting". Voeg het origineel toe (bestand of **Haal bronpagina op**) → per regel
   "Teruggevonden"; koppel die regel opnieuw → bevinding "Geverifieerd" op de passage uit het origineel. Twee regels
   kiezen → optelling, altijd "Schatting".
7. Het dossierlabel (Overzicht/Rapport) mist niet langer "een officiële statistiek of primaire bron" zodra een CBS- of
   bevestigde registerbevinding er is.

**Open punten**

- 🟡 Niet gedaan in deze omgeving: e2e (Playwright) en visuele controle op 1440/390 px met login (geen
  Supabase-toegang)
- CBS publiceert sinds 2026 ook tabellen naar SBI 2025 (bijv. `86280NED`, `86281NED`); de catalogus gebruikt nog SBI
  2008 omdat die reeksen langer en regionaal beschikbaar zijn. Overstappen zodra de SBI 2008-tabellen stoppen
- Een optelling van regels (CBS of register) telt nooit als gecontroleerd, omdat het totaal niet letterlijk in de bron
  staat; desgewenst later "som van gecontroleerde regels" als aparte, uitgelegde status
- Leeftijdsgroepen per gemeente komen uit `70072ned` (zes vaste groepen); een eigen leeftijdsband uit `03759ned` zou
  een optelling van losse jaren zijn en is daarom niet aangeboden
- Een register hoort bij één dossier; voor gedeelde of grote registers (of een API zoals een bondsregister) liever
  eigen tabellen met RLS en audit
- Geen caching van CBS-metadata; elke keuze van een tabel haalt de codelijsten opnieuw op (enkele honderden KB bij
  gemeenten en SBI-codes)

## Fase 2 · punt 4: Testen uitvoeren in ProofLab (5 november)

Een test uitvoeren zonder ProofLab te verlaten: testpagina uit de Test Card, links per kanaal, automatische
waarneming per persoon, betaalde intentie via Mollie, geverifieerde toezeggingen en afspraken uit Calendly/Cal.com,
met de beslisregel op die handelingen. Negen commits op branch `fase2-testen` en één migratie
`20261116090000_fase2_testen.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de test). Strengheid
blijft: vergrendelde criteria, berekende statussen, auditspoor; een AI-bewering telt nooit als klantbewijs.

- ✅ **Testpagina uit de Test Card** (`lib/domain/test-page-generator.ts`, `ExperimentBuilder`): knop "Maak testpagina uit
  de Test Card" vult kop (aanbod uit de intake, anders de belofte uit "Wij denken dat …"), ondertitel (doelgroep en
  reden), aanbod, knoptekst (volgt de succesmaat) en bij een prijstest prijspunten rond de intakeprijs (zonder
  intakeprijs leeg: nooit verzonnen). Deterministisch, zonder AI; alles aanpasbaar; de eerlijkheidscontrole kijkt mee
  en een lijst zegt waar elk deel vandaan komt
- ✅ **Linkbouwer** (`ChannelLinkBuilder`): vanaf goedkeuring per kanaal een kant-en-klare link met `utm_source`,
  optioneel een berichtcode (`utm_content`, zelfde schoonmaakregel als de meting) en een kopieerknop
- ✅ **Automatische waarneming per persoon** (`lib/domain/action-counts.ts`, `lib/action-counts-data.ts`,
  `experiment_action_counts`): unieke bezoekers, klikkers, aanmelders, betalers (live), toezeggers en bookers. De
  systeemwaarneming bij de Learning Card heet expliciet "Waargenomen handeling" (`observations.evidence_type =
  observed_action`), of "Geverifieerde betaling"/"Geverifieerde toezegging", en noemt de telling per persoon in de
  toelichting; de Learning Card bewaart `per_person` en `success_metric`. Testpagina: kaart "Per persoon geteld";
  Bewijs & besluit: pil met het soort bewijs. Eén persoonssleutel = HMAC(TRACKING_SALT, genormaliseerd e-mailadres)
  (zelfde als `emailHash`, dus vindbaar via een privacyverzoek), voor anonieme bezoekers de bezoekerscode
- ✅ **Mollie** (`lib/integrations/mollie.ts`, `mollie-flow.ts`, `mollie-server.ts`, `app/api/t/[slug]/pay`,
  `app/api/webhooks/mollie/[slug]`, `payment-actions.ts`, `DepositsPanel`, `MollieSettings`): optionele stap per test
  (standaard uit) "Reserveer met een terugbetaalbare aanbetaling van €X" met verplichte eerlijke tekst (product bestaat
  nog niet, volledige terugbetaling). Server maakt de betaling (API v2, bedrag uit de goedgekeurde configuratie, alleen
  na een klik, niet als dezelfde persoon al betaalde), redirect terug naar de testpagina, webhook met alleen het id:
  de server haalt de status zelf op met de sleutel van die werkruimte. Live + paid = Geverifieerde betaling (trede
  Betaling); terugbetaald/teruggeboekt telt niet meer en blijft zo; testmodus telt nooit. "Terugbetalen", "Alles
  terugbetalen", "Status bij Mollie verversen"; coachregel `deposits_refund` na een besluit. Sleutel per werkruimte door
  een eigenaar op `/app/status`, versleuteld met AES-256-GCM (`lib/domain/secret-box.ts`), nooit terug naar de client
  (alleen "eindigt op …" en test/live). Per betaling alleen Mollie-id, bedrag, valuta, status, modus,
  persoonssleutel en tijden
- ✅ **Geverifieerde toezegging** (`lib/domain/commitments.ts`, `commitment-actions.ts`, `CommitmentsPanel`, `/c/[token]`,
  `app/api/c/[token]`): (a) upload van een getekende intentieverklaring (pdf/png/jpeg/webp, type gecontroleerd aan de
  inhoud, tot 4 MB) met organisatie en ondertekenaar in de privé bucket `commitment-documents` (alleen het team);
  (b) persoonlijke link met eenmalige code (14 dagen) waar iemand naam, organisatie, getypte naam en vinkje invult; de
  database legt tijdstip en gehashte IP vast. Zonder document of akkoord geen telling (database-check
  `test_commitments_proof`); intrekken kan, verder ligt een toezegging vast
- ✅ **Afspraken** (`lib/integrations/bookings.ts`, `app/api/webhooks/bookings/[provider]/[token]`, `booking-actions.ts`,
  `BookingsPanel`): per test een webhookadres met eigen geheime sleutel voor Calendly én Cal.com (één adapter-interface,
  twee implementaties). Handtekening (Calendly `t=..,v1=..` over `t.body`; Cal.com `X-Cal-Signature-256` over de body)
  en een tijdsvenster van 5 minuten tegen replay. Geboekt = Waargenomen handeling in `test_bookings` (schema zoals
  punt 5 het leest); geannuleerd telt niet en een afgespeelde boeking maakt een annulering niet ongedaan
- ✅ **Beslisregels** (`lib/domain/success-metric.ts`, `test-card.ts`, `experiment-metrics.ts`): de Test Card kiest de
  succesmaat (aanmelding, betaling, toezegging, afspraak; `hypotheses.success_metric`, vergrendeld via
  `guard_hypothesis_lock`). Kansregel met unieke betalers/toezeggers/bookers als successen en unieke bezoekers als n;
  vast aantal ("3 betaalde aanbetalingen") nu ook bij betaling, toezegging en afspraak. Betaling als succesmaat vraagt
  de betaalstap; bewijsniveau en de controle op prijsaannames volgen de succesmaat
- ✅ **Privacy** (`lib/domain/test-privacy.ts`): AVG-tekst onderaan de testpagina met naam en contact van de
  verwerkingsverantwoordelijke; een nieuwe landing-/prijstest gaat pas live als die zijn ingevuld (scherm, server en
  database-trigger `guard_experiment_go_live`); bestaande tests zonder privacyblok en hervatten na een pauze blijven
  werken. Nieuwe aanmeldingen 12 maanden (`consentText`, default `retention_until`; bestaande rijen ongewijzigd).
  `purge_expired_personal_data` wist toezeggingsnamen, getypte naam en gehashte IP en vervangt de persoonssleutel
  van betalingen en afspraken; `dsr_search` vindt betalingen, afspraken en toezeggingen; `audit_row` bewaart
  persoonssleutels, namen, codes en paden alleen als md5. Losse `test_events` niet in het auditspoor
- **Migratie** `20261116090000_fase2_testen.sql`: `hypotheses.success_metric`, `observations.evidence_type` (alleen
  systeem), `org_payment_settings` (geen policies), `test_payments`, `test_commitments` (+ bucket), `test_booking_hooks`,
  `test_bookings`, RPC's met de ingest-sleutel (`deposit_checkout`, `register_test_payment`, `mollie_webhook_lookup`,
  `record_mollie_status`, `get_commitment_invite`, `sign_commitment`, `record_test_booking`), `experiment_action_counts`,
  `mark_refund_requested`, nieuwe versies van `guard_hypothesis_lock`, `purge_expired_personal_data`, `dsr_search`,
  `audit_row` (laatste versies letterlijk overgenomen). RLS op alle nieuwe tabellen; triggerfuncties zonder execute.
  **Terugval zonder migratie**: de app werkt zoals voorheen (zie docs/OPERATIONS.md §14)
- **Env vars**: `SECRETS_ENCRYPTION_KEY` (32 bytes base64), `MOLLIE_ENABLED=1` (in `.env.example`). Instellen van
  Mollie, Calendly en Cal.com: `docs/OPERATIONS.md` §14
- ✅ **Tests**: unit `tests/unit/fase2-testen.test.ts` (33 tests: versleuteling, Mollie-status, webhook met onbekend id
  telt niets, vervalste webhook verandert niets, terugbetaald blijft terugbetaald, testmodus, handtekeningen
  Calendly/Cal.com geldig/vervalst/oud, geannuleerde afspraak, per persoon tellen, beslisregel met betalingen (kansregel
  en vast aantal), generator, linkbouwer, privacy, toezeggingen, coach); DB `tests/db/fase2-testen.test.ts` (10 tests:
  idempotent, privacy- en betaalstapcontrole bij live gaan, 12 maanden, sleutel alleen eigenaar en nooit leesbaar,
  dubbele betaling zelfde persoon telt één keer, testmodus/terugbetaald/onbekend id, afspraken met annulering en
  replay, toezeggingen met document/akkoord/eenmalige link, opschoning, vergrendelde succesmaat, evidence_type alleen
  systeem). `tsc`, lint, alle unit-tests en alle 25 DB-testbestanden groen
- **UI-teststappen** (dossier "AI-communicatie voor sportclubs", na de migratie en met testsleutel van Mollie):
  1. `/app/status` als eigenaar: Mollie-testsleutel plakken → "Verbonden · testmodus", "eindigt op …"
  2. Testen → nieuwe Test Card, landingpage-test: "Wat telt als succes?" → Betalde aanbetaling; beslisregel Vast aantal,
     3 van 40; onder Details de betaalstap (€ 10) en verwerkingsverantwoordelijke + contact; "Maak testpagina uit de
     Test Card" en controleer de voorstellen; opslaan, ter review, goedkeuren, publiceren
  3. Linkbouwer: berichtcode `post-1`, kopieer de LinkedIn-link, open hem in een privévenster, klik op de knop, vul een
     e-mailadres in, betaal in de Mollie-testomgeving → terug op de testpagina "Dank je wel"
  4. Testpagina: "Per persoon geteld" en "Aanbetalingen" (pil Testmodus; telt niet als bewijs). Lokaal: "Status bij
     Mollie verversen". "Terugbetalen" → status Terugbetaald
  5. Toezeggingen: upload een pdf met organisatie/naam/e-mail; maak een persoonlijke link en geef akkoord via `/c/…`;
     dezelfde e-mail twee keer telt één keer; "Intrekken" haalt hem uit de telling
  6. Afspraken: maak een Cal.com-webhook, zet adres en sleutel in Cal.com, boek en annuleer een afspraak
  7. Rond af, maak de Learning Card: de waarneming heet "Geverifieerde betaling" (of "Waargenomen handeling") met de
     telling per persoon; leg een besluit vast → coach "aanbetalingen nog niet terugbetaald" tot "Alles terugbetalen"
- 🟡 **Open punten**: e2e (Playwright) en visuele controle op 1440/390 px niet gedaan (geen Supabase-toegang); echte
  Mollie-, Calendly- en Cal.com-aanroepen niet getest (alleen met nep-fetch en nep-handtekeningen). Het bestand van een
  verlopen toezegging verwijdert het team met een knop (Postgres kan Storage-bestanden niet verwijderen). Bij betaling,
  toezegging en afspraak telt ProofLab per kanaal alleen het bezoek (de handelingen zijn per persoon geteld, niet per
  kanaal). Afspraken komen niet via de testpagina binnen: n blijft de unieke bezoekers van de pagina, ook als iemand
  rechtstreeks via de Calendly-link boekt. De afspraakwebhooks hangen aan `TRACKING_SALT` (bij rotatie opnieuw maken).
  Migratie nog toepassen

## Propositie- en businessmodelcanvas (7 november)

Het businessmodel als verzameling aannames, niet als invulformulier (ontwerp §6.1, §11 `/model`, §13.4
`business_models`, §14 "niet sturen op vulling van canvas"). Tabblad **Businessmodel** onder stap 2 Aannames
(`/app/ideas/[id]/model`). Elk onderdeel toont de bewijsstand van de gekoppelde aanname, zodat zichtbaar is welke delen
van het model getoetst, onderbouwd met bronnen of nog geloof zijn. Zeven commits en één migratie
`20261118110000_canvas.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de test).

- ✅ **Twee canvassen per idee** (`lib/domain/canvas.ts`, `components/canvas/CanvasBoard.tsx`, `canvas.css`):
  businessmodel (negen bouwstenen: klantsegmenten, waardepropositie, kanalen, klantrelaties, inkomstenstromen,
  kernactiviteiten, kernmiddelen, kernpartners, kostenstructuur) en waardepropositie (klantprofiel: klanttaken, pijnen,
  winsten; waardekaart: producten & diensten, pijnverzachters, winstmakers). Eigen vormgeving op de ProofLab-tokens,
  geen merk of vormen van derden. Toggle **Canvas | Simpele weergave** (lijst per bouwsteen met de vraag in gewone taal:
  Voor wie? Waar verdienen we aan? Wat kost het?). Opbouw via container queries: tien kolommen in de hoofdkolom,
  twee bij middelbreed, één kolom op mobiel. Een lege bouwsteen staat er als "Nog leeg: onbekend"
- ✅ **Onderdelen**: toevoegen per bouwsteen (Escape sluit het formulier), en per onderdeel een detailpaneel (Drawer:
  focus erin, Escape sluit, focus terug) met tekst bewerken, volgorde omhoog/omlaag (knoppen, toetsenbord), koppelen aan
  een bestaande aanname of ontkoppelen, **Maak aanname** (één klik, komt op de aannamekaart met soort volgens de
  bouwsteen: wenselijkheid, haalbaarheid of levensvatbaarheid), en verwijderen in twee stappen. Herkomst per onderdeel:
  eigen invoer, uit de intake, uit het onderzoek of AI-voorstel
- ✅ **Bewijsstand per onderdeel** (`itemStanding`): open AI-voorstel → niet gekoppeld (nog geloof) → uitslag van de
  hoofdtest (getoetst · ondersteund/weerlegd/onbeslist) → klantbewijs op de bewijsschaal (getoetst · klantbewijs) →
  meetellende bevindingen uit bureauonderzoek (onderbouwd met bronnen) → nog geloof. Zelfde register als de
  aannamekaart (`loadAssumptions`); AI-codering voor half gewicht telt niet voor de trede. Tegenbewijs staat in de
  toelichting. Kleur én tekst; de samenvatting telt per groep, bewust zonder vullingspercentage. Bronnen en claims zijn
  via de aanname te zien (link naar de aannamekaart met de aanname geselecteerd)
- ✅ **Overnemen uit intake en onderzoek** (`draftsFromSources`, zonder AI): doelgroep, beschrijving en prijs uit de
  intake; segmenten met taak en pijn; klantsignalen (taak, pijn, winst; bezwaren niet). Elk onderdeel draagt zijn bron
  (`source_ref`, uniek per idee), dus opnieuw overnemen voegt niets dubbel toe
- ✅ **AI-voorstel** "Laat de coach een eerste opzet maken" (`lib/ai/canvas.ts`, via `runAi` met maandbudget en
  grootboek, purpose `canvas_draft`): onderdelen komen als AI-voorstel binnen, gelabeld en gestippeld tot een consultant
  ze accepteert. Een open voorstel telt nergens mee, kan niet aan een aanname hangen (database-check) en is voor de
  opdrachtgever onzichtbaar (RLS). Zonder sleutel: knop uit met "AI niet verbonden · alles werkt handmatig"
- ✅ **Versies**: "Versie opslaan" met notitie; de database stelt de momentopname zelf samen (`save_canvas_version`:
  onderdelen met gekoppelde aanname en haar status, doorlopend nummer, auteur en tijd) en houdt hem onveranderlijk
  (trigger; alleen het wissen van een verwijderd account en het verwijderen van het hele idee mogen). Vergelijken van
  twee versies of een versie met de huidige stand (`diffVersions`): toegevoegd, verwijderd en gewijzigd per bouwsteen
  (tekst, verplaatst, koppeling, status van de aanname, acceptatie); alleen een andere volgorde telt niet
- ✅ **Coach**: eigen schermtekst en suggesties voor `/model`; coachregel `canvas_after_decision` na een besluit om bij te
  sturen zolang er geen canvasversie na het besluit is opgeslagen (sluit vanzelf daarna)
- ✅ **Rapport**: rapportversies leggen het canvas vast (`snapshot.canvas`, zonder open AI-voorstellen, alleen hun
  aantal) met de bewijsstand per onderdeel: sectie "06b / Businessmodel en propositie" op de rapportpagina en een
  compacte tabel onder hoofdstuk 06 in de PDF. Oudere rapporten hebben het veld niet en tonen niets
- ✅ **Opdrachtgevers** zien het tabblad alleen-lezen (geen bewerkknoppen, geen open AI-voorstellen, wel versies en
  vergelijken)
- **Migratie** `20261118110000_canvas.sql`: `canvas_items` (canvas, bouwsteen, tekst 1–500, positie, herkomst,
  `source_ref`, acceptatie, aanname; trigger `guard_canvas_item` zet maker/tijden, houdt herkomst en canvas vast,
  accepteert één keer en alleen AI, controleert dat de aanname bij hetzelfde idee hoort), `canvas_versions`
  (onveranderlijk via `guard_canvas_version`, geen insert-/update-/delete-rechten; alleen `save_canvas_version`). RLS met
  `can_read_idea`/`can_write_idea`, index op elke FK, `audit_row` op beide tabellen. Geen bestaande functies gewijzigd.
  **Terugval zonder migratie**: de pagina zegt dat het canvas nog niet beschikbaar is; rapport en coach slaan het over
- ✅ **Tests**: unit `tests/unit/canvas.test.ts` (bouwstenen, validatie, volgorde, bewijsstand, samenvatting, overnemen,
  versievergelijking, rapport en PDF, coachregel, plaats in het menu) en `tests/unit/canvas-ui.test.ts` (weergave
  businessmodel, waardepropositie, simpele weergave, alleen-lezen, rapportsectie); DB `tests/db/canvas.test.ts`
  (10 tests: idempotent, maker door de database, opdrachtgever leest maar schrijft niet, cross-tenant lezen/schrijven,
  aanname van een ander idee, unieke bron, AI-voorstel en acceptatie, open voorstel onzichtbaar voor opdrachtgever,
  versies nummeren en vastleggen, onveranderlijk ook voor de databasebeheerder, verwijderd account en idee, audit).
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` en alle 27 DB-testbestanden groen
- 🟡 **Open punten**: geen e2e (Playwright) en geen visuele controle in de draaiende app (geen Supabase-toegang); de
  opmaak is alleen als statische weergave op 880 en 390 px bekeken. Eén canvas per idee: varianten per propositie of
  doelgroep (ontwerp §6.1) nog niet. Volgorde verschuift met knoppen, niet met slepen. De echte AI-aanroep is niet
  getest (alleen de route zonder sleutel). Migratie nog toepassen

## Experimentencatalogus en begeleide handmatige sjablonen (7 november)

Functioneel ontwerp §7 ("eigen beschreven catalogus"). Een catalogus van 41 testmethodes, volledig in eigen woorden
(geen teksten, indelingen of beoordelingen uit andere methodeboeken), met begeleide handmatige sjablonen voor methodes
zonder ingebouwde automatisering. Zes commits ("Experimentencatalogus 1/5 … 5/5" en de standaardwaarden) en één
migratie `20261118100000_experiment_catalog.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de test;
geen bestaande functie gewijzigd). Strengheid blijft: vergrendelde drempels en draaiboek, geen oordeel vóór de
eindconditie, auditspoor; handmatig ingevoerd is nooit sterker dan een kleine handeling.

- ✅ **Catalogus als getypeerde data** (`lib/domain/experiment-catalog.ts`): per methode id, naam, omschrijving, categorie
  (verkennen/valideren), wat het toetst (wenselijkheid, haalbaarheid, levensvatbaarheid), kosten- en tijdsindicatie,
  typische steekproef, B2B/B2C, wat het wel en niet bewijst, valkuilen, draaiboek (vooraf, tijdens, afronden),
  startwaarden voor de Test Card en hoe het in ProofLab draait: 14 als ingebouwd testtype (interviews, enquête,
  landing- en prijstest, ook met afspraak, toezegging of aanbetaling), 20 als begeleid handmatig sjabloon
  (bijv. veldobservatie, dagboekstudie, conciërgetest, achter-de-schermentest, pop-upstand, aanbodgesprek,
  outreach-proef, partnerproef, kleine pilot) en 7 als bureauonderzoek (vastleggen als bron onder Marktverkenning)
- ✅ **Bewijssterkte afgeleid, nooit opgegeven**: per methode alleen de soort waarneming; trede, zeg- of doe-gedrag en
  factor volgen uit de bestaande bewijsladder (`evidence-scale.ts`, `KIND_LEVEL`, `KIND_DEFAULTS`, `OBSERVATION_LR`).
  Een ingebouwde methode heeft precies het niveau van haar testtype (`testEvidenceLevel`); een handmatig sjabloon komt
  hooguit tot een kleine handeling (`lib/domain/manual-kind.ts`, ook als databasecheck). Betaling en getekende
  toezegging tellen alleen via de bestaande betaal- en toezeggingsstap
- ✅ **Cataloguspagina** `/app/ideas/[id]/experiments/catalogus`: zoeken (zonder accenten, alle woorden), filters op
  categorie, wat het toetst, bewijssterkte, uitvoering (ingebouwd/handmatig/bureauonderzoek), kosten, tijd en markt;
  detailpaneel per methode (bestaande `Drawer`: focus erin, Escape sluit), "Gebruik voor deze aanname" → Test Card met
  het sjabloon. Vanuit een aanname opent de catalogus met de passende lens. Lege, laad- en foutstatus; één kolom op
  mobiel, knoppen ≥ 44 px
- ✅ **Sjabloon → Test Card** (`ExperimentBuilder`, `createExperiment`): de methode staat als "Uit de catalogus" tussen de
  voorstellen (één keuze per testtype, `optionsWithCatalog`) en vult naam, meting (teller/noemer), drempels,
  steekproef, deadline, vertekeningen en zo nodig de succesmaat voor. Alles blijft aanpasbaar tot de goedkeuring; de
  bestaande drempelvergrendeling, beslisregel en goedkeuring gelden ongewijzigd. Ongewijzigde startwaarden staan bij
  "Standaardwaarden van ProofLab" en in het auditspoor. Een handmatig sjabloon toont het draaiboek in de preview, met
  eigen aanvullingen; de server stelt de configuratie op uit de catalogus (`manualConfigFor`), nooit uit het formulier
- ✅ **Handmatige resultaten** (testtype `manual`, `manual_results`, `ManualResultsPanel`, `manual-actions.ts`): per
  waarneming of telling een datum, aantal, hoeveel meetellen, een notitie zonder namen of contactgegevens en optioneel
  een bewijsbestand (pdf, png, jpg, webp, csv tot 4 MB; type gecontroleerd aan de inhoud; privé bucket
  `manual-evidence`, alleen het team). Alleen invoeren terwijl de test loopt, met een datum tussen de start en vandaag;
  intrekken met reden; na afronden ligt alles vast; niets wordt verwijderd. n en successen zijn de som van de
  niet-ingetrokken regels; het oordeel volgt de bestaande beslisregel van de methodeversie pas na de eindconditie
  (`experimentMetrics`, `manualOutcome`). De Learning Card krijgt de soort waarneming van de methode, de samenvatting
  begint met "Handmatig ingevoerd (methode)" en `metrics.manual_entry` met het aantal regels
- ✅ **Rapport en bewijs**: rapport (scherm en PDF-model), "Alle tests", tellingen en Bewijs & besluit noemen bij een
  handmatige test de catalogusmethode en "handmatig ingevoerd"; de beperkingen in het rapport vermelden het. Ingebouwde
  tests uit de catalogus noemen de methode ("Landingpage-test · Nepdeur-pagina")
- ✅ **Aanbeveler gekoppeld** zonder gedragswijziging: bij "Wat test je eerst?" staat per voorgestelde test de
  bijbehorende catalogusmethode (`catalogMethodForTest`; prijsaanname → uitgaveninterviews, kanaalproef →
  outreach-proef, technische proef en juridische check → bureauonderzoek). Rangorde, factoren en bestaande tests
  ongewijzigd; rekenfactoren per testtype gelden alleen voor ingebouwde types (`BuiltinExperimentType`)
- **Migratie** `20261118100000_experiment_catalog.sql`: `experiments_type_check` met `manual`; check
  `experiments_manual_catalog` (catalogusmethode en soort waarneming verplicht bij `manual`); tabel `manual_results` met
  RLS (lezen: iedereen die het dossier leest; toevoegen/intrekken: het team; verwijderen: niemand), index op elke FK,
  `guard_manual_result`, `check_idea_refs` en `audit_row`; bucket `manual-evidence` met policies. **Terugval zonder
  migratie**: catalogus en ingebouwde methodes werken; een handmatig sjabloon toont een nette melding en wordt niet
  opgeslagen (geen half concept)
- ✅ **Tests**: unit `tests/unit/experiment-catalog.test.ts` (elke methode volledig, unieke ids en namen, bewijssterkte
  binnen de ladder, eigen woorden, zoeken en filters, elk sjabloon is een geldige Test Card, standaardwaarden,
  handmatige configuratie, aanbeveler) en `tests/unit/manual-results.test.ts` (invoer, bestandstype, telling,
  samenvatting, oordeel pas na de eindconditie met de vergrendelde drempels); DB `tests/db/experiment-catalog.test.ts`
  (idempotent, type- en configuratiecheck, vergrendelde configuratie, invoer alleen tijdens de test, datumgrenzen,
  intrekken, niet verwijderen, RLS team/opdrachtgever/buitenstaander, bewijsbestand en bucket, audit). `npm run lint`,
  `npm run typecheck`, `npm test` (1.499 tests), `npm run build` en alle 27 DB-testbestanden groen
- 🟡 **Open punten**: visuele controle van cataloguspagina, Test Card met sjabloon en invoerpaneel op 1440/390 px en een
  e2e-run niet gedaan (geen Supabase-toegang in deze omgeving). Bewijsbestanden en notities van handmatige resultaten
  vallen nog niet onder `purge_expired_personal_data` en `dsr_search` (notities zijn zonder namen; bestanden alleen
  voor het team); opnemen bij de volgende privacyronde. De coach kent de catalogus nog niet (geen eigen tips). Migratie
  nog toepassen

## AI-gemodereerde interviews (7 november)

Een respondent voert via een publieke link een chatgesprek met een AI-interviewer, volgens de goedgekeurde leidraad van
een interviewtest (ontwerpregels: `ProofLab_Analyse_en_Verbeteringen_v1.1` §"AI-gemodereerd tekstinterview"; apart
gelabeld en gescoord: `ProofLab_Voorspelkracht_v1` 7.4). Zeven commits en één migratie
`20261118090000_ai_interviews.sql` (**nog niet toegepast**; idempotent, twee keer uitgevoerd in de test; zonder de
migratie werkt de app zoals voorheen: de opzet meldt dat de database moet worden bijgewerkt, de publieke link geeft 404).

- ✅ **Opzet door de consultant** (`components/experiments/AiInterviewPanel.tsx`, `ai-interview-actions.ts`): bij een
  interviewtest "AI-interviewer (tekstchat)". Leidraad = de interviewvragen van de Test Card (3–12). De leidraadcontrole
  moet slagen: geen hypothetische, sturende of verkopende vragen en geen vragen naar bijzondere persoonsgegevens
  (`checkGuide`, zelfde regels als `interview-audit.ts`). Instellingen: max. antwoorden (4–40), max. duur (5–45 min),
  doorvragen per onderwerp (0–2), introductie, opdrachtgever bij naam of "een onderzoeksbureau", privacycontact,
  bewaartermijn (1–12 maanden), tot drie screenervragen (rol/segment/anders; "+" = doelgroep, rol tussen haakjes).
  Expliciet goedkeuren (twee vinkjes) kan pas na de goedgekeurde Test Card; daarna ligt alles vast behalve pauzeren
  (database: `guard_ai_interview_config`; de leidraad moet gelijk zijn aan die van de Test Card). Intrekken kan zolang
  er geen gesprekken zijn. Daarna: publieke link met kopieerknop en de linkbouwer per kanaal (`utm_source`)
- ✅ **Publieke chatpagina** `/i/<slug>` (`app/i/[slug]`, `app/api/i/[slug]`, `lib/ai-interview-public.ts`): cookieloos,
  merkneutraal, mobiel eerst. Vooraf: een AI voert het gesprek (AI-verordening art. 50), opdrachtgever, doel, duur,
  bewaartermijn, stoppen mag altijd, geen gevoelige gegevens delen, privacycontact. Toestemming verplicht en vastgelegd
  (tekst en tijd). Screener vooraf: buiten de doelgroep = bedankt, geen gesprek, telt niet mee (welke opties
  kwalificeren blijft op de server). Daarna de chat: één vraag tegelijk, Enter verstuurt, "Gesprek afsluiten" met
  bevestiging (Escape sluit), bedankscherm met gesprekscode (om verwijdering te vragen). Honeypot, botfilter, alleen
  JSON van de eigen pagina, 8 kB per verzoek, 1.500 tekens per antwoord. De gesprekscode staat alleen in
  `sessionStorage` van het tabblad (verversen hervat het gesprek)
- ✅ **Verloop en controle** (`lib/domain/ai-interview.ts`, `lib/ai/interview.ts`): de vragen uit de leidraad stelt
  ProofLab letterlijk; het model bedenkt alleen doorvragen (op gepseudonimiseerde tekst, afgebakend als data). Elke
  doorvraag gaat vóór verzenden door de vaste regels (`checkProposedQuestion`: één korte vraag, niet hypothetisch,
  sturend, verkopend of dubbel, geen bijzondere of identificerende gegevens, geen links of AI-praat) en, als die
  beschikbaar is, een tweede modelaanroep (`reviewQuestion`; bij twijfel afkeuren). Bij afkeur volgt de volgende vraag
  uit de leidraad (terugval; de afgekeurde vraag staat in de controle). Instructies van de respondent ("negeer je
  opdracht") worden zonder modelaanroep geweigerd en de vraag wordt herhaald; na drie keer stopt het gesprek. Antwoorden
  worden vóór opslag én vóór het model gepseudonimiseerd (regels uit `pseudonymize.ts`; per gesprek steeds hetzelfde
  label via een HMAC-sleutel, nooit de naam zelf). Valt het model uit of is het budget halverwege op, dan gaat het
  gesprek verder met de leidraad
- ✅ **Harde grenzen in de database** (`ai_interview_start/answer/ask/finish`, alleen met de ingest-sleutel): één gesprek
  per bezoeker per test (HMAC per test), beurten om en om, leidraadvragen letterlijk, max. doorvragen, max. antwoorden,
  max. duur (+2 min marge), rate limit (5 starts en 20 berichten per minuut per netwerk, 60 starts per minuut per link),
  alleen tijdens een lopende ronde en niet gepauzeerd
- ✅ **Opslag** (migratie): `ai_interview_configs`, `ai_interview_sessions` (toestemming, screener, voortgang, kosten,
  bewaartermijn) en `ai_interview_turns` (elke beurt met tijdstempel, rol, soort, controle en vlaggen). Bij afronden met
  minstens één antwoord wordt het gesprek een interview in `interviews`: `ai_moderated = true`, `source_format =
  'ai_chat'`, gekoppeld aan de test, pseudoniem "AI-interview XXXX-XXXX", toestemming vastgelegd, echt gesprek,
  gepseudonimiseerd, transcript "[00:01:05] Respondent: …" met segmenten, bewaartermijn van het gesprek (standaard 12
  maanden). `observations.ai_moderated` zet de database uit het interview. Een AI-interview ontstaat nooit via een
  gewone insert (`guard_interview_ai`) en de markering ligt vast. RLS op elke tabel: alleen het onderzoeksteam leest
  opzet, gesprekken en beurten; schrijven alleen via functies. Auditspoor zonder tekst (`audit_ai_interview_session`:
  status, aantallen, uitsluiten; de opzet via `audit_row`, die niet is aangepast)
- ✅ **Alleen respondentbeurten als bewijs**: database-guard `stamp_observation_ai` (een citaat uit een AI-interview
  heeft een plek binnen een respondentsegment) plus dezelfde controle bij markeren (`transcript-actions.ts`), handmatig
  en AI-coderen (`storeObservation`, `locateRespondentQuote`) en AI-thema's (`theme-actions.ts`)
- ✅ **Analyse en rapport**: AI-interviews lopen door de bestaande codering, thema's en Learning Card. Label
  "AI-gemodereerd" op de interviewkaarten, de transcriptpagina, de dossierpagina Interviews (bron "AI-gemodereerd
  chatinterview") en bij observaties op Bewijs & besluit; de transcriptcontrole leest "AI-interviewer:" als
  interviewer. Metingen: `byModeration` (n en successen AI apart van mens) met een waarschuwing die ook op de Learning
  Card komt. Rapport: kolom "Waarvan AI-gemodereerd" in de momentopname (`report-counts.ts`, ook in het totaal), een zin
  in de managementsamenvatting (web en PDF: aantal interviews en waarnemingen, steunend/tegensprekend) en
  "AI-gemodereerd klantgesprek" in het beslisblad
- ✅ **Gesprekken voor de consultant**: lijst per test met status (bezig, afgerond, gescreend uit, afgebroken,
  uitgesloten), antwoorden, rol, kanaal, geweigerde instructies, afgekeurde doorvragen en kosten; transcript per gesprek
  (`/experiments/<test>/ai-interviews/<gesprek>`) met tijd, rol, soort beurt en controle; uitsluiten met reden (het
  interview en zijn waarnemingen verdwijnen uit alle tellingen; niet meer na een besluit), weer opnemen (ook een
  afgebroken gesprek), verwijderen op verzoek met de gesprekscode
- ✅ **Zonder AI-sleutel of bij bereikt budget**: de consultant ziet "AI niet verbonden" (of "budget bereikt") met het
  handmatige alternatief (zelf interviewen en het transcript importeren); de publieke pagina toont "Dit gesprek is nu
  niet beschikbaar". Kosten per gesprek via `ai_interview_log_run` in `ai_runs` (doel `ai_interview_probe` /
  `ai_interview_check`, zonder tekst) en dus in het maandbudget van de organisatie (`org_ai_spend`)
- ✅ **Privacy**: de opschoning (`purge_expired_personal_data`, laatste versie overgenomen) wist na de bewaartermijn de
  tekst van elke beurt, de afgekeurde doorvragen en de naamsleutels, en zet gesprekken zonder activiteit na een uur op
  afgebroken; het interview volgt de bestaande regel. `dsr_search` (laatste versie overgenomen) vindt gesprekken waarin
  een adres letterlijk getypt is; het privacyscherm legt uit dat verwijderen via de gesprekscode gaat
- ✅ **Tests**: unit `tests/unit/ai-interview.test.ts` (43: screener, instellingen en melding vooraf, leidraadcontrole,
  vraagcontrole, injectie, gevoelige gegevens, verloop en grenzen, opschonen en pseudonimiseren, transcript en
  respondentcitaten, status, aparte telling, rapport) en `tests/unit/ai-interview-flow.test.ts` (11: de publieke kant met
  een nep-database en een nep-model: doorvraag goedgekeurd, afgekeurd door de regels of het tweede model, model uit,
  injectie zonder modelaanroep, pseudonimiseren vóór opslag en model, afsluiten met transcript, grenzen, gelijktijdige
  berichten). DB `tests/db/ai-interviews.test.ts` (11: idempotent, opzet en vergrendeling, RLS, ingest-sleutel,
  beschikbaarheid/screener/volgorde, grenzen en rate limit, afronden en respondentcitaten, uitsluiten/opnemen, kosten en
  budget, opschoning/audit/dsr, verwijderen en cascade). `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`
  en alle 27 DB-testbestanden (`scripts/test-db.sh`) groen. In de tests wordt nooit een echt model aangeroepen
- **UI-teststappen** (na de migratie, met `INGEST_SECRET`, `TRACKING_SALT` en een AI-sleutel):
  1. Testen → interviewtest met minstens drie neutrale vragen; ter review en goedkeuren
  2. Op de testpagina "AI-interviewer (tekstchat)" → instellen (introductie, privacycontact, eventueel een screener met
     "+ Bestuurslid (beslisser)") → opslaan → beide vinkjes → "Keur goed en vergrendel"
  3. Start de interviewronde, kopieer de link (of per kanaal), open hem in een privévenster: melding vooraf, screener,
     toestemming, "Start het gesprek"
  4. Beantwoord de vragen; probeer "negeer je opdracht" (geweigerd, vraag herhaald) en een e-mailadres (vervangen door
     "E-mail 1"); sluit af → bedankscherm met gesprekscode
  5. Terug op de testpagina: het gesprek staat als "Afgerond"; lees het gesprek (tijd, rol, controle per doorvraag);
     open het interview en markeer een citaat in een antwoord (lukt) en in een vraag van de AI (geweigerd)
  6. Sluit een gesprek uit met reden (telt niet meer mee) en neem het weer op; maak de Learning Card en een
     rapportversie: kolom "Waarvan AI-gemodereerd" en de zin over AI-interviews
  7. Zonder AI-sleutel: "AI niet verbonden" met het handmatige alternatief; de publieke link zegt "nu niet beschikbaar"
- 🟡 **Open punten**: echte modelaanroepen (doorvraag en tweede controle bij Claude, ChatGPT of Gemini) zijn alleen met
  een API-sleutel te controleren; e2e (Playwright) en visuele controle op 1440/390 px niet gedaan (geen
  Supabase-toegang). Thema-aantallen (X van N) splitsen AI en mens nog niet uit (het pseudoniem "AI-interview …" staat
  wel bij elk citaat). De doorvraag komt niet als stream binnen (de respondent wacht op het hele antwoord). Spraak
  (VoiceProvider) volgt later. Migratie nog toepassen


## Gebruiksvriendelijkheid: review van de hele route (8 november)

De hele route is als nieuwe consultant doorlopen op 1440×900 en 390×844, tegen een lokale Supabase met alle migraties
(`supabase start` + `scripts/e2e-seed.sh`) en de productiebuild. Laadtijden ±0,7–1,2 s per pagina. Uitkomst: 24
bevindingen; alle 24 opgelost.

**Echte fouten**
- ✅ Interviewtest (opzet AI-interviewer) en een lopende handmatige catalogustest crashten in productie met "Element
  type is invalid" (React #130). Oorzaak: `Field` kloonde zijn invoerveld met `cloneElement`, en React Flight gaf dat
  veld soms als lazy verwijzing door. `Field` pakt die nu eerst uit (`resolveLazyElement`, unit-test
  `field-lazy.test.ts`). Bevestigd in de productiebuild, inclusief een resultaat vastleggen.
- ✅ Risicokaart: punten dichter dan 44 px bij elkaar worden uitgespreid; alle punten zijn klikbaar (300 willekeurige
  sets in `risk-layout.test.ts`).
- ✅ Marktpotentieel: bevestiging na "Scenario opslaan" blijft zichtbaar en het gekozen scenario blijft geselecteerd;
  "Niet opgeslagen" per factor en een waarschuwing bij vertrek; "onbekend" in plaats van 0 zonder basisaantal.
- ✅ Concurrenten: een nieuwe aanbieder telt vanaf de aanmaakdatum; "niets doen" en items zonder pagina krijgen geen
  controle-alarm.
- ✅ Bron toevoegen: geen standaard "Officiële statistiek" meer; het soort bron is verplicht (ook op de server).
- ✅ "1. Voorspelling ✓ klaar" zonder voorspelling: nu "volgt bij het besluit".
- ✅ Rapport en Markt noemen dezelfde beslissende vraag (`pickDecisiveQuestion`).
- ✅ Publieke testpagina: geen belofte "we nemen contact op" vóór een e-mailadres; de interne ideebeschrijving wordt
  niet meer voorgevuld als aanbod; dubbele privacytekst samengevoegd.
- ✅ Inlogfout houdt het e-mailadres vast.

**Begrijpelijkheid**
- ✅ "Kritiek" betekent overal belang 4–5; de stand van het bewijs telt "gekozen aannames getest".
- ✅ Primaire knop per stap volgt de stand ("Voeg je eerste bron toe", "Begin met de standaardset").
- ✅ Testpagina: "Ga naar: Bord · Wat test je eerst · Nieuwe test".
- ✅ Test Card: uitleg bij beslisregel, kansregel, go-regel, informatiewaarde en Learning Card; eenheid van de
  catalogusmethode i.p.v. "deelnemers"; uitleg waarom de steekproef automatisch omhoog ging.
- ✅ Korter kopvoorstel voor de testpagina; "Maak aanname" in het canvas vult een "We geloven dat …"-zin voor.
- ✅ API-sleutelinstructie alleen voor de eigenaar; enkelvoud/meervoud; geen voorloopnullen in KPI's.
- ✅ Intake: "Meer instellen" voor niet-essentiële velden (11 i.p.v. 16 velden zichtbaar), regio standaard Nederland,
  bedrag met periode, betere korte naam.
- ✅ Coach zonder werkruimte spreekt een beginnende consultant aan, niet een opdrachtgever.

**Mobiel**
- ✅ Compacte dossierkop (titel op 376 px i.p.v. 558 px), zwevende knoppen dekken geen invoer meer af, catalogus met
  inklapbare filters, aanraakdoelen ≥44 px. Geen horizontale overloop op 390 en 1440. Zie DESIGN_DIFF_LOG #63–#70.

**Open**
- Bestaande testpagina's waarvan het aanbod al de ideebeschrijving is, tonen die nog (de publieke pagina kan de
  herkomst niet zien zonder RPC-wijziging).
- In `next dev` (niet in productie) gaf het server-renderen van dossierpagina's soms dezelfde #130-fout rond
  `StepNotes`; met de `Field`-reparatie niet meer gezien in de productiebuild.

## ProofLab eenvoudiger: basis, Testen en Besluit (9 november)

Op basis van het onderzochte voorstel "ProofLab eenvoudiger" (audit van 84 schermen op 1440 en 390 px, plus GOV.UK,
NN/g, Baymard, Microsoft HAX en Google PAIR). De eigenaar ging akkoord met de richting en koos: eerst de basis plus
Testen en Besluit. Markt, Aannames en Rapport volgen in een volgende ronde. Ontwerpafwijkingen: DESIGN_DIFF_LOG #72–#77.

**Basis**
- ✅ Eén takenmodel per idee (`lib/domain/tasks.ts`, unit-test `tasks.test.ts`): vijf fasen met taken, status
  Klaar/Bezig/Te doen/Kan nog niet met de reden, de huidige fase, de volgende taak, en per taak "wat jij doet" en "wat AI
  kan" (`ai: null` als AI daar niets doet; een berekening heet nooit AI). Een open voorspelmoment gaat als eerste taak vóór
  alles. Na "verder testen" of "bijsturen" staat het testplan weer open tot er een nieuwe test is.
- ✅ "Wat nu?" (was: Overzicht van dit idee): één volgende taak met één knop, daaronder de takenlijst per fase.
- ✅ Taakkop (`components/tasks/TaskHeader.tsx`): "Fase · taak x van y", één zin waarom, de taken van de fase als stappen
  en het vaste blok Wat jij doet / Wat AI kan; onderaan terug naar Wat nu? en door naar de volgende taak.
- ✅ Sprintbalk en stappenbalk weg uit de kop van elke ideepagina; het coachpaneel is geen vaste kolom meer maar opent
  via "Tips en vragen".
- ✅ Herkomstlabels: AI-voorstel, Berekend voorstel, Door jou bevestigd, Gemeten bewijs. Geen namen van
  omgevingsvariabelen meer in schermen voor gebruikers.

**Testen**
- ✅ Pagina Testen: bord, "Wat test je eerst" en één knop "Zet een nieuwe test op".
- ✅ Testplan als eigen taakscherm in vijf genummerde stappen met Vorige/Volgende en opslaan op de laatste stap; een fout
  springt naar de stap met het veld. (Bugfix tijdens het bouwen: de knop Volgende werd op de laatste stap als
  opslagknop hergebruikt en verstuurde het formulier; nu eigen keys.)

**Besluit**
- ✅ Drie taken op eigen schermen: Wat heb je geleerd? → Klopt het echt? → Neem je besluit, plus "Alle bewijs op een rij"
  als naslag. Eerst voorspellen staat in dezelfde kolom met het formulier eronder.
- ✅ Na elk besluit maakt ProofLab zelf een nieuwe rapportversie (delen blijft een bewuste stap).

**Getest**: typecheck, lint, 1.618 unit-tests, alle Playwright-specs (desktop en mobiel) tegen een lokale Supabase en de
productiebuild, inclusief de hele journey idee → onderzoek → risico → test → bewijs → besluit → rapport.

**Nog te doen (volgende ronde)**: Markt, Aannames en Rapport ombouwen naar taakschermen; klantonderzoek op één plek;
methode en catalogus naar "Hulp en methode"; vaktermen in gewone taal; daarna testen met drie gebruikers.

### Ronde 2 (9 november): Markt, Aannames en Rapport
- ✅ Markt: per tabblad de taakkop van de bijbehorende taak; "Doelgroep en klantonderzoek" is één taak (tabbladen Doelgroepen en Klantonderzoek). Tabbladen volgen een link naar een ander tabblad zonder dat meldingen na opslaan verdwijnen.
- ✅ Aannames: opschrijven → risicokaart → beslisregel, elk een eigen scherm; links naar `#beslisregel` en `#nieuwe-aanname` openen de juiste stap.
- ✅ Rapport: taakkop voor het team.
- Getest: typecheck, lint, unit-tests, alle Playwright-specs (desktop en mobiel) lokaal tegen de productiebuild.
- Nog open: methode en catalogus naar "Hulp en methode", vaktermen in gewone taal, test met drie gebruikers.

### Ronde 3 (10 november): Hulp en methode, gewone taal, testkit
- ✅ "Hulp en methode" per idee (`/app/ideas/[id]/hulp`): begrippen in gewone taal, rekenmethode, alle testmethodes; methode en catalogus horen bij geen stap meer.
- ✅ Vaktermen in gewone taal in alle schermen en meldingen (testkaart, leerkaart, realiteitscheck, beslisregel, pre-mortem, TAM/SAM/SOM); het vakwoord staat in de uitleg.
- ✅ Testkit voor een gebruikerstest met drie mensen: `docs/GEBRUIKERSTEST_3_GEBRUIKERS.md` (taken, script, observatieformulier, toestemming, analyse). De test zelf moet nog met echte deelnemers worden gedaan; deelnemers die zelf een idee maken, moeten op `signup_allowlist`.

### Ronde 4 (10 november): onderzoek naar zeer gebruiksvriendelijke software
- ✅ Onderzoek en meting: `docs/ONDERZOEK_GEBRUIKSVRIENDELIJKHEID.md` (15 principes met bronnen, meting per scherm).
- ✅ Overzicht leest de takenlijst: fase, balk van vijf fasen en "Volgende taak" per idee; sprintplanning ingeklapt.
- ✅ Tijdsindicatie per taak; compacter rolblok; Markt zonder dubbele navigatie en dubbele koppen.
- ✅ Bronnen in één kolom en vaste volgorde; Marktpotentieel met optionele velden ingeklapt.
- ✅ Testkaart: "Controleer je antwoorden" vóór opslaan.
- ⬜ Voorstel volgende ronde: AI-voorstel per veld (overnemen/aanpassen/weggooien), automatisch opslaan met ongedaan maken, "Waarom vragen we dit?" per veld, foutoverzicht op alle formulieren.
