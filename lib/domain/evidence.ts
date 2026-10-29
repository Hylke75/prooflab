// Evidence strength along the four dimensions of the method: fact vs opinion, what people do vs
// say, real-world vs lab setting, and how much the participant invested. Synthetic = 0.

import type { ClaimStatus, ObservationKind } from "./labels";

export type ObservationDims = {
  isFact: boolean;
  isBehaviour: boolean;
  isRealContext: boolean;
  isCostly: boolean;
  isSynthetic: boolean;
};

// Default dimensions per observation kind (the behaviour ladder).
export const KIND_DEFAULTS: Record<ObservationKind, Omit<ObservationDims, "isSynthetic">> = {
  opinion: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
  objection: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
  problem_absent: { isFact: true, isBehaviour: false, isRealContext: false, isCostly: false },
  problem_confirmed: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  current_behaviour: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  current_spend: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: true },
  counter_example: { isFact: true, isBehaviour: true, isRealContext: false, isCostly: false },
  waitlist_signup: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  demo_request: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  quote_request: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: false },
  deposit: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: true },
  repeat_purchase: { isFact: true, isBehaviour: true, isRealContext: true, isCostly: true },
  other: { isFact: false, isBehaviour: false, isRealContext: false, isCostly: false },
};

export function strength(d: ObservationDims): number {
  if (d.isSynthetic) return 0;
  return (d.isFact ? 1 : 0) + (d.isBehaviour ? 1 : 0) + (d.isRealContext ? 1 : 0) + (d.isCostly ? 1 : 0);
}

export function strengthLabel(score: number): { label: string; pill: string } {
  if (score >= 4) return { label: "Sterk", pill: "green" };
  if (score >= 3) return { label: "Redelijk sterk", pill: "green" };
  if (score >= 2) return { label: "Middel", pill: "blue" };
  if (score >= 1) return { label: "Zwak", pill: "orange" };
  return { label: "Geen bewijs", pill: "gray" };
}

export function explainStrength(d: ObservationDims): string {
  if (d.isSynthetic) return "Synthetisch: telt niet mee.";
  return [
    d.isFact ? "feit" : "mening",
    d.isBehaviour ? "wat mensen doen" : "wat mensen zeggen",
    d.isRealContext ? "echte situatie" : "gesprek of testsituatie",
    d.isCostly ? "met inzet (tijd/geld)" : "zonder inzet",
  ].join(" · ");
}

const CLAIM_WEIGHT: Record<ClaimStatus, number> = {
  verified: 1.2,
  estimate: 0.6,
  insufficient: 0,
  contested: 0,
  outdated: 0.2,
};

// Evidence axis of the assumption map, 0 (no evidence) .. 1 (strong evidence). Desk research can
// lift an assumption to at most ~0.45; only real-world behaviour gets it further.
export function assumptionEvidence(
  claims: { status: ClaimStatus; relation: "supports" | "contradicts" }[],
  observations: (ObservationDims & { relation: "supports" | "contradicts" })[],
): { score: number; supporting: number; contradicting: number } {
  let desk = 0;
  let field = 0;
  let supporting = 0;
  let contradicting = 0;
  for (const c of claims) {
    const w = CLAIM_WEIGHT[c.status];
    if (w === 0) continue;
    desk += w;
    if (c.relation === "supports") supporting++;
    else contradicting++;
  }
  for (const o of observations) {
    const s = strength(o);
    if (s === 0) continue;
    field += s * s; // stronger observations count disproportionately
    if (o.relation === "supports") supporting++;
    else contradicting++;
  }
  const deskPart = Math.min(0.45, desk * 0.15);
  const fieldPart = Math.min(0.55, field / 40);
  return { score: Math.min(1, deskPart + fieldPart), supporting, contradicting };
}

export type CardVerdict = "pass" | "fail" | "inconclusive";

// The status of an assumption follows all approved experiments that tested it, not only the latest:
// a later inconclusive test does not erase an earlier result, and conflicting results stay visible.
export function assumptionStatusFromVerdicts(verdicts: CardVerdict[]): "supported" | "refuted" | "inconclusive" | "untested" {
  if (verdicts.length === 0) return "untested";
  const pass = verdicts.includes("pass");
  const fail = verdicts.includes("fail");
  if (pass && fail) return "inconclusive";
  if (pass) return "supported";
  if (fail) return "refuted";
  return "inconclusive";
}
