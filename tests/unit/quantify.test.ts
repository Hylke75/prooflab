import { describe, expect, it } from "vitest";
import {
  assumptionProbability,
  bandFromShift,
  diminishing,
  explainContribution,
  OBSERVATION_LR,
  probabilityFromShift,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";
import { costIndex, rankByInformationValue, valueOfInformation, type VoiInput } from "@/lib/domain/recommend";
import { betaBinomial, betaQuantile, empiricalPrior, FLAT_PRIOR, lnGamma, regIncBeta } from "@/lib/domain/stats";
import { breakEvenRevenue, mulberry32, percentile, simulateSizing, type RangedFactor } from "@/lib/domain/sizing";
import { runRealityCheck, type DossierFacts } from "@/lib/domain/reality-check";

const obs = (kind: string, relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  ...extra,
});
const times = <T,>(n: number, x: T) => Array.from({ length: n }, () => x);
const sig = (x: number) => 1 / (1 + Math.exp(-x));

describe("probability per assumption (likelihood ratios)", () => {
  it("stays at the prior without evidence", () => {
    const r = assumptionProbability([], []);
    expect(r.probability).toBe(0.5);
    expect(r.band).toEqual({ low: 0.5, high: 0.5 });
    expect(r.top).toEqual([]);
    expect(assumptionProbability([], [], 0.3).probability).toBeCloseTo(0.3, 10);
  });

  it("updates in odds with the factor of the evidence kind", () => {
    expect(assumptionProbability([], [obs("deposit")]).probability).toBeCloseTo(6 / 7, 10);
    expect(assumptionProbability([], [obs("demo_request")]).probability).toBeCloseTo(0.75, 10);
    // Intent correction: an opinion barely moves the probability.
    expect(assumptionProbability([], [obs("opinion")]).probability).toBeCloseTo(1.1 / 2.1, 10);
    // From a chosen prior of 20%: odds 0,25 × 3 = 0,75.
    expect(assumptionProbability([], [obs("current_spend")], 0.2).probability).toBeCloseTo(0.75 / 1.75, 10);
  });

  it("gives diminishing returns: 20 identical opinions are no certainty", () => {
    const r = assumptionProbability([], times(20, obs("opinion")));
    expect(r.probability).toBeGreaterThan(0.55);
    expect(r.probability).toBeLessThan(0.62);
    expect(r.contributions).toHaveLength(1);
    expect(r.contributions[0].count).toBe(20);
    // Naive multiplication would have given 87%.
    expect(1.1 ** 20 / (1 + 1.1 ** 20)).toBeGreaterThan(0.85);
    expect(diminishing(1)).toBe(1);
    expect(diminishing(3)).toBe(2);
    const three = assumptionProbability([], times(3, obs("deposit")));
    expect(three.probability).toBeCloseTo(sig(2 * Math.log(6)), 10);
  });

  it("treats contradicting evidence as the inverse factor", () => {
    expect(assumptionProbability([], [obs("demo_request", "contradicts")]).probability).toBeCloseTo(0.25, 10);
    expect(assumptionProbability([{ status: "verified", relation: "supports" }], []).probability).toBeCloseTo(0.6, 10);
    expect(assumptionProbability([{ status: "verified", relation: "contradicts" }], []).probability).toBeCloseTo(0.4, 10);
    expect(assumptionProbability([{ status: "estimate", relation: "supports" }], []).probability).toBeCloseTo(1.2 / 2.2, 10);
    expect(assumptionProbability([{ status: "insufficient", relation: "supports" }], []).probability).toBe(0.5);
  });

  it("always counts objections, absent problems and counter-examples against", () => {
    for (const k of ["objection", "problem_absent", "counter_example"] as const) {
      expect(OBSERVATION_LR[k].against).toBe(true);
      expect(assumptionProbability([], [obs(k, "supports")]).probability).toBeLessThan(0.5);
      expect(assumptionProbability([], [obs(k, "contradicts")]).probability).toBeLessThan(0.5);
    }
    // A deposit outweighs one objection.
    expect(assumptionProbability([], [obs("deposit"), obs("objection")]).probability).toBeGreaterThan(0.75);
  });

  it("ignores synthetic data and rejected AI coding; unreviewed AI coding counts half in log-odds", () => {
    const syn = assumptionProbability([], [obs("deposit", "supports", { isSynthetic: true })]);
    expect(syn.probability).toBe(0.5);
    expect(syn.ignored.synthetic).toBe(1);
    const rejected = assumptionProbability([], [obs("demo_request", "supports", { origin: "ai", reviewStatus: "rejected" })]);
    expect(rejected.probability).toBe(0.5);
    expect(rejected.ignored.rejected).toBe(1);
    const unreviewed = assumptionProbability([], [obs("demo_request", "supports", { origin: "ai", reviewStatus: null })]);
    expect(unreviewed.probability).toBeCloseTo(sig(0.5 * Math.log(3)), 10);
    expect(unreviewed.top[0].weight).toBe(0.5);
    const accepted = assumptionProbability([], [obs("demo_request", "supports", { origin: "ai", reviewStatus: "accepted" })]);
    expect(accepted.probability).toBeCloseTo(0.75, 10);
  });

  it("never shows certainty", () => {
    expect(assumptionProbability([], times(50, obs("repeat_purchase"))).probability).toBeLessThanOrEqual(0.99);
    expect(assumptionProbability([], times(50, obs("counter_example"))).probability).toBeGreaterThanOrEqual(0.01);
  });

  it("gives a band from LRs ±50% in log space and the three largest contributions", () => {
    const r = assumptionProbability(
      [{ status: "verified", relation: "supports" }],
      [obs("deposit"), obs("opinion"), obs("objection"), obs("demo_request")],
    );
    expect(r.band.low).toBeLessThan(r.probability);
    expect(r.band.high).toBeGreaterThan(r.probability);
    expect(r.band.low).toBeCloseTo(probabilityFromShift(0.5, r.shift, 0.5), 10);
    expect(r.band.high).toBeCloseTo(probabilityFromShift(0.5, r.shift, 1.5), 10);
    expect(r.top.map((c) => c.label)).toEqual(["Aanbetaling", "Demo aangevraagd", "Bezwaar"]);
    expect(r.contributions).toHaveLength(5);
    expect(explainContribution(r.top[2])).toMatch(/÷ 1,5/);
    // The what-if prior on screen uses the same shift.
    expect(probabilityFromShift(0.5, r.shift)).toBeCloseTo(r.probability, 10);
    expect(bandFromShift(0.5, r.shift)).toEqual(r.band);
  });
});

