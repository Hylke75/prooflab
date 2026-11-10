// Contextual coach: reacts to the actual state of the dossier, not to a fixed list of tips.

import type { IconName } from "@/components/Icon";
import type { SprintStage } from "@/lib/domain/sprint";
import { followUpFor, forecastDue, MOMENT_LABELS, openMomentFor, type ForecastState } from "@/lib/domain/forecast";

export type CoachPage = "dashboard" | "overview" | "intake" | "research" | "integrations" | "assumptions" | "model" | "businesscase" | "experiments" | "evidence" | "report" | "outcome" | "forecasts" | "clients" | "other";

export type ExperimentSummary = {
  id: string;
  title: string;
  state: string;
  startedAt: string | null;
  endsAt: string | null;
  hasApprovedCard: boolean;
};

import { getDossierStatus, isConclusiveDecision, type DossierInput } from "./dossier-status";
import { dossierInput } from "@/lib/steps";

export type IdeaProgress = {
  ideaId: string;
  questions: number;
  claims: number;
  verifiedClaims: number;
  weakClaims: number;
  competitors: number;
  hasAlternatives: boolean;
  segments: number;
  sizingEstablished: boolean;
  // Businesscase: "calculated" = omzet en vaste kosten zijn ingevuld, "started" = begonnen. Ontbreekt = niet begonnen.
  businessCase?: "none" | "started" | "calculated";
  assumptions: number;
  assumptionsWithoutEvidence: number;
  untestedCritical: number; // importance >= 4, still untested
  topAssumption: { id: string; statement: string; evidence: number } | null;
  experiments: ExperimentSummary[];
  experimentsDraft: number; // draft + ready_for_review + approved (not yet live)
  experimentsLive: number; // live or paused
  experimentsEnded: number;
  learningCardsDraft: number;
  learningCardsApproved: number;
  latestCardApprovedAt: string | null;
  latestRealityCheckAt: string | null;
  decisions: number;
  latestDecisionAt: string | null;
  // Actie van het laatste besluit (decisions.action): alleen doorgaan of stoppen rondt stap Besluit af.
  latestDecisionAction: string | null;
  // Bevestigd door de opdrachtgever, of geen bevestiging nodig (dossier zonder opdrachtgever, zie decision-confirmation.ts).
  latestDecisionConfirmed: boolean;
  reports: number;
  latestReportAt: string | null;
  latestReportShared: boolean;
  behaviourObservations: number;
  // Fase B1c: invoer voor getDossierStatus(); ontbreekt in oudere testdata, dan rekent lib/steps met de tellers hierboven.
  dossier?: DossierInput;
  // Prediction loop; absent when the database has no prediction schema yet (the coach then ignores it).
  forecast?: ForecastState;
};

export type CoachSuggestion = { label: string; href: string; icon: IconName };

export type CoachData = {
  title: string;
  copy: string;
  insightTitle: string;
  insight: string;
  suggestions: CoachSuggestion[];
  ideaId?: string;
  audience: "consultant" | "client";
};

export type NextAction = { title: string; detail: string; href: string; icon: IconName };

const PAGE_COPY: Record<CoachPage, [string, string]> = {
  dashboard: ["Wat gaan we vandaag bewijzen?", "Je hoeft geen expert in marktonderzoek te zijn. Ik help je de juiste vragen te stellen en de volgende stap te kiezen."],
  overview: ["Waar staat dit dossier?", "Eén volgende stap tegelijk. Hier zie je hoe ver elke stap is en wat de coach opviel."],
  intake: ["Drie vragen, één bevestiging.", "Het idee en voor wie, de beslissing met inzet en datum, en je grootste onzekerheid. Daarna stelt ProofLab de rest voor; jij controleert en past aan."],
  research: ["Kijk verder dan de concurrent.", "Ook Excel, je eigen netwerk of helemaal niets doen kan de grootste concurrent zijn."],
  integrations: ["Hoor de klant in zijn eigen woorden.", "Reviews, forumdraden, enquête-antwoorden en LinkedIn-reacties laten zien welke problemen klanten zelf noemen. Haal ze hier binnen; ze verschijnen bij Doelgroepen."],
  assumptions: ["Begin met je grootste risico.", "Welke aanname zou het hele idee onderuit halen als die niet klopt? Daar beginnen we. Kies er hooguit drie om nu te testen; de rest wacht op later."],
  model: ["Een vol canvas is geen bewijs.", "Elk vak is een aanname. Koppel de onderdelen waar het model op rust aan een aanname en toets de riskantste eerst; zo zie je welk deel getoetst, onderbouwd of nog geloof is."],
  businesscase: ["Eerst een ruwe rekensom, dan verfijnen.", "Je hoeft niet alles te weten. Vul in wat je verwacht; ProofLab rekent mee, zegt wat ontbreekt en welk getal het zwaarst weegt."],
  experiments: ["Test gedrag, geen complimenten.", "Een enthousiaste reactie is prettig. Een echte afspraak of betaling zegt vaak meer."],
  evidence: ["Wat zegt dit bewijs echt?", "Het doel is leren, niet gelijk krijgen. Kijk ook naar wat een resultaat niet aantoont."],
  report: ["Maak je verhaal controleerbaar.", "Goede directierapporten maken duidelijk wat bekend is, wat geschat is en welke beslissing volgt."],
  outcome: ["Voorspel, en kijk daarna wat er gebeurde.", "Leg vooraf vast wanneer het idee geslaagd is. Zes maanden na het besluit blijkt of de voorspellingen klopten."],
  forecasts: ["Leer van je eigen voorspellingen.", "Een goede voorspeller zegt 70% en ziet het ook ongeveer 7 van de 10 keer gebeuren."],
  clients: ["Betrek de opdrachtgever.", "Als het leren alleen bij de consultant zit, is testen uitbesteed. Laat de opdrachtgever meebeslissen."],
  other: ["Eén stap tegelijk.", "ProofLab denkt kritisch mee. Jij houdt de regie."],
};

