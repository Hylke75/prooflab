import { describe, expect, it } from "vitest";
import {
  addMonths,
  aggregate,
  brier,
  bucketLabel,
  checkinDueFor,
  decisionBlocker,
  decisionSteps,
  explainBrier,
  followUp,
  forecastDue,
  openMoment,
  outcomeDueFor,
  scoreSet,
  type ForecastState,
  type MomentInput,
} from "@/lib/domain/forecast";
import type { IdeaProgress } from "@/lib/domain/coach";
import { parseDutchNumber, OutcomeDefinitionSchema, outcomeValueProblem } from "@/lib/forecast-schemas";
import { measureWindowProblem, outcomeDueAtDecision } from "@/lib/domain/forecast";

describe("succescriterium: waarde en meetvenster", () => {
  it("vraagt minstens een minimumbedrag per klant of een omzetdoel", () => {
    expect(outcomeValueProblem({ outcome_min_value_per_customer: null, outcome_revenue_target: null })).toMatch(/minstens één/);
    expect(outcomeValueProblem({ outcome_min_value_per_customer: 0, outcome_revenue_target: undefined })).toMatch(/minstens één/);
    expect(outcomeValueProblem({ outcome_min_value_per_customer: 1500, outcome_revenue_target: null })).toBeNull();
    expect(outcomeValueProblem({ outcome_min_value_per_customer: null, outcome_revenue_target: 22500 })).toBeNull();
  });

  it("leest bedragen en een lege meetdatum uit het formulier", () => {
    const p = OutcomeDefinitionSchema.parse({
      outcome_statement: "Minstens 15 klanten betalen",
      outcome_metric: "betalende klanten",
      outcome_target: "15",
      outcome_min_value_per_customer: "1.500",
      outcome_revenue_target: "",
      outcome_measure_date: "",
    });
    expect(p).toMatchObject({ outcome_min_value_per_customer: 1500, outcome_revenue_target: null, outcome_measure_date: null });
  });

  it("laat de meetdatum alleen toe na de beslisdatum en binnen zes maanden", () => {
    expect(measureWindowProblem("2027-03-01", "2027-03-01")).toMatch(/na de beslisdatum/);
    expect(measureWindowProblem("2027-02-01", "2027-03-01")).toMatch(/na de beslisdatum/);
    expect(measureWindowProblem("2027-09-02", "2027-03-01")).toMatch(/buiten het venster van 6 maanden.*2027-09-01/);
    expect(measureWindowProblem("2027-09-01", "2027-03-01")).toBeNull();
    expect(measureWindowProblem("2027-05-15", "2027-03-01")).toBeNull();
    expect(measureWindowProblem("morgen", "2027-03-01")).toMatch(/geldige/);
  });

  it("gebruikt de geplande meetdatum bij het besluit als hij nog in het venster past", () => {
    expect(outcomeDueAtDecision("2027-03-01", "2027-06-01")).toBe("2027-06-01");
    expect(outcomeDueAtDecision("2027-03-01", null)).toBe("2027-09-01");
    // Later besloten dan gepland: de meetdatum ligt dan te vroeg, dus zes maanden na het besluit.
    expect(outcomeDueAtDecision("2027-07-01", "2027-06-01")).toBe("2028-01-01");
  });
});

describe("Brier score", () => {
  it("is the squared distance to what happened (yes 1, partial 0.5, no 0)", () => {
    expect(brier(0.7, "yes")).toBeCloseTo(0.09);
    expect(brier(0.7, "no")).toBeCloseTo(0.49);
    expect(brier(0.5, "partial")).toBe(0);
    expect(brier(0.5, "yes")).toBe(0.25);
    expect(brier(0.05, "no")).toBeCloseTo(0.0025);
  });

  it("explains a contribution against a 50% guess", () => {
    expect(explainBrier(0.8, "yes")).toContain("dicht bij de uitkomst");
    expect(explainBrier(0.5, "yes")).toContain("even goed als een gok van 50%");
    expect(explainBrier(0.9, "no")).toContain("verder van de uitkomst");
    expect(explainBrier(0.4, "no")).toContain("beter dan een gok");
  });

  it("scores a set: mean Brier, mean probability and hit rate", () => {
    const s = scoreSet([
      { probability: 0.8, achieved: "yes" },
      { probability: 0.6, achieved: "no" },
      { probability: 0.5, achieved: "partial" },
    ])!;
    expect(s.n).toBe(3);
    expect(s.brier).toBeCloseTo((0.04 + 0.36 + 0) / 3);
    expect(s.meanProbability).toBeCloseTo(0.6333, 3);
    expect(s.hitRate).toBeCloseTo(0.5);
    expect(scoreSet([])).toBeNull();
    expect(bucketLabel(7)).toBe("70–80%");
  });
});

