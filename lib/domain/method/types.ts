import type { AssumptionProbability, EvidenceCaps, ProbabilityClaim, ProbabilityObservation } from "@/lib/domain/evidence";
import type { LrOverrides } from "@/lib/domain/calibration";
import type { RuledVerdict, VerdictInput } from "@/lib/domain/stats";

export const METHOD_VERSIONS = ["2026-11-a", "2026-11-b"] as const;
export type MethodVersion = (typeof METHOD_VERSIONS)[number];

// De beslisregel zoals vastgelegd op de Test Card (null bij Test Cards van vóór methode 2026-11-b).
export type HypothesisRule = { decision_rule?: string | null; success_count?: number | null };

// Eén rekenmodule per methodeversie: kans per aanname en oordeel per test.
export type MethodModule = {
  version: MethodVersion;
  label: string;
  usesCaps: boolean;
  rules: string[];
  probability: (claims: ProbabilityClaim[], observations: ProbabilityObservation[], prior: number, overrides: LrOverrides, caps: EvidenceCaps) => AssumptionProbability;
  verdict: (h: HypothesisRule, input: VerdictInput) => RuledVerdict;
};
