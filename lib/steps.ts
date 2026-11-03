import type { IdeaProgress } from "@/lib/domain/coach";
import { getDossierStatus, type DossierInput, type DossierStatus, type StepKey, type StepState } from "@/lib/domain/dossier-status";

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
      realTestObservations: p.behaviourObservations,
      decisions: p.decisions,
    }
  );
}

export function dossierStatus(p: IdeaProgress): DossierStatus {
  return getDossierStatus(dossierInput(p));
}

// Welke stappen klaar zijn, voor de stappenbalk. "idea" is altijd klaar: er is een dossier.
export function stepsDone(p: IdeaProgress) {
  const s = dossierStatus(p);
  const done = (k: StepKey) => s.steps.find((x) => x.key === k)?.state === "done";
  return { idea: true, market: done("market"), assumptions: done("assumptions"), test: done("test"), decide: done("decide") };
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