// What a client stakeholder reads on each screen: explanation, not a to-do list.
const CLIENT_COPY: Record<CoachPage, [string, string, string]> = {
  dashboard: ["Welkom bij uw dossier.", "Hier volgt u het onderzoek dat voor u wordt uitgevoerd. U kijkt mee; het onderzoeksteam doet het werk.", "U ziet per dossier in welke sprintweek het onderzoek zit, het laatst gedeelde rapport en of er een besluit op uw bevestiging wacht."],
  overview: ["Uw dossier.", "Hier volgt u het onderzoek.", "Het onderzoeksteam werkt stap voor stap van marktverkenning naar besluit."],
  intake: ["Begin bij de beslissing.", "Elk onderzoek start met de beslissing die u wilt nemen.", "Het onderzoeksteam legt de beslisvraag met u vast."],
  integrations: ["Wat zeggen klanten zelf?", "Het onderzoeksteam verzamelt hier reacties uit reviews, forums en LinkedIn.", "Klantreacties zijn kwalitatieve signalen: ze maken vragen scherper, maar bewijzen geen gedrag."],
  research: ["Wat weten we over de markt?", "Elke bevinding verwijst naar een bron met een letterlijk citaat. ProofLab controleert dat citaat zelf.", "Een bevinding met 'onvoldoende bewijs' is een open vraag, geen feit. Een AI-tekst telt nooit als bron."],
  assumptions: ["Wat moet waar zijn?", "De risicokaart zet af hoe belangrijk een aanname is tegen hoeveel bewijs er al voor is.", "Rechtsboven staan de aannames die het meest belangrijk zijn en het minst bewezen. Die worden als eerste getest."],
  model: ["Het businessmodel.", "Het canvas laat zien hoe het idee moet werken: voor wie, wat, via welke kanalen, waar het geld vandaan komt en wat het kost.", "Bij elk onderdeel staat of het getoetst is, onderbouwd met bronnen of nog een aanname. Een gevuld vak is geen bewijs."],
  businesscase: ["De businesscase.", "Een rekensom van omzet, kosten en investeringen in drie scenario's: als het tegenvalt, realistisch en als het meevalt.", "Bij elk cijfer staat of het bevestigd is, een schatting of een voorstel. Een businesscase is een berekening met aannames, geen bewijs."],
  experiments: ["Hoe wordt er getest?", "Elke test heeft vooraf vastgelegde drempels. Na goedkeuring kunnen die niet meer stil worden aangepast.", "Tijdens een lopende test ziet u voortgang, maar nog geen conclusie. Een uitspraak volgt pas na de afgesproken eindconditie."],
  evidence: ["Wat zegt het bewijs?", "Hier staan de waargenomen signalen, de realiteitscheck en het besluitvoorstel van het onderzoeksteam.", "Bent u aangewezen als beslisser, dan bevestigt u hier het besluit. Daarmee wordt het onderdeel van het rapport."],
  report: ["Het rapport.", "Elke gedeelde versie is een vaste momentopname met bronnen, beperkingen en tegenbewijs.", "Het rapport laat zien wat bekend is, wat geschat is en wat nog niet bewezen is."],
  outcome: ["Hoe groot is de kans van slagen?", "Op vaste momenten geeft u een eigen kansinschatting, los van het onderzoeksteam.", "U ziet de andere voorspellingen pas nadat u de uwe hebt gegeven. Zo beïnvloedt niemand elkaar."],
  forecasts: ["Voorspelkwaliteit.", "", ""],
  clients: ["Betrek de opdrachtgever.", "", ""],
  other: ["Zo werkt ProofLab.", "ProofLab maakt zichtbaar wat bewezen is en wat nog niet.", "Een AI-antwoord is nooit automatisch bewijs."],
};

