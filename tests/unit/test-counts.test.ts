import { describe, expect, it } from "vitest";
import { excludedTests, experimentFromSourceKey, testExclusion, testOutcomesFrom, withoutExcludedTests } from "@/lib/domain/test-counts";
import { computeAssumptions, hasDiscoveryEvidence, orderByInformationValue, rankAssumptions, type AssumptionInputs } from "@/lib/progress";
import { DEFAULT_CAPS } from "@/lib/domain/evidence";
import type { MethodVersion } from "@/lib/domain/method";

describe("testExclusion: wanneer een test niet meetelt", () => {
  it("een onbesliste test telt niet mee", () => {
    expect(testExclusion({ experimentId: "e", title: "Interviews", verdict: "inconclusive", n: 10, minSample: 8 })).toMatchObject({ reason: "inconclusive", text: "telt niet mee: onbeslist" });
  });
  it("een test onder de minimale steekproef telt niet mee, ook als hij 'geslaagd' heet", () => {
    expect(testExclusion({ experimentId: "e", verdict: "pass", n: 5, minSample: 8 })).toMatchObject({
      reason: "under_sample",
      text: "telt niet mee: onder de minimale steekproef van 8",
      title: "Test",
    });
  });
  it("een geslaagde of mislukte test met voldoende deelnemers telt mee", () => {
    expect(testExclusion({ experimentId: "e", verdict: "pass", n: 8, minSample: 8 })).toBeNull();
    expect(testExclusion({ experimentId: "e", verdict: "fail", n: 20, minSample: 8 })).toBeNull();
  });
  it("zonder bekend aantal geldt alleen de onbeslist-regel", () => {
    expect(testExclusion({ experimentId: "e", verdict: null, n: null, minSample: 150 })).toBeNull();
  });
  it("filtert alleen wat uit een uitgesloten test komt", () => {
    const ex = excludedTests([
      { experimentId: "a", verdict: "inconclusive", n: 9, minSample: 8 },
      { experimentId: "b", verdict: "pass", n: 9, minSample: 8 },
    ]);
    expect(withoutExcludedTests([{ e: "a" }, { e: "b" }, { e: null }], (x) => x.e, ex)).toEqual([{ e: "b" }, { e: null }]);
    expect(experimentFromSourceKey("experiment:abc")).toBe("abc");
    expect(experimentFromSourceKey("source:abc")).toBeNull();
  });
  it("leest uitkomst en n van de leerkaart, of bij een lopende interviewtest de gecodeerde interviews", () => {
    const exps = [
      { id: "iv", title: "Interviews", type: "interview", state: "live", hypotheses: { assumption_id: "a1", min_sample: 8 } },
      { id: "lp", title: "Landingpage", type: "landing", state: "live", hypotheses: { assumption_id: "a1", min_sample: 150 } },
      { id: "pr", title: "Prijstest", type: "pricing", state: "analyzed", hypotheses: { assumption_id: "a1", min_sample: 50 } },
    ];
    const cards = [
      { experiment_id: "pr", status: "draft", verdict: "fail", metrics: { n: 10 } },
      { experiment_id: "pr", status: "approved", verdict: "pass", metrics: { n: 60 } },
    ];
    const obs = [
      { experiment_id: "iv", interview_id: "i1", is_synthetic: false },
      { experiment_id: "iv", interview_id: "i1", is_synthetic: false },
      { experiment_id: "iv", interview_id: "i2", is_synthetic: false },
      { experiment_id: "iv", interview_id: "i3", is_synthetic: true },
    ];
    const rows = testOutcomesFrom(exps, cards, obs);
    expect(rows.map((r) => [r.experimentId, r.verdict, r.n])).toEqual([
      ["iv", null, 2],
      ["lp", null, null],
      ["pr", "pass", 60],
    ]);
  });
});

