import { describe, expect, it } from "vitest";
import {
  blendedEstimate,
  BLEND_WEIGHTS,
  coachRuleStats,
  describeWeights,
  LEARN_MIN_DOSSIERS,
  LEARNED_LR_MAX,
  learnWeights,
  median,
  overconfidence,
  overridesFrom,
  smoothedLr,
  surveyAgreement,
  weightsInUse,
  type EvidenceCountRow,
} from "@/lib/domain/calibration";
import { assumptionProbability, OBSERVATION_LR } from "@/lib/domain/evidence";
import { TEST_LR } from "@/lib/domain/recommend";

const resolved = (yes: number, no: number, partial = 0): EvidenceCountRow[] => [
  { dimension: "resolved", kind: "", achieved: "yes", direction: "", dossiers: yes },
  { dimension: "resolved", kind: "", achieved: "no", direction: "", dossiers: no },
  ...(partial ? [{ dimension: "resolved" as const, kind: "", achieved: "partial" as const, direction: "" as const, dossiers: partial }] : []),
];
const obs = (kind: string, achieved: "yes" | "no" | "partial", direction: "positive" | "negative", dossiers: number): EvidenceCountRow => ({ dimension: "observation", kind, achieved, direction, dossiers });
const find = (rows: ReturnType<typeof learnWeights>, kind: string, dimension = "observation") => rows.find((w) => w.kind === kind && w.dimension === dimension)!;

describe("smoothed likelihood ratio", () => {
  it("equals the default without data", () => {
    for (const lr of [1.1, 1.3, 3, 8]) expect(smoothedLr(lr, { ach: 0, not: 0 }, { ach: 0, not: 0 }, "ach")).toBeCloseTo(lr, 10);
  });

  it("moves towards the data as dossiers accumulate", () => {
    // Survey positive in 9 of 10 achieved and 1 of 10 not achieved dossiers: the data say ≈ 9.
    const few = smoothedLr(1.3, { ach: 9, not: 1 }, { ach: 10, not: 10 }, "ach");
    const many = smoothedLr(1.3, { ach: 90, not: 10 }, { ach: 100, not: 100 }, "ach");
    expect(few).toBeGreaterThan(1.3);
    expect(many).toBeGreaterThan(few);
    expect(many).toBeLessThan(9.01);
    expect(many).toBeGreaterThan(8);
  });

  it("goes below 1 when the evidence appears more often in failed dossiers", () => {
    expect(smoothedLr(3, { ach: 1, not: 9 }, { ach: 20, not: 20 }, "ach")).toBeLessThan(1);
  });
});

describe("learned weights", () => {
  it("keeps the default below eight dossiers with a result and says how many", () => {
    const rows = [...resolved(10, 10), obs("survey_answer", "yes", "positive", 4), obs("survey_answer", "no", "negative", 3)];
    const w = find(learnWeights(rows), "survey_answer");
    expect(w.status).toBe("too_few");
    expect(w.n).toBe(7);
    expect(w.note).toBe(`Nog te weinig dossiers: 7/${LEARN_MIN_DOSSIERS}.`);
    expect(w.defaultLr).toBe(1.3);
    expect(overridesFrom(learnWeights(rows))).toEqual({});
  });

  it("learns a factor from eight dossiers, shrunk towards the default", () => {
    const rows = [...resolved(10, 10), obs("survey_answer", "yes", "positive", 6), obs("survey_answer", "no", "positive", 1), obs("survey_answer", "no", "negative", 1)];
    const w = find(learnWeights(rows), "survey_answer");
    expect(w.status).toBe("learned");
    expect(w.n).toBe(8);
    // Raw ratio (6/10)/(1/10) = 6; with the prior it lands between the default and the raw ratio.
    expect(w.learnedFor!).toBeGreaterThan(1.3);
    expect(w.learnedFor!).toBeLessThan(6);
    expect(w.appliedFor).toBe(w.learnedFor);
    expect(overridesFrom([w]).survey_answer).toEqual({ lr: w.appliedFor, lrAgainst: w.appliedAgainst });
  });

  it("counts a partly reached outcome half in each group", () => {
    const rows = [...resolved(0, 0, 10), obs("deposit", "partial", "positive", 8)];
    const w = find(learnWeights(rows), "deposit");
    // Every dossier was partly reached: half counts as reached, half as not. A deposit then appears equally
    // often in both groups, so the learned factor falls from the default 6 towards 1.
    expect(w.status).toBe("learned");
    expect(w.learnedFor!).toBeGreaterThan(1);
    expect(w.learnedFor!).toBeLessThan(2);
  });

  it("does not learn when every resolved dossier had the same outcome", () => {
    const rows = [...resolved(12, 0), obs("deposit", "yes", "positive", 9)];
    expect(find(learnWeights(rows), "deposit").status).toBe("no_spread");
  });

  it("clamps factors in use: evidence never turns around and never exceeds the cap", () => {
    const rows = [...resolved(20, 20), obs("demo_request", "yes", "positive", 1), obs("demo_request", "no", "positive", 9)];
    const w = find(learnWeights(rows), "demo_request");
    expect(w.learnedFor!).toBeLessThan(1);
    expect(w.appliedFor).toBe(1);
    expect(w.note).toMatch(/andere kant/);
    const strong = find(learnWeights([...resolved(200, 200), obs("waitlist_signup", "yes", "positive", 200)]), "waitlist_signup");
    expect(strong.appliedFor).toBeLessThanOrEqual(LEARNED_LR_MAX);
  });

  it("learns counter-evidence kinds only on the side against", () => {
    const rows = [...resolved(10, 10), obs("objection", "no", "negative", 7), obs("objection", "yes", "negative", 2)];
    const w = find(learnWeights(rows), "objection");
    expect(w.status).toBe("learned");
    expect(w.learnedFor).toBeNull();
    expect(w.learnedAgainst!).toBeGreaterThan(1.5);
  });

  it("lists every kind and test type, with 'other' as not learnable", () => {
    const all = learnWeights(resolved(5, 5));
    expect(all.filter((w) => w.dimension === "observation").map((w) => w.kind).sort()).toEqual(Object.keys(OBSERVATION_LR).sort());
    expect(all.filter((w) => w.dimension === "test").map((w) => w.kind).sort()).toEqual(Object.keys(TEST_LR).sort());
    expect(find(all, "other").status).toBe("not_learnable");
  });

  it("learns test types too (informational)", () => {
    const rows: EvidenceCountRow[] = [
      ...resolved(10, 10),
      { dimension: "test", kind: "landing", achieved: "yes", direction: "positive", dossiers: 6 },
      { dimension: "test", kind: "landing", achieved: "no", direction: "negative", dossiers: 5 },
    ];
    const w = find(learnWeights(rows), "landing", "test");
    expect(w.status).toBe("learned");
    expect(w.defaultLr).toBe(3);
    // Test types never become overrides for the assumption probability.
    expect(overridesFrom([w])).toEqual({});
  });
});