const MAX_SUGGESTIONS = 3;

function latest(a: string | null, b: string | null): boolean {
  // true when a is strictly newer than b (or b is missing while a exists)
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() > new Date(b).getTime();
}

function firstWithState(p: IdeaProgress, states: string[]): ExperimentSummary | undefined {
  return p.experiments.find((e) => states.includes(e.state));
}

export function endedWithoutCard(p: IdeaProgress): ExperimentSummary[] {
  return p.experiments.filter((e) => ["ended", "analyzed", "decided"].includes(e.state) && !e.hasApprovedCard);
}

export function realityCheckDue(p: IdeaProgress): boolean {
  return p.learningCardsApproved > 0 && latest(p.latestCardApprovedAt, p.latestRealityCheckAt);
}

export function decisionDue(p: IdeaProgress): boolean {
  return !!p.latestRealityCheckAt && (p.decisions === 0 || latest(p.latestRealityCheckAt, p.latestDecisionAt));
}

export function reportStale(p: IdeaProgress): boolean {
  return p.reports > 0 && latest(p.latestDecisionAt, p.latestReportAt);
}

export function nextAction(p: IdeaProgress): NextAction {
  const base = `/app/ideas/${p.ideaId}`;
  const exp = (e: ExperimentSummary) => `${base}/experiments/${e.id}`;
  // 1. Opvolging van de uitkomst na het besluit gaat altijd voor.
  const follow = followUpAction(p);
  if (follow) return follow;
  // 2. Daarna de sprintvolgorde: onderzoek → aannames → test → besluit. Uitkomstdefinitie en voorspelling zijn
  //    hier een neventip (predictionTip), behalve op het moment van het besluit.
  if (p.questions === 0) return { title: "Maak de onderzoekskaart", detail: "Maximaal vijf vragen die je beslissing echt kunnen veranderen.", href: `${base}/research`, icon: "compass" };
  if (p.claims === 0) return { title: "Verzamel de eerste bronnen", detail: "Start een marktcheck of voeg zelf een bron met citaat toe.", href: `${base}/research?tab=sources`, icon: "compass" };
  if (!p.hasAlternatives) return { title: "Breng huidige alternatieven in kaart", detail: "Hoe lossen klanten dit nu op, ook zonder software of door niets te doen?", href: `${base}/research?tab=competitors`, icon: "compass" };
  if (p.assumptions === 0) return { title: "Maak je aannames zichtbaar", detail: "Wat moet waar zijn? Begin bij wat het belangrijkst is en het minst bewezen.", href: `${base}/assumptions`, icon: "layers" };
  if (p.experiments.length === 0)
    return {
      title: "Toets de grootste onzekerheid",
      detail: p.topAssumption ? `"${p.topAssumption.statement}" heeft nog weinig bewijs.` : "Kies een kleine test met echt gedrag.",
      href: p.topAssumption ? `${base}/experiments?assumption=${p.topAssumption.id}` : `${base}/experiments`,
      icon: "flask",
    };
  const live = firstWithState(p, ["live"]);
  if (live) return { title: "Werf deelnemers voor je lopende test", detail: "Deel de testlink via de afgesproken kanalen. Een uitspraak volgt pas na de eindconditie.", href: exp(live), icon: "flask" };
  const paused = firstWithState(p, ["paused"]);
  if (paused) return { title: "Hervat of beëindig de gepauzeerde test", detail: `"${paused.title}" staat stil. Een gepauzeerde test levert geen nieuw bewijs op.`, href: exp(paused), icon: "flask" };
  const unlearned = endedWithoutCard(p)[0];
  if (unlearned)
    return {
      title: "Leg vast wat je hebt geleerd",
      detail: "Rond de leerkaart af: wat verwachtten we, wat zagen we, wat doen we nu?",
      href: p.learningCardsDraft > 0 ? `${base}/evidence` : exp(unlearned),
      icon: "shield",
    };
  const approved = firstWithState(p, ["approved"]);
  if (approved) return { title: "Publiceer de test", detail: `"${approved.title}" is goedgekeurd en vergrendeld. Zet hem live om te gaan meten.`, href: `${exp(approved)}#publiceren`, icon: "flask" };
  const review = firstWithState(p, ["ready_for_review"]);
  if (review) return { title: "Keur de testkaart goed", detail: `"${review.title}" wacht op review. Goedkeuren vergrendelt hypothese en drempels.`, href: `${exp(review)}#goedkeuren`, icon: "flask" };
  const draft = firstWithState(p, ["draft"]);
  if (draft) return { title: "Rond je testkaart af en zet hem ter review", detail: `"${draft.title}" is nog een concept. Leg vooraf vast wat je meet en wanneer het klopt.`, href: `${exp(draft)}#ter-review`, icon: "flask" };
  if (realityCheckDue(p)) return { title: "Doe de realiteitscheck", detail: "Er is nieuw bewijs sinds de laatste check. De check zoekt tegenbewijs en valkuilen vóór het besluit.", href: `${base}/evidence`, icon: "shield" };
  if (decisionDue(p)) {
    const atDecision = decisionMomentAction(p);
    if (atDecision) return atDecision;
  }
  if (decisionDue(p)) return { title: "Neem het besluit", detail: "Doorgaan, bijsturen, verder testen, pauzeren of stoppen. Jij beslist, de check adviseert.", href: `${base}/evidence`, icon: "shield" };
  // Na verder testen, bijsturen, een verlengde testfase of pauzeren is het dossier niet besloten: eerst de volgende
  // test (of de terugkeer na de pauze), pas na een definitief besluit het rapport delen.
  const open = openDecisionAction(p);
  if (open) return open;
  if (p.reports === 0) return { title: "Maak het eerste rapport", detail: "Bundel beslisvraag, bronnen, tests en besluit in een vaste rapportversie.", href: `${base}/report`, icon: "file" };
  if (reportStale(p)) return { title: "Werk het rapport bij", detail: "Er is een besluit genomen na de laatste rapportversie. Maak een nieuwe versie.", href: `${base}/report`, icon: "file" };
  if (!p.latestReportShared) return { title: "Deel het rapport met de opdrachtgever", detail: "De laatste versie is nog niet gedeeld. De opdrachtgever ziet alleen gedeelde versies.", href: `${base}/report`, icon: "file" };
  if (p.decisions > 0 && !p.latestDecisionConfirmed) return { title: "Wacht op bevestiging van het besluit", detail: "De opdrachtgever bevestigt het besluit zelf in ProofLab. Bespreek het in de besluitsessie.", href: `${base}/evidence`, icon: "users" };
  return {
    title: "Kies de volgende aanname om te toetsen",
    detail: p.topAssumption ? `Grootste resterende risico: "${p.topAssumption.statement}".` : "Het dossier is bijgewerkt. Bepaal wat je nu nog niet weet.",
    href: `${base}/assumptions`,
    icon: "layers",
  };
}

