import type { IdeaProgress } from "@/lib/domain/coach";

// Which of the five visible steps are done. Done means evidence exists, not that fields are filled.
export function stepsDone(p: IdeaProgress) {
  return {
    idea: true,
    market: p.claims > 0 && p.hasAlternatives,
    assumptions: p.assumptions > 0,
    test: p.experimentsEnded > 0,
    decide: p.decisions > 0,
  };
}

export function currentStepLabel(p: IdeaProgress): string {
  const d = stepsDone(p);
  if (!d.market) return "Marktverkenning";
  if (!d.assumptions) return "Aannames";
  if (!d.test) return p.experimentsLive ? "Test loopt" : "Testen";
  if (!d.decide) return "Besluiten";
  return "Besloten";
}

export type StepOverview = { key: keyof ReturnType<typeof stepsDone>; label: string; done: boolean; current: boolean; counts: string; href: string };

const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

// De vijf stappen van het dossier met aantallen, voor het dossieroverzicht. De huidige stap is de eerste die nog
// niet af is.
export function stepOverview(p: IdeaProgress): StepOverview[] {
  const d = stepsDone(p);
  const base = `/app/ideas/${p.ideaId}`;
  const steps: Omit<StepOverview, "current">[] = [
    { key: "idea", label: "Idee en beslisvraag", done: d.idea, counts: n(p.questions, "onderzoeksvraag", "onderzoeksvragen"), href: `${base}/research` },
    {
      key: "market",
      label: "Marktverkenning",
      done: d.market,
      counts: `${n(p.claims, "bevinding", "bevindingen")} (${p.verifiedClaims} onderbouwd) · ${n(p.competitors, "concurrent of alternatief", "concurrenten en alternatieven")}`,
      href: `${base}/research`,
    },
    {
      key: "assumptions",
      label: "Aannames",
      done: d.assumptions,
      counts: `${n(p.assumptions, "aanname", "aannames")} · ${p.untestedCritical} kritiek en nog niet getest`,
      href: `${base}/assumptions`,
    },
    {
      key: "test",
      label: "Testen",
      done: d.test,
      counts: `${n(p.experiments.length, "test", "tests")} · ${p.experimentsLive} lopend · ${p.experimentsEnded} afgerond`,
      href: `${base}/experiments`,
    },
    { key: "decide", label: "Besluit en rapport", done: d.decide, counts: `${n(p.decisions, "besluit", "besluiten")} · ${n(p.reports, "rapportversie", "rapportversies")}`, href: `${base}/evidence` },
  ];
  const firstOpen = steps.findIndex((s) => !s.done);
  return steps.map((s, i) => ({ ...s, current: i === firstOpen }));
}