describe("weights in use and the probability", () => {
  const rows = [...resolved(10, 10), obs("survey_answer", "yes", "positive", 8), obs("survey_answer", "no", "negative", 6)];
  const weights = learnWeights(rows);

  it("uses the defaults when the setting is off, so results stay reproducible", () => {
    const off = weightsInUse(false, weights, 20);
    expect(off.overrides).toEqual({});
    expect(off.inUse.mode).toBe("default");
    expect(describeWeights(off.inUse)).toMatch(/standaardfactoren/);
    const p = assumptionProbability([], [{ kind: "survey_answer", relation: "supports", isSynthetic: false }], 0.5, off.overrides);
    expect(p).toEqual(assumptionProbability([], [{ kind: "survey_answer", relation: "supports", isSynthetic: false }], 0.5));
  });

  it("applies learned factors when on, and the report names them", () => {
    const on = weightsInUse(true, weights, 20);
    expect(on.inUse.mode).toBe("learned");
    expect(on.inUse.learned.map((l) => l.kind)).toEqual(["survey_answer"]);
    const learned = assumptionProbability([], [{ kind: "survey_answer", relation: "supports", isSynthetic: false }], 0.5, on.overrides);
    const plain = assumptionProbability([], [{ kind: "survey_answer", relation: "supports", isSynthetic: false }], 0.5);
    expect(learned.probability).toBeGreaterThan(plain.probability);
    expect(learned.contributions[0].label).toMatch(/geleerde factor/);
    expect(learned.contributions[0].lr).toBeCloseTo(on.overrides.survey_answer!.lr, 10);
    // Contradicting evidence uses the separate factor against.
    const against = assumptionProbability([], [{ kind: "survey_answer", relation: "contradicts", isSynthetic: false }], 0.5, on.overrides);
    expect(against.contributions[0].lr).toBeCloseTo(1 / on.overrides.survey_answer!.lrAgainst, 10);
    expect(describeWeights(on.inUse)).toMatch(/geleerd uit 20 afgeronde dossiers/);
  });

  it("ignores a learned factor of 1 in that direction only", () => {
    const p = assumptionProbability(
      [],
      [
        { kind: "demo_request", relation: "supports", isSynthetic: false },
        { kind: "demo_request", relation: "contradicts", isSynthetic: false },
      ],
      0.5,
      { demo_request: { lr: 1, lrAgainst: 2 } },
    );
    expect(p.ignored.neutral).toBe(1);
    expect(p.contributions).toHaveLength(1);
    expect(p.contributions[0].direction).toBe("contradicts");
  });

  it("says when learned weights are on but nothing has enough dossiers", () => {
    expect(describeWeights({ mode: "learned", resolvedDossiers: 3, learned: [] })).toMatch(/standaardfactoren gebruikt/);
    expect(describeWeights(undefined)).toMatch(/standaardfactoren/);
  });
});

