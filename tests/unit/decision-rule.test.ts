import { describe, expect, it } from "vitest";
import { describeRule, deviates, deviationLabel, evaluateRule, isFinalAction, ruleProblem, type DecisionRule } from "@/lib/domain/decision-rule";
import { evaluateRules, type CoachFacts } from "@/lib/coach/rules";

// Golf B, punt 6: beslisregel van bewijs naar besluit.

const rule = (over: Partial<DecisionRule> = {}): DecisionRule => ({
  primaryExperimentId: "e1",
  note: null,
  lockedAt: null,
  recordedLate: false,
  conditions: [
    { assumptionId: "a1", minProbability: 0.7 },
    { assumptionId: "a2", minProbability: 0.5 },
  ],
  ...over,
});
const assumptions = [
  { id: "a1", statement: "Eventmanagers betalen voor selectie", probability: 0.74 },
  { id: "a2", statement: "Locaties willen meedoen", probability: 0.45 },
];

describe("toets aan de beslisregel", () => {
  it("toont per voorwaarde of die is gehaald, en de hoofdtest", () => {
    const ev = evaluateRule(rule(), assumptions, [{ id: "e1", title: "Prijstest", verdict: "pass" }]);
    expect(ev.conditions.map((c) => c.met)).toEqual([true, false]);
    expect(ev.primary).toEqual({ experimentId: "e1", title: "Prijstest", verdict: "pass", met: true });
    expect(ev.met).toBe(false);
  });

  it("is alleen gehaald als alle aannames hun kans halen en de hoofdtest is geslaagd", () => {
    const high = assumptions.map((a) => ({ ...a, probability: 0.8 }));
    expect(evaluateRule(rule(), high, [{ id: "e1", title: "Prijstest", verdict: "pass" }]).met).toBe(true);
    expect(evaluateRule(rule(), high, [{ id: "e1", title: "Prijstest", verdict: "inconclusive" }]).met).toBe(false);
    expect(evaluateRule(rule(), high, [{ id: "e1", title: "Prijstest", verdict: null }]).met).toBe(false);
    // Een verdwenen aanname of test telt als niet gehaald.
    expect(evaluateRule(rule(), [high[0]], [{ id: "e1", title: "Prijstest", verdict: "pass" }]).conditions[1]).toMatchObject({ probability: null, met: false });
    expect(evaluateRule(rule({ conditions: [] }), [], []).primary).toMatchObject({ title: "Verwijderde test", met: false });
  });

  it("noemt afwijken: doorgaan zonder regel, of stoppen terwijl hij is gehaald", () => {
    expect(deviates("continue", false)).toBe(true);
    expect(deviates("continue", true)).toBe(false);
    expect(deviates("stop", true)).toBe(true);
    expect(deviates("pause", true)).toBe(true);
    expect(deviates("stop", false)).toBe(false);
    // Tussenbesluiten wijken niet af; zonder regel ook niet.
    expect(deviates("test_more", false)).toBe(false);
    expect(deviates("adjust", true)).toBe(false);
    expect(deviates("continue", null)).toBe(false);
    expect(deviationLabel("continue", false)).toMatch(/Doorgaan terwijl/);
    expect(isFinalAction("pause")).toBe(true);
    expect(isFinalAction("test_more")).toBe(false);
  });

  it("vraagt minstens één voorwaarde met een kans tussen 5% en 95%", () => {
    expect(ruleProblem({ conditions: [], primaryExperimentId: null })).toMatch(/minstens één/);
    expect(ruleProblem({ conditions: [{ minProbability: 0.99 }], primaryExperimentId: null })).toMatch(/tussen 5% en 95%/);
    expect(ruleProblem({ conditions: [], primaryExperimentId: "e1" })).toBeNull();
    expect(describeRule(rule(), "Prijstest")).toBe('Doorgaan als 2 aannames hun minimale kans halen en de hoofdtest "Prijstest" slaagt.');
  });
});

describe("coach: beslisregel vóór de eerste test", () => {
  const facts = (over: Partial<CoachFacts>): CoachFacts => ({
    ideaId: "i1",
    today: "2026-11-07",
    now: Date.parse("2026-11-07T10:00:00Z"),
    sprint: null,
    claims: [],
    competitorKinds: [],
    sourceTypes: [],
    assumptions: [],
    experiments: [],
    interviews: [],
    observations: [],
    learningCards: [],
    realityCheck: null,
    decisions: [],
    decisionDeadline: null,
    clientDeciderInvited: false,
    outcome: { defined: false, due: null, resolved: false, checkins: [] },
    forecasts: [],
    outreach: { replies: 0, latestReplyAt: null, latestImportAt: null },
    ...over,
  });
  const exp = (state: string) =>
    ({ id: "e1", title: "Prijstest", type: "pricing", state, startedAt: null, endsAt: null, n: 0, minSample: 20, locked: false, successThresholdPct: 10, failThresholdPct: 2, guide: [] }) as CoachFacts["experiments"][number];

  it("tipt vóór de eerste goedkeuring en waarschuwt erna", () => {
    const codes = (f: CoachFacts) => evaluateRules(f).map((n) => n.code);
    expect(codes(facts({ decisionRule: { defined: false, locked: false }, experiments: [exp("draft")] }))).toContain("decision_rule_missing");
    expect(codes(facts({ decisionRule: { defined: false, locked: false }, experiments: [exp("live")] }))).toContain("decision_rule_missing:late");
    expect(codes(facts({ decisionRule: { defined: true, locked: false }, experiments: [exp("draft")] }))).not.toContain("decision_rule_missing");
    expect(codes(facts({ experiments: [exp("draft")] })).some((c) => c.startsWith("decision_rule_missing"))).toBe(false);
  });
});
