# ProofLab: hoe voorspellen we de uitkomst zo goed mogelijk?

Onderzoek naar methodes die de voorspelkracht van ProofLab kunnen verbeteren, en hoe we ze toepassen.
Versie 1.3, 6 november 2026 (hoofdstuk 7: onderzoeksmethodes en AI; hoofdstuk 8: leren van uitkomsten; hoofdstuk 9:
methode 2026-11-b).

## 1. Waar we nu staan

ProofLab beoordeelt een idee nu met:

- **Bewijs per bewering**: letterlijk citaat, berekende status (geverifieerd, schatting, onvoldoende, betwist, verouderd).
- **Bewijssterkte per observatie**: vier ja/nee-dimensies (feit, gedrag, echte context, kostbaar), opgeteld tot 0–4.
- **Experimenten**: vooraf vergrendelde drempel, Wilson-interval, oordeel geslaagd/gefaald/onbeslist pas na de eindconditie.
- **Reality Check**: regels die een advies geven (doorgaan, bijsturen, verder testen, pauzeren, stoppen).

Dat is eerlijk en controleerbaar, maar het levert **geen voorspelling** op. Er staat nergens "de kans dat dit idee binnen
12 maanden 20 betalende klanten heeft is 35%". En omdat we niet bijhouden hoe ideeën achteraf uitpakken, weten we ook
niet of ons advies goed was. Een systeem dat zichzelf niet meet, kan niet beter worden.

## 2. Wat het onderzoek zegt

### Basispercentages: begin bij het buitenperspectief