describe("survey versus behaviour", () => {
  it("counts agreement and both kinds of disagreement, leaving mixed verdicts out", () => {
    const a = surveyAgreement([
      { surveyVerdict: "pass", behaviourVerdict: "pass", assumptions: 3 },
      { surveyVerdict: "fail", behaviourVerdict: "fail", assumptions: 1 },
      { surveyVerdict: "pass", behaviourVerdict: "fail", assumptions: 4 },
      { surveyVerdict: "fail", behaviourVerdict: "pass", assumptions: 1 },
      { surveyVerdict: "mixed", behaviourVerdict: "pass", assumptions: 2 },
    ]);
    expect(a).toEqual({ pairs: 9, agree: 4, surveyTooPositive: 4, surveyTooNegative: 1, mixed: 2, rate: 4 / 9 });
    expect(surveyAgreement([]).rate).toBeNull();
  });
});

describe("coach rule statistics", () => {
  it("computes counts, median days, helpful votes and Brier per followed or ignored dossier", () => {
    const stats = coachRuleStats([
      { ideaId: "a", rule: "alternatives_missing", status: "done", daysToResolve: 2, helpful: true, decisionBrier: 0.1 },
      { ideaId: "a", rule: "alternatives_missing", status: "done", daysToResolve: 4, helpful: null, decisionBrier: 0.1 },
      { ideaId: "b", rule: "alternatives_missing", status: "dismissed", daysToResolve: 1, helpful: false, decisionBrier: 0.4 },
      { ideaId: "c", rule: "alternatives_missing", status: "open", daysToResolve: null, helpful: null, decisionBrier: null },
      { ideaId: "d", rule: "alternatives_missing", status: "done", daysToResolve: 10, helpful: true, decisionBrier: 0.2 },
      { ideaId: "a", rule: "ai", status: "dismissed", daysToResolve: 0.5, helpful: null, decisionBrier: 0.1 },
    ]);
    expect(stats[0]).toEqual({
      rule: "alternatives_missing",
      posted: 5,
      open: 1,
      done: 3,
      dismissed: 1,
      medianDays: 3,
      helpfulYes: 2,
      helpfulNo: 1,
      followed: { dossiers: 2, brier: (0.1 + 0.2) / 2 },
      ignored: { dossiers: 1, brier: 0.4 },
    });
    expect(stats[1]).toMatchObject({ rule: "ai", posted: 1, followed: null, ignored: { dossiers: 1, brier: 0.1 } });
  });

  it("counts a dossier as ignored when any note of the rule was dismissed there", () => {
    const [s] = coachRuleStats([
      { ideaId: "x", rule: "test_pace", status: "done", daysToResolve: 1, helpful: null, decisionBrier: 0.3 },
      { ideaId: "x", rule: "test_pace", status: "dismissed", daysToResolve: 1, helpful: null, decisionBrier: 0.3 },
    ]);
    expect(s.followed).toBeNull();
    expect(s.ignored).toEqual({ dossiers: 1, brier: 0.3 });
  });

  it("median handles even, odd and empty lists", () => {
    expect(median([])).toBeNull();
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe("starting calibration", () => {
  const br = { low: 0.1, high: 0.4 }; // midpoint 25%

  it("flags a forecast more than 25 points from the base rate without an ended behaviour test", () => {
    expect(overconfidence(0.55, br, false)).toMatchObject({ flagged: true, direction: "higher" });
    expect(overconfidence(0.5, br, false)?.flagged).toBe(false); // exactly 25 points
    expect(overconfidence(0.55, br, true)?.flagged).toBe(false);
    expect(overconfidence(0.05, { low: 0.52, high: 0.71 }, false)).toMatchObject({ flagged: true, direction: "lower" });
    expect(overconfidence(0.5, null, false)).toBeNull();
  });

  it("blends people, AI and base rate with the documented weights", () => {
    const b = blendedEstimate({ people: [0.7, 0.5], ai: 0.4, baseRate: br, behaviourTestEnded: false })!;
    const w = BLEND_WEIGHTS.withoutBehaviour;
    expect(b.estimate).toBeCloseTo(0.6 * w.people + 0.4 * w.ai + 0.25 * w.baseRate, 10);
    expect(b.parts.map((p) => p.key)).toEqual(["people", "ai", "baseRate"]);
    const after = blendedEstimate({ people: [0.7, 0.5], ai: 0.4, baseRate: br, behaviourTestEnded: true })!;
    expect(after.estimate).toBeGreaterThan(b.estimate);
  });

  it("renormalises the weights over the parts that exist and needs a human forecast", () => {
    const b = blendedEstimate({ people: [0.8], ai: null, baseRate: br, behaviourTestEnded: false })!;
    expect(b.parts.reduce((s, p) => s + p.weight, 0)).toBeCloseTo(1, 10);
    expect(b.estimate).toBeCloseTo((0.8 * 0.5 + 0.25 * 0.3) / 0.8, 10);
    expect(blendedEstimate({ people: [], ai: 0.4, baseRate: br, behaviourTestEnded: false })).toBeNull();
  });
});
