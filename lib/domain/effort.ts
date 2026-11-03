// Inzet bij de uitkomst (golf B, punt 2). De uitkomst meet ook uitvoering: een idee dat nooit is gestart of met een
// fractie van het plan is uitgevoerd, zegt weinig over de voorspelling. Zulke dossiers worden gemarkeerd; een
// consultant kan ze met een reden uit de kalibratie halen. Dezelfde regel als de databasefunctie execution_insufficient.

// Onder deze fractie van het plan (budget of uren) heet de uitvoering onvoldoende.
export const INSUFFICIENT_SHARE = 0.5;

export type Effort = {
  started: boolean | null;
  hours: number | null;
  budgetPctOfPlan: number | null; // 100 = volgens plan
};

// Geplande inzet uit de intake (stake_kind / stake_value): alleen uren zijn met bestede uren te vergelijken.
export type PlannedStake = { kind: string | null; value: number | null };

// null = onbekend (geen inzet vastgelegd, oudere uitkomst).
export function executionInsufficient(e: Effort, plan: PlannedStake = { kind: null, value: null }): boolean | null {
  if (e.started == null) return null;
  if (!e.started) return true;
  if (e.budgetPctOfPlan != null && e.budgetPctOfPlan < INSUFFICIENT_SHARE * 100) return true;
  if (plan.kind === "time" && plan.value != null && plan.value > 0 && e.hours != null && e.hours < plan.value * INSUFFICIENT_SHARE) return true;
  return false;
}

// Waarom de uitvoering onvoldoende is, in één zin; null als ze voldoende of onbekend is.
export function insufficientReason(e: Effort, plan: PlannedStake = { kind: null, value: null }): string | null {
  if (executionInsufficient(e, plan) !== true) return null;
  if (!e.started) return "Het besluit is niet uitgevoerd: er is niet gestart.";
  if (e.budgetPctOfPlan != null && e.budgetPctOfPlan < INSUFFICIENT_SHARE * 100) return `Er is ${Math.round(e.budgetPctOfPlan)}% van het geplande budget besteed (minder dan de helft).`;
  return `Er zijn ${fmtHours(e.hours ?? 0)} uur besteed, minder dan de helft van de geplande ${fmtHours(plan.value ?? 0)} uur.`;
}

// Korte samenvatting voor scherm en rapport, bijv. "Gestart · 120 uur · 80% van het budget".
export function effortSummary(e: Effort): string {
  if (e.started == null) return "Inzet niet vastgelegd";
  if (!e.started) return "Niet gestart";
  return ["Gestart", e.hours != null ? `${fmtHours(e.hours)} uur` : null, e.budgetPctOfPlan != null ? `${Math.round(e.budgetPctOfPlan)}% van het budget` : null].filter(Boolean).join(" · ");
}

const fmtHours = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 1 });