describe("value of information", () => {
  const base: VoiInput = { id: "a", statement: "x", importance: 5, probability: 0.5, category: "desirability", evidence: 0.3, hasDiscoveryEvidence: true };

  it("ranks critical assumptions near the decision boundary first", () => {
    const ranked = rankByInformationValue([
      { ...base, id: "sure", probability: 0.95 },
      { ...base, id: "minor", importance: 1 },
      { ...base, id: "critical" },
      { ...base, id: "leaning", probability: 0.7 },
    ]);
    // A near-certain assumption has little to learn, even when it is critical.
    expect(ranked.map((r) => r.id)).toEqual(["critical", "leaning", "minor", "sure"]);
    expect(ranked[0].index).toBe(100);
    expect(ranked[0].canFlip).toBe(true);
    expect(ranked.find((r) => r.id === "sure")!.canFlip).toBe(false);
  });

  it("divides by the cost of the cheapest suitable test", () => {
    expect(costIndex({ days: 14, costEur: 0 })).toBe(2);
    expect(costIndex({ days: 21, costEur: 500 })).toBe(4);
    const v = valueOfInformation(base);
    expect(v.test.type).toBe("interview"); // cheapest test that can flip the decision
    expect(v.cost).toBe(2);
    expect(v.after.negative).toBeLessThan(0.5);
    expect(v.after.positive).toBeGreaterThan(0.5);
    expect(v.why).toMatch(/Kritiek \(5\/5\), geschatte kans 50%/);
    expect(v.why).toMatch(/omdraaien/);
  });

  it("starts with discovery when there is no discovery evidence yet", () => {
    const v = valueOfInformation({ ...base, category: "viability", evidence: 0, hasDiscoveryEvidence: false });
    expect(v.test.type).toBe("interview");
  });

  it("explains when no test can change the decision", () => {
    const v = valueOfInformation({ ...base, probability: 0.97 });
    expect(v.canFlip).toBe(false);
    expect(v.why).toMatch(/waarschijnlijk niet/);
  });
});

