// Experimentencatalogus (functioneel ontwerp §7): een eigen, geïndexeerde catalogus van testmethodes. Alle teksten,
// indelingen en startwaarden zijn door ProofLab zelf geschreven; er zijn geen beschrijvingen of beoordelingen uit
// andere methodeboeken overgenomen.
//
// Elke methode draait in ProofLab op één van drie manieren:
// - builtin: als bestaand testtype met eigen automatisering (testpagina, enquête, interviews);
// - manual: als begeleid handmatig sjabloon. Het team voert de methode zelf uit en voert de ruwe resultaten in
//   (aantallen, per waarneming een notitie en eventueel een bewijsbestand); die tellen als "handmatig ingevoerd";
// - source: als bureauonderzoek. Geen klanttest: de uitkomst wordt een bron met citaat onder Marktverkenning.
//
// De bewijssterkte wordt nooit per methode "gegeven", maar afgeleid uit de soort waarneming (evidenceKind) via de
// bestaande bewijsladder (evidence-scale.ts, KIND_LEVEL en KIND_DEFAULTS in evidence.ts). Zo kan een methode nooit
// sterker lijken dan de ladder toestaat. Handmatige methodes blijven bovendien onder het plafond uit manual-kind.ts.
// Puur, zonder database.

import { KIND_DEFAULTS, KIND_LEVEL, LEVEL_SHORT, OBSERVATION_LR, type EvidenceLevel } from "./evidence";
import { EVIDENCE_SCALE, scaleIndex, scaleOfKind, type ScaleStep } from "./evidence-scale";
import { EXPERIMENT_TYPES, OBSERVATION_KINDS, type BuiltinExperimentType, type ExperimentType, type ObservationKind } from "./labels";
import { catalogMethodIdOf, isManualObservationKind, type ManualObservationKind } from "./manual-kind";
import type { SuccessMetric } from "./success-metric";
import type { AssumptionKind } from "./assumption-kind";
import type { Option, VoiTestType } from "./recommend";

export type CatalogCategory = "verkennen" | "valideren";
export type Lens = "desirability" | "feasibility" | "viability";
export type CostBand = "laag" | "middel" | "hoog";
export type TimeBand = "dagen" | "weken" | "maanden";
export type Audience = "b2b" | "b2c";
export type RunsKind = "builtin" | "manual" | "source";

export type CatalogRuns =
  | { kind: "builtin"; type: BuiltinExperimentType; successMetric?: SuccessMetric }
  | { kind: "manual" }
  | { kind: "source" };

// Startwaarden voor de testkaart. Altijd aanpasbaar; ze liggen pas vast na goedkeuring.
export type CardTemplate = {
  test_method: string;
  metric_label: string;
  metric_numerator: string;
  metric_denominator: string;
  success_threshold_pct: number;
  fail_threshold_pct: number;
  min_sample: number;
  max_duration_days: number;
  expected_biases: string;
};

export type CatalogSteps = {
  before: string[]; // voorbereiden en vooraf vastleggen
  during: string[]; // tijdens de test bijhouden
  after: string[]; // afronden en invoeren
};

export type CatalogMethod = {
  id: string;
  name: string;
  summary: string;
  category: CatalogCategory;
  lenses: Lens[];
  // De sterkste soort waarneming die de methode kan opleveren; null = bureauonderzoek (geen klantwaarneming).
  evidenceKind: ObservationKind | null;
  cost: CostBand;
  costText: string;
  time: TimeBand;
  timeText: string;
  sample: string;
  audiences: Audience[];
  proves: string;
  doesNotProve: string;
  pitfalls: string[];
  runs: CatalogRuns;
  steps: CatalogSteps;
  card: CardTemplate | null;
  // Handmatig: hoe heet één eenheid in de invoer ("gesprek", "bezoeker")?
  unit?: { one: string; many: string };
};

export const CATEGORIES: Record<CatalogCategory, { label: string; explain: string }> = {
  verkennen: { label: "Verkennen", explain: "Begrijpen: bestaat het probleem, hoe lossen mensen het nu op, wat kost het ze?" },
  valideren: { label: "Valideren", explain: "Bewijzen: doen mensen iets als je een concreet aanbod doet?" },
};

export const LENSES: Record<Lens, { label: string; question: string }> = {
  desirability: { label: "Wenselijkheid", question: "Willen klanten dit?" },
  feasibility: { label: "Haalbaarheid", question: "Kunnen we dit leveren?" },
  viability: { label: "Levensvatbaarheid", question: "Kunnen we hier duurzaam geld mee verdienen?" },
};

export const COST_BANDS: Record<CostBand, string> = { laag: "Laag (tot € 100)", middel: "Middel (€ 100–1.000)", hoog: "Hoog (boven € 1.000)" };
export const TIME_BANDS: Record<TimeBand, string> = { dagen: "Dagen (binnen een week)", weken: "Weken (1–4 weken)", maanden: "Maanden (langer dan 4 weken)" };
export const AUDIENCES: Record<Audience, string> = { b2b: "Zakelijk (B2B)", b2c: "Consument (B2C)" };
export const RUNS_LABELS: Record<RunsKind, { label: string; explain: string }> = {
  builtin: { label: "Ingebouwd", explain: "ProofLab voert de meting zelf uit en telt de resultaten." },
  manual: { label: "Handmatig sjabloon", explain: "Je voert de methode zelf uit met een draaiboek en voert de ruwe resultaten in." },
  source: { label: "Bureauonderzoek", explain: "Geen klanttest: je legt de uitkomst vast als bron met citaat onder Marktverkenning." },
};

// Vaste eerste stap van elk sjabloon met een testkaart: eerst de lat, dan de test.
export const TEST_CARD_STEP =
  "Leg in de testkaart vast: de hypothese, wat je telt (teller) en waarvan (noemer), de succes- en faaldrempel, de minimale steekproef en de deadline. Na goedkeuring liggen ze vast.";
// Vaste laatste stap van een handmatig sjabloon: invoer en oordeel.
export const MANUAL_RESULT_STEP =
  "Voer elke waarneming of telling in zodra je hem hebt, met een korte notitie zonder namen. Een oordeel volgt pas na de deadline of als je de test afrondt, met de drempels van vóór de start.";

const iv = (m: Omit<CatalogMethod, "runs"> & { runs?: CatalogRuns }): CatalogMethod => ({ runs: { kind: "builtin", type: "interview" }, ...m });