describe("aggregation", () => {
  it("gives mean and spread (range and population standard deviation)", () => {
    const a = aggregate([0.3, 0.5, 0.7])!;
    expect(a.n).toBe(3);
    expect(a.mean).toBeCloseTo(0.5);
    expect(a.min).toBe(0.3);
    expect(a.max).toBe(0.7);
    expect(a.sd).toBeCloseTo(Math.sqrt(0.08 / 3));
    expect(aggregate([0.4])).toMatchObject({ n: 1, mean: 0.4, sd: 0 });
    expect(aggregate([])).toBeNull();
  });
});

describe("due dates", () => {
  it("measures the outcome six months after the decision, clamping to the end of the month", () => {
    expect(outcomeDueFor("2026-11-03")).toBe("2027-05-03");
    expect(outcomeDueFor("2026-08-31")).toBe("2027-02-28");
    expect(outcomeDueFor("2027-08-31")).toBe("2028-02-29");
    expect(addMonths("2026-12-15", 1)).toBe("2027-01-15");
    expect(addMonths("2027-03-31", -1)).toBe("2027-02-28");
  });

  it("opens the interim check-in three months after the decision", () => {
    expect(checkinDueFor(outcomeDueFor("2026-11-03"))).toBe("2027-02-03");
  });

  it("asks for the check-in, then the outcome, and nothing after resolution", () => {
    const due = "2027-05-03";
    expect(followUp({ outcomeDue: null, checkins: 0, resolved: false, today: "2027-06-01" })).toMatchObject({ checkinDue: false, outcomeDue: false });
    expect(followUp({ outcomeDue: due, checkins: 0, resolved: false, today: "2027-02-02" })).toMatchObject({ checkinDue: false, outcomeDue: false, checkinDate: "2027-02-03" });
    expect(followUp({ outcomeDue: due, checkins: 0, resolved: false, today: "2027-02-03" })).toMatchObject({ checkinDue: true, outcomeDue: false });
    expect(followUp({ outcomeDue: due, checkins: 1, resolved: false, today: "2027-03-01" }).checkinDue).toBe(false);
    // On the due date the outcome takes over, also without a check-in.
    expect(followUp({ outcomeDue: due, checkins: 0, resolved: false, today: "2027-05-03" })).toMatchObject({ checkinDue: false, outcomeDue: true });
    expect(followUp({ outcomeDue: due, checkins: 1, resolved: true, today: "2027-06-01" })).toMatchObject({ checkinDue: false, outcomeDue: false });
  });
});

describe("forecast moments", () => {
  const base: MomentInput = { outcomeDefined: true, resolved: false, marketDone: false, experimentEnded: false, realityCheckDone: false, outcomeDue: null, today: "2026-11-03" };

  it("opens nothing before the outcome is defined or after it is known", () => {
    expect(openMoment({ ...base, outcomeDefined: false })).toBeNull();
    expect(openMoment({ ...base, resolved: true, realityCheckDone: true })).toBeNull();
  });

  it("opens only the latest reached moment", () => {
    expect(openMoment(base)).toBe("intake");
    expect(openMoment({ ...base, marketDone: true })).toBe("research");
    expect(openMoment({ ...base, marketDone: true, experimentEnded: true })).toBe("experiment");
    expect(openMoment({ ...base, marketDone: true, experimentEnded: true, realityCheckDone: true })).toBe("decision");
    // A Reality Check without a finished test still means the decision is near.
    expect(openMoment({ ...base, realityCheckDone: true })).toBe("decision");
  });

  it("keeps the decision moment open for two weeks after the decision that set the clock", () => {
    const decided = { ...base, realityCheckDone: true, outcomeDue: "2027-05-03" };
    expect(openMoment({ ...decided, today: "2026-11-17" })).toBe("decision");
    expect(openMoment({ ...decided, today: "2026-11-18" })).toBeNull();
  });
});