- Nieuwe producten slagen veel minder vaak dan de bedenkers denken. Meta-analyses noemen een succespercentage onder de
  25%, met spreiding van ongeveer 10% tot boven 60% afhankelijk van sector en definitie van succes
  ([Aston/Henard & Szymanski](https://research.aston.ac.uk/en/publications/success-factors-of-product-innovation-an-updated-meta-analysis);
  [Food Processing](https://www.foodprocessing.com/new-food-products/article/11330194/food-product-marketing-new-product-success-rate-higher-than-most-believe)).
- In Nederland bestaat ongeveer 65% van de nieuwe bedrijven na vijf jaar nog, met grote verschillen per sector
  (handel 52%, bouw 71%) ([CBS](https://www.cbs.nl/nl-nl/nieuws/2022/48/5-jarig-overlevingspercentage-van-nieuwe-bedrijven-neemt-toe)).
  Let op: overleven is iets anders dan een geslaagd idee.
- *Reference class forecasting* (Kahneman, Flyvbjerg) corrigeert optimisme door te beginnen bij hoe vergelijkbare
  projecten echt afliepen. De kwaliteit hangt af van hoe vergelijkbaar de referentieklasse is
  ([Flyvbjerg](https://arxiv.org/abs/1302.3642);
  [UK DfT 2020](https://assets.publishing.service.gov.uk/government/uploads/system/uploads/attachment_data/file/983759/updating-the-evidence-behind-the-optimism-bias-uplifts-for-transport-appraisals.pdf)).

**Toepassing:** elk dossier begint met een basispercentage voor een gekozen referentieklasse; daarna stuur je bij op
basis van bewijs. Na een jaar vervangen we externe percentages door onze eigen afgeronde dossiers.

### Gekalibreerd voorspellen: kansen uitspreken en scoren

- In het Good Judgment Project voorspelden mensen die kansen gaven, werden afgerekend met de Brier-score en een uur
  training kregen, aantoonbaar beter. De besten zaten gemiddeld maar 0,014 naast perfecte kalibratie, gewone
  voorspellers 0,068. Het samenvoegen van meerdere voorspellers, met meer gewicht voor wie eerder goed zat, was het
  sterkst ([AI Impacts](https://aiimpacts.org/evidence-on-good-forecasting-practices-from-the-good-judgment-project/);
  [Good Judgment](https://goodjudgment.com/wp-content/uploads/2021/10/Superforecasters-A-Decade-of-Stochastic-Dominance.pdf)).
- Bij gestructureerd expertoordeel (Cooke) wint gewogen samenvoegen in de eigen data, maar buiten die data is gelijk
  gewicht vaak even goed. Minder dan een derde van de experts blijkt goed gekalibreerd
  ([Colson & Cooke](https://www.rff.org/publications/journal-articles/expert-elicitation-using-the-classical-model-to-validate-experts-judgments/);
  [cross-validatie](https://pureportal.strath.ac.uk/en/publications/cross-validation-for-the-classical-model-of-structured-expert-jud/)).
- Interne voorspelmarkten bij Google en Ford voorspelden goed, met een optimisme-bias die afnam naarmate deelnemers
  ervaring opdeden ([Cowgill & Zitzewitz](https://business.columbia.edu/faculty/research/corporate-prediction-markets-evidence-google-ford-and-firm-x)).

**Toepassing:** consultant, opdrachtgever en (optioneel) het model geven elk onafhankelijk een kans op een vooraf
gedefinieerde uitkomst. Begin met gelijk gewicht; pas gewichten aan zodra er genoeg afgeronde voorspellingen zijn.

### Uitspraken van klanten overschatten gedrag

- Koopintentie voorspelt aankopen, maar onvolledig; bij positief beoordeelde concepten overschatten modellen de
  koopkans ([Morwitz](https://dx.doi.org/10.1561/1700000036);
  [Chandon & Morwitz](https://www.marketingprofs.com/6/chandon1.asp)).
- De markt corrigeert daarom standaard: het BASES-model telt maar een deel van de "zeker kopen"-antwoorden als
  aankoop ([Intent scale translation](https://en.wikipedia.org/wiki/Intent_scale_translation)).
- Bij prijsonderzoek presteert een methode met echte betaling (Becker-DeGroot-Marschak) beter dan alleen vragen
  (Van Westendorp, Gabor-Granger), al is het bewijs beperkt tot enkele studies
  ([Krohmer & Zhang, via GfK MIR](https://reference-global.com/download/article/10.2478/gfkmir-2014-0040.pdf)).
- De bekende "40% zeer teleurgesteld"-test voor product-market fit heeft geen gepubliceerde validatie
  ([MeasuringU](https://measuringu.com/product-market-fit-item/)).

**Toepassing:** zeggen telt minder dan doen (dat doet ProofLab al), maar we maken het kwantitatief: een uitgesproken
koopintentie krijgt een vaste kortingsfactor, die we later ijken op onze eigen data. Prijs testen we bij voorkeur
met een echte toezegging (aanbetaling, intentieverklaring, voorverkoop).

### Kleine tests liegen vaker dan je denkt

- Tests die je selecteert omdat ze goed uitpakten, overschatten het effect (*winner's curse*). Bayesiaans krimpen
  naar wat eerdere tests lieten zien, corrigeert dat
  ([Amazon Science](https://amazon.science/publications/overcoming-the-winners-curse-leveraging-bayesian-inference-to-improve-estimates-of-the-impact-of-features-launched-via-a-b-tests);
  [Meta, Bayesian Hybrid Shrinkage](https://arxiv.org/abs/2603.12867)).
- Bayesiaanse analyse is niet vanzelf bestand tegen tussentijds kijken: een naïeve regel "kans > 95%" bij 15 keer
  kijken gaf in een simulatie 38% vals-positief. Een vooraf vastgelegde regel blijft nodig
  ([wikidocs-simulatie](https://wikidocs.net/blog/@datalearners/29480/);
  [overzicht sequentieel testen](https://zhedata.quarto.pub/applied-sequential-analysis-data-science/note/8.%20AB%20Test.html)).

**Toepassing:** we houden de vooraf vergrendelde eindconditie (geen tussentijdse oordelen), en voegen een prior uit
eerdere vergelijkbare tests toe zodat een toevallig hoge uitkomst bij 30 bezoekers niet als doorbraak telt.

### Kies het experiment met de meeste informatiewaarde

- De verwachte waarde van informatie (EVPI/EVSI) zegt hoeveel een meting een beslissing kan verbeteren; een test is
  alleen de moeite waard als die waarde hoger is dan de kosten. Wat het meest wordt gemeten, is vaak het minst waard
  om te meten (Hubbard's *measurement inversion*)
  ([EVPI](https://en.wikipedia.org/wiki/Expected_value_of_perfect_information);
  [Value of information](https://www.r-bloggers.com/2020/08/quantifying-the-expected-value-of-information/)).

**Toepassing:** de aannamekaart rangschikt nu op belang × weinig bewijs. Beter: op hoeveel een test de kans op een
ander besluit verandert, gedeeld door wat de test kost en duurt.

### Tegenspraak organiseren

- De *pre-mortem* ("stel dat het over een jaar mislukt is: waarom?") helpt teams meer redenen voor falen te vinden.
  Het vaak genoemde "30% beter" komt uit één studie uit 1989 en is in de bron zelf genuanceerder
  ([Mitchell, Russo & Pennington](https://colab.ws/articles/10.1002%2Fbdm.3960020103)).

**Toepassing:** een korte pre-mortem als vast onderdeel van de Reality Check, met de antwoorden als te toetsen
aannames.

### Wat AI wel en niet kan

- Taalmodellen voorspellen inmiddels bijna zo goed als de beste menselijke voorspellers: Brier 0,101 tegen 0,081 op
  ForecastBench (oktober 2025), met verwachte gelijkstand rond eind 2026
  ([Good Judgment](https://goodjudgment.com/human-vs-ai-forecasts/);
  [ForecastBench](https://arxiv.org/pdf/2409.19839)).
- Synthetische respondenten benaderen soms gemiddelde voorkeuren, maar falen bij segmenten en kunnen misleidende
  signalen voor bedrijfsbeslissingen geven
  ([NeurIPS-studie](https://neurips.cc/virtual/2026/169654);
  [PyMC Labs/Colgate](https://arxiv.org/pdf/2510.08338);
  [LLM-enquêtes](https://arxiv.org/pdf/2604.17267)).
- Modellen die startupsucces voorspellen uit Crunchbase-data halen in serieuze studies rond 53% F1; hogere claims
  komen uit persberichten. Ontbrekende data en de definitie van succes drukken de betrouwbaarheid
  ([Journal of Big Data](https://journalofbigdata.springeropen.com/counter/pdf/10.1186/s40537-024-00993-8.pdf);
  [ZHAW](https://digitalcollection.zhaw.ch/bitstream/11475/28226/3/2023_Te-etal_Crunchbase-LinkedIn-data-analysis.pdf)).

**Toepassing:** AI is één extra voorspeller in de groep, met eigen score, nooit bewijs. Synthetische respondenten
alleen om vragenlijsten vooraf te testen. Geen extern machine-learningmodel; wel later een eigen eenvoudig model
op onze afgeronde dossiers.

## 3. Voorstel: een voorspelkern in ProofLab

De kern is een gesloten lus: **voorspellen → testen → bijwerken → uitkomst meten → leren**.

### 3.1 Uitkomstdefinitie bij de intake (nieuw)

Bij de beslisvraag legt de consultant ook vast wat "geslaagd" betekent, meetbaar en met een datum. Voorbeeld:
"Op 1 juli 2027 hebben minstens 15 MKB-klanten een betaald abonnement." Zonder deze definitie kan niemand achteraf
zeggen of de voorspelling klopte.

### 3.2 Basispercentage per dossier (nieuw)

De consultant kiest een referentieklasse (bijvoorbeeld "nieuw B2B-product, MKB, Nederland"). ProofLab toont het
basispercentage met bron, of "onbekend" als er geen goede referentie is. Elke latere kansvoorspelling start daar.
Na ongeveer 30 afgeronde dossiers gebruiken we onze eigen percentages per projecttype en branche.

### 3.3 Kansvoorspellingen op vaste momenten (nieuw)

Op vier momenten (na de intake, na het marktonderzoek, na het eerste experiment, bij het besluit) geven consultant,
opdrachtgever en optioneel het model elk onafhankelijk een kans (5–95%) op de uitkomst uit 3.1, met één zin
waarom. Je ziet de anderen pas na je eigen invoer, zodat niemand op elkaar ankert. Het rapport toont het gemiddelde
en de spreiding.

### 3.4 Uitkomsten registreren en scoren (nieuw, het belangrijkste onderdeel)

Op de uitkomstdatum (en na 3, 6 en 12 maanden) vraagt ProofLab de consultant om de werkelijke uitkomst, met bewijs.
Daaruit berekenen we:

- de **Brier-score** per voorspeller en per moment;
- een **kalibratiecurve** ("van alles wat we 70% gaven, gebeurde 64%");
- welke **bewijssoorten** echt voorspellend waren.

Dit is de enige manier om te weten of ProofLab beter wordt. Het vraagt geduld: met 10–20 dossiers per jaar zijn de
eerste betrouwbare inzichten na 1–2 jaar te verwachten.

### 3.5 Bewijs omzetten in kansen per aanname (aanpassing)

De bewijsas van de aannamekaart (nu 0–4 punten) wordt een kans: start bij een neutrale of gekozen beginwaarde en werk
bij met een vaste factor per bewijssoort (Bayes met *likelihood ratios*). Een mening verschuift de kans nauwelijks,
een aanbetaling sterk; tegenbewijs werkt andersom. De factoren beginnen als expliciete, zichtbare aannames en worden
later geijkt op de uitkomsten uit 3.4.

### 3.6 Experimenten met voorkennis (aanpassing)

Naast het Wilson-interval tonen we een Bayesiaanse schatting met een prior uit eerdere vergelijkbare tests
(gekrompen naar het gemiddelde van de referentieklasse). Het oordeel blijft pas na de vooraf vastgelegde
eindconditie. Daardoor telt een toevallig hoge score bij een kleine steekproef minder zwaar.

### 3.7 Intentiecorrectie (aanpassing)

Observaties van het type "zou kopen" of "geïnteresseerd" krijgen een vaste kortingsfactor in de voorspelling, zichtbaar
in het rapport. De factor wordt later geijkt op de echte uitkomsten.

### 3.8 Monte Carlo voor marktomvang en rendabiliteit (aanpassing)

In plaats van drie scenario's geeft de consultant per factor een bandbreedte (90%-interval). ProofLab simuleert
duizenden combinaties en toont onder meer de kans dat het break-evenpunt binnen de looptijd ligt, en welke factor
de onzekerheid het meest bepaalt.

### 3.9 Volgende test kiezen op informatiewaarde (aanpassing)

De experimentaanbeveler rangschikt aannames op hoeveel een test de beslissing kan veranderen, gedeeld door de kosten
en duur van die test, in plaats van alleen belang × gebrek aan bewijs.

### 3.10 Pre-mortem in de Reality Check (aanpassing)

Een vaste vraag: "Het is één jaar later en dit is mislukt. Wat is de meest waarschijnlijke reden?" Elk antwoord wordt
een aanname op de kaart, of een bewuste keuze om het risico te accepteren.

## 4. Wat we bewust niet doen

- **Geen succesgetal dat sterker lijkt dan het is.** Zolang er geen eigen uitkomstdata zijn, tonen we kansen als
  inschatting van mensen, met spreiding en basispercentage, nooit als modeluitkomst.
- **Geen extern startupsucces-model.** De beschikbare modellen zijn zwak, slecht te vergelijken en passen niet bij
  MKB-, events- en mediaprojecten in Nederland.
- **Synthetische respondenten tellen niet als bewijs.** Hooguit om vragenlijsten vooraf te testen.
- **AI-voorspellingen tellen niet als bewijs.** Wel als aparte voorspeller met eigen score.

## 5. Volgorde van bouwen

| Fase | Inhoud | Waarom eerst |
|---|---|---|
| A (2–3 weken) | 3.1 uitkomstdefinitie, 3.2 basispercentage, 3.3 kansvoorspellingen, 3.4 uitkomstregistratie en Brier-score | Zonder uitkomstdata kan niets anders geijkt worden; elke maand uitstel is een maand minder leerdata |
| B (3–4 weken) | 3.5 kansen per aanname, 3.6 experimenten met voorkennis, 3.7 intentiecorrectie, 3.10 pre-mortem | Maakt het bewijs kwantitatief en corrigeert bekende denkfouten |
| C (2–3 weken) | 3.8 Monte Carlo, 3.9 informatiewaarde, AI als extra voorspeller | Betere keuzes over welke test en welke onzekerheid ertoe doet |
| D (na ±30 afgeronde dossiers) | Eigen basispercentages, geijkte factoren, gewogen samenvoegen van voorspellers, eenvoudig eigen model | Pas zinvol met genoeg eigen data |

ProofLab op ProofLab is het eerste testdossier: de uitkomstdefinitie ("Link & Lead verkoopt binnen 6 maanden
X validatiesprints met ProofLab") en de eerste voorspellingen kunnen direct na fase A worden vastgelegd.

## 7. Onderzoeksmethodes en de rol van AI

Een voorspelling is zo goed als het onderzoek dat erin gaat. Hieronder per methode wat AI aantoonbaar kan, waar het
misgaat en hoe ProofLab het inzet. Het principe blijft: **AI levert breedte en snelheid, bewijs komt uit bronnen en
uit gedrag van echte mensen.** Elke AI-uitkomst is terug te voeren op een letterlijke passage of een meting.

### 7.1 Deskresearch

- **Wat het onderzoek zegt:** AI-onderzoeksagenten maken minder nep-links dan vroeger (3–13% niet-bestaande URL's),
  maar de geciteerde bron ondersteunt de bewering in maar 39–77% van de gevallen
  ([Rao e.a.](https://www.alphaxiv.org/abs/2604.03173.md); [ReportBench](https://arxiv.org/pdf/2508.15804);
  [overzicht](https://intuitionlabs.ai/pdfs/citation-reliability-ai-literature-reviews.pdf)).
- **Wat ProofLab al doet:** alleen bevindingen opslaan waarvan het citaat letterlijk in de opgehaalde pagina staat,
  met dezelfde getallen. Dat vangt verzonnen citaten en verkeerde cijfers.
- **Wat erbij moet:** een tweede, onafhankelijke controle of het citaat de bewering ook *inhoudelijk* draagt
  (een citaat kan letterlijk kloppen en toch iets anders zeggen). Een aparte modelaanroep beoordeelt
  "ondersteunt / ondersteunt deels / ondersteunt niet"; bij twijfel beslist de consultant. Daarnaast steekproefsgewijs
  meten hoe vaak consultant en model het eens zijn, zodat we weten hoe betrouwbaar die controle is.

### 7.2 Concurrentie- en marktmonitoring

- AI is goed in het periodiek naast elkaar leggen van prijspagina's en productpagina's. ProofLab heeft al een
  SSRF-veilige paginaophaler en citaatcontrole.
- **Toepassing:** een maandelijkse herhaalcheck per concurrent: prijs en positionering opnieuw ophalen, verschillen
  tonen met de vorige versie, verouderde bevindingen automatisch op "verouderd" zetten. Geen AI-oordeel over de
  concurrent; alleen gecontroleerde verschillen.

### 7.3 Reviews, fora en klantsignalen analyseren (nieuw)

- **Wat het onderzoek zegt:** een getraind taalmodel haalt klantbehoeften uit reviews minstens zo goed als
  professionele analisten, en veel sneller; een niet-getraind model met alleen een goede prompt doet het minder goed
  ([Timoshenko, Mao & Hauser](https://arxiv.org/abs/2503.01870);
  [MSI](https://www.msi.org/working-paper/can-large-language-models-extract-customer-needs-as-well-as-professional-analysts/);
  [reiswereldstudie](https://arxiv.org/pdf/2404.17975)).
- **Toepassing:** een nieuwe bronsoort "klantsignalen": reviews van concurrenten, forumdraden, vacatureteksten en
  aanbestedingen. AI groepeert ze in behoeften en pijnpunten (*jobs to be done*), met per groep de letterlijke
  fragmenten en het aantal. Dit telt als **kwalitatieve observatie**, niet als gedrag, en levert vooral betere
  aannames en interviewvragen op.

### 7.4 Klantinterviews

- **Interviewleidraad:** AI controleert de leidraad op sturende en hypothetische vragen ("Zou u ... gebruiken?") en
  stelt vragen over gedrag in het verleden voor ("Wanneer deed u dit voor het laatst?"). Dat is de kern van goede
  probleeminterviews en goed te automatiseren.
- **Codering van transcripten:** taalmodellen coderen met een vaste codelijst met redelijke tot goede
  overeenstemming met mensen (kappa ongeveer 0,45–0,8, mensen onderling rond 0,73), maar minder goed bij nuance
  ([QualiGPT](https://arxiv.org/pdf/2407.14925); [JMIR 2026](https://formative.jmir.org/2026/1/e85572/PDF);
  [Human-AI concordance](https://arxiv.org/html/2508.14764v2)). ProofLab doet dit al met letterlijk citaat en
  menselijke goedkeuring. **Toevoeging:** de consultant codeert eerst een paar interviews zelf; ProofLab meet de
  overeenstemming met het model en toont die. Is die te laag, dan blijft AI-codering een voorstel per citaat.
- **Kwaliteitscontrole achteraf:** AI markeert in het transcript waar de interviewer stuurde of het idee
  verkocht. Die passages tellen minder zwaar.
- **AI-gemodereerde interviews (eerder besloten: later):** ze winnen op schaal, consistentie en eerlijkheid bij
  gevoelige onderwerpen, maar leveren minder diepte, en deelnemers beoordelen features in één vergelijking lager dan
  bij een menselijke interviewer. Onafhankelijk onderzoek is schaars; de meeste bronnen zijn leveranciers
  ([ustwo-test](https://blog.buildbetter.ai/ustwo-tested-ai-moderated-interviews-synthetic-personas/);
  [Quirks-pilot](https://www.quirks.com/storage/ralene/2026%20Session%20Documents/2026%20DL%20Sess%20Docs/Can%20AI%20Moderate.pdf)).
  **Toepassing:** eerst mensen om de doelgroep en het probleem scherp te krijgen, daarna AI-interviews voor breedte
  (meer respondenten per segment). Resultaten krijgen een eigen label en worden apart gescoord.

### 7.5 Enquêtes

- **Voortesten:** een eerste AI-proef met cognitieve interviews was snel maar oppervlakkig
  ([UKHSA](https://the-sra.org.uk/SRA/Blog/CanLLMsHelpDeliverRapidCognitiveInterviewing.aspx)); menselijke
  cognitieve interviews vinden echte problemen, maar herschreven vragen moeten opnieuw getest worden
  ([Lenzner e.a.](https://link.springer.com/article/10.1007/s11135-022-01489-4)). **Toepassing:** AI als eerste filter
  (onduidelijke woorden, dubbele vragen, sturende formuleringen), daarna 3–5 echte mensen.
- **Grootste risico: nepantwoorden.** Een AI-agent haalde 99,8% van de aandachtscontroles in online enquêtes en kan
  het doel van het onderzoek raden ([Westwood, via 404 Media](https://www.404media.co/a-researcher-made-an-ai-that-completely-breaks-the-online-surveys-scientists-rely-on/);
  [agentic AI en datakwaliteit](https://arxiv.org/pdf/2608.28597);
  [CloudResearch](https://www.cloudresearch.com/resources/blog/ai-survey-fraud-data-quality-part-2/)).
  **Toepassing:** geen anonieme online panels als bewijs. Wel bekende, geverifieerde respondenten (klantenbestand,
  LinkedIn-contact, persoonlijke uitnodiging per kanaal), en de herkomst van elke respons vastleggen.

### 7.6 Gedragsexperimenten

- AI is nuttig om varianten van koppen, aanbod en prijsstaffels te bedenken en om te controleren of een testpagina
  eerlijk is (geen beloftes die het product niet waarmaakt). De varianten worden vóór de vergrendeling gekozen; daarna
  verandert er niets.
- Kanaalkeuze en bereik: AI kan helpen schatten hoeveel bezoekers een kanaal oplevert, maar die schatting telt nooit
  als resultaat.
- Het bewijs zelf blijft gedrag van echte bezoekers, met de bestaande ontdubbeling, botfilter en vooraf vastgelegde
  beslisregel.

### 7.7 Prijsonderzoek

- AI-schattingen van betalingsbereidheid zijn onbetrouwbaar, vooral per segment
  ([NeurIPS-studie](https://neurips.cc/virtual/2026/169654)). Vragen naar prijs (Van Westendorp, Gabor-Granger) geeft een
  bandbreedte; een echte toezegging (aanbetaling, voorverkoop, intentieverklaring met bedrag) voorspelt het best.
- **Toepassing:** AI stelt prijsstaffels en de tekst van de prijstest op; het bewijs komt uit wat mensen echt kiezen.

### 7.8 Analyse en tegenspraak

- AI is sterk in het vinden van tegenargumenten, ontbrekende alternatieven en zwakke plekken in een redenering. Dat
  doet de Reality Check al. **Toevoeging:** een vaste pre-mortem-ronde (zie 3.10) en een "rode team"-prompt die alleen
  zoekt naar bewijs tégen de belangrijkste aanname, met dezelfde citaatcontrole.

### 7.9 Hoe we de AI zelf meten

Elke AI-taak krijgt een eigen kwaliteitsmaat, die we in de app bijhouden:

| Taak | Maat | Drempel om zelfstandig te gebruiken |
|---|---|---|
| Bevindingen uit bronnen | % citaten dat de bewering inhoudelijk draagt (steekproef door consultant) | ≥ 90% |
| Codering interviews | Overeenstemming met consultant (kappa) | ≥ 0,7, anders alleen als voorstel |
| Klantsignalen uit reviews | % groepen dat de consultant herkent en houdt | ≥ 80% |
| Voorspellingen | Brier-score naast consultant en opdrachtgever | Alleen meewegen als niet slechter |

Zo blijft zichtbaar waar AI tijd bespaart zonder de voorspelling slechter te maken.

### 7.10 Aanvulling op de bouwvolgorde

| Fase | Toevoeging uit dit hoofdstuk |
|---|---|
| A | Controle "draagt het citaat de bewering?", controle van interviewleidraden op sturende vragen |
| B | Klantsignalen uit reviews en fora, overeenstemmingsmeting bij AI-codering, herkomst per enquêterespons |
| C | Maandelijkse concurrentiecheck, rode-teamronde, AI-varianten voor testpagina's |
| Later | AI-gemodereerde interviews voor breedte, apart gelabeld en gescoord |

## 6. Besluiten (3 november 2026)

- **Uitkomsttermijn:** zes maanden na het besluit, met een tussenstand na drie maanden.
- **Alle aanpassingen bouwen** volgens het voorstel in dit document.
- **Bronnen voor klantsignalen:** zoveel mogelijk (reviews, fora, nieuws, eigen exports, losse pagina's). LinkedIn
  loopt via **Expandi**: per dossier een webhook die antwoorden, connecties en berichten binnenhaalt; contacten worden
  gepseudonimiseerd, berichten vallen onder dezelfde bewaartermijn als andere persoonsgegevens.
- **AI-gemodereerde interviews:** na de eerste sprints.
- **Coach die meekijkt:** tijdens het hele traject plaatst een coach uit zichzelf tips, waarschuwingen en vragen
  zodra het dossier verandert (vaste regels altijd, AI-tips binnen daglimiet en maandbudget).

## 6b. Eerder open vragen

1. Welke uitkomsthorizon is standaard: 6, 12 of 18 maanden na het besluit?
2. Mag de opdrachtgever zelf voorspellen, en ziet die de scores van de consultant?
3. Willen we AI als extra voorspeller zodra de API-sleutel er is (kost per dossier enkele euro's)?
4. Willen we prijstests met een echte aanbetaling (vraagt een juridische check, eerder uitgesteld)?
5. Welke bronnen voor klantsignalen zijn toegestaan (reviews van concurrenten, fora, LinkedIn)? Sommige platforms
   verbieden automatisch ophalen in hun voorwaarden.
6. Wanneer wil je AI-gemodereerde interviews toevoegen: na de eerste sprints, of pas als de handmatige route bewezen is?

## 8. Leren van uitkomsten (4 november 2026)

Drie mechanismen sluiten de lus "uitkomst meten → leren" uit 3.4. Ze staan op de pagina Voorspelkwaliteit; het
rekenwerk zit in `lib/domain/calibration.ts`, de tellingen in de database. Alles is beschrijvend en wordt pas met
tientallen afgeronde dossiers betrouwbaar.

### 8.1 Geleerde bewijsfactoren (bij 3.5 en 3.7)

- **Wat:** per soort observatie (enquête-uitkomst, demo-aanvraag, aanbetaling, bezwaar, …) en per testtype kijken we
  in afgeronde dossiers of een dossier met een ondersteunende uitkomst van die soort vaker zijn doel haalde dan een
  dossier zonder. De factor is `P(uitkomst | gehaald) / P(uitkomst | niet gehaald)`; voor tegenbewijs andersom.
  "Deels gehaald" telt half in beide groepen.
- **Krimp:** de schatting begint bij de vaste standaardfactor, met per uitkomstgroep twee denkbeeldige dossiers
  (Beta(1,1)-achtig) die precies die factor opleveren. Zonder data is het resultaat de standaardfactor; met meer
  dossiers schuift het naar wat de data laten zien.
- **Drempel:** pas vanaf 8 afgeronde dossiers met een uitkomst van die soort tonen we een geleerde factor; daaronder
  "nog te weinig dossiers: x/8". Als alle afgeronde dossiers dezelfde uitkomst hebben, valt er niets te leren.
- **Alleen in gebruik als de werkruimte het aanzet** (standaard uit; elke consultant kan het omzetten, de database
  legt vast wie en wanneer). Factoren in gebruik zijn minimaal 1 (bewijs keert nooit om) en maximaal 20. Het rapport
  en de aannamepagina vermelden welke factoren zijn gebruikt, zodat elke kans te reproduceren is.
- **Enquête tegenover gedrag:** per aanname met zowel een enquête als een landing- of prijstest vergelijken we de
  oordelen. Zegt de enquête vaak "ja" waar gedrag "nee" zegt, dan overschat zelfrapportage bij onze doelgroepen het
  gedrag.
- **Grenzen:** het is samenhang, geen oorzaak; dossiers verschillen in meer dan alleen dit bewijs. Synthetische data
  en niet-geaccepteerde AI-codering tellen niet mee. Testtypes worden getoond maar nog niet gebruikt bij de keuze van
  de volgende test. Met geleerde factoren aan kan de kans van een aanname veranderen zodra elders een dossier wordt
  afgerond; daarom staat het standaard uit.

### 8.2 Werken de coachtips?

- Per coachregel: hoe vaak geplaatst, gedaan of niet relevant, de mediaan van het aantal dagen tot afhandeling, en
  de stemmen op "Was deze tip nuttig?".
- Voor afgeronde dossiers de Brier-score van de voorspellingen van mensen bij het besluit, apart voor dossiers waar
  de tip werd opgevolgd en waar hij werd genegeerd.
- **Grenzen:** correlatie, geen effect. Teams die tips opvolgen kunnen om andere redenen beter voorspellen, en
  "gedaan" omvat ook notities die de coach zelf sloot omdat het punt was opgelost.

### 8.3 Startkalibratie vóór tien eigen dossiers (bij 3.2 en 3.3)

- **Te zeker?** Zolang de werkruimte minder dan 10 afgeronde dossiers heeft, vergelijken we elke voorspelling met
  het midden van het basispercentage. Ligt die er meer dan 25 procentpunt vanaf terwijl er nog geen landingpage- of
  prijstest is afgerond, dan stelt de coach een vraag (regel `forecast_overconfident`) en markeert de ijkhulp op de
  uitkomstpagina de eigen voorspelling. De coachnotitie noemt geen waarde, persoon of richting, zodat niemand via de
  coach een blinde voorspelling ziet. Wel verraadt ze dat er een verre voorspelling is; dat nemen we bewust voor lief.
- **Gemengde schatting (krimp naar het buitenperspectief):** naast de voorspellingen tonen we als suggestie een
  gewogen gemiddelde van het gemiddelde van de mensen, de AI-voorspelling en het midden van het basispercentage:

  | Situatie | Mensen | AI | Basispercentage |
  |---|---|---|---|
  | Nog geen afgeronde gedragstest | 50% | 20% | 30% |
  | Wel een afgeronde landingpage- of prijstest | 60% | 20% | 20% |

  Ontbreekt een onderdeel, dan worden de gewichten over de rest herverdeeld. De schatting verschijnt alleen voor een
  moment waarop je zelf al hebt voorspeld (of na de uitkomst) en gebruikt alleen voorspellingen die je mag zien. Ze
  vervangt geen voorspelling en telt nergens mee.
- **Bewust geen extremiseren:** samenvoegen en daarna "extremiseren" (verder van 50% duwen) werkt bij goed
  gekalibreerde groepen, maar zonder eigen uitkomstdata zou het de bekende overmoed versterken. We krimpen daarom
  alleen richting het basispercentage. De gewichten zijn startaannames; zodra er genoeg eigen dossiers zijn, ijken we
  ze op de Brier-scores per voorspeller (fase D).

## 9. Methode 2026-11-b: beslisregels en bewijsfactoren (6 november 2026)

Methode 2026-11-a is de rekenwijze tot en met hoofdstuk 8. Methode 2026-11-b verandert drie dingen: de beslisregel
per testtype (9.1), één factor per bron (9.2) en een plafond per bewijsniveau (9.3). De code staat in
`lib/domain/stats.ts` (beslisregels) en `lib/domain/evidence.ts` (`assumptionProbabilityV2`).

### 9.1 Beslisregels per testtype

De intervalregel van 2026-11-a ("geslaagd als ook de ondergrens van het 95%-Wilson-interval boven de drempel ligt")
is bij kleine steekproeven zo streng dat bijna elke test onbeslist eindigt. Voorbeeld: 6 van 20 bij een drempel van
20% geeft een ondergrens van 14,6%: onbeslist, terwijl de kans dat het echte percentage boven 20% ligt 89% is.

- **Kansregel** (landingpagina, prijstest op klikniveau, enquête, interviews): met een vlakke prior Beta(1,1) is de
  posterior Beta(1 + s, 1 + n − s). **Geslaagd** als P(echte waarde > succesdrempel) ≥ 0,80. **Niet geslaagd** als
  P(echte waarde > faaldrempel) ≤ 0,20; zonder faaldrempel geldt de succesdrempel. Daartussen **onbeslist**. Met een
  aparte, lagere faaldrempel is "niet geslaagd" dus strenger: het moet vrijwel zeker zijn dat de waarde zelfs onder
  de faaldrempel ligt.
- **Aantalregel** (sterke handelingen): vooraf ligt een aantal vast, bijvoorbeeld "minstens 3 aanbetalingen uit 15
  gesprekken". Geslaagd als dat aantal na de eindconditie is gehaald; niet gehaald na een volledige steekproef is
  niet geslaagd; minder deelnemers dan afgesproken en het aantal niet gehaald is onbeslist. In de huidige code is
  dit beschikbaar voor interviews: een gesprek telt mee met een vastgelegde aanbetaling of herhaalaankoop
  (`deposit`, `repeat_purchase`; afgekeurde AI-codering telt niet). De prijstest meet een klik op een prijs, geen
  betaling, en valt daarom onder de kansregel. Een getekende offerte heeft nog geen eigen soort waarneming.
- **Sterk bewezen**: de intervalregel blijft bestaan als extra label. Ligt bij een geslaagde test ook de
  Wilson-ondergrens boven de drempel, dan heet de uitkomst "sterk bewezen".
- **Eindconditie en minimale steekproef** blijven: geen oordeel zolang de test loopt; onder de minimale steekproef
  is het resultaat onbeslist.
- **Vooraf rekenen**: de Test Card vraagt de verwachte uitkomst (`expected_pct`) en het aantal beschikbare
  deelnemers per week. Voor de kansregel is het benodigde aantal de kleinste n vanaf waar, met een waargenomen
  aandeel gelijk aan de verwachting, P(p > drempel) ≥ 0,80 blijvend wordt gehaald, met een ondergrens van 5. Voor
  de aantalregel: aantal ÷ verwacht aandeel, naar boven afgerond. ProofLab waarschuwt als dat aantal niet past in
  beschikbaar per week × looptijd, of groter is dan de minimale steekproef. `required_n` wordt met de drempels
  vastgelegd en na goedkeuring vergrendeld, net als de regel, het afgesproken aantal en de aannames erachter.
- **Beperking:** bij een lage drempel geeft de vlakke prior zonder enige data al P(p > drempel) = 1 − drempel (bij
  20% precies 0,80). Bij lage drempels draagt daarom vooral de minimale steekproef het oordeel; de ondergrens van 5
  deelnemers in het benodigde aantal voorkomt een schijnbaar haalbare test van 1 deelnemer. Overweeg bij drempels
  onder 20% een strengere slaaggrens of een prior rond de drempel; dat is een keuze voor een volgende methodeversie.
- De Bayesiaanse schatting met voorkennis (3.6) blijft ter informatie naast het oordeel en telt niet mee in de regel.

### 9.2 Eén factor per bron per aanname

Twaalf antwoorden uit dezelfde enquête of vijf gecodeerde citaten uit hetzelfde interview zijn geen twaalf of vijf
onafhankelijke signalen. In 2026-11-b telt **ondersteunend** bewijs per bron als één signaal: alleen de sterkste
factor (grootste ln(factor) × gewicht) blijft over. "Dezelfde bron" is (`evidenceSourceKey`):

| Signaal | Dezelfde bron = |
|---|---|
| Bevinding (claim) uit bronfragmenten en klantsignalen | de bron (`source_id`) van de bevinding; bij meerdere bronnen de eerste met een letterlijk gecontroleerd citaat |
| Klantsignalen uit outreach (bronnen van het type outreach) | de campagne, ook over meerdere importen heen |
| Enquête- en testwaarnemingen | het experiment (`experiment_id`); open enquêteantwoorden die als bron zijn opgenomen horen bij hun enquête |
| Interviewcodering | het interview (`interview_id`) |
| Overig (losse observatie, bevinding zonder bron) | het signaal zelf |

**Tegenbewijs** (een tegensprekende koppeling, en bezwaren, "probleem niet herkend" en tegenvoorbeelden) wordt niet
samengevoegd en telt per signaal mee, zoals in 2026-11-a. Daarna werkt alles als in 3.5: per soort en richting
afnemend meetellen (log₂(1 + n)), half gewicht voor niet beoordeelde AI-codering, synthetische data telt niet.

**De factoren werken op de kansverhouding (odds):** logit(p) = logit(beginwaarde) + Σ ln(factor) × log₂(1 + n) ×
gewicht. Eén aanbetaling (factor 6) bij een beginwaarde van 50% geeft odds 1 × 6 = 6, dus 6/7 ≈ 86%; een huidige
werkwijze (factor 2) bij 20% geeft odds 0,25 × 2 = 0,5, dus 33%. Dit is in de unittests vastgelegd.

De aannamepagina toont welke signalen zijn samengevoegd, bijvoorbeeld "12 signalen uit Enquête X samengevoegd".
Wie alleen meekijkt (opdrachtgever) ziet geen campagnenamen of interviewlabels, maar rekent met dezelfde groepering.

### 9.3 Plafond per bewijsniveau

De berekende kans wordt begrensd door het hoogste bewijsniveau onder het ondersteunende bewijs dat volledig meetelt
(niet beoordeelde AI-codering tilt het niveau niet op). Standaardwaarden, instelbaar per werkruimte door de
eigenaar (pagina Voorspelkwaliteit; tabel `org_evidence_caps`, elke wijziging in het auditspoor):

| Niveau | Soorten bewijs | Plafond |
|---|---|---|
| Meningen, enquêtes en bureauonderzoek | mening, enquête-uitkomst, overige observatie, alle bevindingen uit bronnen | 40% |
| Probleem in eigen gedrag of huidige uitgaven | probleem herkend in eigen recent gedrag, huidige werkwijze, huidige uitgaven | 50% |
| Kleine handeling | aanmelding wachtlijst, demo aangevraagd | 60% |
| Offerte of prijsaanbod gekozen | offerte of prijsaanbod gekozen | 75% |
| Aanbetaling | aanbetaling | 90% |
| Herhaalaankoop | herhaalaankoop | geen plafond (wel de algemene grens van 99%) |

Tegenbewijs (bezwaar, probleem niet herkend, tegenvoorbeeld) tilt nooit een niveau op. Zonder ondersteunend bewijs
geldt het laagste niveau: een aanname zonder bewijs staat dus op hoogstens 40%, ook bij een hogere beginwaarde.
Zo kan meer ondersteunend bewijs de kans nooit verlagen. Is het plafond actief, dan toont ProofLab wat er
ontbreekt, bijvoorbeeld "begrensd op 75%: nog geen aanbetaling", met de kans zonder plafond ernaast. De
bandbreedte wordt op dezelfde manier begrensd.