describe("beta-binomial with an empirical prior", () => {
  it("computes the regularized incomplete beta and its quantiles", () => {
    expect(lnGamma(5)).toBeCloseTo(Math.log(24), 10);
    expect(regIncBeta(0.5, 2, 2)).toBeCloseTo(0.5, 10);
    expect(regIncBeta(0.3, 1, 1)).toBeCloseTo(0.3, 10);
    // Beta(2,3): CDF(x) = 6x² − 8x³ + 3x⁴.
    const x = 0.4;
    expect(regIncBeta(x, 2, 3)).toBeCloseTo(6 * x ** 2 - 8 * x ** 3 + 3 * x ** 4, 10);
    expect(betaQuantile(0.9, 1, 1)).toBeCloseTo(0.9, 8);
    expect(regIncBeta(betaQuantile(0.05, 12, 40), 12, 40)).toBeCloseTo(0.05, 8);
  });

  it("uses a flat Beta(1,1) with fewer than three earlier tests", () => {
    expect(empiricalPrior([])).toEqual(FLAT_PRIOR);
    const p = empiricalPrior([{ n: 50, successes: 5 }, { n: 80, successes: 4 }]);
    expect(p.source).toBe("flat");
    expect(p.tests).toBe(2);
    const b = betaBinomial(p, 9, 30, 15);
    expect(b.mean).toBeCloseTo(10 / 32, 10);
  });

  it("caps the prior at 20 pseudo-observations and keeps it at least 2", () => {
    const steady = empiricalPrior(times(6, { n: 200, successes: 20 }));
    expect(steady.source).toBe("empirical");
    expect(steady.mean).toBeCloseTo(0.1, 10);
    expect(steady.strength).toBe(20);
    expect(steady.alpha).toBeCloseTo(2, 10);
    const wild = empiricalPrior([{ n: 100, successes: 2 }, { n: 100, successes: 60 }, { n: 100, successes: 5 }, { n: 100, successes: 90 }]);
    expect(wild.strength).toBeGreaterThanOrEqual(2);
    expect(wild.strength).toBeLessThan(5);
  });

  it("reports the posterior mean, a 90% interval and P(rate ≥ threshold)", () => {
    const b = betaBinomial(FLAT_PRIOR, 12, 80, 15);
    expect(b.mean).toBeCloseTo(13 / 82, 10);
    expect(b.low).toBeLessThan(b.mean);
    expect(b.high).toBeGreaterThan(b.mean);
    expect(regIncBeta(b.high, 13, 69) - regIncBeta(b.low, 13, 69)).toBeCloseTo(0.9, 6);
    expect(b.pAboveThreshold).toBeCloseTo(1 - regIncBeta(0.15, 13, 69), 10);
  });

  it("simulation: the prior shrinks a lucky small-sample result (winner's curse)", () => {
    const rnd = mulberry32(42);
    const binom = (n: number, p: number) => {
      let s = 0;
      for (let i = 0; i < n; i++) if (rnd() < p) s++;
      return s;
    };
    const trueRate = () => 0.06 + 0.08 * rnd(); // earlier landing pages convert 6–14%
    const earlier = Array.from({ length: 30 }, () => {
      const n = 150;
      return { n, successes: binom(n, trueRate()) };
    });
    const prior = empiricalPrior(earlier);
    expect(prior.source).toBe("empirical");
    expect(prior.mean).toBeGreaterThan(0.07);
    expect(prior.mean).toBeLessThan(0.13);

    // One lucky test: 9 of 30 visitors (30%) against a 15% threshold.
    const lucky = betaBinomial(prior, 9, 30, 15);
    const flat = betaBinomial(FLAT_PRIOR, 9, 30, 15);
    // 20 pseudo-observations at ≈ 10% against 30 real ones at 30%: the estimate lands near 22%.
    expect(lucky.mean).toBeLessThan(0.24);
    expect(lucky.mean).toBeLessThan(flat.mean);
    expect(lucky.pAboveThreshold).toBeLessThan(flat.pAboveThreshold);

    // Many small tests, keep only the ones that looked good: the raw rate overestimates, the posterior less so.
    let rawError = 0;
    let bayesError = 0;
    let winners = 0;
    for (let i = 0; i < 4000; i++) {
      const p = trueRate();
      const n = 30;
      const s = binom(n, p);
      if (s / n < 0.2) continue;
      winners++;
      rawError += s / n - p;
      bayesError += betaBinomial(prior, s, n, 15).mean - p;
    }
    expect(winners).toBeGreaterThan(20);
    expect(rawError / winners).toBeGreaterThan(0.08);
    // The capped prior (≤ 20 pseudo-observations) removes roughly half of the overestimate.
    expect(Math.abs(bayesError / winners)).toBeLessThan((rawError / winners) * 0.6);
  });
});

