import type { IconName } from "@/components/Icon";
import type { IdeaProgress } from "@/lib/domain/coach";
import { getDossierStatus, STEP_LABELS, type DossierInput, type DossierStatus, type StepKey, type StepState } from "@/lib/domain/dossier-status";

// Eén definitie van de stappen voor het menu én de stappenbalk: dezelfde namen, iconen, adressen en status.
// Tabbladen horen bij een stap: Bronnen & koppelingen onder Markt, Voorspelling & uitkomst onder Besluit.
export type StepTab = { path: string; label: string; consultantOnly?: boolean };
export type StepDef = { key: StepKey; number: number; label: string; icon: IconName; path: string; tabs?: StepTab[]; also?: string[] };

export const STEPS: readonly StepDef[] = [
  {
    key: "market",
    number: 1,
    label: STEP_LABELS.market,
    icon: "compass",
    path: "/research",
    tabs: [
      { path: "/research", label: "Marktverkenning" },
      { path: "/integrations", label: "Bronnen & koppelingen", consultantOnly: true },
    ],
    // Fase 1 · punt 3: interviews en thema's over alle gesprekken heen (Markt › Klantonderzoek).
    also: ["/interviews"],
  },
  { key: "assumptions", number: 2, label: STEP_LABELS.assumptions, icon: "layers", path: "/assumptions", also: ["/method"] },
  { key: "test", number: 3, label: STEP_LABELS.test, icon: "flask", path: "/experiments" },
  {
    key: "decide",
    number: 4,
    label: STEP_LABELS.decide,
    icon: "scale",
    path: "/evidence",
    tabs: [
      { path: "/evidence", label: "Bewijs & besluit" },
      { path: "/outcome", label: "Voorspelling & uitkomst" },
    ],
  },
];

export const IDEA_OVERVIEW = { label: "Overzicht van dit idee", icon: "layout-dashboard", path: "" } as const satisfies { label: string; icon: IconName; path: string };
export const IDEA_REPORT = { label: "Rapport", icon: "file", path: "/report" } as const satisfies { label: string; icon: IconName; path: string };

// Het deel van het adres na /app/ideas/[id], bijv. "/research" of "/experiments/…". Leeg voor het overzicht.
export function stepForPath(sub: string): StepKey | null {
  for (const s of STEPS) {
    const paths = [s.path, ...(s.tabs ?? []).map((t) => t.path), ...(s.also ?? [])];
    if (paths.some((p) => sub === p || sub.startsWith(`${p}/`))) return s.key;
  }
  return null;
}

export type MenuItem = { key: string; label: string; icon: IconName; href: string; step?: StepKey; number?: number };

// De zichtbare menu-items. Opdrachtgevers zien het overzicht van het idee niet (dat stuurt hen door naar het
// rapport) en ook Klanten niet. De ideekiezer staat boven deze items en telt als één extra item.
export function menuItems({ ideaId, isConsultant }: { ideaId: string | null; isConsultant: boolean }): { idea: MenuItem[]; workspace: MenuItem[] } {
  const base = ideaId ? `/app/ideas/${ideaId}` : null;
  const idea: MenuItem[] = base
    ? [
        ...(isConsultant ? [{ key: "overview", label: IDEA_OVERVIEW.label, icon: IDEA_OVERVIEW.icon, href: base }] : []),
        ...STEPS.map((s) => ({ key: s.key, label: s.label, icon: s.icon, href: `${base}${s.path}`, step: s.key, number: s.number })),
        { key: "report", label: IDEA_REPORT.label, icon: IDEA_REPORT.icon, href: `${base}${IDEA_REPORT.path}` },
      ]
    : [];
  const workspace: MenuItem[] = [
    { key: "ideas", label: "Alle ideeën", icon: "lightbulb", href: "/app" },
    ...(isConsultant ? [{ key: "clients", label: "Klanten", icon: "users" as const, href: "/app/clients" }] : []),
  ];
  return { idea, workspace };
}

export type StepStates = Record<StepKey, StepState>;

