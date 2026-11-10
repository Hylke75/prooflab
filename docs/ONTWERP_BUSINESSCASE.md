# Businesscase eenvoudiger maken — fase 1: analyse en voorstel

Status: **voorstel, wacht op akkoord** (10 november 2026). Er is nog niets gebouwd of aan de database veranderd.

Uitgangspunt van de opdracht: iemand zonder financiële kennis maakt zelfstandig een professionele businesscase. De
berekeningen blijven even uitgebreid en betrouwbaar; het systeem vangt de complexiteit op.

---

## 0. Wat er nu is (inventaris)

ProofLab heeft geen apart businesscase-scherm. De financiële kant zit verspreid over vier plekken:

| Plek | Wat je invult | Rekenmodel (`lib/domain/sizing.ts`) | Waar het terugkomt |
|---|---|---|---|
| **Intake** (`/app/ideas/new`) | Idee, beslissing, onzekerheid; optioneel "Prijs van het aanbod" als vrije tekst ("€ 249 per maand") en een minimale waarde per klant | — | Voorstel voor de beslisregel; de prijs kan in Marktpotentieel worden overgenomen |
| **Markt → Marktpotentieel** (tab 4) | Drie scenario's (conservatief, realistisch, optimistisch), elk apart op te slaan. Per scenario een model (zakelijk / consumenten / per aankoop) met 5–6 factoren. Per factor: waarde, gekoppelde bron, ondergrens, bovengrens, jaar, regio | `computeSizing` (TAM → SAM → SOM, aantal × omzet per klant), `simulateSizing` (Monte Carlo, 5.000 trekkingen, vaste seed), `factorConsistency` (jaar/regio verschillen verbreden de band) | Rapport hfst. 5 "Marktpotentieel" (tabel + formule), web en PDF |
| **Financiële haalbaarheid** (onder Marktpotentieel, alleen in weergave *Grondig*) | 6 velden: prijs per klant per jaar, brutomarge, wervingskosten per klant, klantverloop, vaste kosten per jaar, benodigde investering | `computeUnitEconomics` (marge per klant, terugverdientijd werving, klantwaarde, LTV/CAC, klanten voor break-even), `breakEvenRevenue` | Rapport hfst. 5: één zin "Financieel: …"; break-evenlijn in Marktpotentieel |
| **Aannames → Businessmodel** (canvas) | Vrije tekst per blok, o.a. *Inkomstenstromen* en *Kostenstructuur* | — (geen cijfers) | Rapport, aannames |

Opslag: `sizing_scenarios` + `sizing_factors` (per scenario/factor, met `claim_id`, `low_value`, `high_value`, `year`,
`region`), `unit_economics` (één rij per idee), `canvas_items`. Twee weergaven bestaan al: **Snel** en **Grondig**
(`components/shell/ViewMode.tsx`, `<Detail only="thorough">`).

Sterk aan het huidige systeem en te behouden: deterministische berekeningen zonder AI, "onbekend" in plaats van een
stille 0, herkomst per factor (bron of aanname), bandbreedtes met simulatie, en eerlijke labels in het rapport.

---

## 1. De tien belangrijkste problemen

Beoordeeld als iemand die nog nooit een businesscase heeft gemaakt. Gerangschikt op verwachte schade aan de ervaring.

