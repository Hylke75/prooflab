// Woordenboek van vaktermen (uitlegtooltips). Eén centrale plek voor de teksten: het component
// components/ui/Term.tsx toont ze bij hover, focus en tik. De uitleg volgt hoe ProofLab de term echt gebruikt
// (lib/domain/* en docs/ProofLab_Voorspelkracht_v1.md); pas hem hier aan als de rekenwijze verandert.
// Bewust zonder imports, zodat de unit-test en elk component dit bestand los kunnen laden.

export type GlossaryEntry = {
  term: string; // de term zoals hij bovenaan de tooltip staat
  uitleg: string; // 1–2 zinnen in gewone taal
  meer?: string; // optioneel: één extra zin (geen link: een tooltip bevat geen bedieningselementen)
};

export const GLOSSARY = {
  "beslissende-vraag": {
    term: "Beslissende vraag",
    uitleg:
      "Een onderzoeksvraag waarvan het antwoord het besluit echt verandert; per idee zijn het er hooguit vijf. De marktstap is pas klaar als de eerste beslissende vraag is beantwoord met minstens één geverifieerde bevinding.",
  },
  aanname: {
    term: "Aanname",
    uitleg:
      "Iets wat waar moet zijn om het idee te laten slagen, geschreven als één toetsbare bewering. Elke aanname start op 50% kans (“we weten het niet”) en schuift alleen door bewijs.",
  },
  "kritieke-aanname": {
    term: "Kritieke aanname",
    uitleg:
      "Een aanname met belangrijkheid 4 of 5: klopt ze niet, dan valt het idee (grotendeels) om. Op de risicokaart is zo’n aanname rood zolang de geschatte kans onder 70% ligt.",
  },
  hoofdtest: {
    term: "Hoofdtest",
    uitleg:
      "De ene test die je vooraf per aanname aanwijst; alleen die beslist over de status van de aanname en telt in de go-regel. Na goedkeuring ligt de keuze vast, zodat niemand achteraf de test kiest die toevallig slaagde.",
  },
  "verkennende-test": {
    term: "Verkennende test",
    uitleg: "Elke andere test bij een aanname dan de hoofdtest. Hij geeft richting, maar beslist niet over de aanname of het besluit.",
  },
  "test-card": {
    term: "Test Card",
    uitleg:
      "Het testplan dat je vóór de start vastlegt: wat je denkt, bij wie, hoe je het toetst, wat je meet en wanneer het klopt. Na goedkeuring is het vergrendeld; wijzigen kan alleen met een nieuwe versie en een motivering.",
  },
  beslisregel: {
    term: "Beslisregel van een test",
    uitleg:
      "Hoe ProofLab na afloop bepaalt of een test geslaagd is: met de kansregel (voor percentages) of de aantalregel (voor sterke handelingen zoals aanbetalingen). Je kiest hem vooraf, samen met de drempels.",
  },
  succesdrempel: {
    term: "Succesdrempel",
    uitleg:
      "Het percentage dat de test vooraf minstens moet halen om te slagen. Je legt hem vast vóórdat ProofLab uitrekent hoeveel deelnemers je nodig hebt, en ProofLab stelt nooit een lagere drempel voor.",
  },
  faaldrempel: {
    term: "Faaldrempel",
    uitleg:
      "De ondergrens die je vooraf vastlegt: ligt het echte percentage vrijwel zeker niet boven deze waarde, dan is de test niet geslaagd. Valt de uitkomst tussen faal- en succesdrempel, dan is de test onbeslist.",
  },
  "minimale-steekproef": {
    term: "Minimale steekproef",
    uitleg:
      "Het aantal deelnemers dat een test minstens moet halen. Rond je eerder af, dan geef je een reden en telt de uitkomst niet mee in kans en rangorde.",
  },
  kansregel: {
    term: "Kansregel",
    uitleg:
      "Beslisregel voor tests die een percentage meten. Geslaagd als de kans dat het echte percentage boven de succesdrempel ligt minstens 80% is; niet geslaagd als de kans dat het boven de faaldrempel ligt 20% of minder is.",
  },
  aantalregel: {
    term: "Aantalregel",
    uitleg:
      "Beslisregel voor sterke handelingen zoals aanbetalingen en herhaalaankopen: geslaagd als na de eindconditie minstens het vooraf afgesproken aantal is gehaald, bijvoorbeeld 3 aanbetalingen uit 15 gesprekken.",
  },
  "interval-95": {
    term: "95%-interval",
    uitleg:
      "De bandbreedte waarbinnen het echte percentage vrijwel zeker ligt, gegeven het aantal deelnemers (Wilson-interval). Ligt ook de ondergrens boven de succesdrempel, dan heet een geslaagde test “sterk bewezen”.",
  },
  bewijsniveau: {
    term: "Bewijsniveau",
    uitleg:
      "Hoe sterk een soort bewijs is: van meningen en bureauonderzoek, via een probleem in eigen gedrag, een kleine handeling en een gekozen prijsaanbod, tot een aanbetaling en een herhaalaankoop. Wat mensen doen weegt zwaarder dan wat ze zeggen.",
  },
  plafond: {
    term: "Plafond (begrensd)",
    uitleg:
      "De hoogste kans die een aanname met het huidige bewijsniveau kan krijgen, hoeveel bewijs van dat niveau er ook is. “Begrensd” betekent dat het plafond de kans nu tegenhoudt; alleen sterker bewijs tilt het op.",
  },
  informatiewaarde: {
    term: "Informatiewaarde (IW)",
    uitleg:
      "Hoeveel een test aan het besluit kan veranderen voor zijn tijd en geld: belang × onzekerheid × hoeveel de goedkoopste geschikte test de kans kan verschuiven, gedeeld door de kosten. Score 100 is de hoogste in dit dossier.",
  },
  basispercentage: {
    term: "Basispercentage",
    uitleg:
      "Hoe vaak vergelijkbare ideeën uit een referentiegroep hun doel haalden. Het is het startpunt van elke voorspelling; zonder gedragsbewijs blijven goede voorspellers er dicht bij.",
  },
  "reality-check": {
    term: "Reality Check",
    uitleg:
      "Een verplichte controle op vaste regels vóór elk besluit en rapport. Hij zoekt valkuilen, zwakke data en conclusies die het bewijs niet draagt; AI mag kritische vragen toevoegen, maar de regels draaien altijd.",
  },
  "learning-card": {
    term: "Learning Card",
    uitleg:
      "Het verslag van een afgeronde test: wat we verwachtten, wat de ruwe, ontdubbelde metingen lieten zien, de beperkingen en wat het betekent. Pas na goedkeuring telt de uitkomst mee voor de aanname.",
  },
  "go-regel": {
    term: "Go-regel",
    uitleg:
      "De beslisregel van het dossier, vooraf vastgelegd: doorgaan als de gekozen aannames hun minimale kans halen en de hoofdtest slaagt. Wie bij het besluit afwijkt, motiveert dat; die motivering staat in het rapport.",
  },
  wervingsgroep: {
    term: "Wervingsgroep",
    uitleg:
      "Via welke weg de deelnemers zijn geworven: eigen netwerk, warm contact, koud, betaald panel of onbekend. Herhaalde signalen uit dezelfde groep zijn geen onafhankelijk bewijs en tellen afnemend mee.",
  },
  "per-persoon": {
    term: "Per persoon tellen",
    uitleg:
      "Uit één interview telt per bewijsniveau en per richting (steun of tegenspraak) maar één uitspraak mee: de sterkste. Zo levert één enthousiaste geïnterviewde geen vijf “bewijzen” op.",
  },
  oefengesprek: {
    term: "Oefengesprek",
    uitleg:
      "Een oefening of fictief gesprek. Alleen een gesprek dat uitdrukkelijk als echt is aangegeven telt als bewijs; oefengesprekken en niet-aangegeven gesprekken tellen nergens mee.",
  },
  "geverifieerde-bron": {
    term: "Geverifieerde bron",
    uitleg:
      "Een bevinding is geverifieerd als het citaat letterlijk in een officiële of primaire bron staat, of als minstens twee onafhankelijke bronnen het bevestigen, en de bron niet te oud is. ProofLab bepaalt die status zelf; een AI-tekst is nooit een bron.",
  },
  "letterlijk-citaat": {
    term: "Letterlijk citaat",
    uitleg:
      "Het stukje tekst uit de bron dat de bewering draagt. ProofLab controleert dat het woord voor woord in het bewaarde fragment staat en dat elk getal uit de bewering er met dezelfde eenheid in voorkomt.",
  },
  tegenbewijs: {
    term: "Tegenbewijs",
    uitleg:
      "Alles wat een aanname of het idee tegenspreekt: een bezwaar, “probleem niet herkend”, een tegenvoorbeeld, een mislukte test of een tegensprekende bron. Het verlaagt de kans en blijft altijd zichtbaar naast het steunende bewijs.",
  },
  tam: {
    term: "TAM (totale markt)",
    uitleg: "Alle relevante organisaties of personen in het gebied: het basisaantal, vóór je kijkt wie het probleem heeft of bereikbaar is.",
  },
  sam: {
    term: "SAM (bedienbare markt)",
    uitleg: "Het deel van de TAM dat het probleem (en het budget) heeft en dat je via je kanalen kunt bereiken: basisaantal × deel met het probleem × bereikbaar deel.",
  },
  som: {
    term: "SOM (haalbare markt)",
    uitleg:
      "Het deel van de SAM dat je realistisch binnen drie jaar kunt winnen. Maal de jaaromzet per klant geeft dat de bereikbare jaaromzet; een geschat websitebezoek is geen bewezen marktomvang.",
  },
  "brier-score": {
    term: "Brier-score",
    uitleg:
      "Meet achteraf hoe goed een voorspelde kans was: het kwadraat van het verschil tussen de kans en wat er gebeurde. 0 is perfect, 0,25 haal je door steeds 50% te zeggen en 1 is stellig en fout.",
  },
  "ai-voorstel": {
    term: "Voorstel (AI)",
    uitleg:
      "Een AI-codering waarvan het citaat letterlijk in het transcript staat, maar die nog niemand heeft beoordeeld. Hij telt pas als bewijs na akkoord van een consultant; afgewezen telt hij nooit.",
  },
  "ai-drempel": {
    term: "Drempel voor AI-kwaliteit",
    uitleg:
      "ProofLab meet hoe vaak consultants het eens zijn met de AI, over minstens 10 beoordelingen. Onder de drempel blijft elk AI-oordeel een voorstel dat een mens moet bevestigen.",
  },
  kalibratie: {
    term: "Kalibratie",
    uitleg:
      "Of gegeven kansen kloppen met wat er gebeurt: van alles wat 70% kreeg, moet ongeveer 70% uitkomen. Tot een werkruimte 10 afgeronde dossiers heeft, toont ProofLab kansen als band van 10 procentpunt rond de waarde met “niet gekalibreerd”.",
  },
} as const satisfies Record<string, GlossaryEntry>;

export type GlossaryKey = keyof typeof GLOSSARY;

export function glossaryEntry(k: GlossaryKey): GlossaryEntry {
  return GLOSSARY[k];
}

export function isGlossaryKey(k: string): k is GlossaryKey {
  return Object.prototype.hasOwnProperty.call(GLOSSARY, k);
}