// Twee aannames. a1 (belang 4) heeft drie gecodeerde interviewuitspraken uit test E1; a2 (belang 3) heeft geen bewijs.
// Telt E1 mee, dan zakt a1 onder a2 in de rangorde en stijgt de kans van a1.
function inputs(opts: { card?: { verdict: string; n: number } | null; coded?: number; withObservations?: boolean }): AssumptionInputs {
  const assumption = (id: string, importance: number) => ({
    id,
    statement: `Aanname ${id}`,
    category: "desirability",
    importance,
    status: "testing",
    origin: "manual",
    prior: 0.5,
    prior_rationale: null,
    prior_locked_at: null,
    primary_experiment_id: null,
  });
  const coded = opts.coded ?? 3;
  const obs = Array.from({ length: coded }, (_, i) => ({ experiment_id: "E1", interview_id: `i${i}`, is_synthetic: false }));
  const obsLinks = (opts.withObservations ?? true)
    ? obs.map((o, i) => ({
        assumption_id: "a1",
        observation_id: `o${i}`,
        relation: "supports",
        observations: {
          is_fact: true,
          is_behaviour: true,
          is_real_context: false,
          is_costly: false,
          is_synthetic: false,
          kind: "problem_confirmed",
          origin: "manual",
          review_status: null,
          interview_id: o.interview_id,
          experiment_id: "E1",
        },
      }))
    : [];
  const experiments = [{ id: "E1", title: "Probleeminterviews", type: "interview", state: opts.card ? "analyzed" : "live", hypotheses: { assumption_id: "a1", min_sample: 3 } }];
  const cards = opts.card ? [{ experiment_id: "E1", status: "approved", verdict: opts.card.verdict, metrics: { n: opts.card.n } }] : [];
  return {
    assumptions: [assumption("a1", 4), assumption("a2", 3)],
    links: [],
    obsLinks,
    weights: { overrides: {} },
    refs: new Map(),
    caps: { caps: DEFAULT_CAPS },
    method: "2026-11-c",
    tests: testOutcomesFrom(experiments, cards, obs),
    interviewObs: (opts.withObservations ?? true) ? obs : [],
  } as unknown as AssumptionInputs;
}

const VERSIONS: MethodVersion[] = ["2026-11-a", "2026-11-b", "2026-11-c"];
const summary = (i: AssumptionInputs, v: MethodVersion) => {
  const list = computeAssumptions(i, v);
  return {
    probability: list.map((a) => a.probability.probability),
    evidence: list.map((a) => a.evidence),
    rank: rankAssumptions(list).map((a) => a.id),
    voi: orderByInformationValue(list, hasDiscoveryEvidence(i)).map((a) => [a.id, a.voi.index]),
  };
};

describe("fase B0, punt 4: kans en rangorde veranderen niet door een test die niet meetelt", () => {
  for (const v of VERSIONS) {
    const baseline = summary(inputs({ withObservations: false }), v);

    it(`${v}: een onbesliste test laat kans en rangorde gelijk`, () => {
      expect(summary(inputs({ card: { verdict: "inconclusive", n: 3 } }), v)).toEqual(baseline);
    });

    it(`${v}: een test met n onder de minimale steekproef laat kans en rangorde gelijk`, () => {
      expect(summary(inputs({ card: { verdict: "pass", n: 2 } }), v)).toEqual(baseline);
      // Lopende interviewtest zonder leerkaart, met 2 van de minimaal 3 gecodeerde interviews.
      expect(summary(inputs({ card: null, coded: 2 }), v)).toEqual(baseline);
    });

    it(`${v}: een geslaagde test met voldoende deelnemers verandert kans en rangorde wel`, () => {
      const counted = summary(inputs({ card: { verdict: "pass", n: 3 } }), v);
      expect(counted.probability[0]).toBeGreaterThan(baseline.probability[0]);
      expect(counted.evidence[0]).toBeGreaterThan(0);
      expect(baseline.rank).toEqual(["a1", "a2"]);
      expect(counted.rank).toEqual(["a2", "a1"]);
    });
  }

  it("toont bij de aanname waarom de test niet meetelt", () => {
    const [a1, a2] = computeAssumptions(inputs({ card: { verdict: "pass", n: 2 } }), "2026-11-c");
    expect(a1.excludedTests).toEqual([
      { experimentId: "E1", title: "Probleeminterviews", reason: "under_sample", text: "telt niet mee: onder de minimale steekproef van 3" },
    ]);
    expect(a2.excludedTests).toEqual([]);
    expect(computeAssumptions(inputs({ card: { verdict: "inconclusive", n: 3 } }), "2026-11-c")[0].excludedTests[0].text).toBe("telt niet mee: onbeslist");
    expect(computeAssumptions(inputs({ card: { verdict: "pass", n: 3 } }), "2026-11-c")[0].excludedTests).toEqual([]);
  });
});
