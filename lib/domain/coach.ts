// Contextual coach: reacts to the actual state of the dossier, not to a fixed list of tips.

import type { IconName } from "@/components/Icon";
import type { SprintStage } from "@/lib/domain/sprint";

export type CoachPage = "dashboard" | "intake" | "research" | "assumptions" | "experiments" | "evidence" | "report" | "clients" | "other";

export type ExperimentSummary = {
  id: string;
  title: string;
  state: string;
  startedAt: string | null;
  endsAt: string | null;
  hasApprovedCard: boolean;
};

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
  latestDecisionConfirmed: boolean;
  reports: number;
  latestReportAt: string | null;
  latestReportShared: boolean;
  behaviourObservations: number;
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
  intake: ["Begin bij de beslissing.", "Welke beslissing moet dit onderzoek ondersteunen? Daarmee krijgt elk onderzoek een doel en een moment waarop het genoeg is."],
  research: ["Kijk verder dan de concurrent.", "Ook Excel, je eigen netwerk of helemaal niets doen kan de grootste concurrent zijn."],
  assumptions: ["Begin met je grootste risico.", "Welke aanname zou het hele idee onderuit halen als die niet klopt? Daar beginnen we."],
  experiments: ["Test gedrag, geen complimenten.", "Een enthousiaste reactie is prettig. Een echte afspraak of betaling zegt vaak meer."],
  evidence: ["Wat zegt dit bewijs echt?", "Het doel is leren, niet gelijk krijgen. Kijk ook naar wat een resultaat niet aantoont."],
  report: ["Maak je verhaal controleerbaar.", "Goede directierapporten maken duidelijk wat bekend is, wat geschat is en welke beslissing volgt."],
  clients: ["Betrek de opdrachtgever.", "Als het leren alleen bij de consultant zit, is testen uitbesteed. Laat de opdrachtgever meebeslissen."],
  other: ["Eén stap tegelijk.", "ProofLab denkt kritisch mee. Jij houdt de regie."],
};

// What a client stakeholder reads on each screen: explanation, not a to-do list.
const CLIENT_COPY: Record<CoachPage, [string, string, string]> = {
  dashboard: ["Welkom bij uw dossier.", "Hier volgt u het onderzoek dat voor u wordt uitgevoerd. U kijkt mee; het onderzoeksteam doet het werk.", "U ziet per dossier in welke sprintweek het onderzoek zit, het laatst gedeelde rapport en of er een besluit op uw bevestiging wacht."],
  intake: ["Begin bij de beslissing.", "Elk onderzoek start met de beslissing die u wilt nemen.", "Het onderzoeksteam legt de beslisvraag met u vast."],
  research: ["Wat weten we over de markt?", "Elke bevinding verwijst naar een bron met een letterlijk citaat. ProofLab controleert dat citaat zelf.", "Een bevinding met 'onvoldoende bewijs' is een open vraag, geen feit. Een AI-tekst telt nooit als bron."],
  assumptions: ["Wat moet waar zijn?", "De risicokaart zet af hoe belangrijk een aanname is tegen hoeveel bewijs er al voor is.", "Rechtsboven staan de aannames die het meest belangrijk zijn en het minst bewezen. Die worden als eerste getest."],
  experiments: ["Hoe wordt er getest?", "Elke test heeft vooraf vastgelegde drempels. Na goedkeuring kunnen die niet meer stil worden aangepast.", "Tijdens een lopende test ziet u voortgang, maar nog geen conclusie. Een uitspraak volgt pas na de afgesproken eindconditie."],
  evidence: ["Wat zegt het bewijs?", "Hier staan de waargenomen signalen, de Reality Check en het besluitvoorstel van het onderzoeksteam.", "Bent u aangewezen als beslisser, dan bevestigt u hier het besluit. Daarmee wordt het onderdeel van het rapport."],
  report: ["Het rapport.", "Elke gedeelde versie is een vaste momentopname met bronnen, beperkingen en tegenbewijs.", "Het rapport laat zien wat bekend is, wat geschat is en wat nog niet bewezen is."],
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
      detail: "Rond de Learning Card af: wat verwachtten we, wat zagen we, wat doen we nu?",
      href: p.learningCardsDraft > 0 ? `${base}/evidence` : exp(unlearned),
      icon: "shield",
    };
  const approved = firstWithState(p, ["approved"]);
  if (approved) return { title: "Publiceer de test", detail: `"${approved.title}" is goedgekeurd en vergrendeld. Zet hem live om te gaan meten.`, href: exp(approved), icon: "flask" };
  const review = firstWithState(p, ["ready_for_review"]);
  if (review) return { title: "Keur de Test Card goed", detail: `"${review.title}" wacht op review. Goedkeuren vergrendelt hypothese en drempels.`, href: exp(review), icon: "flask" };
  const draft = firstWithState(p, ["draft"]);
  if (draft) return { title: "Rond je Test Card af en zet hem ter review", detail: `"${draft.title}" is nog een concept. Leg vooraf vast wat je meet en wanneer het klopt.`, href: exp(draft), icon: "flask" };
  if (realityCheckDue(p)) return { title: "Doe de Reality Check", detail: "Er is nieuw bewijs sinds de laatste check. De check zoekt tegenbewijs en valkuilen vóór het besluit.", href: `${base}/evidence`, icon: "shield" };
  if (decisionDue(p)) return { title: "Neem het besluit", detail: "Doorgaan, bijsturen, verder testen, pauzeren of stoppen. Jij beslist, de check adviseert.", href: `${base}/evidence`, icon: "shield" };
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