// De volgende stap na een besluit dat het traject gaande houdt; null zonder besluit of na doorgaan/stoppen.
export function openDecisionAction(p: IdeaProgress): NextAction | null {
  if (p.decisions === 0 || isConclusiveDecision(p.latestDecisionAction)) return null;
  const base = `/app/ideas/${p.ideaId}`;
  const risk = p.topAssumption ? `Grootste resterende risico: "${p.topAssumption.statement}".` : "Kies de aanname die het besluit nu tegenhoudt.";
  const testHref = p.topAssumption ? `${base}/experiments?assumption=${p.topAssumption.id}` : `${base}/experiments`;
  switch (p.latestDecisionAction) {
    case "adjust":
      return { title: "Stuur bij en ontwerp een nieuwe test", detail: `Het besluit was bijsturen. Pas aanbod, doelgroep of belofte aan en toets opnieuw. ${risk}`, href: `${base}/assumptions`, icon: "layers" };
    case "pause":
      return { title: "Het dossier is gepauzeerd", detail: "Leg vast wat er moet veranderen om terug te komen. Na nieuw bewijs volgt het definitieve besluit: doorgaan of stoppen.", href: `${base}/evidence`, icon: "clock" };
    case "extend":
      return { title: "Verzamel gedragsbewijs in de verlengde testfase", detail: `Start of loop de vervolgtest. Het definitieve besluit volgt na de verlengde testfase. ${risk}`, href: testHref, icon: "flask" };
    default:
      return { title: "Ontwerp de volgende test", detail: `Het besluit was verder testen: het bewijs is nog te zwak of onbeslist. ${risk}`, href: testHref, icon: "flask" };
  }
}

