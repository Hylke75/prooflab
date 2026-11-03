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
| `ANTHROPIC_API_KEY` als secret | AI-onderzoek, AI-aannames, interviewcodering, AI-vragen in de Reality Check | Hylke |
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

Alle AI-functies werken alleen met `ANTHROPIC_API_KEY`; zonder sleutel tonen ze "AI niet verbonden" met het handmatige alternatief.
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
