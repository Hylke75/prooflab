# Implementation status

Stand: 29 oktober 2026. Bouwvolgorde volgens het besluit "eerst één complete route" (analyse §12.4–12.5).
Legenda: ✅ gebouwd en getest · 🟡 gebouwd, test of koppeling hangt af van een externe stap · ⬜ nog niet gebouwd.

## Externe stappen die nog openstaan

| Stap | Waarom | Wie |
|---|---|---|
| ~~Migraties toepassen~~ | Gedaan 28-10: `core_schema`, `security`, `hardening` staan op project `prooflab`; ingest-sleutel geregistreerd | ✅ |
| Migratie `integrity` (29-10) toepassen en migratiegeschiedenis rechtzetten | Zonder deze migratie werken testpagina's, inloglinks, sprints en rapport delen niet tegen de live database | Claude, na bevestiging in Supabase |
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

## Testresultaten (laatste run, 29-10)

- `npm run lint` en `npm run typecheck` — schoon
- `npm test` — 114 geslaagd, 3 overgeslagen (live eval zonder API-sleutel)
- `npm run test:db` — 14 geslaagd
- `npm run build` — geslaagd
- E2E tegen het live project: opnieuw te draaien na migratie `integrity` (laatste geslaagde run: 28-10, 5/5)

## Gevonden en opgelost tijdens de live E2E

- Formulieren werden na verzenden door React leeggemaakt, waardoor de intake bij een fout invoer verloor (`keepValuesOnSubmit`)
- Intake: de knop "Volgende" wisselde tijdens de klik van type en verstuurde te vroeg
- Bevinding toevoegen: een verouderde fragmentselectie na het toevoegen van een nieuw fragment
- Contrast loginpagina op mobiel; horizontale overloop op smalle schermen

## Nog niet gebouwd (na de route)

- ⬜ AI-gemodereerde chatinterviews (spraak later)
- ⬜ Weekritmes: leersessie en besluitsessie met de klant, Fathom-import
- ⬜ Koppelingen met de Meta- en LinkedIn-advertentie-API's (nu: kanaallinks + handmatig live zetten)
- ⬜ Experimentencatalogus (±40 methodes met metadata) en begeleide handmatige sjablonen
- ⬜ Propositie- en businessmodelcanvas
- ⬜ Concurrentiemonitor (periodiek herchecken), verschillenrapport tussen onderzoeksversies
- ⬜ Betalingen/aanbetalingen (na juridische check), Stripe
- ⬜ Server-side PDF-rendering (nu printstylesheet)
- ⬜ Gebruiksniveaus (begeleid / verdiepend / expert)