// Opvolging van de uitkomst: de tussenstand na drie maanden en de uitkomst na zes maanden (of op de meetdatum).
export function followUpAction(p: IdeaProgress): NextAction | null {
  if (!p.forecast) return null;
  const base = `/app/ideas/${p.ideaId}`;
  const fu = followUpFor(p);
  if (fu?.outcomeDue && p.forecast.question === "stop_review")
    return { title: "Was stoppen achteraf terecht?", detail: "Zes maanden na het stop- of pauzebesluit: leg met bewijs vast of stoppen terecht was.", href: `${base}/outcome#uitkomst`, icon: "check" };
  if (fu?.outcomeDue) return { title: "Leg de uitkomst vast", detail: "De meetdatum is bereikt: is het doel gehaald? Leg het vast met bewijs, dan worden de voorspellingen gescoord.", href: `${base}/outcome#uitkomst`, icon: "check" };
  if (fu?.checkinDue) return { title: "Geef de tussenstand", detail: "Drie maanden na het besluit: ligt het doel op koers? Een korte tussenstand houdt de uitkomstmeting eerlijk.", href: `${base}/outcome#tussenstand`, icon: "clock" };
  return null;
}

// Neventip van de voorspellus: eerst de uitkomstdefinitie, dan een basispercentage, dan een voorspelling op het
// open moment. Een voorspelling wordt pas gevraagd als er een basispercentage is: de pagina weigert anders.
export function predictionTip(p: IdeaProgress): NextAction | null {
  const f = p.forecast;
  if (!f || f.resolved) return null;
  const base = `/app/ideas/${p.ideaId}`;
  if (!f.outcomeDefined) return { title: "Leg vast wanneer dit geslaagd is", detail: "Eén meetbare zin met een doelwaarde. Zonder die definitie kan niemand achteraf zeggen of het klopte.", href: `${base}/outcome#definitie`, icon: "trend" };
  if (!f.baseRateChosen) return { title: "Kies een basispercentage", detail: "Hoe vaak slagen vergelijkbare ideeën? Elke voorspelling start bij dat buitenperspectief.", href: `${base}/outcome#basispercentage`, icon: "compass" };
  const due = forecastDue(p);
  if (!due) return null;
  return {
    title: "Geef je voorspelling",
    detail: `${MOMENT_LABELS[due].label}: hoe groot is de kans dat het doel wordt gehaald? Begin bij het basispercentage.`,
    href: due === "decision" ? `${base}/evidence?stap=besluit#voorspelling` : `${base}/outcome#voorspelling`,
    icon: "trend",
  };
}

// Op het moment van het besluit is de voorspellus wél de hoofdactie: het besluit vraagt een uitkomstdefinitie en
// de eigen voorspelling (en die vraagt een basispercentage).
function decisionMomentAction(p: IdeaProgress): NextAction | null {
  const f = p.forecast;
  if (!f || f.resolved) return null;
  // Zonder uitkomstdefinitie is er geen voorspelmoment, maar het besluit wordt wel geweigerd (decisionBlocker).
  if (!f.outcomeDefined || openMomentFor(p) === "decision") return predictionTip(p);
  return null;
}

// De voorspellus als geheel (opvolging eerst), voor de pagina Voorspelling & uitkomst.
export function predictionAction(p: IdeaProgress): NextAction | null {
  return followUpAction(p) ?? predictionTip(p);
}

// Where the dossier is on the sprint path (used for "loopt achter").
// Waar het dossier echt staat (fase B1c): de huidige stap uit getDossierStatus(). Een lopende test zet het dossier
// in de testfase. Na het besluit telt het rapport nog mee: zonder (actueel) rapport is de sprint niet rond.
export function sprintStage(p: IdeaProgress): SprintStage {
  const s = getDossierStatus(dossierInput(p));
  const stage = ({ market: 1, assumptions: 2, test: 3, decide: 4, done: 5 } as const)[s.current];
  if (stage === 5 && (p.reports === 0 || reportStale(p))) return 4;
  return stage;
}