// Where the dossier is on the sprint path (used for "loopt achter").
export function sprintStage(p: IdeaProgress): SprintStage {
  if (p.claims === 0 || !p.hasAlternatives) return 1;
  if (p.assumptions === 0 || p.experiments.length === 0) return 2;
  if (p.experimentsEnded === 0) return 3;
  if (p.decisions === 0 || p.reports === 0 || reportStale(p)) return 4;
  return 5;
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
      if (p.weakClaims > 0) insight = ["Let hierop", `${p.weakClaims} bevinding(en) hebben nog onvoldoende bewijs. Zoekcijfers en AI-conclusies zijn geen bewijs dat klanten willen betalen.`];
      else if (!p.sizingEstablished) insight = ["Let hierop", "Het basisaantal van de marktomvang heeft nog geen bron. Tot die tijd is de omvang een verkenning, geen feit."];
      if (items.length === 0) add("Ga door naar de aannames", `${base}/assumptions`, "layers");
      break;
    }
    case "assumptions": {
      if (p.assumptions === 0) add("Schrijf de eerste aanname op", `${base}/assumptions#nieuwe-aanname`, "layers");
      if (p.topAssumption && p.untestedCritical > 0)
        add(`Kies een test voor de grootste onzekerheid`, `${base}/experiments?assumption=${p.topAssumption.id}`, "flask");
      if (p.assumptionsWithoutEvidence > 0) add(`Koppel bewijs aan ${p.assumptionsWithoutEvidence} aanname${p.assumptionsWithoutEvidence === 1 ? "" : "s"} zonder bewijs`, `${base}/research?tab=sources`, "compass");
      if (p.topAssumption) insight = ["Mijn advies", `Grootste risico: "${p.topAssumption.statement}". Kies daar je eerste test voor.`];
      break;
    }
    case "experiments": {
      const draft = firstWithState(p, ["draft"]);
      const review = firstWithState(p, ["ready_for_review"]);
      const approved = firstWithState(p, ["approved"]);
      const live = firstWithState(p, ["live", "paused"]);
      if (draft) add("Rond je Test Card af en zet hem ter review", `${base}/experiments/${draft.id}`, "flask");
      if (review) add("Keur de Test Card goed", `${base}/experiments/${review.id}`, "check");
      if (approved) add("Publiceer de test", `${base}/experiments/${approved.id}`, "flask");
      if (live) add("Bekijk de tussenstand van de lopende test", `${base}/experiments/${live.id}`, "clock");
      if (p.experiments.length === 0 && p.topAssumption) add("Ontwerp een test voor de grootste onzekerheid", `${base}/experiments?assumption=${p.topAssumption.id}`, "flask");
      const unlearned = endedWithoutCard(p)[0];
      if (unlearned) add("Leg vast wat de afgeronde test leerde", `${base}/experiments/${unlearned.id}`, "shield");
      insight = ["Mijn advies", "Leg vóór de proef vast wanneer je iets als een serieus signaal ziet. Daarna kun je het niet stil aanpassen."];
      break;
    }
    case "evidence": {
      if (p.learningCardsDraft > 0) add("Keur de Learning Card goed", `${base}/evidence`, "shield");
      else if (endedWithoutCard(p).length > 0) add("Maak de Learning Card van de afgeronde test", `${base}/experiments/${endedWithoutCard(p)[0].id}`, "shield");
      if (realityCheckDue(p) || (!p.latestRealityCheckAt && p.experimentsEnded > 0)) add("Doe de Reality Check", `${base}/evidence`, "shield");
      else if (decisionDue(p)) add("Neem het besluit", `${base}/evidence`, "check");
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
      if (!p.latestRealityCheckAt) add("Doe eerst de Reality Check", `${base}/evidence`, "shield");
      if (p.decisions === 0) add("Leg het besluit vast", `${base}/evidence`, "check");
      if (p.reports === 0) insight = ["Mijn advies", "Een rapport is een vaste momentopname. Maak het als het besluit genomen is, of eerder als tussenstand."];
      else if (reportStale(p)) insight = ["Let hierop", "Het laatste besluit staat nog niet in een rapportversie."];
      break;
    }
    default:
      break;
  }
  return { items, insight };
}

export function coachFor(page: CoachPage, p: IdeaProgress | null, opts: { audience?: "consultant" | "client"; isClientDecider?: boolean } = {}): CoachData {
  const audience = opts.audience ?? "consultant";
  if (audience === "client") return clientCoach(page, p, !!opts.isClientDecider);
  const [title, copy] = PAGE_COPY[page];
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

function clientCoach(page: CoachPage, p: IdeaProgress | null, isClientDecider: boolean): CoachData {
  const [title, copy, insight] = CLIENT_COPY[page];
  const suggestions: CoachSuggestion[] = [];
  if (p) {
    const base = `/app/ideas/${p.ideaId}`;
    if (isClientDecider && p.decisions > 0 && !p.latestDecisionConfirmed) suggestions.push({ label: "Bekijk en bevestig het besluit", href: `${base}/evidence`, icon: "check" });
    if (page !== "report") suggestions.push({ label: "Lees het laatst gedeelde rapport", href: `${base}/report`, icon: "file" });
    if (page !== "evidence" && suggestions.length < MAX_SUGGESTIONS) suggestions.push({ label: "Bekijk het bewijs tot nu toe", href: `${base}/evidence`, icon: "shield" });
  }
  if (suggestions.length < MAX_SUGGESTIONS) suggestions.push({ label: "Wat betekenen de begrippen?", href: "/app/help#begrippen", icon: "info" });
  return { title, copy, insightTitle: "Goed om te weten", insight, suggestions: suggestions.slice(0, MAX_SUGGESTIONS), ideaId: p?.ideaId, audience: "client" };
}