describe("outcome definition", () => {
  it("requires a sentence, a metric and a numeric target", () => {
    const ok = OutcomeDefinitionSchema.safeParse({ outcome_statement: "Minstens 15 MKB-klanten betalen een abonnement", outcome_metric: "betalende klanten", outcome_target: "15" });
    expect(ok.success && ok.data.outcome_target).toBe(15);
    expect(OutcomeDefinitionSchema.safeParse({ outcome_statement: "Kort", outcome_metric: "x", outcome_target: "15" }).success).toBe(false);
    expect(OutcomeDefinitionSchema.safeParse({ outcome_statement: "Minstens 15 klanten betalen", outcome_metric: "klanten", outcome_target: "" }).success).toBe(false);
    expect(OutcomeDefinitionSchema.safeParse({ outcome_statement: "Minstens 15 klanten betalen", outcome_metric: "klanten", outcome_target: "-3" }).success).toBe(false);
  });

  it("reads Dutch numbers", () => {
    expect(parseDutchNumber("1.500")).toBe(1500);
    expect(parseDutchNumber("1.500,5")).toBe(1500.5);
    expect(parseDutchNumber("2,5")).toBe(2.5);
    expect(parseDutchNumber("15")).toBe(15);
    expect(parseDutchNumber("0.25")).toBe(0.25);
  });
});

// Minimal progress for the helpers that read the dossier.
function progress(forecast: Partial<ForecastState> | undefined, over: Partial<IdeaProgress> = {}): IdeaProgress {
  return {
    ideaId: "i1",
    questions: 4,
    claims: 3,
    verifiedClaims: 1,
    weakClaims: 0,
    competitors: 2,
    hasAlternatives: true,
    segments: 1,
    sizingEstablished: false,
    assumptions: 3,
    assumptionsWithoutEvidence: 0,
    untestedCritical: 0,
    topAssumption: null,
    experiments: [],
    experimentsDraft: 0,
    experimentsLive: 0,
    experimentsEnded: 1,
    learningCardsDraft: 0,
    learningCardsApproved: 1,
    latestCardApprovedAt: "2026-10-20T10:00:00Z",
    latestRealityCheckAt: "2026-10-21T10:00:00Z",
    decisions: 0,
    latestDecisionAt: null,
    latestDecisionAction: null,
    latestDecisionConfirmed: false,
    reports: 0,
    latestReportAt: null,
    latestReportShared: false,
    behaviourObservations: 1,
    forecast:
      forecast === undefined
        ? undefined
        : { outcomeDefined: true, baseRateChosen: true, outcomeDue: null, ownMoments: [], checkins: 0, resolved: false, today: "2026-11-03", ...forecast },
    ...over,
  };
}

describe("decision gate", () => {
  it("requires the outcome definition and the decider's own decision forecast", () => {
    expect(decisionBlocker(progress({ outcomeDefined: false }))?.text).toMatch(/wanneer dit idee geslaagd is/);
    expect(decisionBlocker(progress({}))?.text).toMatch(/eigen voorspelling/);
    expect(forecastDue(progress({}))).toBe("decision");
    expect(decisionBlocker(progress({ ownMoments: ["decision"] }))).toBeNull();
  });

  it("gebruikerstest D12: per ontbrekend onderdeel een link en de stap", () => {
    expect(decisionBlocker(progress({ outcomeDefined: false }))).toMatchObject({ step: "definitie", href: "/app/ideas/i1/outcome#definitie" });
    expect(decisionBlocker(progress({ baseRateChosen: false }))).toMatchObject({ step: "basispercentage", href: "/app/ideas/i1/outcome#basispercentage" });
    expect(decisionSteps(progress({ baseRateChosen: false }))?.missing.map((m) => m.step)).toEqual(["basispercentage", "voorspelling"]);
    expect(decisionBlocker(progress({}))).toMatchObject({ step: "voorspelling", href: "#voorspelling" });
    expect(decisionSteps(progress({ ownMoments: ["decision"] }))).toEqual({ done: true, status: "done", missing: [] });
    expect(decisionSteps(progress({}))?.status).toBe("open");
    expect(decisionSteps(progress(undefined))).toBeNull();
  });

  it("geeft geen vinkje als er nooit voorspeld is omdat het besluitmoment nog niet open is", () => {
    // Geen Reality Check: het besluitmoment is niet open, er hoeft nu niets, maar er is ook niets gedaan.
    expect(decisionSteps(progress({}, { latestRealityCheckAt: null }))).toEqual({ done: true, status: "later", missing: [] });
    // Besluitmoment al gesloten zonder eigen voorspelling: evenmin "klaar".
    expect(decisionSteps(progress({ outcomeDue: "2027-02-01", today: "2026-12-01" }))?.status).toBe("later");
  });

  it("does not block without the prediction schema, after resolution, or once the decision moment has closed", () => {
    expect(decisionBlocker(progress(undefined))).toBeNull();
    expect(decisionBlocker(progress({ resolved: true }))).toBeNull();
    expect(decisionBlocker(progress({ outcomeDue: "2027-02-01", today: "2026-12-01" }))).toBeNull();
  });
});