function pageSuggestions(page: CoachPage, p: IdeaProgress): { items: CoachSuggestion[]; insight?: [string, string] } {
  const base = `/app/ideas/${p.ideaId}`;
  const items: CoachSuggestion[] = [];
  let insight: [string, string] | undefined;
  const add = (label: string, href: string, icon: IconName) => items.push({ label, href, icon });
  switch (page) {
    case "research": {
      if (p.questions === 0) add("Maak de onderzoekskaart", `${base}/research`, "compass");
      if (p.claims === 0) add("Voeg een eerste bron met citaat toe", `${base}/research?tab=sources`, "compass");
      if (p.weakClaims > 0) add(`Onderbouw ${p.weakClaims} bevinding${p.weakClaims === 1 ? "" : "en"} zonder genoeg bewijs`, `${base}/research?tab=sources`, "compass");
      if (!p.hasAlternatives) add("Breng het huidige alternatief in kaart", `${base}/research?tab=competitors`, "compass");
      if (p.segments === 0) add("Leg gebruiker en betaler vast", `${base}/research?tab=customers`, "users");
      if (!p.sizingEstablished) add("Onderbouw het basisaantal van de marktomvang", `${base}/research?tab=sizing`, "trend");
      // Aannames en pre-mortem mogen parallel aan het onderzoek: niets wacht op het einde van week 1.
      if (p.assumptions === 0) add("Schrijf alvast de eerste aannames op", `${base}/assumptions?stap=opschrijven#nieuwe-aanname`, "layers");
      if (p.weakClaims > 0) insight = ["Let hierop", `${p.weakClaims} bevinding(en) hebben nog onvoldoende bewijs. Zoekcijfers en AI-conclusies zijn geen bewijs dat klanten willen betalen.`];
      else if (!p.sizingEstablished) insight = ["Let hierop", "Het basisaantal van de marktomvang heeft nog geen bron. Tot die tijd is de omvang een verkenning, geen feit."];
      if (items.length === 0) add("Ga door naar de aannames", `${base}/assumptions`, "layers");
      break;
    }
    case "integrations": {
      add("Importeer reviews of forumdraden in bulk", `${base}/integrations#bulk-import`, "users");
      add("Haal één pagina met klantreacties op", `${base}/integrations#pagina-ophalen`, "compass");
      add("Bekijk de klantsignalen bij Doelgroepen", `${base}/research?tab=customers#klantsignalen`, "users");
      insight = ["Goed om te weten", "Klantsignalen tellen als kwalitatieve observatie, niet als gedrag. Gebruik ze om aannames en interviewvragen scherper te maken; voor bewijs is een test nodig."];
      break;
    }
    case "assumptions": {
      if (p.assumptions === 0) add("Schrijf de eerste aanname op", `${base}/assumptions?stap=opschrijven#nieuwe-aanname`, "layers");
      if (p.topAssumption && p.untestedCritical > 0)
        add(`Kies een test voor de grootste onzekerheid`, `${base}/experiments?assumption=${p.topAssumption.id}`, "flask");
      if (p.assumptionsWithoutEvidence > 0) add(`Koppel bewijs aan ${p.assumptionsWithoutEvidence} aanname${p.assumptionsWithoutEvidence === 1 ? "" : "s"} zonder bewijs`, `${base}/research?tab=sources`, "compass");
      if (p.topAssumption) insight = ["Mijn advies", `Grootste risico: "${p.topAssumption.statement}". Kies daar je eerste test voor.`];
      break;
    }
    case "model": {
      if (p.assumptions === 0) add("Schrijf de eerste aanname op", `${base}/assumptions?stap=opschrijven#nieuwe-aanname`, "layers");
      if (p.topAssumption && p.untestedCritical > 0) add("Kies een test voor de grootste onzekerheid", `${base}/experiments?assumption=${p.topAssumption.id}`, "flask");
      add("Bekijk de aannamekaart", `${base}/assumptions`, "layers");
      insight = ["Mijn advies", "Niet sturen op een vol canvas. Koppel de onderdelen waar het model op rust aan een aanname; de stand per onderdeel laat zien wat getoetst is en wat nog geloof is."];
      break;
    }
    case "businesscase": {
      if (p.assumptions === 0) add("Schrijf op wat waar moet zijn", `${base}/assumptions?stap=opschrijven#nieuwe-aanname`, "layers");
      add("Bekijk de marktomvang als controle", `${base}/research?tab=sizing`, "trend");
      insight = ["Mijn advies", "Een businesscase is een rekensom met aannames, geen bewijs. Toets het getal dat de uitkomst het meest bepaalt; dat staat onder \"Wat weegt het zwaarst\"."];
      break;
    }
    case "experiments": {
      const draft = firstWithState(p, ["draft"]);
      const review = firstWithState(p, ["ready_for_review"]);
      const approved = firstWithState(p, ["approved"]);
      const live = firstWithState(p, ["live", "paused"]);
      if (draft) add("Rond je testkaart af en zet hem ter review", `${base}/experiments/${draft.id}#ter-review`, "flask");
      if (review) add("Keur de testkaart goed", `${base}/experiments/${review.id}#goedkeuren`, "check");
      if (approved) add("Publiceer de test", `${base}/experiments/${approved.id}#publiceren`, "flask");
      if (live) add("Bekijk de tussenstand van de lopende test", `${base}/experiments/${live.id}`, "clock");
      if (p.experiments.length === 0 && p.topAssumption) add("Ontwerp een test voor de grootste onzekerheid", `${base}/experiments?assumption=${p.topAssumption.id}`, "flask");
      const unlearned = endedWithoutCard(p)[0];
      if (unlearned) add("Leg vast wat de afgeronde test leerde", `${base}/experiments/${unlearned.id}`, "shield");
      insight = ["Mijn advies", "Leg vóór de proef vast wanneer je iets als een serieus signaal ziet. Daarna kun je het niet stil aanpassen."];
      break;
    }
    case "evidence": {
      if (p.learningCardsDraft > 0) add("Keur de leerkaart goed", `${base}/evidence`, "shield");
      else if (endedWithoutCard(p).length > 0) add("Maak de leerkaart van de afgeronde test", `${base}/experiments/${endedWithoutCard(p)[0].id}`, "shield");
      if (realityCheckDue(p) || (!p.latestRealityCheckAt && p.experimentsEnded > 0)) add("Doe de realiteitscheck", `${base}/evidence`, "shield");
      else if (decisionDue(p)) {
        if (forecastDue(p) === "decision") {
          if (p.forecast?.baseRateChosen) add("Geef je voorspelling", `${base}/evidence?stap=besluit#voorspelling`, "trend");
          else add("Kies een basispercentage", `${base}/outcome#basispercentage`, "compass");
        }
        add("Neem het besluit", `${base}/evidence`, "check");
      }
      if (p.behaviourObservations === 0) {
        add("Plan een test met echt klantgedrag", `${base}/experiments`, "flask");
        insight = ["De kern", "Er is nog geen waargenomen klantgedrag. Interesse in een gesprek is iets anders dan een aanvraag of betaling."];
      }
      if (p.decisions > 0 && !p.latestDecisionConfirmed) add("Bespreek het besluit met de opdrachtgever", "/app/clients", "users");
      break;
    }
    case "report": {
      if (p.reports === 0) add("Maak het eerste rapport", `${base}/report`, "file");
      else if (reportStale(p)) add("Werk het rapport bij", `${base}/report`, "file");
      else if (!p.latestReportShared) add("Deel de laatste versie met de opdrachtgever", `${base}/report`, "users");
      if (!p.latestRealityCheckAt) add("Doe eerst de realiteitscheck", `${base}/evidence`, "shield");
      if (p.decisions === 0) add("Leg het besluit vast", `${base}/evidence`, "check");
      if (p.reports === 0) insight = ["Mijn advies", "Een rapport is een vaste momentopname. Maak het als het besluit genomen is, of eerder als tussenstand."];
      else if (reportStale(p)) insight = ["Let hierop", "Het laatste besluit staat nog niet in een rapportversie."];
      break;
    }
    case "outcome": {
      const prediction = predictionAction(p);
      if (prediction) add(prediction.title, prediction.href, prediction.icon);
      if (p.forecast && !p.forecast.baseRateChosen && p.forecast.outcomeDefined) add("Kies een basispercentage", `${base}/outcome#basispercentage`, "compass");
      if (p.forecast?.outcomeDefined && !p.forecast.outcomeDue) insight = ["Goed om te weten", "De uitkomstdatum wordt zes maanden na het besluit vastgezet. De tussenstand volgt na drie maanden."];
      else insight = ["Mijn advies", "Begin bij het basispercentage en pas het aan op wat dit dossier anders maakt. Schrijf in één zin waarom."];
      break;
    }
    case "dashboard":
      add("Nieuw idee onderzoeken", "/app/ideas/new", "plus");
      break;
    default:
      break;
  }
  return { items, insight };
}