describe("Monte Carlo market sizing", () => {
  const fixed: RangedFactor[] = [
    { key: "base_count", value: 10000 },
    { key: "fit_pct", value: 20 },
    { key: "reach_pct", value: 50 },
    { key: "winnable_pct", value: 5 },
    { key: "revenue_per_customer", value: 1000 },
  ];
  const withRange = (key: string, low: number, high: number) => fixed.map((f) => (f.key === key ? { ...f, low, high } : f));

  it("behaves as before without ranges", () => {
    expect(simulateSizing("b2b_accounts", fixed)).toBeNull();
    expect(simulateSizing("b2b_accounts", withRange("fit_pct", 20, 20))).toBeNull();
  });

  it("is deterministic for the same seed", () => {
    const f = withRange("base_count", 5000, 20000);
    const a = simulateSizing("b2b_accounts", f);
    const b = simulateSizing("b2b_accounts", f);
    expect(a).toEqual(b);
    const c = simulateSizing("b2b_accounts", f, { seed: 7 });
    expect(c!.somRevenue.p50).not.toBe(a!.somRevenue.p50);
    expect(a!.draws).toBe(5000);
  });

  it("matches the percentiles of the fitted log-normal", () => {
    const r = simulateSizing("b2b_accounts", withRange("base_count", 5000, 20000))!;
    // SOM revenue = base × 0,2 × 0,5 × 0,05 × 1000 = base × 5.
    const mu = Math.log(10000);
    const sigma = (Math.log(20000) - Math.log(5000)) / (2 * 1.6448536269514722);
    expect(r.somRevenue.p50 / (5 * Math.exp(mu))).toBeCloseTo(1, 1);
    expect(r.somRevenue.p10 / (5 * Math.exp(mu - 1.2815515655 * sigma))).toBeCloseTo(1, 1);
    expect(r.somRevenue.p90 / (5 * Math.exp(mu + 1.2815515655 * sigma))).toBeCloseTo(1, 1);
    expect(r.somCount.p50).toBeCloseTo(r.somRevenue.p50 / 1000, 6);
  });

  it("uses a triangular distribution from zero and caps percentages at 100", () => {
    const tri = simulateSizing("b2b_accounts", withRange("winnable_pct", 0, 10))!;
    expect(tri.somCount.p10).toBeGreaterThanOrEqual(0);
    expect(tri.somCount.p90).toBeLessThanOrEqual(10000 * 0.2 * 0.5 * 0.1);
    const capped = simulateSizing("b2b_accounts", withRange("fit_pct", 50, 100))!;
    expect(capped.somCount.p90).toBeLessThanOrEqual(10000 * 1 * 0.5 * 0.05 + 1e-9);
  });

  it("gives the probability of reaching a threshold and the factor that drives the variance", () => {
    const f = withRange("base_count", 5000, 20000).map((x) => (x.key === "winnable_pct" ? { ...x, low: 1, high: 20 } : x));
    const r = simulateSizing("b2b_accounts", f, { threshold: 0 })!;
    expect(r.pAboveThreshold).toBe(1);
    const mid = simulateSizing("b2b_accounts", f, { threshold: r.somRevenue.p50 })!;
    expect(mid.pAboveThreshold).toBeCloseTo(0.5, 1);
    expect(r.drivers[0].key).toBe("winnable_pct");
    expect(r.drivers.reduce((s, d) => s + d.share, 0)).toBeCloseTo(1, 10);
    expect(simulateSizing("b2b_accounts", f)!.pAboveThreshold).toBeNull();
  });

  it("computes the break-even revenue and percentiles", () => {
    expect(breakEvenRevenue({ grossMarginPct: 50, fixedCostsYear: 60000 })).toBe(120000);
    expect(breakEvenRevenue({ grossMarginPct: null, fixedCostsYear: 60000 })).toBeNull();
    expect(breakEvenRevenue({ grossMarginPct: 0, fixedCostsYear: 60000 })).toBeNull();
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1, 10);
  });
});

