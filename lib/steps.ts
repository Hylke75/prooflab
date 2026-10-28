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