export function coachFor(
  page: CoachPage,
  p: IdeaProgress | null,
  opts: { audience?: "consultant" | "client"; isClientDecider?: boolean; currentIdea?: { id: string; title: string } | null; noWorkspace?: boolean } = {},
): CoachData {
  if (opts.noWorkspace) return SETUP_COACH;
  const audience = opts.audience ?? "consultant";
  if (audience === "client") return clientCoach(page, p, !!opts.isClientDecider);
  const [title, copy] = PAGE_COPY[page];
  // Werkruimtepagina's (geen idee open): verwijs naar het lopende idee. Alleen zonder ideeën: begin met één idee.
  if (!p && opts.currentIdea) {
    const href = `/app/ideas/${opts.currentIdea.id}`;
    return {
      title,
      copy,
      insightTitle: "Je lopende idee",
      insight: `Je werkt aan "${opts.currentIdea.title}". Ga verder waar je gebleven was; het overzicht van dit idee toont de volgende stap.`,
      suggestions: [
        { label: `Verder met ${opts.currentIdea.title}`, href, icon: "arrow" },
        { label: "Nieuw idee onderzoeken", href: "/app/ideas/new", icon: "plus" },
      ],
      audience,
    };
  }
  if (!p) {
    return {
      title,
      copy,
      insightTitle: "Een goede start",
      insight: "Begin met één idee en de beslissing die het moet onderbouwen.",
      suggestions: [{ label: "Nieuw idee onderzoeken", href: "/app/ideas/new", icon: "plus" }],
      audience,
    };
  }
  const next = nextAction(p);
  const { items, insight } = pageSuggestions(page, p);
  const suggestions: CoachSuggestion[] = [];
  const push = (s: CoachSuggestion) => {
    if (suggestions.length < MAX_SUGGESTIONS && !suggestions.some((x) => x.href === s.href || x.label === s.label)) suggestions.push(s);
  };
  // Page-specific gaps first; on the dashboard (and when the page has nothing missing) the overall next step leads.
  if (page === "dashboard" || items.length === 0) push({ label: next.title, href: next.href, icon: next.icon });
  items.forEach(push);
  push({ label: next.title, href: next.href, icon: next.icon });
  // De voorspellus als neventip, alleen als er nog plaats is (nooit vóór de stap van de sprint).
  const tip = predictionTip(p);
  if (tip) push({ label: tip.title, href: tip.href, icon: tip.icon });
  return {
    title,
    copy,
    insightTitle: insight?.[0] ?? "Mijn advies",
    insight: insight?.[1] ?? next.detail,
    suggestions,
    ideaId: p.ideaId,
    audience,
  };
}