export const CATALOG: readonly CatalogMethod[] = [
  // -------------------------------------------------------------------------------------------------------------
  // Verkennen: gesprekken, enquête en observatie
  // -------------------------------------------------------------------------------------------------------------
  iv({
    id: "probleeminterviews",
    name: "Probleeminterviews",
    summary: "Gesprekken over de laatste keer dat iemand het probleem had: wat er gebeurde, wat het kostte en hoe het nu wordt opgelost.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "problem_confirmed",
    cost: "laag",
    costText: "€ 0, alleen tijd",
    time: "weken",
    timeText: "1–2 weken",
    sample: "8–12 gesprekken per segment",
    audiences: ["b2b", "b2c"],
    proves: "Of het probleem in recent, eigen gedrag voorkomt en hoe mensen het nu oplossen.",
    doesNotProve: "Of mensen jouw oplossing gaan kopen of wat ze ervoor betalen.",
    pitfalls: ["Je oplossing pitchen in plaats van luisteren.", "Vragen naar de toekomst (\"zou je …\") in plaats van naar de laatste keer.", "Alleen bekenden spreken."],
    steps: {
      before: ["Kies één segment en schrijf een selectievraag op die bekenden en niet-doelgroep uitsluit.", "Gebruik de neutrale leidraad: alleen vragen over gedrag in het verleden."],
      during: ["Vraag per gesprek om toestemming en leg vast of het een bekende is.", "Noteer letterlijke uitspraken; codeer daarna wat iemand echt deed."],
      after: ["Codeer per gesprek of het probleem met een recent voorbeeld werd beschreven.", "Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Probleeminterviews over de laatste keer (geen pitch)",
      metric_label: "Probleem herkend in eigen recent gedrag",
      metric_numerator: "geïnterviewden die het probleem met een recent eigen voorbeeld beschrijven",
      metric_denominator: "geïnterviewden uit de doelgroep",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 8,
      max_duration_days: 14,
      expected_biases: "Bekenden zijn vriendelijker; mensen vertellen liever wat ze zouden doen dan wat ze deden.",
    },
  }),
  iv({
    id: "uitgaveninterviews",
    name: "Uitgaveninterviews",
    summary: "Gesprekken over wat het probleem nu werkelijk kost: geld, uren, uitbesteding en wie daarover beslist.",
    category: "verkennen",
    lenses: ["viability"],
    evidenceKind: "current_spend",
    cost: "laag",
    costText: "€ 0, alleen tijd",
    time: "weken",
    timeText: "1–2 weken",
    sample: "8–12 gesprekken met budgethouders",
    audiences: ["b2b", "b2c"],
    proves: "Hoeveel er nu al aan het probleem wordt uitgegeven: een anker voor een realistische prijs.",
    doesNotProve: "Dat iemand dat bedrag aan jóu gaat betalen.",
    pitfalls: ["Vragen \"wat zou je ervoor betalen?\": dat antwoord voorspelt weinig.", "Alleen gebruikers spreken terwijl een ander het budget heeft."],
    steps: {
      before: ["Spreek af met wie je praat: de gebruiker én wie het budget beheert.", "Voeg de vragen over huidige uitgaven en budget aan de leidraad toe."],
      during: ["Vraag naar bedragen en facturen van de afgelopen periode, niet naar schattingen voor later.", "Noteer wie heeft beslist over de laatste uitgave."],
      after: ["Codeer per gesprek of er een concrete huidige uitgave werd genoemd.", "Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Interviews over huidige uitgaven en budget (geen prijsvraag over de toekomst)",
      metric_label: "Noemt een concrete huidige uitgave aan het probleem",
      metric_numerator: "geïnterviewden die een concreet bedrag of aantal uren van de afgelopen periode noemen",
      metric_denominator: "geïnterviewden met budgetverantwoordelijkheid",
      success_threshold_pct: 50,
      fail_threshold_pct: 20,
      min_sample: 8,
      max_duration_days: 14,
      expected_biases: "Bedragen worden uit het hoofd vaak te hoog of te laag genoemd; vraag waar mogelijk naar een factuur.",
    },
  }),
  iv({
    id: "leveranciersgesprekken",
    name: "Gesprekken met leveranciers en experts",
    summary: "Toets bij mensen die het moeten leveren of al leveren of jouw aanpak uitvoerbaar is, en wat het kost.",
    category: "verkennen",
    lenses: ["feasibility"],
    evidenceKind: "current_behaviour",
    cost: "laag",
    costText: "€ 0–250 (soms een vergoeding)",
    time: "weken",
    timeText: "1–3 weken",
    sample: "5–8 gesprekken",
    audiences: ["b2b"],
    proves: "Hoe het leveren nu in de praktijk gaat, waar het vastloopt en welke kosten realistisch zijn.",
    doesNotProve: "Of klanten het willen. Een expert is geen klant.",
    pitfalls: ["Eén enthousiaste expert als bewijs zien.", "Een leverancier spreken die vooral iets wil verkopen."],
    steps: {
      before: ["Maak een lijst van wat er technisch en operationeel waar moet zijn.", "Kies experts die het zelf doen, niet alleen erover adviseren."],
      during: ["Vraag naar de laatste keer dat ze iets vergelijkbaars leverden: doorlooptijd, kosten, problemen."],
      after: ["Codeer per gesprek of de aanpak met een concreet eigen voorbeeld uitvoerbaar bleek.", "Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Gesprekken met leveranciers en uitvoerende experts over hun recente praktijk",
      metric_label: "Aanpak uitvoerbaar volgens eigen recente praktijk",
      metric_numerator: "experts die met een eigen recent voorbeeld laten zien dat het zo te leveren is",
      metric_denominator: "gesproken uitvoerende experts",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 5,
      max_duration_days: 21,
      expected_biases: "Leveranciers zijn optimistisch over hun eigen kunnen; vraag naar wat er misging.",
    },
  }),
  iv({
    id: "koopproces-interviews",
    name: "Interviews over het koopproces",
    summary: "Breng in kaart wie in een organisatie meebeslist, wie betaalt en hoe de laatste vergelijkbare aankoop verliep.",
    category: "verkennen",
    lenses: ["viability", "desirability"],
    evidenceKind: "current_behaviour",
    cost: "laag",
    costText: "€ 0, alleen tijd",
    time: "weken",
    timeText: "2–3 weken",
    sample: "6–10 organisaties, liefst twee rollen per organisatie",
    audiences: ["b2b"],
    proves: "Hoe een aankoop werkelijk verloopt: rollen, doorlooptijd, budgetmoment en bezwaren.",
    doesNotProve: "Dat jouw aanbod door dat proces komt.",
    pitfalls: ["Alleen de enthousiaste gebruiker spreken.", "Aannemen dat de gesprekspartner ook beslist."],
    steps: {
      before: ["Bepaal welke rollen je per organisatie wilt spreken (gebruiker, inkoper, betaler, beslisser)."],
      during: ["Vraag naar de laatste vergelijkbare aankoop: wie zette hem in gang, wie tekende, hoe lang duurde het?"],
      after: ["Codeer per organisatie of het koopproces concreet beschreven werd.", "Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Interviews over de laatste vergelijkbare aankoop, per rol in het koopproces",
      metric_label: "Koopproces concreet beschreven",
      metric_numerator: "organisaties waarvan beslisser en budgetmoment met een recente aankoop zijn beschreven",
      metric_denominator: "gesproken organisaties uit de doelgroep",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 6,
      max_duration_days: 21,
      expected_biases: "Eén gesprekspartner overziet zelden het hele proces; vraag door naar andere rollen.",
    },
  }),
  {
    id: "online-enquete",
    name: "Online enquête over recent gedrag",
    summary: "Meet bij veel mensen hoe vaak iets voorkomt en wat ze nu doen, met één vooraf vastgelegde kernvraag.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "survey_answer",
    cost: "laag",
    costText: "€ 0 (panel optioneel)",
    time: "weken",
    timeText: "1–2 weken",
    sample: "50–200 geloofwaardige antwoorden",
    audiences: ["b2b", "b2c"],
    proves: "Hoe vaak wat je in gesprekken hoorde voorkomt, volgens de mensen zelf.",
    doesNotProve: "Wat mensen werkelijk gaan doen of betalen: het blijft zelfrapportage.",
    pitfalls: ["Vragen naar de toekomst of naar meningen over jouw idee.", "Alleen via een open link verspreiden, zodat je niet weet wie antwoordt."],
    runs: { kind: "builtin", type: "survey" },
    steps: {
      before: ["Doe eerst een paar interviews, zodat vragen en antwoordopties kloppen.", "Leg één kernvraag en de succesantwoorden vast.", "Leg de vragen voor aan 3–5 mensen uit de doelgroep."],
      during: ["Nodig bij voorkeur persoonlijk uit; houd open-linkantwoorden apart."],
      after: ["Rond af en maak de leerkaart; bevestig de uitkomst daarna met een gedragstest."],
    },
    card: {
      test_method: "Enquête over recent gedrag met één vooraf vastgelegde kernvraag",
      metric_label: "Kernvraag: gekozen succesantwoord",
      metric_numerator: "respondenten die een succesantwoord kozen",
      metric_denominator: "respondenten die de kernvraag beantwoordden",
      success_threshold_pct: 40,
      fail_threshold_pct: 15,
      min_sample: 50,
      max_duration_days: 21,
      expected_biases: "Zelfrapportage: mensen overschatten hun eigen gedrag; wie reageert is vaak extra betrokken.",
    },
  },
  {
    id: "veldobservatie",
    name: "Veldobservatie",
    summary: "Kijk op de plek waar het gebeurt hoe mensen een taak nu uitvoeren, zonder in te grijpen.",
    category: "verkennen",
    lenses: ["desirability", "feasibility"],
    evidenceKind: "current_behaviour",
    cost: "laag",
    costText: "€ 0–100 (reistijd)",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "10–20 waargenomen situaties",
    audiences: ["b2b", "b2c"],
    proves: "Wat mensen werkelijk doen, inclusief omwegen en hulpmiddelen die ze in een gesprek vergeten.",
    doesNotProve: "Waarom ze het zo doen, of dat ze iets anders willen.",
    pitfalls: ["Mensen gaan zich anders gedragen als ze weten dat je kijkt.", "Achteraf alleen de situaties onthouden die je verwachtte."],
    runs: { kind: "manual" },
    unit: { one: "waargenomen situatie", many: "waargenomen situaties" },
    steps: {
      before: ["Vraag toestemming aan de locatie en aan wie je observeert.", "Schrijf vooraf op wat precies telt als \"het probleem treedt op\".", "Maak een observatieformulier: tijd, plek, wat gebeurde er, welk hulpmiddel."],
      during: ["Noteer elke situatie direct, ook als het probleem níét optreedt.", "Geen namen of herkenbare foto's; een eigen code per situatie."],
      after: ["Tel per situatie of het probleem optrad volgens je vooraf vastgelegde definitie."],
    },
    card: {
      test_method: "Observatie ter plaatse met een vooraf vastgelegd observatieformulier",
      metric_label: "Probleem waargenomen in de praktijk",
      metric_numerator: "waargenomen situaties waarin het probleem volgens de vooraf vastgelegde definitie optrad",
      metric_denominator: "waargenomen situaties in de doelgroep",
      success_threshold_pct: 40,
      fail_threshold_pct: 15,
      min_sample: 10,
      max_duration_days: 7,
      expected_biases: "Waarnemerseffect: mensen gedragen zich netter als ze bekeken worden. Je ziet vooral wat je verwacht.",
    },
  },
  {
    id: "dagboekstudie",
    name: "Dagboekstudie",
    summary: "Deelnemers houden een korte periode bij wanneer het probleem optreedt en wat ze dan doen.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "current_behaviour",
    cost: "middel",
    costText: "€ 100–500 (bedankje per deelnemer)",
    time: "weken",
    timeText: "1–3 weken",
    sample: "8–15 deelnemers",
    audiences: ["b2b", "b2c"],
    proves: "Hoe vaak het probleem in een gewone week voorkomt en wat het mensen kost.",
    doesNotProve: "Dat mensen voor een oplossing kiezen.",
    pitfalls: ["Deelnemers haken na een paar dagen af.", "Een te uitgebreid formulier, zodat alleen de fanatiekste deelnemers bijhouden."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Kies een korte periode (5–10 dagen) en een formulier van hooguit drie vragen.", "Spreek toestemming en bewaartermijn af; geen namen in de notities."],
      during: ["Stuur een vaste herinnering en noteer wie afhaakt.", "Bewaar de ingevulde formulieren als bewijsbestand (zonder namen)."],
      after: ["Tel per deelnemer of het probleem in de periode minstens het vooraf vastgelegde aantal keren optrad."],
    },
    card: {
      test_method: "Dagboekstudie van een vaste periode met een kort formulier",
      metric_label: "Probleem trad vaak genoeg op in de periode",
      metric_numerator: "deelnemers bij wie het probleem minstens het vooraf afgesproken aantal keren optrad",
      metric_denominator: "deelnemers die de periode volhielden",
      success_threshold_pct: 50,
      fail_threshold_pct: 20,
      min_sample: 8,
      max_duration_days: 21,
      expected_biases: "Bijhouden verandert gedrag; afhakers zijn vaak juist mensen met minder last.",
    },
  },
  {
    id: "klantcontact-analyse",
    name: "Analyse van klantvragen en klachten",
    summary: "Tel in bestaande kanalen (support, mail, chat) hoe vaak het probleem spontaan wordt gemeld.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "problem_confirmed",
    cost: "laag",
    costText: "€ 0, alleen tijd",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "100+ klantcontacten uit een vaste periode",
    audiences: ["b2b", "b2c"],
    proves: "Dat het probleem spontaan, zonder jouw vraag, door bestaande klanten wordt gemeld.",
    doesNotProve: "Hoe groot het probleem is bij mensen die (nog) geen klant zijn.",
    pitfalls: ["Alleen de laatste week bekijken.", "Achteraf de definitie oprekken tot alles meetelt."],
    runs: { kind: "manual" },
    unit: { one: "klantcontact", many: "klantcontacten" },
    steps: {
      before: ["Kies een vaste periode en de kanalen die je meetelt.", "Schrijf op wanneer een contact over het probleem gaat (zoekwoorden en voorbeelden)."],
      during: ["Tel per dag of week; voer de telling in als één regel met een notitie over de bron."],
      after: ["Voeg een export of telformulier zonder persoonsgegevens toe als bewijsbestand."],
    },
    card: {
      test_method: "Telling van klantcontacten over het probleem in een vaste periode",
      metric_label: "Contact gaat over het probleem",
      metric_numerator: "klantcontacten die volgens de vooraf vastgelegde definitie over het probleem gaan",
      metric_denominator: "alle klantcontacten in de periode",
      success_threshold_pct: 5,
      fail_threshold_pct: 1,
      min_sample: 100,
      max_duration_days: 14,
      expected_biases: "Alleen ontevreden klanten melden zich; stille klanten tellen niet mee.",
    },
  },
  {
    id: "meeloopdag",
    name: "Meeloopdag",
    summary: "Loop een dag mee met iemand uit de doelgroep en zie het hele werkproces rond het probleem.",
    category: "verkennen",
    lenses: ["desirability", "feasibility"],
    evidenceKind: "current_behaviour",
    cost: "laag",
    costText: "€ 0–100",
    time: "weken",
    timeText: "1–3 weken",
    sample: "5–8 meeloopdagen",
    audiences: ["b2b"],
    proves: "Hoe het probleem past in het dagelijkse werk, en welke werkwijze en hulpmiddelen er nu zijn.",
    doesNotProve: "Hoe vaak dit bij anderen voorkomt: het zijn weinig, diepe waarnemingen.",
    pitfalls: ["Een dag uitkiezen waarop het probleem toevallig niet speelt.", "Te veel vragen stellen en zo het werk sturen."],
    runs: { kind: "manual" },
    unit: { one: "meeloopdag", many: "meeloopdagen" },
    steps: {
      before: ["Spreek doel, toestemming en vertrouwelijkheid af met de organisatie.", "Leg vast wat telt als \"het probleem kost hier tijd of geld\"."],
      during: ["Noteer per dag de momenten waarop het probleem speelt en hoe lang het duurt."],
      after: ["Tel per meeloopdag of het probleem volgens je definitie optrad."],
    },
    card: {
      test_method: "Meeloopdagen bij mensen uit de doelgroep met een vast observatieformulier",
      metric_label: "Probleem trad op tijdens de meeloopdag",
      metric_numerator: "meeloopdagen waarop het probleem volgens de vooraf vastgelegde definitie optrad",
      metric_denominator: "meeloopdagen bij mensen uit de doelgroep",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 5,
      max_duration_days: 21,
      expected_biases: "Organisaties laten liever een goede dag zien; weinig dagen, dus grote toevalsmarge.",
    },
  },
  {
    id: "schetsentest",
    name: "Schetsentest",
    summary: "Laat een ruwe schets of storyboard van de oplossing zien en vraag mensen hem in eigen woorden uit te leggen.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "opinion",
    cost: "laag",
    costText: "€ 0",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "8–12 mensen uit de doelgroep",
    audiences: ["b2b", "b2c"],
    proves: "Of het idee begrijpelijk is en welke delen vragen of weerstand oproepen.",
    doesNotProve: "Dat iemand het wil gebruiken of kopen: reacties zijn meningen.",
    pitfalls: ["\"Leuk!\" als bewijs tellen.", "De schets te mooi maken, zodat mensen op de vormgeving reageren."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Maak een schets van hooguit één pagina; geen prijs, geen merk.", "Leg vast wat telt als \"begrepen\": de kern in eigen woorden terugvertellen."],
      during: ["Vraag eerst uitleg in eigen woorden, pas daarna om een reactie.", "Noteer per deelnemer of de kern klopte."],
      after: ["Voer per deelnemer in of de uitleg klopte; reacties en bezwaren in de notitie."],
    },
    card: {
      test_method: "Schets van de oplossing voorleggen en laten uitleggen in eigen woorden",
      metric_label: "Kern van het idee in eigen woorden juist uitgelegd",
      metric_numerator: "deelnemers die de kern van de oplossing in eigen woorden juist uitleggen",
      metric_denominator: "deelnemers uit de doelgroep die de schets zagen",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 8,
      max_duration_days: 7,
      expected_biases: "Mensen zijn beleefd tegenover de maker; begrip is nog geen behoefte.",
    },
  },
  {
    id: "klikbaar-prototype",
    name: "Klikbaar prototype",
    summary: "Laat mensen een concrete taak uitvoeren in een nagebouwde versie en kijk waar ze vastlopen.",
    category: "verkennen",
    lenses: ["desirability", "feasibility"],
    evidenceKind: "opinion",
    cost: "middel",
    costText: "€ 100–750 (ontwerptijd, bedankjes)",
    time: "weken",
    timeText: "1–2 weken",
    sample: "5–8 deelnemers per ronde",
    audiences: ["b2b", "b2c"],
    proves: "Of mensen de bedoelde taak zonder hulp kunnen afronden, en waar de oplossing onduidelijk is.",
    doesNotProve: "Of ze het in het echt zouden gebruiken: een testsituatie telt als mening, niet als koopgedrag.",
    pitfalls: ["Helpen als iemand vastloopt.", "Een taak kiezen die alleen werkt als je weet hoe het product bedoeld is."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Formuleer één realistische taak en wat telt als \"zelfstandig afgerond\".", "Test het prototype eerst zelf met een collega."],
      during: ["Laat hardop denken; grijp niet in. Noteer per deelnemer of de taak lukte en waar het stokte."],
      after: ["Voer per deelnemer in of de taak zelfstandig lukte; voeg eventueel een schermopname zonder gezicht toe."],
    },
    card: {
      test_method: "Taaktest met een klikbaar prototype, zonder hulp van de onderzoeker",
      metric_label: "Taak zelfstandig afgerond",
      metric_numerator: "deelnemers die de taak zonder hulp afronden",
      metric_denominator: "deelnemers uit de doelgroep die de taak kregen",
      success_threshold_pct: 70,
      fail_threshold_pct: 40,
      min_sample: 5,
      max_duration_days: 14,
      expected_biases: "Testsituatie: deelnemers doen meer moeite dan in het echt. Kleine aantallen.",
    },
  },
  {
    id: "kaartsortering",
    name: "Kaartsortering van behoeften",
    summary: "Laat mensen kaartjes met problemen of functies op volgorde leggen van belangrijk naar onbelangrijk.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "opinion",
    cost: "laag",
    costText: "€ 0–50",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "10–20 deelnemers",
    audiences: ["b2b", "b2c"],
    proves: "Welke problemen of functies mensen het belangrijkst noemen, vergeleken met de alternatieven.",
    doesNotProve: "Dat mensen voor het belangrijkste punt ook betalen.",
    pitfalls: ["Te veel kaartjes, zodat de volgorde willekeurig wordt.", "Je eigen favoriet zo formuleren dat hij aantrekkelijker klinkt."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Maak 6–10 kaartjes in neutrale woorden, ook met problemen die niet bij jouw idee horen.", "Leg vast wat telt als succes, bijvoorbeeld \"jouw probleem in de top 3\"."],
      during: ["Wissel de volgorde van de kaartjes per deelnemer.", "Maak een foto van de eindvolgorde (zonder gezicht) als bewijsbestand."],
      after: ["Voer per deelnemer in of jouw probleem in de vooraf afgesproken top viel."],
    },
    card: {
      test_method: "Kaartsortering van problemen in neutrale bewoording",
      metric_label: "Ons probleem in de top 3",
      metric_numerator: "deelnemers die ons probleem in hun top 3 leggen",
      metric_denominator: "deelnemers uit de doelgroep",
      success_threshold_pct: 50,
      fail_threshold_pct: 20,
      min_sample: 10,
      max_duration_days: 7,
      expected_biases: "Een rangorde is een mening; mensen leggen soms neer wat sociaal wenselijk is.",
    },
  },
  {
    id: "puntenverdeling",
    name: "Puntenverdeling",
    summary: "Geef mensen een vast budget aan punten om te verdelen over problemen of functies: wat krijgt het meest?",
    category: "verkennen",
    lenses: ["desirability", "viability"],
    evidenceKind: "opinion",
    cost: "laag",
    costText: "€ 0",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "15–30 deelnemers",
    audiences: ["b2b", "b2c"],
    proves: "Hoe mensen kiezen als alles niet tegelijk kan: een scherper beeld dan losse beoordelingen.",
    doesNotProve: "Wat ze met echt geld zouden doen.",
    pitfalls: ["Punten verwarren met euro's.", "Een lijst waarin jouw oplossing de enige concrete optie is."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Stel een lijst van 5–8 opties op en leg vast hoeveel punten \"veel\" is (bijv. 25 van 100)."],
      during: ["Bewaar elk ingevuld formulier (zonder naam) als bewijsbestand."],
      after: ["Voer per deelnemer in of jouw optie minstens het afgesproken aantal punten kreeg."],
    },
    card: {
      test_method: "Puntenverdeling (100 punten) over problemen of functies",
      metric_label: "Onze optie krijgt minstens 25 van de 100 punten",
      metric_numerator: "deelnemers die minstens 25 van 100 punten aan onze optie geven",
      metric_denominator: "deelnemers uit de doelgroep",
      success_threshold_pct: 40,
      fail_threshold_pct: 15,
      min_sample: 15,
      max_duration_days: 7,
      expected_biases: "Een keuze zonder gevolg: mensen verdelen anders dan ze uitgeven.",
    },
  },
  {
    id: "groepsgesprek",
    name: "Groepsgesprek",
    summary: "Een begeleid gesprek met 5–8 mensen uit de doelgroep over hoe zij het probleem ervaren.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "opinion",
    cost: "middel",
    costText: "€ 100–500 (ruimte, bedankjes)",
    time: "weken",
    timeText: "1–2 weken",
    sample: "2–3 groepen van 5–8 mensen",
    audiences: ["b2b", "b2c"],
    proves: "Welke woorden en zorgen mensen gebruiken, en waar ze het onderling over oneens zijn.",
    doesNotProve: "Hoe vaak iets voorkomt of wat één persoon zou doen: de groep stuurt de antwoorden.",
    pitfalls: ["Eén dominante deelnemer bepaalt de uitkomst.", "Groepsinstemming als bewijs tellen."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Schrijf een gespreksleidraad met vragen over recente ervaringen.", "Laat deelnemers vooraf individueel één vraag beantwoorden (zo telt elke stem)."],
      during: ["Noteer per deelnemer of die een recent eigen voorbeeld gaf.", "Geen namen in de notities; een code per deelnemer."],
      after: ["Voer per deelnemer in of het probleem met een eigen voorbeeld werd genoemd."],
    },
    card: {
      test_method: "Begeleid groepsgesprek met een vooraf individueel ingevulde vraag",
      metric_label: "Noemt het probleem met een eigen voorbeeld",
      metric_numerator: "deelnemers die het probleem met een eigen recent voorbeeld noemen",
      metric_denominator: "deelnemers uit de doelgroep",
      success_threshold_pct: 50,
      fail_threshold_pct: 20,
      min_sample: 10,
      max_duration_days: 14,
      expected_biases: "Groepsdruk en meepraten: één verhaal wordt al snel het verhaal van de groep.",
    },
  },
  {
    id: "verpakkingstest",
    name: "Productdoostest",
    summary: "Ontwerp de verpakking of het voorblad van je aanbod en laat mensen kiezen tussen jouw doos en bestaande alternatieven.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: "opinion",
    cost: "laag",
    costText: "€ 0–100",
    time: "dagen",
    timeText: "2–5 dagen",
    sample: "15–30 deelnemers",
    audiences: ["b2c"],
    proves: "Welke belofte het meest opvalt naast echte alternatieven.",
    doesNotProve: "Dat iemand het koopt: er wordt niets afgerekend.",
    pitfalls: ["Een mooi ontworpen doos naast saaie alternatieven zetten.", "De volgorde niet wisselen."],
    runs: { kind: "manual" },
    unit: { one: "deelnemer", many: "deelnemers" },
    steps: {
      before: ["Maak de doos of het voorblad in dezelfde stijl als de alternatieven.", "Leg vast wat telt: \"kiest onze doos als eerste keus\"."],
      during: ["Wissel de plaats van de dozen per deelnemer; noteer de keuze en de reden."],
      after: ["Voer per deelnemer in of onze doos de eerste keus was."],
    },
    card: {
      test_method: "Keuze tussen onze productdoos en bestaande alternatieven",
      metric_label: "Kiest onze doos als eerste keus",
      metric_numerator: "deelnemers die onze doos als eerste keus aanwijzen",
      metric_denominator: "deelnemers uit de doelgroep",
      success_threshold_pct: 35,
      fail_threshold_pct: 15,
      min_sample: 15,
      max_duration_days: 7,
      expected_biases: "Nieuwigheid trekt de aandacht; een keuze zonder geld is een mening.",
    },
  },
  // -------------------------------------------------------------------------------------------------------------
  // Verkennen: bureauonderzoek (geen klanttest; vastleggen als bron)
  // -------------------------------------------------------------------------------------------------------------
  {
    id: "zoekvolume-analyse",
    name: "Zoekvolume-analyse",
    summary: "Kijk hoe vaak mensen zoeken naar het probleem en de bestaande oplossingen, en hoe dat verandert.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: null,
    cost: "laag",
    costText: "€ 0–100",
    time: "dagen",
    timeText: "1–2 dagen",
    sample: "10–30 zoektermen",
    audiences: ["b2b", "b2c"],
    proves: "Dat er actief naar het probleem of naar alternatieven wordt gezocht, en of dat groeit.",
    doesNotProve: "Wie er zoekt en of die persoon iets koopt. Een geschat zoekvolume is geen marktomvang.",
    pitfalls: ["Schattingen van zoekmachines als harde aantallen gebruiken.", "Alleen termen zoeken die jouw oplossing al noemen."],
    runs: { kind: "source" },
    steps: {
      before: ["Maak een lijst met termen voor het probleem, de huidige oplossingen en de concurrenten."],
      during: ["Noteer per term de bron, de datum en de periode van het cijfer."],
      after: ["Leg de uitkomst vast als bron met datum onder Marktverkenning; het blijft een schatting."],
    },
    card: null,
  },
  {
    id: "reviews-en-forums",
    name: "Analyse van reviews en forums",
    summary: "Lees wat mensen zelf schrijven over bestaande oplossingen: klachten, omwegen en wensen.",
    category: "verkennen",
    lenses: ["desirability"],
    evidenceKind: null,
    cost: "laag",
    costText: "€ 0",
    time: "dagen",
    timeText: "2–4 dagen",
    sample: "50–200 reviews of berichten",
    audiences: ["b2b", "b2c"],
    proves: "Welke klachten over bestaande oplossingen terugkomen, in de woorden van gebruikers.",
    doesNotProve: "Hoe representatief dat is: schrijvers van reviews zijn vaak extra tevreden of ontevreden.",
    pitfalls: ["Alleen de berichten verzamelen die jouw idee steunen.", "Geen datum vastleggen."],
    runs: { kind: "source" },
    steps: {
      before: ["Kies vooraf de platforms en de periode."],
      during: ["Bewaar per bevinding de link, de datum en een letterlijk citaat."],
      after: ["Leg terugkerende klachten vast als bevinding met bron onder Marktverkenning."],
    },
    card: null,
  },
  {
    id: "proefaankoop-alternatief",
    name: "Proefaankoop bij een alternatief",
    summary: "Koop of probeer het bestaande alternatief zelf, en noteer prijs, voorwaarden en wat er misgaat.",
    category: "verkennen",
    lenses: ["viability", "desirability"],
    evidenceKind: null,
    cost: "middel",
    costText: "€ 50–500 (de aankoop zelf)",
    time: "dagen",
    timeText: "2–7 dagen",
    sample: "2–5 alternatieven",
    audiences: ["b2b", "b2c"],
    proves: "Wat klanten nu werkelijk krijgen en betalen bij een alternatief, met een peildatum.",
    doesNotProve: "Wat klanten van dat alternatief vinden.",
    pitfalls: ["Alleen het duurste of slechtste alternatief proberen.", "De prijs zonder datum en voorwaarden noteren."],
    runs: { kind: "source" },
    steps: {
      before: ["Kies de alternatieven die klanten in gesprekken noemden."],
      during: ["Bewaar factuur, voorwaarden en schermafbeeldingen met datum."],
      after: ["Leg prijs en voorwaarden vast als bron (primair document) bij de concurrent onder Marktverkenning."],
    },
    card: null,
  },
  {
    id: "eigen-data-analyse",
    name: "Analyse van eigen data",
    summary: "Gebruik bestaande cijfers van je eigen organisatie (verkopen, gebruik, aanvragen) om een aanname te toetsen.",
    category: "verkennen",
    lenses: ["desirability", "viability"],
    evidenceKind: null,
    cost: "laag",
    costText: "€ 0",
    time: "dagen",
    timeText: "1–5 dagen",
    sample: "Een vaste periode met alle records",
    audiences: ["b2b", "b2c"],
    proves: "Wat bestaande klanten aantoonbaar deden, zonder nieuwe test.",
    doesNotProve: "Hoe nieuwe klanten zich gedragen.",
    pitfalls: ["De periode kiezen die de mooiste cijfers geeft.", "Persoonsgegevens meenemen die niet nodig zijn."],
    runs: { kind: "source" },
    steps: {
      before: ["Leg periode, filter en definitie vast vóór je de cijfers bekijkt."],
      during: ["Exporteer zonder persoonsgegevens; bewaar de query of het filter."],
      after: ["Upload de dataset als eigen bron onder Marktverkenning, met de definitie erbij."],
    },
    card: null,
  },
  {
    id: "juridische-check",
    name: "Juridische check",
    summary: "Laat toetsen of iets mag: privacy, vergunningen, sectorregels of voorwaarden van platforms.",
    category: "verkennen",
    lenses: ["feasibility", "viability"],
    evidenceKind: null,
    cost: "middel",
    costText: "€ 0–1.000 (advies)",
    time: "dagen",
    timeText: "3–7 dagen",
    sample: "1–2 deskundige oordelen of primaire teksten",
    audiences: ["b2b", "b2c"],
    proves: "Of een randvoorwaarde het idee blokkeert, met de tekst van de regel als bron.",
    doesNotProve: "Of klanten het idee vertrouwen; dat vraag je bij klanten uit.",
    pitfalls: ["Een blog als juridische bron gebruiken.", "De vraag zo stellen dat het gewenste antwoord volgt."],
    runs: { kind: "source" },
    steps: {
      before: ["Formuleer één concrete vraag: mag X onder voorwaarden Y?"],
      during: ["Vraag om de wettekst of de voorwaarde waarop het oordeel steunt."],
      after: ["Leg het oordeel vast als bron met letterlijk citaat onder Marktverkenning."],
    },
    card: null,
  },
  {
    id: "technische-proef",
    name: "Technische proef",
    summary: "Bouw het lastigste technische onderdeel in het klein na en kijk of het werkt met echte gegevens.",
    category: "verkennen",
    lenses: ["feasibility"],
    evidenceKind: null,
    cost: "hoog",
    costText: "€ 0–2.000 (ontwikkeltijd)",
    time: "weken",
    timeText: "1–3 weken",
    sample: "Een vaste set echte testgevallen",
    audiences: ["b2b", "b2c"],
    proves: "Of het riskantste onderdeel technisch te maken is, met welke kwaliteit en kosten.",
    doesNotProve: "Of klanten het willen of ervoor betalen.",
    pitfalls: ["Een makkelijk onderdeel testen omdat dat snel resultaat geeft.", "Testen met verzonnen in plaats van echte gegevens."],
    runs: { kind: "source" },
    steps: {
      before: ["Leg vooraf vast welke kwaliteit nodig is (bijv. 9 van 10 testgevallen goed)."],
      during: ["Houd per testgeval de uitkomst en de kosten bij."],
      after: ["Leg de uitkomst vast als eigen bron met de testresultaten onder Marktverkenning."],
    },
    card: null,
  },
  {
    id: "leveranciersoffertes",
    name: "Leveranciersoffertes opvragen",
    summary: "Vraag offertes op voor wat je nodig hebt om te leveren, en reken de kostprijs per klant uit.",
    category: "verkennen",
    lenses: ["viability", "feasibility"],
    evidenceKind: null,
    cost: "laag",
    costText: "€ 0",
    time: "weken",
    timeText: "1–2 weken",
    sample: "2–4 offertes per onderdeel",
    audiences: ["b2b", "b2c"],
    proves: "Wat leveren werkelijk kost, als onderbouwing voor marge en prijs.",
    doesNotProve: "Wat klanten willen betalen.",
    pitfalls: ["Alleen de goedkoopste offerte gebruiken.", "Volumekortingen meerekenen die je nog niet haalt."],
    runs: { kind: "source" },
    steps: {
      before: ["Beschrijf per onderdeel wat je precies nodig hebt en bij welk volume."],
      during: ["Bewaar elke offerte met datum en geldigheid."],
      after: ["Leg de offertes vast als primaire bron en gebruik ze in het businessmodel."],
    },
    card: null,
  },
  // -------------------------------------------------------------------------------------------------------------
  // Valideren: ingebouwde tests
  // -------------------------------------------------------------------------------------------------------------
  {
    id: "nepdeur-pagina",
    name: "Nepdeur-pagina",
    summary: "Een pagina met één concreet aanbod en één knop; na de klik volgt eerlijk dat het aanbod nog in ontwikkeling is.",
    category: "valideren",
    lenses: ["desirability"],
    evidenceKind: "waitlist_signup",
    cost: "laag",
    costText: "€ 0–500 (advertenties optioneel)",
    time: "weken",
    timeText: "2–3 weken",
    sample: "80–200 unieke relevante bezoekers",
    audiences: ["b2b", "b2c"],
    proves: "Of onbekende, relevante mensen in een echte context een handeling doen bij jouw belofte.",
    doesNotProve: "Of ze gaan betalen, of het product blijven gebruiken.",
    pitfalls: ["Verkeer alleen uit het eigen netwerk.", "Iets beloven wat niet waar is; de eerlijke uitleg na de klik is verplicht."],
    runs: { kind: "builtin", type: "landing", successMetric: "signup" },
    steps: {
      before: ["Schrijf één belofte voor één doelgroep; maak de testpagina uit de testkaart.", "Kies minstens twee wervingskanalen en gebruik per kanaal een eigen link."],
      during: ["Houd per kanaal bezoekers en aanmeldingen in de gaten, maar concludeer niets voor de deadline."],
      after: ["Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Testpagina met één concrete belofte en één actie",
      metric_label: "Aanmelding op de testpagina",
      metric_numerator: "unieke aanmelders",
      metric_denominator: "unieke relevante bezoekers",
      success_threshold_pct: 15,
      fail_threshold_pct: 5,
      min_sample: 80,
      max_duration_days: 21,
      expected_biases: "Belangstelling is geen betaling; warm verkeer uit het eigen netwerk converteert hoger.",
    },
  },
  {
    id: "demo-aanvraagpagina",
    name: "Demo-aanvraagpagina",
    summary: "Een pagina waarop bezoekers direct een kennismaking of demo inplannen in je agenda.",
    category: "valideren",
    lenses: ["desirability"],
    evidenceKind: "demo_request",
    cost: "laag",
    costText: "€ 0–500",
    time: "weken",
    timeText: "2–4 weken",
    sample: "60–150 unieke relevante bezoekers",
    audiences: ["b2b"],
    proves: "Of mensen er tijd voor vrijmaken: een geboekte afspraak kost meer moeite dan een klik.",
    doesNotProve: "Of de afspraak tot een aankoop leidt.",
    pitfalls: ["Geannuleerde afspraken meetellen.", "Bezoekers die rechtstreeks via de agendalink boeken, buiten de pagina om."],
    runs: { kind: "builtin", type: "landing", successMetric: "booking" },
    steps: {
      before: ["Koppel Calendly of Cal.com bij de test.", "Leg vast wat een relevante bezoeker is."],
      during: ["Volg geboekte en geannuleerde afspraken; alleen niet-geannuleerde tellen."],
      after: ["Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Testpagina met een agendalink voor een kennismaking",
      metric_label: "Geboekte afspraak",
      metric_numerator: "unieke bezoekers die een afspraak boekten (niet geannuleerd)",
      metric_denominator: "unieke bezoekers van de testpagina",
      success_threshold_pct: 5,
      fail_threshold_pct: 1,
      min_sample: 60,
      max_duration_days: 28,
      expected_biases: "Mensen uit het eigen netwerk boeken uit beleefdheid; no-shows komen pas later aan het licht.",
    },
  },
  {
    id: "prijs-aanbodtest",
    name: "Prijs-/aanbodtest",
    summary: "Een concreet aanbod met prijs op een testpagina: welk deel van de bezoekers kiest het?",
    category: "valideren",
    lenses: ["viability"],
    evidenceKind: "quote_request",
    cost: "laag",
    costText: "€ 0–750 (advertenties optioneel)",
    time: "weken",
    timeText: "2–4 weken",
    sample: "150–300 unieke relevante bezoekers",
    audiences: ["b2b", "b2c"],
    proves: "Of relevante bezoekers een aanbod kiezen als de prijs erbij staat.",
    doesNotProve: "Werkelijke betaling: er wordt niets afgerekend.",
    pitfalls: ["Een prijs zonder periode of voorwaarden.", "Verschillen tussen prijspunten overschatten bij kleine aantallen."],
    runs: { kind: "builtin", type: "pricing" },
    steps: {
      before: ["Formuleer het aanbod en 1–3 prijspunten; de prijs uit de intake staat al klaar."],
      during: ["Bezoekers zien steeds één prijspunt; vergelijk pas na de deadline."],
      after: ["Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Aanbod met prijspunten op een testpagina (zonder afrekenen)",
      metric_label: "Kiest een aanbod met prijs",
      metric_numerator: "unieke bezoekers die een prijsaanbod kiezen",
      metric_denominator: "unieke relevante bezoekers",
      success_threshold_pct: 8,
      fail_threshold_pct: 2,
      min_sample: 150,
      max_duration_days: 28,
      expected_biases: "Een klik op een prijs is geen betaling; warm verkeer kiest vaker.",
    },
  },
  {
    id: "prijspunten-vergelijken",
    name: "Prijspunten vergelijken",
    summary: "Toon verschillende bezoekers verschillende prijzen voor hetzelfde aanbod en vergelijk hoe vaak ze kiezen.",
    category: "valideren",
    lenses: ["viability"],
    evidenceKind: "quote_request",
    cost: "middel",
    costText: "€ 200–1.000 (genoeg verkeer per prijs)",
    time: "weken",
    timeText: "3–4 weken",
    sample: "100+ unieke bezoekers per prijspunt",
    audiences: ["b2b", "b2c"],
    proves: "Hoe gevoelig de keuze is voor de prijs, binnen het geteste bereik.",
    doesNotProve: "De beste prijs buiten het geteste bereik, of betaling.",
    pitfalls: ["Te weinig verkeer per prijspunt.", "Een verschil van een paar keuzes als hard resultaat zien."],
    runs: { kind: "builtin", type: "pricing" },
    steps: {
      before: ["Kies 2–3 prijspunten die echt verschillen; reken uit hoeveel verkeer per prijspunt nodig is."],
      during: ["Houd per prijspunt bezoekers en keuzes bij; trek geen tussentijdse conclusies."],
      after: ["Rond af; vergelijk de prijspunten op de leerkaart met hun intervallen."],
    },
    card: {
      test_method: "Dezelfde testpagina met per bezoeker één van meerdere prijspunten",
      metric_label: "Kiest een aanbod met prijs",
      metric_numerator: "unieke bezoekers die een prijsaanbod kiezen",
      metric_denominator: "unieke relevante bezoekers",
      success_threshold_pct: 8,
      fail_threshold_pct: 2,
      min_sample: 300,
      max_duration_days: 28,
      expected_biases: "Kleine verschillen tussen prijspunten zijn vaak toeval.",
    },
  },
  {
    id: "aanbetaling",
    name: "Reservering met aanbetaling",
    summary: "Bezoekers reserveren een plek met een kleine, volledig terugbetaalbare aanbetaling.",
    category: "valideren",
    lenses: ["viability", "desirability"],
    evidenceKind: "deposit",
    cost: "middel",
    costText: "€ 100–1.000 (verkeer, transactiekosten)",
    time: "weken",
    timeText: "3–4 weken",
    sample: "100–300 unieke relevante bezoekers",
    audiences: ["b2b", "b2c"],
    proves: "Dat mensen echt geld inzetten: de sterkste vorm van bewijs zonder bestaand product.",
    doesNotProve: "Dat ze na levering blijven betalen.",
    pitfalls: ["Testbetalingen meetellen.", "Niet duidelijk maken dat het product nog niet bestaat en het bedrag terugkomt."],
    runs: { kind: "builtin", type: "pricing", successMetric: "payment" },
    steps: {
      before: ["Stel Mollie in voor de werkruimte en zet de betaalstap aan in de testkaart.", "Laat de tekst over terugbetaling controleren."],
      during: ["Alleen live, betaalde en niet-terugbetaalde aanbetalingen tellen."],
      after: ["Rond af, maak de leerkaart en betaal alles terug na het besluit."],
    },
    card: {
      test_method: "Aanbod met prijs en een terugbetaalbare aanbetaling via de betaalstap",
      metric_label: "Betaalde aanbetaling",
      metric_numerator: "unieke bezoekers die een terugbetaalbare aanbetaling betaalden (live, niet terugbetaald)",
      metric_denominator: "unieke bezoekers van de testpagina",
      success_threshold_pct: 3,
      fail_threshold_pct: 0.5,
      min_sample: 150,
      max_duration_days: 28,
      expected_biases: "Een terugbetaalbare aanbetaling is lichter dan een echte aankoop; bekenden betalen uit sympathie.",
    },
  },
  {
    id: "intentieverklaring",
    name: "Intentieverklaring",
    summary: "Een organisatie tekent een korte, niet-bindende verklaring dat ze het aanbod wil afnemen als het er is.",
    category: "valideren",
    lenses: ["viability", "desirability"],
    evidenceKind: "quote_request",
    cost: "laag",
    costText: "€ 0–250",
    time: "weken",
    timeText: "2–6 weken",
    sample: "10–30 benaderde organisaties",
    audiences: ["b2b"],
    proves: "Dat een organisatie haar naam aan het aanbod verbindt: meer dan belangstelling.",
    doesNotProve: "Een betaling of contract; de juridische betekenis hangt van de tekst af.",
    pitfalls: ["Een verklaring zo vaag maken dat tekenen niets kost.", "Alleen bestaande relaties benaderen."],
    runs: { kind: "builtin", type: "landing", successMetric: "commitment" },
    steps: {
      before: ["Schrijf een korte verklaring met aanbod, prijsindicatie en looptijd.", "Kies of je met een getekend document of met een digitaal akkoord werkt."],
      during: ["Alleen een getekend document of digitaal akkoord telt; intrekken blijft mogelijk."],
      after: ["Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Aanbod met een niet-bindende intentieverklaring (getekend document of digitaal akkoord)",
      metric_label: "Getekende toezegging",
      metric_numerator: "unieke personen met een getekende intentieverklaring of digitaal akkoord",
      metric_denominator: "unieke bezoekers van de testpagina",
      success_threshold_pct: 10,
      fail_threshold_pct: 2,
      min_sample: 30,
      max_duration_days: 42,
      expected_biases: "Niet-bindend tekenen is makkelijker dan kopen; warme relaties tekenen eerder.",
    },
  },
  {
    id: "advertentie-rooktest",
    name: "Advertentie-rooktest",
    summary: "Stuur betaald verkeer van onbekenden naar een testpagina en meet wie reageert, en wat dat kost.",
    category: "valideren",
    lenses: ["desirability", "viability"],
    evidenceKind: "waitlist_signup",
    cost: "middel",
    costText: "€ 200–1.000 (advertenties)",
    time: "weken",
    timeText: "1–3 weken",
    sample: "200–500 unieke bezoekers via advertenties",
    audiences: ["b2b", "b2c"],
    proves: "Of koude, onbekende mensen reageren, en wat een aanmelding via dit kanaal kost.",
    doesNotProve: "Hoe goed die mensen bij je doelgroep passen als de targeting breed is.",
    pitfalls: ["Advertentie-uitgaven niet vooraf vastleggen.", "De advertentie anders laten beloven dan de pagina."],
    runs: { kind: "builtin", type: "landing", successMetric: "signup" },
    steps: {
      before: ["Leg budget en doelgroepinstelling vast; laat de uitgave goedkeuren.", "Gebruik de kanaallink van de advertentie zodat bezoekers per kanaal tellen."],
      during: ["Houd uitgaven en aanmeldingen per kanaal bij."],
      after: ["Rond af, maak de leerkaart en noteer de kosten per aanmelding."],
    },
    card: {
      test_method: "Testpagina met betaald verkeer van onbekenden via advertenties",
      metric_label: "Aanmelding op de testpagina",
      metric_numerator: "unieke aanmelders via advertenties",
      metric_denominator: "unieke bezoekers via advertenties",
      success_threshold_pct: 5,
      fail_threshold_pct: 1,
      min_sample: 200,
      max_duration_days: 21,
      expected_biases: "Advertentieplatforms tonen aan wie het meest klikt, niet altijd aan je doelgroep.",
    },
  },
  {
    id: "uitlegvideo",
    name: "Uitlegvideo met aanmelding",
    summary: "Een korte video laat zien hoe de oplossing zou werken; daaronder één knop om je aan te melden.",
    category: "valideren",
    lenses: ["desirability"],
    evidenceKind: "waitlist_signup",
    cost: "middel",
    costText: "€ 100–750 (video maken)",
    time: "weken",
    timeText: "2–3 weken",
    sample: "80–200 unieke relevante bezoekers",
    audiences: ["b2b", "b2c"],
    proves: "Of mensen na het zien van de werking een handeling doen.",
    doesNotProve: "Of het echte product doet wat de video belooft.",
    pitfalls: ["De video laat iets zien wat nog niet kan zonder dat te zeggen.", "Een lange video die weinig mensen afkijken."],
    runs: { kind: "builtin", type: "landing", successMetric: "signup" },
    steps: {
      before: ["Maak een video van hooguit twee minuten die eerlijk zegt dat het een concept is.", "Zet de video in het aanbod van de testpagina."],
      during: ["Werf via minstens twee kanalen met eigen links."],
      after: ["Rond af en maak de leerkaart."],
    },
    card: {
      test_method: "Testpagina met een korte uitlegvideo en één aanmeldknop",
      metric_label: "Aanmelding na de video",
      metric_numerator: "unieke aanmelders",
      metric_denominator: "unieke relevante bezoekers",
      success_threshold_pct: 12,
      fail_threshold_pct: 4,
      min_sample: 80,
      max_duration_days: 21,
      expected_biases: "Een overtuigende video verkoopt de belofte, niet het product.",
    },
  },
  {
    id: "mailing-aanbod",
    name: "Aanbod via een bestaande mailinglijst",
    summary: "Stuur een concreet aanbod naar een bestaande lijst en meet wie doorklikt en zich aanmeldt.",
    category: "valideren",
    lenses: ["desirability"],
    evidenceKind: "waitlist_signup",
    cost: "laag",
    costText: "€ 0",
    time: "dagen",
    timeText: "5–10 dagen",
    sample: "Een lijst van 200+ ontvangers",
    audiences: ["b2b", "b2c"],
    proves: "Of bestaande relaties een handeling doen bij een concreet aanbod.",
    doesNotProve: "Hoe onbekenden reageren: een eigen lijst is warm verkeer.",
    pitfalls: ["De lijst als representatief voor de hele markt zien.", "Mailen zonder toestemming voor dit soort berichten."],
    runs: { kind: "builtin", type: "landing", successMetric: "signup" },
    steps: {
      before: ["Controleer dat de ontvangers toestemming gaven voor dit soort berichten.", "Gebruik de kanaallink voor nieuwsbrief of e-mail."],
      during: ["Verstuur één keer; tel bezoekers en aanmeldingen via de testpagina."],
      after: ["Rond af en maak de leerkaart; houd rekening met warm verkeer."],
    },
    card: {
      test_method: "Aanbod via een bestaande mailinglijst naar een testpagina",
      metric_label: "Aanmelding op de testpagina",
      metric_numerator: "unieke aanmelders via de mailing",
      metric_denominator: "unieke bezoekers via de mailing",
      success_threshold_pct: 15,
      fail_threshold_pct: 5,
      min_sample: 60,
      max_duration_days: 10,
      expected_biases: "Eigen lijst = eigen netwerk: positiever dan de markt.",
    },
  },
  // -------------------------------------------------------------------------------------------------------------
  // Valideren: begeleide handmatige sjablonen
  // -------------------------------------------------------------------------------------------------------------
  {
    id: "concierge",
    name: "Conciërgetest",
    summary: "Lever de dienst eerst helemaal met de hand aan een paar echte klanten, en meet of ze hem gebruiken en wat het kost.",
    category: "valideren",
    lenses: ["desirability", "feasibility", "viability"],
    evidenceKind: "demo_request",
    cost: "middel",
    costText: "€ 100–1.000 (eigen tijd)",
    time: "weken",
    timeText: "2–6 weken",
    sample: "5–15 echte klanten",
    audiences: ["b2b", "b2c"],
    proves: "Of klanten de dienst echt afnemen en blijven gebruiken als hij er is, en wat leveren per klant kost.",
    doesNotProve: "Of het te automatiseren of op te schalen is.",
    pitfalls: ["Klanten die het uit vriendschap doen.", "Je eigen uren niet bijhouden, zodat de kostprijs onbekend blijft."],
    runs: { kind: "manual" },
    unit: { one: "klant", many: "klanten" },
    steps: {
      before: ["Beschrijf het serviceprotocol: wat lever je, binnen welke tijd, wat kost het de klant?", "Leg vast wat telt als \"gebruikt\" (bijv. een tweede keer aangevraagd)."],
      during: ["Houd per klant bij wat er geleverd is, hoeveel tijd het kostte en of de klant terugkwam.", "Geen namen in de notities; een code per klant."],
      after: ["Voer per klant in of die volgens je definitie gebruikte; voeg je urenregistratie toe als bewijsbestand."],
    },
    card: {
      test_method: "Dienst met de hand leveren aan echte klanten volgens een vast protocol",
      metric_label: "Klant gebruikt de dienst opnieuw",
      metric_numerator: "klanten die de dienst binnen de looptijd een tweede keer afnemen",
      metric_denominator: "klanten die de dienst een eerste keer kregen",
      success_threshold_pct: 50,
      fail_threshold_pct: 20,
      min_sample: 5,
      max_duration_days: 42,
      expected_biases: "Persoonlijke aandacht maakt klanten tevredener dan een geautomatiseerde dienst; kleine aantallen.",
    },
  },
  {
    id: "wizard-of-oz",
    name: "Achter-de-schermentest",
    summary: "Klanten gebruiken iets dat geautomatiseerd lijkt, terwijl een mens het achter de schermen doet.",
    category: "valideren",
    lenses: ["desirability", "feasibility"],
    evidenceKind: "demo_request",
    cost: "middel",
    costText: "€ 100–1.000",
    time: "weken",
    timeText: "2–4 weken",
    sample: "10–30 gebruikers",
    audiences: ["b2b", "b2c"],
    proves: "Of mensen de oplossing in een echte situatie gebruiken voordat je de techniek bouwt.",
    doesNotProve: "Of de techniek het straks net zo goed kan.",
    pitfalls: ["Verzwijgen dat een mens meekijkt waar dat privacy raakt.", "Een hogere kwaliteit leveren dan de techniek ooit haalt."],
    runs: { kind: "manual" },
    unit: { one: "gebruiker", many: "gebruikers" },
    steps: {
      before: ["Zet een eenvoudige voorkant op; leg vast welke kwaliteit de techniek straks moet halen.", "Leg in de privacytekst uit dat verzoeken door mensen worden behandeld."],
      during: ["Houd per gebruiker bij hoe vaak die de dienst gebruikte en hoeveel handwerk het kostte."],
      after: ["Voer per gebruiker in of die volgens je definitie actief gebruikte."],
    },
    card: {
      test_method: "Dienst met een eenvoudige voorkant die achter de schermen door mensen wordt uitgevoerd",
      metric_label: "Actief gebruik",
      metric_numerator: "gebruikers die de dienst minstens twee keer gebruiken binnen de looptijd",
      metric_denominator: "gebruikers die toegang kregen",
      success_threshold_pct: 40,
      fail_threshold_pct: 15,
      min_sample: 10,
      max_duration_days: 28,
      expected_biases: "Nieuwsgierigheid zorgt voor een eerste keer; kijk naar herhaling.",
    },
  },
  {
    id: "pop-up-stand",
    name: "Pop-upstand",
    summary: "Bied het aanbod tijdelijk aan op een drukke plek of beurs en tel wie stopt en wie een vervolgstap zet.",
    category: "valideren",
    lenses: ["desirability"],
    evidenceKind: "waitlist_signup",
    cost: "middel",
    costText: "€ 100–1.000 (standplaats, materiaal)",
    time: "dagen",
    timeText: "1–3 dagen",
    sample: "100+ voorbijgangers die stoppen",
    audiences: ["b2c", "b2b"],
    proves: "Of mensen in een echte situatie een vervolgstap zetten (aanmelden, gegevens achterlaten).",
    doesNotProve: "Of de bezoekers van die plek representatief zijn voor je doelgroep.",
    pitfalls: ["Alleen de aanmeldingen tellen en niet hoeveel mensen stopten.", "Gratis weggevers die iedereen aantrekken."],
    runs: { kind: "manual" },
    unit: { one: "persoon die stopte", many: "personen die stopten" },
    steps: {
      before: ["Leg vast wat telt als \"gestopt\" en als \"vervolgstap\".", "Zorg voor een aanmeldformulier met toestemmingstekst."],
      during: ["Tel per dagdeel hoeveel mensen stopten en hoeveel een vervolgstap zetten; voer per dagdeel één regel in.", "Bewaar het telformulier als bewijsbestand."],
      after: ["Controleer dat de aantallen per dagdeel zijn ingevoerd."],
    },
    card: {
      test_method: "Tijdelijke stand op een plek waar de doelgroep komt, met een telformulier",
      metric_label: "Zet een vervolgstap",
      metric_numerator: "personen die een vervolgstap zetten (aanmelding met toestemming)",
      metric_denominator: "personen die bij de stand stopten",
      success_threshold_pct: 10,
      fail_threshold_pct: 3,
      min_sample: 100,
      max_duration_days: 7,
      expected_biases: "De plek bepaalt wie langskomt; het gesprek aan de stand werkt als een verkooppraatje.",
    },
  },
  {
    id: "aanbodgesprek",
    name: "Aanbodgesprek met vervolgstap",
    summary: "Een kort gesprek waarin je een concreet aanbod doet en om een duidelijke vervolgstap vraagt.",
    category: "valideren",
    lenses: ["desirability", "viability"],
    evidenceKind: "demo_request",
    cost: "laag",
    costText: "€ 0, alleen tijd",
    time: "weken",
    timeText: "2–4 weken",
    sample: "10–20 gesprekken met beslissers",
    audiences: ["b2b"],
    proves: "Of beslissers na een concreet aanbod een vervolgstap zetten (vervolgafspraak, voorstel aanvragen).",
    doesNotProve: "Dat ze tekenen of betalen; een getekende toezegging leg je vast via de toezeggingsstap.",
    pitfalls: ["\"Interessant, stuur maar wat op\" als vervolgstap tellen.", "Alleen bestaande relaties spreken."],
    runs: { kind: "manual" },
    unit: { one: "gesprek", many: "gesprekken" },
    steps: {
      before: ["Schrijf het aanbod uit met prijsindicatie en de vervolgstap die je vraagt.", "Leg vast wat telt: een vervolgafspraak met datum of een gevraagd voorstel."],
      during: ["Noteer per gesprek of de vervolgstap werd gezet, met datum; geen namen."],
      after: ["Voer per gesprek in of de vervolgstap volgens je definitie werd gezet."],
    },
    card: {
      test_method: "Gesprekken met beslissers waarin een concreet aanbod met vervolgstap wordt gedaan",
      metric_label: "Zet de gevraagde vervolgstap",
      metric_numerator: "beslissers die een vervolgafspraak met datum maken of een voorstel aanvragen",
      metric_denominator: "beslissers met wie het aanbodgesprek is gevoerd",
      success_threshold_pct: 30,
      fail_threshold_pct: 10,
      min_sample: 10,
      max_duration_days: 28,
      expected_biases: "Beleefdheid: een vervolgafspraak is makkelijker gezegd dan nagekomen.",
    },
  },
  {
    id: "outreach-proef",
    name: "Outreach-proef",
    summary: "Benader een vaste groep uit de doelgroep via één kanaal en tel reacties, gesprekken en kosten.",
    category: "valideren",
    lenses: ["viability", "desirability"],
    evidenceKind: "demo_request",
    cost: "laag",
    costText: "€ 0–250",
    time: "weken",
    timeText: "1–2 weken",
    sample: "30–100 benaderde personen of organisaties",
    audiences: ["b2b"],
    proves: "Of je de doelgroep via dit kanaal bereikt, en tegen welke inspanning.",
    doesNotProve: "Dat de mensen die reageren ook klant worden.",
    pitfalls: ["Halverwege de boodschap aanpassen.", "Reacties als \"nee, dank je\" als succes tellen."],
    runs: { kind: "manual" },
    unit: { one: "benaderde", many: "benaderden" },
    steps: {
      before: ["Leg de lijst, het kanaal en de boodschap vast.", "Leg vast wat telt: een gesprek ingepland."],
      during: ["Voer per dag een telling in: benaderd en gesprekken ingepland, met een notitie over het kanaal."],
      after: ["Noteer de bestede tijd en kosten in de laatste notitie."],
    },
    card: {
      test_method: "Een vaste groep via één kanaal benaderen met één vaste boodschap",
      metric_label: "Gesprek ingepland na benadering",
      metric_numerator: "benaderden met wie een gesprek is ingepland",
      metric_denominator: "benaderde personen of organisaties",
      success_threshold_pct: 10,
      fail_threshold_pct: 3,
      min_sample: 30,
      max_duration_days: 14,
      expected_biases: "De eerste lijst is vaak de warmste; reacties op koude benadering nemen af.",
    },
  },
  {
    id: "partnerkanaal-proef",
    name: "Proef via een partner",
    summary: "Laat een partner (bond, branchevereniging, leverancier) het aanbod aan zijn achterban voorleggen.",
    category: "valideren",
    lenses: ["viability"],
    evidenceKind: "waitlist_signup",
    cost: "laag",
    costText: "€ 0–500",
    time: "weken",
    timeText: "2–6 weken",
    sample: "Een achterban van 100+ organisaties",
    audiences: ["b2b"],
    proves: "Of een partner zijn achterban echt in beweging krijgt voor jouw aanbod.",
    doesNotProve: "Hoe de markt reageert zonder die partner.",
    pitfalls: ["Een toezegging van de partner zien als vraag van klanten.", "Niet weten hoeveel leden het bericht kregen."],
    runs: { kind: "manual" },
    unit: { one: "bereikt lid", many: "bereikte leden" },
    steps: {
      before: ["Spreek met de partner af hoeveel leden het bericht krijgen en via welk kanaal.", "Gebruik waar mogelijk een eigen link, zodat aanmeldingen herleidbaar zijn."],
      during: ["Voer de telling van bereikte leden en aanmeldingen in zodra de partner die geeft; bewaar het overzicht."],
      after: ["Noteer welke afspraken met de partner nodig waren."],
    },
    card: {
      test_method: "Aanbod via een partner aan diens achterban",
      metric_label: "Aanmelding via de partner",
      metric_numerator: "bereikte leden die zich aanmelden",
      metric_denominator: "leden die het bericht van de partner kregen",
      success_threshold_pct: 5,
      fail_threshold_pct: 1,
      min_sample: 100,
      max_duration_days: 42,
      expected_biases: "Het gezag van de partner werkt mee; zonder partner ligt de respons lager.",
    },
  },
  {
    id: "doorverwijsproef",
    name: "Doorverwijsproef",
    summary: "Vraag bestaande gebruikers of deelnemers om het aanbod door te sturen, en tel wie dat doet.",
    category: "valideren",
    lenses: ["desirability", "viability"],
    evidenceKind: "waitlist_signup",
    cost: "laag",
    costText: "€ 0–250",
    time: "weken",
    timeText: "2–3 weken",
    sample: "20–50 bestaande gebruikers",
    audiences: ["b2b", "b2c"],
    proves: "Of gebruikers het aanbod waardevol genoeg vinden om hun naam eraan te verbinden.",
    doesNotProve: "Of de doorverwezen mensen ook klant worden.",
    pitfalls: ["Een beloning die groter is dan de waarde van het aanbod.", "Doorsturen tellen zonder te weten of het aankwam."],
    runs: { kind: "manual" },
    unit: { one: "gebruiker", many: "gebruikers" },
    steps: {
      before: ["Kies een vaste groep gebruikers en een eenvoudige manier om door te sturen.", "Leg vast wat telt: minstens één doorverwijzing die aankomt."],
      during: ["Houd per gebruiker bij of er een doorverwijzing binnenkwam."],
      after: ["Voer per gebruiker in of die doorverwees."],
    },
    card: {
      test_method: "Bestaande gebruikers vragen het aanbod door te sturen",
      metric_label: "Verwijst minstens één persoon door",
      metric_numerator: "gebruikers van wie minstens één doorverwijzing binnenkwam",
      metric_denominator: "gebruikers die het verzoek kregen",
      success_threshold_pct: 20,
      fail_threshold_pct: 5,
      min_sample: 20,
      max_duration_days: 21,
      expected_biases: "Enthousiaste vroege gebruikers verwijzen vaker door dan latere klanten.",
    },
  },
  {
    id: "mini-pilot",
    name: "Kleine pilot",
    summary: "Een beperkte proefperiode bij een paar organisaties, met vooraf vastgelegd wat geslaagd gebruik is.",
    category: "valideren",
    lenses: ["desirability", "feasibility", "viability"],
    evidenceKind: "demo_request",
    cost: "hoog",
    costText: "€ 500–5.000 (begeleiding, aanpassingen)",
    time: "maanden",
    timeText: "4–8 weken",
    sample: "3–10 organisaties",
    audiences: ["b2b"],
    proves: "Of organisaties de oplossing in hun eigen werk inzetten, en wat er nodig is om dat te laten werken.",
    doesNotProve: "Dat ze na de pilot betalen; een getekende afspraak leg je vast via de toezeggingsstap.",
    pitfalls: ["Geen succescriterium vooraf.", "Zoveel extra begeleiding dat de pilot niet lijkt op het echte product."],
    runs: { kind: "manual" },
    unit: { one: "organisatie", many: "organisaties" },
    steps: {
      before: ["Leg per pilot vast: doel, looptijd, wat telt als actief gebruik en wie aanspreekpunt is.", "Spreek af wat er na de pilot gebeurt (stoppen, verlengen, offerte)."],
      during: ["Houd per organisatie wekelijks het gebruik en je eigen begeleidingsuren bij."],
      after: ["Voer per organisatie in of die het vooraf vastgelegde gebruik haalde; voeg het evaluatieverslag toe."],
    },
    card: {
      test_method: "Pilot met een vaste looptijd en een vooraf vastgelegd criterium voor actief gebruik",
      metric_label: "Haalt het afgesproken gebruik",
      metric_numerator: "organisaties die het vooraf vastgelegde gebruik halen in de laatste pilotweek",
      metric_denominator: "organisaties die aan de pilot begonnen",
      success_threshold_pct: 60,
      fail_threshold_pct: 30,
      min_sample: 5,
      max_duration_days: 56,
      expected_biases: "Pilotorganisaties zijn vaak de meest gemotiveerde; extra aandacht verhoogt het gebruik.",
    },
  },
  {
    id: "crowdfunding",
    name: "Crowdfundingcampagne",
    summary: "Zet het aanbod op een crowdfundingplatform en tel hoeveel bezoekers het steunen.",
    category: "valideren",
    lenses: ["desirability", "viability"],
    evidenceKind: "waitlist_signup",
    cost: "hoog",
    costText: "€ 500–3.000 (campagne, video)",
    time: "maanden",
    timeText: "4–8 weken",
    sample: "500+ unieke bezoekers van de campagne",
    audiences: ["b2c"],
    proves: "Of mensen buiten je netwerk het aanbod steunen.",
    doesNotProve: "Een geverifieerde betaling in ProofLab: een externe steunbetuiging voer je handmatig in en telt hooguit als kleine handeling.",
    pitfalls: ["Steun van vrienden en familie als marktvraag zien.", "Beloftes doen die je niet kunt leveren."],
    runs: { kind: "manual" },
    unit: { one: "bezoeker", many: "bezoekers" },
    steps: {
      before: ["Controleer de voorwaarden van het platform en wat je belooft.", "Leg vast hoe je bezoekers en steuners telt (statistieken van het platform)."],
      during: ["Voer wekelijks de telling van bezoekers en steuners in; bewaar een export als bewijsbestand."],
      after: ["Noteer hoeveel steuners uit het eigen netwerk kwamen."],
    },
    card: {
      test_method: "Campagne op een crowdfundingplatform met een concreet aanbod",
      metric_label: "Steunt de campagne",
      metric_numerator: "unieke steuners van de campagne",
      metric_denominator: "unieke bezoekers van de campagnepagina",
      success_threshold_pct: 3,
      fail_threshold_pct: 0.5,
      min_sample: 500,
      max_duration_days: 56,
      expected_biases: "De eerste steun komt bijna altijd uit het eigen netwerk.",
    },
  },
  {
    id: "minimale-versie",
    name: "Minimale versie in gebruik",
    summary: "Laat een kleine groep een eerste, beperkte versie gebruiken en meet of ze terugkomen.",
    category: "valideren",
    lenses: ["desirability", "feasibility"],
    evidenceKind: "demo_request",
    cost: "hoog",
    costText: "€ 1.000+ (bouwen)",
    time: "maanden",
    timeText: "4–8 weken",
    sample: "20–50 gebruikers",
    audiences: ["b2b", "b2c"],
    proves: "Of mensen een eerste versie in hun eigen situatie blijven gebruiken.",
    doesNotProve: "Dat ze ervoor betalen, of dat het gebruik op grotere schaal hetzelfde is.",
    pitfalls: ["Te veel bouwen voordat je weet wat ertoe doet.", "Aanmeldingen tellen in plaats van terugkerend gebruik."],
    runs: { kind: "manual" },
    unit: { one: "gebruiker", many: "gebruikers" },
    steps: {
      before: ["Bouw alleen wat nodig is voor de kernhandeling.", "Leg vast wat telt als terugkerend gebruik (bijv. actief in week 3)."],
      during: ["Houd per gebruiker bij of die in de afgesproken week actief was; bewaar een export zonder persoonsgegevens."],
      after: ["Voer per gebruiker in of die volgens je definitie terugkwam."],
    },
    card: {
      test_method: "Eerste beperkte versie bij een kleine groep, met een vooraf vastgelegde gebruiksmaat",
      metric_label: "Actief in de afgesproken week",
      metric_numerator: "gebruikers die in de afgesproken week de kernhandeling uitvoeren",
      metric_denominator: "gebruikers die toegang kregen",
      success_threshold_pct: 30,
      fail_threshold_pct: 10,
      min_sample: 20,
      max_duration_days: 56,
      expected_biases: "Vroege gebruikers zijn enthousiaster dan de markt; nieuwsgierigheid verdwijnt na een week.",
    },
  },
];

// ---------------------------------------------------------------------------------------------------------------
// Afgeleide eigenschappen
// ---------------------------------------------------------------------------------------------------------------

export function catalogMethod(id: string | null | undefined): CatalogMethod | null {
  if (!id) return null;
  return CATALOG.find((m) => m.id === id) ?? null;
}

// De trede op de bewijsschaal: afgeleid uit de soort waarneming, nooit los opgegeven.
export function evidenceStep(m: Pick<CatalogMethod, "evidenceKind">): ScaleStep {
  return m.evidenceKind ? scaleOfKind(m.evidenceKind) : "exploration";
}

export function evidenceLevelOf(m: Pick<CatalogMethod, "evidenceKind">): EvidenceLevel | null {
  return m.evidenceKind ? KIND_LEVEL[m.evidenceKind] : null;
}

// Zeg-gedrag of doe-gedrag, zoals de bestaande bewijsfactoren het indelen (KIND_DEFAULTS.isBehaviour).
export type Signal = "zeggen" | "doen" | "bureau";
export const SIGNAL_LABELS: Record<Signal, string> = {
  zeggen: "Wat mensen zeggen",
  doen: "Wat mensen doen",
  bureau: "Bureauonderzoek (geen klantwaarneming)",
};
export function evidenceSignal(m: Pick<CatalogMethod, "evidenceKind">): Signal {
  if (!m.evidenceKind) return "bureau";
  return KIND_DEFAULTS[m.evidenceKind].isBehaviour ? "doen" : "zeggen";
}

// Uitleg van de bewijssoort in gewone taal: soort waarneming, trede en factor.
export function evidenceText(m: Pick<CatalogMethod, "evidenceKind" | "runs">): string {
  if (!m.evidenceKind) return "Bureauonderzoek: telt als bron, niet als klantbewijs.";
  const step = EVIDENCE_SCALE[scaleIndex(evidenceStep(m))];
  const lr = OBSERVATION_LR[m.evidenceKind].lr.toLocaleString("nl-NL");
  const manual = m.runs.kind === "manual" ? " Handmatig ingevoerd: hooguit een kleine handeling op de ladder." : "";
  return `${OBSERVATION_KINDS[m.evidenceKind]} · trede ${step.label.toLowerCase()} (niveau ${LEVEL_SHORT[KIND_LEVEL[m.evidenceKind]]}, factor ${lr}).${manual}`;
}

export function runsKind(m: Pick<CatalogMethod, "runs">): RunsKind {
  return m.runs.kind;
}

// Het testtype in ProofLab: het ingebouwde type, "manual" voor een sjabloon, null voor bureauonderzoek.
export function catalogExperimentType(m: Pick<CatalogMethod, "runs">): ExperimentType | null {
  if (m.runs.kind === "builtin") return m.runs.type;
  if (m.runs.kind === "manual") return "manual";
  return null;
}

export function runsText(m: Pick<CatalogMethod, "runs">): string {
  if (m.runs.kind === "builtin") return `Ingebouwd: ${EXPERIMENT_TYPES[m.runs.type].label.toLowerCase()}`;
  if (m.runs.kind === "manual") return "Begeleid handmatig sjabloon";
  return "Bureauonderzoek: vastleggen als bron";
}

// Het draaiboek: de vaste stap van de testkaart, de stappen van de methode en (handmatig) de vaste invoerstap.
export function checklistFor(m: Pick<CatalogMethod, "steps" | "runs" | "card">): CatalogSteps {
  const before = m.card ? [TEST_CARD_STEP, ...m.steps.before] : [...m.steps.before];
  const after = m.runs.kind === "manual" ? [MANUAL_RESULT_STEP, ...m.steps.after] : [...m.steps.after];
  return { before, during: [...m.steps.during], after };
}

// ---------------------------------------------------------------------------------------------------------------
// Zoeken en filteren
// ---------------------------------------------------------------------------------------------------------------

export type CatalogFilter = {
  query?: string;
  category?: CatalogCategory | "";
  lens?: Lens | "";
  cost?: CostBand | "";
  time?: TimeBand | "";
  step?: ScaleStep | "";
  runs?: RunsKind | "";
  audience?: Audience | "";
};

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");

function haystack(m: CatalogMethod): string {
  return fold([m.name, m.summary, m.proves, m.doesNotProve, m.sample, ...m.pitfalls, m.id.replace(/-/g, " ")].join(" "));
}

// Alle woorden van de zoekvraag moeten voorkomen (in naam, omschrijving, wat het bewijst, valkuilen …).
export function filterCatalog(methods: readonly CatalogMethod[], f: CatalogFilter): CatalogMethod[] {
  const words = fold(f.query ?? "").split(/\s+/).filter(Boolean);
  return methods.filter((m) => {
    if (f.category && m.category !== f.category) return false;
    if (f.lens && !m.lenses.includes(f.lens)) return false;
    if (f.cost && m.cost !== f.cost) return false;
    if (f.time && m.time !== f.time) return false;
    if (f.step && evidenceStep(m) !== f.step) return false;
    if (f.runs && m.runs.kind !== f.runs) return false;
    if (f.audience && !m.audiences.includes(f.audience)) return false;
    if (words.length) {
      const h = haystack(m);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

// Filters uit de adresbalk (?q=…&categorie=…), alleen geldige waarden.
export function filterFromParams(sp: Record<string, string | string[] | undefined>): CatalogFilter {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const pick = <T extends string>(v: string, allowed: readonly T[]): T | "" => ((allowed as readonly string[]).includes(v) ? (v as T) : "");
  return {
    query: one("q").slice(0, 80),
    category: pick(one("categorie"), Object.keys(CATEGORIES) as CatalogCategory[]),
    lens: pick(one("toetst"), Object.keys(LENSES) as Lens[]),
    cost: pick(one("kosten"), Object.keys(COST_BANDS) as CostBand[]),
    time: pick(one("tijd"), Object.keys(TIME_BANDS) as TimeBand[]),
    step: pick(one("bewijs"), EVIDENCE_SCALE.map((s) => s.step)),
    runs: pick(one("uitvoering"), Object.keys(RUNS_LABELS) as RunsKind[]),
    audience: pick(one("markt"), Object.keys(AUDIENCES) as Audience[]),
  };
}

// ---------------------------------------------------------------------------------------------------------------
// Sjabloon → testkaart
// ---------------------------------------------------------------------------------------------------------------

export type TestCardPrefill = CardTemplate & { we_believe: string; target_group: string };

export function templateToTestCard(m: Pick<CatalogMethod, "card">, statement: string, audience: string): TestCardPrefill | null {
  if (!m.card) return null;
  return { ...m.card, we_believe: statement, target_group: audience };
}

// De configuratie van een handmatige test, opgesteld op de server uit de catalogus (nooit uit het formulier): de
// methode, de soort waarneming (bewijssoort, hooguit een kleine handeling), het draaiboek en de eenheid. Ligt na
// goedkeuring vast met de rest van de configuratie (guard_experiment).
export type ManualConfig = {
  catalog_method_id: string;
  observation_kind: ManualObservationKind;
  method_name: string;
  checklist: CatalogSteps;
  extra_steps: string[];
  unit: { one: string; many: string };
};

export function manualConfigFor(m: CatalogMethod, extraSteps: string[] = []): ManualConfig | null {
  if (m.runs.kind !== "manual" || !isManualObservationKind(m.evidenceKind)) return null;
  return {
    catalog_method_id: m.id,
    observation_kind: m.evidenceKind,
    method_name: m.name,
    checklist: checklistFor(m),
    extra_steps: extraSteps.map((s) => s.trim().slice(0, 300)).filter(Boolean).slice(0, 10),
    unit: m.unit ?? { one: "waarneming", many: "waarnemingen" },
  };
}

// Leest de opgeslagen configuratie terug (ook van een oudere of onvolledige rij); null als het geen handmatige test is.
export function manualConfigOf(config: unknown): ManualConfig | null {
  const id = catalogMethodIdOf(config);
  if (!id || !config || typeof config !== "object") return null;
  const c = config as Partial<ManualConfig>;
  const m = catalogMethod(id);
  const kind = isManualObservationKind(c.observation_kind) ? c.observation_kind : null;
  if (!kind) return null;
  const list = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const steps = c.checklist && typeof c.checklist === "object" ? c.checklist : null;
  return {
    catalog_method_id: id,
    observation_kind: kind,
    method_name: typeof c.method_name === "string" ? c.method_name : (m?.name ?? id),
    checklist: steps ? { before: list(steps.before), during: list(steps.during), after: list(steps.after) } : m ? checklistFor(m) : { before: [], during: [], after: [] },
    extra_steps: list(c.extra_steps),
    unit: c.unit && typeof c.unit.one === "string" && typeof c.unit.many === "string" ? c.unit : (m?.unit ?? { one: "waarneming", many: "waarnemingen" }),
  };
}

// Naam van het testtype voor rapport en bewijs: bij een handmatige test met de catalogusmethode erbij.
export function experimentTypeLabel(type: string, config: unknown): string {
  if (type === "manual") {
    const c = manualConfigOf(config);
    return c ? `${c.method_name} (handmatig ingevoerd)` : "Handmatig sjabloon (handmatig ingevoerd)";
  }
  const label = (EXPERIMENT_TYPES as Record<string, { label: string }>)[type]?.label ?? type;
  const m = catalogMethod(catalogMethodIdOf(config));
  return m && m.runs.kind === "builtin" && m.runs.type === type && m.name !== label ? `${label} · ${m.name}` : label;
}

// ---------------------------------------------------------------------------------------------------------------
// Koppeling met de aanbeveler: welke catalogusmethode hoort bij een voorgestelde test?
// ---------------------------------------------------------------------------------------------------------------

const RECOMMENDED: Record<VoiTestType, string> = {
  interview: "probleeminterviews",
  landing: "nepdeur-pagina",
  pricing: "prijs-aanbodtest",
  survey: "online-enquete",
  manual: "concierge",
  prototype: "technische-proef",
  outreach: "outreach-proef",
  desk_check: "juridische-check",
};

// De catalogusmethode bij een voorgestelde test; bij een prijsaanname horen interviews over huidige uitgaven.
export function catalogMethodForTest(type: VoiTestType, kind?: AssumptionKind | null): CatalogMethod | null {
  if (type === "interview" && kind === "price") return catalogMethod("uitgaveninterviews");
  return catalogMethod(RECOMMENDED[type]);
}

// De methode als keuze in de testkaart-bouwer ("Uit de catalogus"), met dezelfde velden als een aanbeveling. De
// sterkte volgt de trede op de bewijsschaal. Null voor bureauonderzoek (geen test in ProofLab).
const STRENGTH: Record<ScaleStep, Option["strength"]> = { exploration: "Zwak", opinion: "Zwak", behaviour: "Middel", payment: "Sterk", repeat: "Sterk" };
export function catalogOption(m: CatalogMethod): Option | null {
  const type = catalogExperimentType(m);
  if (!type) return null;
  const days = { dagen: 7, weken: 21, maanden: 56 }[m.time];
  const costEur = { laag: 100, middel: 1000, hoog: 2500 }[m.cost];
  return {
    tier: "Uit de catalogus",
    type,
    why: `${m.name}: ${m.summary}`,
    learn: m.proves,
    cannotConclude: m.doesNotProve,
    effort: m.sample,
    duration: m.timeText,
    cost: m.costText,
    strength: STRENGTH[evidenceStep(m)],
    canChangeDecision: m.card ? "Ja, als de uitkomst onder de vooraf vastgelegde faaldrempel blijft." : "Nee: bureauonderzoek.",
    followUp: "",
    costEur,
    days,
  };
}

// Welke lens past bij een soort aanname: de catalogus opent vanuit een aanname met dit filter.
export const KIND_LENS: Record<AssumptionKind, Lens> = {
  market: "desirability",
  behaviour: "desirability",
  price: "viability",
  channel: "viability",
  technical: "feasibility",
  regulation: "feasibility",
};

// De opties van de testkaart-bouwer met een gekozen catalogusmethode: de methode eerst, daarna de aanbevelingen van een
// ander testtype (zo is er per testtype één keuze en geldt het sjabloon eenduidig), hooguit vier.
export function optionsWithCatalog(options: Option[], m: CatalogMethod | null): Option[] {
  const own = m ? catalogOption(m) : null;
  if (!own) return options;
  return [own, ...options.filter((o) => o.type !== own.type)].slice(0, 4);
}
