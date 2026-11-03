# ProofLab: hoe voorspellen we de uitkomst zo goed mogelijk?

Onderzoek naar methodes die de voorspelkracht van ProofLab kunnen verbeteren, en hoe we ze toepassen.
Versie 1, 3 november 2026.

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

## 6. Open vragen voor Hylke

1. Welke uitkomsthorizon is standaard: 6, 12 of 18 maanden na het besluit?
2. Mag de opdrachtgever zelf voorspellen, en ziet die de scores van de consultant?
3. Willen we AI als extra voorspeller zodra de API-sleutel er is (kost per dossier enkele euro's)?
4. Willen we prijstests met een echte aanbetaling (vraagt een juridische check, eerder uitgesteld)?
