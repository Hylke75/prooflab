// Contextual coach: reacts to the actual state of the dossier, not to a fixed list of tips.

import type { IconName } from "@/components/Icon";

export type CoachPage = "dashboard" | "intake" | "research" | "assumptions" | "experiments" | "evidence" | "report" | "clients" | "other";

export type IdeaProgress = {
  ideaId: string;
  questions: number;
  claims: number;
  verifiedClaims: number;
  weakClaims: number;
  competitors: number;
  hasAlternatives: boolean;
  sizingEstablished: boolean;
  assumptions: number;
  topAssumption: { statement: string; evidence: number } | null;
  experimentsDraft: number;
  experimentsLive: number;
  experimentsEnded: number;
  learningCardsDraft: number;
  learningCardsApproved: number;
  decisions: number;
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
};

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

export function nextAction(p: IdeaProgress): { title: string; detail: string; href: string; icon: IconName } {
  const base = `/app/ideas/${p.ideaId}`;
  if (p.questions === 0) return { title: "Maak de onderzoekskaart", detail: "Maximaal vijf vragen die je beslissing echt kunnen veranderen.", href: `${base}/research`, icon: "compass" };
  if (p.claims === 0) return { title: "Verzamel de eerste bronnen", detail: "Start een marktcheck of voeg zelf een bron met citaat toe.", href: `${base}/research?tab=sources`, icon: "compass" };
  if (!p.hasAlternatives) return { title: "Breng huidige alternatieven in kaart", detail: "Hoe lossen klanten dit nu op, ook zonder software of door niets te doen?", href: `${base}/research?tab=competitors`, icon: "compass" };
  if (p.assumptions === 0) return { title: "Maak je aannames zichtbaar", detail: "Wat moet waar zijn? Begin bij wat het belangrijkst is en het minst bewezen.", href: `${base}/assumptions`, icon: "layers" };
  if (p.experimentsLive + p.experimentsEnded + p.experimentsDraft === 0)
    return {
      title: "Toets de grootste onzekerheid",
      detail: p.topAssumption ? `"${p.topAssumption.statement}" heeft nog weinig bewijs.` : "Kies een kleine test met echt gedrag.",
      href: `${base}/experiments`,
      icon: "flask",
    };
  if (p.experimentsLive > 0) return { title: "Werf deelnemers voor je lopende test", detail: "Deel de testlink via de afgesproken kanalen. Een uitspraak volgt pas na de eindconditie.", href: `${base}/experiments`, icon: "flask" };
  if (p.experimentsEnded > 0 && p.learningCardsApproved === 0) return { title: "Leg vast wat je hebt geleerd", detail: "Rond de Learning Card af: wat verwachtten we, wat zagen we?", href: `${base}/evidence`, icon: "shield" };
  if (p.learningCardsApproved > 0 && p.decisions === 0) return { title: "Doe de Reality Check en besluit", detail: "Doorgaan, bijsturen, verder testen, pauzeren of stoppen.", href: `${base}/evidence`, icon: "shield" };
  return { title: "Werk het rapport bij", detail: "Maak een nieuwe, reproduceerbare rapportversie voor de opdrachtgever.", href: `${base}/report`, icon: "file" };
}

export function coachFor(page: CoachPage, p: IdeaProgress | null): CoachData {
  const [title, copy] = PAGE_COPY[page];
  if (!p) {
    return {
      title,
      copy,
      insightTitle: "Een goede start",
      insight: "Begin met één idee en de beslissing die het moet onderbouwen.",
      suggestions: [{ label: "Nieuw idee onderzoeken", href: "/app/ideas/new", icon: "plus" }],
    };
  }
  const next = nextAction(p);
  const base = `/app/ideas/${p.ideaId}`;
  let insightTitle = "Mijn advies";
  let insight = next.detail;
  if (page === "research" && p.weakClaims > 0) {
    insightTitle = "Let hierop";
    insight = `${p.weakClaims} bevinding(en) hebben nog onvoldoende bewijs. Zoekcijfers en AI-conclusies zijn geen bewijs dat klanten willen betalen.`;
  } else if (page === "assumptions" && p.topAssumption) {
    insight = `Grootste risico: "${p.topAssumption.statement}". Kies daar je eerste test voor.`;
  } else if (page === "experiments") {
    insight = "Leg vóór de proef vast wanneer je iets als een serieus signaal ziet. Daarna kun je het niet stil aanpassen.";
  } else if (page === "evidence" && p.behaviourObservations === 0) {
    insightTitle = "De kern";
    insight = "Er is nog geen waargenomen klantgedrag. Interesse in een gesprek is iets anders dan een aanvraag of betaling.";
  }
  const suggestions: CoachSuggestion[] = [{ label: next.title, href: next.href, icon: next.icon }];
  for (const s of [
    { label: "Mijn markt onderzoeken", href: `${base}/research`, icon: "compass" as const },
    { label: "Risico's overzichtelijk maken", href: `${base}/assumptions`, icon: "layers" as const },
    { label: "Een proef starten", href: `${base}/experiments`, icon: "flask" as const },
  ]) {
    if (suggestions.length < 3 && !suggestions.some((x) => x.href === s.href)) suggestions.push(s);
  }
  return { title, copy, insightTitle, insight, suggestions, ideaId: p.ideaId };
}