// UX-review 22: nog geen werkruimte en geen gedeeld dossier. Wie hier staat, begint meestal zelf (consultant); een
// opdrachtgever ziet een uitgenodigd dossier vanzelf. Daarom geen "uw dossier" of "u kijkt mee", maar de eerste stap.
const SETUP_COACH: CoachData = {
  title: "Welkom bij ProofLab.",
  copy: "Maak eerst je werkruimte aan: de plek voor je klanten, ideeën en onderzoeksdossiers. Daarna begin je met één idee en de beslissing die het moet onderbouwen.",
  insightTitle: "Uitgenodigd als opdrachtgever?",
  insight: "Dan heb je geen eigen werkruimte nodig. Log in met het e-mailadres waarop je de uitnodiging kreeg; het dossier verschijnt dan vanzelf.",
  suggestions: [{ label: "Wat betekenen de begrippen?", href: "/app/help#begrippen", icon: "info" }],
  audience: "consultant",
};

function clientCoach(page: CoachPage, p: IdeaProgress | null, isClientDecider: boolean): CoachData {
  const [title, copy, insight] = CLIENT_COPY[page];
  const suggestions: CoachSuggestion[] = [];
  if (p) {
    const base = `/app/ideas/${p.ideaId}`;
    if (isClientDecider && p.decisions > 0 && !p.latestDecisionConfirmed) suggestions.push({ label: "Bekijk en bevestig het besluit", href: `${base}/evidence`, icon: "check" });
    // Voorspellen kan pas als het onderzoeksteam een basispercentage koos; vraag er niet eerder om.
    if (forecastDue(p) && p.forecast?.baseRateChosen && page !== "outcome") suggestions.push({ label: "Geef uw voorspelling", href: `${base}/outcome#voorspelling`, icon: "trend" });
    if (page !== "report") suggestions.push({ label: "Lees het laatst gedeelde rapport", href: `${base}/report`, icon: "file" });
    if (page !== "evidence" && suggestions.length < MAX_SUGGESTIONS) suggestions.push({ label: "Bekijk het bewijs tot nu toe", href: `${base}/evidence`, icon: "shield" });
  }
  if (suggestions.length < MAX_SUGGESTIONS) suggestions.push({ label: "Wat betekenen de begrippen?", href: "/app/help#begrippen", icon: "info" });
  return { title, copy, insightTitle: "Goed om te weten", insight, suggestions: suggestions.slice(0, MAX_SUGGESTIONS), ideaId: p?.ideaId, audience: "client" };
}