describe("pre-mortem in the Reality Check", () => {
  const facts: DossierFacts = {
    ideaAgeDays: 5,
    ideaRegion: "Nederland",
    clientDeciderInvited: true,
    claims: [{ status: "verified", section: "market", sourceTypes: ["official_statistic"], region: "Nederland" }],
    competitors: [{ kind: "direct" }, { kind: "status_quo" }],
    sizing: null,
    assumptions: [{ statement: "Probleem is urgent", importance: 4, category: "desirability", status: "supported", evidence: 0.6, contradicting: 0 }],
    experiments: [],
    interviews: [],
    observations: [{ kind: "deposit", isBehaviour: true, isSynthetic: false, isCostly: true }],
    learningCards: [{ status: "approved", verdict: "pass" }],
    decisionsAfterLastLearning: 0,
    isB2B: false,
  };
  const codes = (f: DossierFacts) => runRealityCheck(f).findings.map((x) => x.code);

  it("warns when no pre-mortem was done, and only when that is known", () => {
    expect(codes({ ...facts, premortemDone: false })).toContain("no_premortem");
    expect(codes({ ...facts, premortemDone: true })).not.toContain("no_premortem");
    expect(codes(facts)).not.toContain("no_premortem");
  });

  it("counts pre-mortem assumptions without evidence as untested critical assumptions", () => {
    const before = runRealityCheck({ ...facts, premortemDone: true });
    expect(before.advice).toBe("continue");
    const withReason = {
      ...facts,
      premortemDone: true,
      assumptions: [
        ...facts.assumptions,
        { statement: "Eventmanagers stappen zonder moeite over", importance: 4, category: "desirability", status: "untested", evidence: 0, contradicting: 0, origin: "premortem" },
      ],
    };
    const r = runRealityCheck(withReason);
    expect(r.findings.map((x) => x.code)).toContain("premortem_untested");
    expect(r.advice).toBe("test_more");
    expect(r.adviceReason).toMatch(/1 kritieke aanname/);
    // A minor pre-mortem reason is not flagged as critical.
    const minor = runRealityCheck({ ...withReason, assumptions: [facts.assumptions[0], { ...withReason.assumptions[1], importance: 2 }] });
    expect(minor.findings.map((x) => x.code)).not.toContain("premortem_untested");
  });
});