// De status per stap (klaar, loopt, leeg) voor menu en stappenbalk.
export function stepStates(p: IdeaProgress): StepStates {
  const s = dossierStatus(p);
  return Object.fromEntries(s.steps.map((x) => [x.key, x.state])) as StepStates;
}

// Het teken achter een stap: ✓ klaar, • loopt, niets als de stap nog leeg is. Met een uitgeschreven variant voor
// schermlezers.
export function stepMark(state: StepState | undefined): { mark: string; spoken: string } | null {
  if (state === "done") return { mark: "✓", spoken: "klaar" };
  if (state === "running") return { mark: "•", spoken: "loopt" };
  return null;
}

// Alle schermen lezen de stapstatus via getDossierStatus() (fase B1c). Oudere testdata zonder dossier-invoer
// rekent met de gewone tellers; de beslissende vraag en de hoofdtests zijn dan onbekend en dus niet klaar.
export function dossierInput(p: IdeaProgress): DossierInput {
  return (
    p.dossier ?? {
      questions: p.questions,
      claims: p.claims,
      verifiedClaims: p.verifiedClaims,
      decisiveQuestion: null,
      assumptions: p.assumptions,
      criticalWithPrimaryTest: 0,
      assumptionsWithEvidence: p.assumptions - p.assumptionsWithoutEvidence,
      experiments: p.experiments.length,
      experimentsLive: p.experimentsLive,
      experimentsEnded: p.experimentsEnded,
      // Zonder dossier-invoer is de uitslag van de tests onbekend, dus telt geen test als klaar.
      testsWithVerdict: 0,
      realTestObservations: p.behaviourObservations,
      decisions: p.decisions,
      latestDecisionAction: p.latestDecisionAction,
      decisionRule: "unknown",
    }
  );
}

export function dossierStatus(p: IdeaProgress): DossierStatus {
  return getDossierStatus(dossierInput(p));
}

// Welke stappen klaar zijn.
export function stepsDone(p: IdeaProgress): Record<StepKey, boolean> {
  const s = stepStates(p);
  return { market: s.market === "done", assumptions: s.assumptions === "done", test: s.test === "done", decide: s.decide === "done" };
}

export function currentStepLabel(p: IdeaProgress): string {
  return dossierStatus(p).currentLabel;
}

export type StepOverview = {
  key: StepKey;
  number: number;
  label: string;
  state: StepState;
  done: boolean;
  current: boolean;
  statusLabel: string;
  why: string;
  hasEvidence: boolean;
  counts: string;
  href: string;
};

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// De vier stappen van het dossier met aantallen, voor het dossieroverzicht.
export function stepOverview(p: IdeaProgress): StepOverview[] {
  const s = dossierStatus(p);
  const base = `/app/ideas/${p.ideaId}`;
  const extra: Record<StepKey, { counts: string; href: string }> = {
    market: {
      counts: `${n(p.questions, "onderzoeksvraag", "onderzoeksvragen")} · ${n(p.claims, "bevinding", "bevindingen")} (${p.verifiedClaims} geverifieerd)`,
      href: `${base}/research`,
    },
    assumptions: { counts: `${n(p.assumptions, "aanname", "aannames")} · ${p.untestedCritical} kritiek en nog niet getest`, href: `${base}/assumptions` },
    test: { counts: `${n(p.experiments.length, "test", "tests")} · ${p.experimentsLive} lopend · ${p.experimentsEnded} afgerond`, href: `${base}/experiments` },
    decide: { counts: `${n(p.decisions, "besluit", "besluiten")} · ${n(p.reports, "rapportversie", "rapportversies")}`, href: `${base}/evidence` },
  };
  return s.steps.map((x) => ({
    key: x.key,
    number: x.number,
    label: x.label,
    state: x.state,
    done: x.state === "done",
    current: x.key === s.current,
    statusLabel: x.statusLabel,
    why: x.why,
    hasEvidence: x.hasEvidence,
    ...extra[x.key],
  }));
}
