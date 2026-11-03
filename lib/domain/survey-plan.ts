// Sample-size planner for surveys: how many complete, believable answers are needed before the pre-registered
// verdict can say anything, and how many invitations or open-link visitors that takes. Same rule as the verdict
// (lib/domain/stats.ts): "geslaagd" when the lower bound of the 95% Wilson interval reaches the success threshold,
// "niet geslaagd" when the upper bound stays under the fail threshold (or the success threshold without one).
// Pure functions; the numbers are planning assumptions, never results.

import { wilson } from "./stats";

export const DEFAULT_INVITE_RESPONSE_PCT = 15;
export const DEFAULT_OPEN_COMPLETION_PCT = 30;
export const DEFAULT_USABLE_PCT = 90;
export const PLAN_MAX_N = 20000;
// Distances from the threshold shown when no expected percentage is given.
export const PLAN_STEPS = [5, 10, 15, 20] as const;

// Smallest number of complete answers for which an observed rate of expectedPct puts the whole 95% interval
// above the success threshold (or below the fail threshold). null when the expected rate sits between the
// thresholds (the interval can then never clear them) or more than PLAN_MAX_N answers would be needed.
export function answersToClear(expectedPct: number, successPct: number, failPct: number | null = null): { n: number; side: "above" | "below" } | null {
  const p = expectedPct / 100;
  const s = successPct / 100;
  const f = (failPct ?? successPct) / 100;
  if (!(p >= 0 && p <= 1)) return null;
  const side = p > s ? "above" : p < f ? "below" : null;
  if (!side) return null;
  // successes = p·n (not rounded) keeps the bound monotone in n, so the first n that clears is the answer.
  const clears = (n: number) => (side === "above" ? wilson(p * n, n).low >= s : wilson(p * n, n).high < f);
  if (!clears(PLAN_MAX_N)) return null;
  let lo = 1;
  let hi = PLAN_MAX_N;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (clears(mid)) hi = mid;
    else lo = mid + 1;
  }
  return { n: lo, side };
}

export type PlanInput = {
  successPct: number;
  failPct?: number | null;
  expectedPct?: number | null; // default: the success threshold (then only the table is meaningful)
  minSample: number;
  inviteResponsePct?: number; // share of invited people who complete the survey
  openCompletionPct?: number; // share of open-link visitors who complete it
  usablePct?: number; // share of completed answers that is in the target group and believable
};

export type PlanRow = { expectedPct: number; n: number | null; invitations: number | null; openVisitors: number | null };

export type SurveyPlan = {
  expectedPct: number;
  side: "above" | "below" | null;
  // Complete answers needed: the larger of the statistical need and the Test Card's minimum sample.
  needed: number | null;
  statistical: number | null;
  invitations: number | null;
  openVisitors: number | null;
  rows: PlanRow[]; // the same for rates 5–20 points above and below the threshold
  assumptions: { inviteResponsePct: number; openCompletionPct: number; usablePct: number };
};

const clampPct = (x: number | undefined, d: number) => (x != null && Number.isFinite(x) && x > 0 && x <= 100 ? x : d);

function reach(n: number | null, a: SurveyPlan["assumptions"]) {
  if (n == null) return { invitations: null, openVisitors: null };
  const usable = a.usablePct / 100;
  return {
    invitations: Math.ceil(n / ((a.inviteResponsePct / 100) * usable)),
    openVisitors: Math.ceil(n / ((a.openCompletionPct / 100) * usable)),
  };
}

export function planSurveySample(input: PlanInput): SurveyPlan {
  const assumptions = {
    inviteResponsePct: clampPct(input.inviteResponsePct, DEFAULT_INVITE_RESPONSE_PCT),
    openCompletionPct: clampPct(input.openCompletionPct, DEFAULT_OPEN_COMPLETION_PCT),
    usablePct: clampPct(input.usablePct, DEFAULT_USABLE_PCT),
  };
  const fail = input.failPct ?? null;
  const minSample = Math.max(0, Math.round(input.minSample) || 0);
  const expectedPct = input.expectedPct != null && Number.isFinite(input.expectedPct) ? input.expectedPct : input.successPct;
  const need = (pct: number) => {
    const c = answersToClear(pct, input.successPct, fail);
    return { side: c?.side ?? null, statistical: c?.n ?? null, n: c ? Math.max(c.n, minSample) : null };
  };
  const main = need(expectedPct);
  const rows: PlanRow[] = [];
  for (const d of PLAN_STEPS) {
    for (const pct of [input.successPct + d, (fail ?? input.successPct) - d]) {
      if (pct <= 0 || pct >= 100) continue;
      const r = need(pct);
      rows.push({ expectedPct: pct, n: r.n, ...reach(r.n, assumptions) });
    }
  }
  rows.sort((a, b) => b.expectedPct - a.expectedPct);
  return { expectedPct, side: main.side, needed: main.n, statistical: main.statistical, ...reach(main.n, assumptions), rows, assumptions };
}

const nl = (x: number) => x.toLocaleString("nl-NL");

// The plan in plain Dutch, one or two sentences.
export function planSentence(plan: SurveyPlan, successPct: number): string {
  if (plan.needed == null) {
    return plan.side == null
      ? `Als het werkelijke percentage rond de drempel van ${nl(successPct)}% ligt, blijft het resultaat onbeslist, hoeveel antwoorden je ook verzamelt. Vul in wat je verwacht, of kijk in de tabel hoeveel antwoorden nodig zijn als het percentage duidelijk hoger of lager ligt.`
      : `Bij ${nl(plan.expectedPct)}% zijn meer dan ${nl(PLAN_MAX_N)} antwoorden nodig: zo dicht bij de drempel is een enquête geen bruikbare toets.`;
  }
  const dir = plan.side === "above" ? "boven de succesdrempel" : "onder de drempel";
  const minNote = plan.statistical != null && plan.statistical < plan.needed ? ` (statistisch zijn er ${nl(plan.statistical)} nodig; de Test Card vraagt minimaal ${nl(plan.needed)})` : "";
  return `Als ${nl(plan.expectedPct)}% van de respondenten een succesantwoord kiest, heb je ongeveer ${nl(plan.needed)} volledige, geloofwaardige antwoorden uit de doelgroep nodig${minNote} voordat het hele 95%-interval ${dir} ligt. Bij ${nl(plan.assumptions.inviteResponsePct)}% respons en ${nl(plan.assumptions.usablePct)}% bruikbare antwoorden betekent dat ongeveer ${nl(plan.invitations!)} persoonlijke uitnodigingen, of ${nl(plan.openVisitors!)} bezoekers via een open link als ${nl(plan.assumptions.openCompletionPct)}% de enquête afrondt.`;
}