1. **Er is geen businesscase, alleen losse onderdelen.** Omzetpotentieel (marktpotentieel) en zes losse
   kengetallen staan naast elkaar. Er is geen overzicht van omzet − kosten = resultaat per jaar, geen moment waarop je
   quitte speelt en geen antwoord op "hoeveel geld heb ik nodig om te starten?". De vraag van een beginner ("is dit
   rendabel?") wordt nergens direct beantwoord.
2. **Een ingevuld veld doet niets.** "Benodigde investering" wordt gevraagd en opgeslagen, maar in geen enkele
   berekening of rapportzin gebruikt. Wie het invult, ziet geen gevolg.
3. **Het begint bij de moeilijkste vraag.** Marktpotentieel start met "Relevante organisaties in het gebied" (staat op
   0, dus alles is "onbekend") en daarna drie percentages (deel met probleem, bereikbaar, te winnen aandeel). Dat is
   een top-down marktfunnel met TAM/SAM/SOM; een beginner denkt van onderaf: "hoeveel klanten krijg ik per maand en
   wat betalen ze?".
4. **Drie keer hetzelfde invullen.** Drie scenario's worden elk apart ingevuld en apart opgeslagen: per scenario 5–6
   factoren met elk tot 6 velden, dus tot ruim 100 velden. Conservatief en optimistisch zijn in de praktijk varianten
   van realistisch.
5. **Dubbele vragen.** De prijs staat in de intake (vrije tekst), als "Jaaromzet per klant" in Marktpotentieel én als
   "Prijs per klant per jaar" in Financiële haalbaarheid; kosten staan als tekst in het canvas én als één getal in
   Financiële haalbaarheid. Ze zijn niet aan elkaar gekoppeld en kunnen elkaar tegenspreken.
6. **Vaktaal zonder voorbeeld.** Brutomarge, wervingskosten (CAC), klantverloop (churn), klantwaarde/LTV, TAM/SAM/SOM,
   break-even. Er zijn uitlegknoppen (`Term`), maar geen concreet voorbeeld en geen "weet ik niet"-route.
7. **Eén verdienmodel past niet op elk idee.** De drie modellen (zakelijke klanten, consumenten, per aankoop) en de
   kengetallen zijn op abonnementsdiensten gericht. Een evenementenlocatie (capaciteit × bezetting × prijs, verhuur
   plus horeca), een stichting (subsidies, fondsen, donaties) of een product met kosten per stuk past er niet in.
8. **Geen hulp bij wat je niet weet.** Er zijn geen suggesties voor kostenposten of inkomstenbronnen, geen
   voorbeeldbedragen per soort onderneming, en niemand die zegt "je bent huur vergeten" of "800 klanten in jaar 1 is
   meer dan de haalbare markt van 300".
9. **Laat resultaat, en verstopt.** De eerste uitkomst verschijnt pas als alle factoren van een scenario gevuld zijn.
   Financiële haalbaarheid zit in *Grondig* onder een tab van de stap Markt; in *Snel* ziet een gebruiker het
   helemaal niet. Er is geen plek die zegt: wat weten we, wat ontbreekt, hoe haalbaar lijkt het, wat nu?
10. **Opslaan en zekerheid zijn per veld onduidelijk.** Elk blok heeft een eigen opslagknop (vergeten = kwijt). Bij
    marktfactoren is te zien of er een bron achter zit, bij de zes financiële velden niet: een bevestigd cijfer, een
    eigen gok en een standaardwaarde (de scenario-percentages 10/20/35 % enz.) zien er hetzelfde uit.

---

## 2. Nieuwe gebruikersflow

### Principe

Eén nieuwe plek per idee: **Businesscase** (`/app/ideas/[id]/businesscase`). Je beantwoordt steeds één of twee
vragen tegelijk; na de tweede vraag staat er al een eerste uitkomst naast. De bestaande onderdelen (marktpotentieel,
financiële haalbaarheid, canvas) blijven bestaan en worden **bronnen en controles** voor de businesscase in plaats
van losse eilanden.

### De vragen (Snel: ± 10 minuten)

Volgorde gekozen zoals een beginner denkt: eerst wat je verkoopt en aan wie, dan geld erin, dan geld eruit, dan wat
je vooraf nodig hebt. Elke stap toont rechts de uitkomst tot nu toe.

| # | Vraag op het scherm | Wat het systeem doet | Voorbeeld onder de vraag |
|---|---|---|---|
| 1 | **Welk idee wil je onderzoeken?** (overgenomen uit de intake, aan te passen) | Leest het soort onderneming af en kiest passende vervolgvragen en voorbeelden | "Een evenementenlocatie voor zakelijke bijeenkomsten, workshops en culturele avonden" |
| 2 | **Hoe verdien je geld?** Kies één of meer: abonnement · verkoop per stuk · per dienst of uur · verhuur van ruimte of plekken · subsidie, fonds of donaties · iets anders | Bepaalt welke inkomstenvragen volgen (conditioneel). Stelt bij het idee passende bronnen voor, als voorstel | Locatie: "zaalverhuur" + "horeca per bezoeker" |
| 3 | **Hoeveel verwacht je te verkopen, en voor welke prijs?** Per gekozen bron 2–3 vragen in gewone taal | Rekent direct omzet per maand/jaar; prijs uit de intake staat al ingevuld | Verhuur: "Hoeveel zalen? Hoeveel dagdelen per week verhuurd? Wat kost een dagdeel?" |
| 4 | **Hoe snel groei je?** Eén keuze: rustig · gemiddeld · snel (of zelf invullen in Uitgebreid) | Bouwt jaar 1–3 op (aanloop in het eerste jaar) | "De eerste maanden verhuur je minder; na een jaar zit je op je verwachte bezetting" |
| 5 | **Wat kost het om je product of dienst te leveren?** (per verkoop: inkoop, materiaal, betaalkosten) | Rekent marge; zonder antwoord: duidelijk gemarkeerd "nog onbekend" | "Per bezoeker € 9 aan eten en drinken" |
| 6 | **Welke vaste kosten heb je per maand?** Afvinklijst met voorgestelde posten (huur, personeel, verzekering, marketing, software, energie…) | Suggesties passen bij het idee; elke post is één bedrag; vergeten posten worden gesignaleerd | "Huur € 4.500 per maand, 1,5 fte personeel" |
| 7 | **Hoeveel geld moet je vooraf investeren om te kunnen starten?** Afvinklijst: verbouwing, apparatuur, inrichting, website, voorraad, starttijd zonder inkomsten | Rekent benodigd startkapitaal en terugverdientijd | "Verbouwing € 60.000, geluid en licht € 25.000" |
| 8 | **Wat wil je precies weten?** (overgenomen uit de beslisvraag van de intake) | Kiest welke uitkomst bovenaan staat (rendabel? hoeveel startgeld? wanneer quitte?) | "Kan de locatie binnen 2 jaar zonder verlies draaien?" |

Na stap 3 staat er al een **voorlopige omzet**; na stap 6 een **eerste haalbaarheidsinschatting**; na stap 7 het
**startkapitaal en de terugverdientijd**. Alles wat nog niet is ingevuld staat in "Nog te doen", niet als 0.

Conditionele voorbeelden:
- Stichting kiest "subsidie, fonds of donaties" → vragen naar toezeggingen per fonds (zeker / aangevraagd / idee), geen
  marge- en klantwervingsvragen; uitkomst "Hoeveel dekking mis je nog?" in plaats van "winst".
- Abonnement → klantverloop gevraagd ("Hoeveel van je klanten stopt per jaar? Weet je het niet, kies 'geen idee'
  en we rekenen met een voorzichtige aanname, gemarkeerd als voorstel").
- Verkoop per stuk → inkoopprijs per stuk; geen klantverloop.

### Daarna: verfijnen (Uitgebreid)

Dezelfde businesscase, met per regel meer instellingen: groei per jaar, prijsstijging, betaaltermijnen, afschrijving
van investeringen, financiering (eigen geld, lening, subsidie), bandbreedtes per aanname, koppeling aan een bron. De
bestaande marktpotentieel-simulatie en financiële haalbaarheid blijven hier volledig beschikbaar.

### Scenario's: één keer invullen, drie uitkomsten

Je vult **realistisch** in. Conservatief en optimistisch worden afgeleid met zichtbare, aanpasbare knoppen:
"verkoop valt 25 % tegen / meevaller van 15 %", "kosten 10 % hoger", "half jaar later op niveau". Per aanname kun je in
Uitgebreid een eigen onder- en bovenwaarde zetten. Het scherm toont de drie scenario's naast elkaar (omzet, resultaat
jaar 1–3, startkapitaal, quitte-moment) en een lijst **"Wat weegt het zwaarst"**: welke drie aannames de uitkomst het
meest verschuiven (gevoeligheid, zelfde aanpak als de bestaande "variance drivers").

### Zekerheid per cijfer

Elk getal krijgt één van drie labels, met de bestaande ProofLabel-stijl:

- **Bevestigd** — gekoppeld aan een bron/bevinding of aan een meting uit een test (bijv. offerte huur, CBS-cijfer).
- **Eigen schatting** — door de gebruiker ingevuld zonder bron.
- **Voorstel** — door ProofLab of AI voorgesteld (voorbeeldbedrag, standaardpercentage). Telt pas mee na
  "Overnemen" of "Aanpassen" (zelfde patroon als de voorgestelde aannames); vóór die tijd staat het grijs, met de
  herkomst erbij. Nooit ongemerkt als invoer.

De haalbaarheidsinschatting toont een **betrouwbaarheid**: "3 van 14 cijfers bevestigd; de uitkomst hangt vooral af
van bezettingsgraad (eigen schatting)". Met één klik maak je van zo'n zwaarwegende schatting een **aanname** op de
risicokaart, zodat de bestaande ProofLab-methode (test → bewijs → besluit) hem kan toetsen.

### Controles (herkenning van ontbrekende of onrealistische invoer)

Regels, geen AI, met de reden erbij:
- Ontbrekende kernposten (geen huur bij een locatie, geen personeel bij een dienst, geen kosten per verkoop).
- Onrealistische waarden: bezetting > 100 %, marge < 0, verkoop in jaar 1 hoger dan de haalbare markt (SOM uit
  Marktpotentieel), prijs ver boven het concurrentiegemiddelde, groei > 300 % per jaar, klantverloop 0 %.
- Tegenspraak: prijs in de businesscase ≠ prijs in de intake of in Financiële haalbaarheid.

---

## 3. Velden: automatisch, optioneel of later

| Veld (huidig of nieuw) | Snel | Uitgebreid | Bron van de standaardwaarde |
|---|---|---|---|
| Omschrijving van het idee | automatisch (intake) | aanpasbaar | `ideas` |
| Beslisvraag | automatisch (intake) | aanpasbaar | intake |
| Verdienmodel(len) | **gevraagd** (keuzekaarten) | idem | voorstel uit idee-omschrijving |
| Aantal verkopen/klanten/dagdelen per maand | **gevraagd** | per jaar instelbaar | — (eigen schatting) |
| Prijs | **gevraagd**, voorgevuld | idem | intake `offer_price`, `unit_economics.price_per_customer_year`, sizing `revenue_per_customer` |
| Groei / aanloop | **één keuze** (rustig/gemiddeld/snel) | per jaar | voorstel, gelabeld |
| Kosten per verkoop | **gevraagd** (mag "weet ik niet") | per inkomstenbron | `unit_economics.gross_margin_pct` omgerekend |
| Vaste kosten | **afvinklijst + bedrag** | per post, met indexatie | `unit_economics.fixed_costs_year` als één post |
| Investeringen vooraf | **afvinklijst + bedrag** | met afschrijvingstermijn | `unit_economics.upfront_investment` |
| Klantverloop | alleen bij abonnement | idem | `unit_economics.annual_churn_pct` |
| Wervingskosten per klant | later (Uitgebreid) | ja | `unit_economics.cac_eur` |
| Financiering (eigen geld, lening, rente, subsidie) | verborgen | ja | — |
| Betaaltermijnen, btw-timing | verborgen | ja | standaard: direct betaald, gelabeld |
| Afschrijving | verborgen (standaard 5 jaar, gelabeld) | ja | — |
| Marktfunnel (TAM/SAM/SOM, factoren, bandbreedtes, jaar, regio, CBS) | **niet gevraagd**; wordt een controle ("past je verkoop in de markt?") | volledig, ongewijzigd | bestaand |
| Canvas: inkomstenstromen / kostenstructuur | niet gevraagd | tekst blijft; businesscase stelt de tekst voor | businesscase |

Gevolg: de Snel-route vraagt **circa 10–14 antwoorden** (afhankelijk van het verdienmodel) in plaats van tot ruim 100.

---

## 4. Schermindeling

Eén pagina met twee standen, binnen de bestaande shell (sidebar, topbar, coach) en huisstijl.

**Stand 1 — Vragen (eerste keer, of via "Verder invullen")**

```
┌──────────────────────────────────────────────┬──────────────────────────┐
│ BUSINESSCASE · STAP 3 VAN 8 · ± 2 MIN         │  JE UITKOMST TOT NU TOE  │
│ ●●●○○○○○  (klikbare stappen, terug kan altijd)│  (donkere kaart)         │
│                                              │  Omzet jaar 1  € 96.000  │
│ Hoeveel verwacht je te verkopen,             │  voorlopig · 0 bevestigd │
│ en voor welke prijs?                         │                          │
│ Korte uitleg (1 regel) · "Waarom vragen we   │  Nog te doen:            │
│ dit?" · voorbeeld                            │  · vaste kosten          │
│                                              │  · investering           │
│ [ grote invoervelden met eenheid ]           │                          │
│ Label: Eigen schatting ▾ (koppel bron)       │                          │
│                                              │                          │
│ [Vorige]                  [Volgende stap]    │                          │
│ Automatisch bewaard · 10:42                  │                          │
└──────────────────────────────────────────────┴──────────────────────────┘
```
Mobiel: de uitkomstkaart zakt als compacte balk boven de knoppen ("Omzet jaar 1 € 96.000 · details").

**Stand 2 — Overzicht (dashboard, zodra stap 3 af is)**

Vijf blokken in de volgorde van de opdracht:
1. **Hoe haalbaar lijkt het?** Eén zin + kleur (lijkt haalbaar / krap / nog niet haalbaar / te weinig gegevens),
   met resultaat jaar 1–3, quitte-moment en benodigd startkapitaal. Betrouwbaarheid eronder.
2. **Wat weten we al?** Ingevulde onderdelen met hun label (bevestigd / schatting / voorstel).
3. **Wat moet nog?** Ontbrekende posten als taken met één knop ("Vul vaste kosten in").
4. **Risico's.** Controles + "Wat weegt het zwaarst" (top 3 gevoeligheden) met "Maak er een aanname van".
5. **Wat nu?** Eén aanbevolen volgende stap (via het bestaande takenmodel `ideaTasks`).

Daaronder tabbladen: **Scenario's** (drie kolommen + knoppen voor tegenvallers/meevallers), **Cijfers per jaar**
(omzet, kosten, resultaat, kas; Uitgebreid toont maanden), **Invoer** (alle antwoorden, per regel bewerkbaar).

De businesscase komt in het takenmodel als taak in de fase *Aannames* ("Reken je idee door"), en in het commandomenu
("businesscase", "rendabel", "break-even", "investering").

---

## 5. Technische aanpassingen

1. **Rekenkern (nieuw, puur)** `lib/domain/business-case.ts`: maandmodel over 36 maanden (Uitgebreid 60) met
   inkomstenbronnen per type, aanloopcurve, kosten per verkoop, vaste kosten, investeringen met afschrijving,
   resultaat, kasstroom, laagste kaspunt (= benodigd startkapitaal), quitte-maand, terugverdientijd; drie scenario's
   als afgeleide met zichtbare aanpassingen; gevoeligheid per aanname. Deterministisch, geen AI. **Dit zijn nieuwe
   formules naast de bestaande; bestaande formules (`computeSizing`, `simulateSizing`, `computeUnitEconomics`,
   `breakEvenRevenue`) blijven ongewijzigd.**
2. **Opslag: één nieuwe tabel** `business_cases` (idea_id als sleutel, `inputs jsonb` met schemaversie, per waarde
   label en herkomst, `updated_at`), met dezelfde RLS als `unit_economics`, en een validatie-check op grootte. Geen
   wijziging aan bestaande tabellen. Bestaande ideeën krijgen pas een rij als iemand de businesscase opent; tot dan
   worden waarden afgeleid uit intake/`unit_economics`/sizing (dus bestaande dossiers openen zonder migratie van data).
3. **Synchronisatie:** bij opslaan schrijft de businesscase de overeenkomende zes velden ook naar `unit_economics`,
   zodat Financiële haalbaarheid en het rapport consistent blijven. Andersom: bestaande waarden zijn de startwaarden.
4. **Automatisch opslaan:** debounced server action (bestaand `ActionForm`-patroon + concept op het apparaat), met
   "Automatisch bewaard · tijd" en ongedaan maken per regel.
5. **Suggesties:** regelgebaseerde lijsten van kostenposten/inkomstenbronnen per soort onderneming (zonder bedragen
   als feit; bedragen alleen als gelabeld voorbeeld). Optioneel AI-voorstel via de bestaande AI-provider, alleen als
   die gekoppeld is, altijd als "Voorstel".
6. **Rapport:** nieuw hoofdstuk "Businesscase" (web + PDF): drie scenario's, resultaat per jaar, startkapitaal,
   aannames met labels, gevoeligheden en beperkingen. Bestaande hoofdstukken blijven gelijk; de zin "Financieel: …"
   blijft.
7. **Weergaven:** Snel = vragenroute + overzicht; Grondig = Uitgebreid. Zelfde rekenkern.
8. **Tests:** (a) vastlegtests (golden values) voor alle bestaande financiële functies, vóór er iets verandert;
   (b) unittests rekenkern incl. randgevallen (lege invoer, negatieve marge, 0 % verloop, extreme bedragen);
   (c) E2E met drie fictieve cases — evenementenlocatie, nieuwe dienst bij een bestaande organisatie, stichting met
   maatschappelijk project — inclusief onvolledige invoer, onrealistische bedragen, scenario aanpassen, opslaan en
   opnieuw openen, en 390/768/1440 px; (d) bestaand dossier zonder businesscase opent correct.

---

## 6. Prioriteiten

| # | Onderdeel | Verwachte verbetering | Inspanning | Volgorde |
|---|---|---|---|---|
| 1 | Vastlegtests bestaande berekeningen | voorwaarde (geen regressie) | klein | eerst |
| 2 | Rekenkern businesscase + unittests | hoog (beantwoordt "is het rendabel?") | middel | 1e ronde |
| 3 | Vragenroute Snel (8 stappen, conditioneel, uitkomst ernaast, autosave) | zeer hoog | middel-groot | 1e ronde |
| 4 | Tabel `business_cases` + synchronisatie met `unit_economics` | voorwaarde | klein | 1e ronde (migratie na jouw akkoord) |
| 5 | Overzicht met vijf blokken + labels bevestigd/schatting/voorstel | hoog | middel | 1e ronde |
| 6 | Scenario's afgeleid + "wat weegt het zwaarst" | hoog | klein-middel | 2e ronde |
| 7 | Controles op ontbrekende en onrealistische invoer | hoog | klein | 2e ronde |
| 8 | Suggesties kostenposten/inkomstenbronnen per soort onderneming | middel-hoog | klein | 2e ronde |
| 9 | Rapporthoofdstuk Businesscase (web + PDF) | middel | middel | 2e ronde |
| 10 | Uitgebreid: per jaar, financiering, afschrijving, bandbreedtes | middel (voor gevorderden) | middel | 3e ronde |
| 11 | "Maak er een aanname van" + taak en commandomenu | middel | klein | 3e ronde |
| 12 | AI-voorstel bij het invullen (alleen met gekoppelde provider) | middel | klein-middel | 3e ronde, optioneel |

---

## 7. Besluiten waarvoor akkoord nodig is

1. **Nieuwe rekenkern** (maandmodel, startkapitaal, quitte-moment, afgeleide scenario's) naast de bestaande formules.
2. **Eén nieuwe tabel** `business_cases` op productie (migratie toevoegen; bestaande tabellen en data ongemoeid).
3. **Synchronisatie** van de zes overeenkomende velden naar `unit_economics`.
4. **AI-voorstellen** bij het invullen, alleen als voorstel en alleen met gekoppelde provider (ja/nee).
5. **Plaats in de app:** taak "Reken je idee door" in fase Aannames (alternatief: een eigen fase).
