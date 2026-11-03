import { describe, expect, it } from "vitest";
import { againstCount, againstSummary } from "@/lib/domain/against";

// Golf B, punt 18: de samenvatting "Wat ging tegen" bij het bevestigen van een besluit.

describe("wat ging tegen", () => {
  const summary = againstSummary({
    tests: [
      { id: "e1", title: "Prijstest", verdict: "fail" },
      { id: "e2", title: "Landingspagina", verdict: "pass" },
      { id: "e3", title: "Interviews", verdict: null },
    ],
    contradictedClaims: [{ id: "c1", statement: "De markt groeit 10% per jaar" }],
    counterObservations: [
      { id: "o1", kind: "objection", summary: "Te duur voor kleine bureaus", isSynthetic: false },
      { id: "o2", kind: "problem_absent", summary: "Herkent het probleem niet", isSynthetic: true },
      { id: "o3", kind: "waitlist_signup", summary: "Aangemeld", isSynthetic: false },
    ],
    assumptions: [
      { id: "a1", statement: "Eventmanagers betalen", capActive: true, capReason: "begrensd op 60%: nog geen aanbetaling" },
      { id: "a2", statement: "Locaties doen mee", capActive: false, capReason: null },
    ],
    deviation: { label: "Doorgaan terwijl de beslisregel niet is gehaald", reason: "Strategisch belangrijk" },
  });

  it("noemt mislukte tests, tegenbewijs, begrensde aannames en de afwijking", () => {
    expect(summary.failed_tests).toEqual([{ id: "e1", title: "Prijstest" }]);
    expect(summary.counter_evidence.map((c) => c.text)).toEqual(["De markt groeit 10% per jaar", "Bezwaar: Te duur voor kleine bureaus"]);
    expect(summary.capped_assumptions).toEqual([{ id: "a1", statement: "Eventmanagers betalen", reason: "begrensd op 60%: nog geen aanbetaling" }]);
    expect(summary.rule_deviations).toHaveLength(1);
    expect(againstCount(summary)).toBe(5);
  });

  it("is leeg maar compleet als er niets tegen ging", () => {
    const empty = againstSummary({ tests: [], contradictedClaims: [], counterObservations: [], assumptions: [], deviation: null });
    expect(empty).toEqual({ failed_tests: [], counter_evidence: [], capped_assumptions: [], rule_deviations: [] });
    expect(againstCount(empty)).toBe(0);
  });
});
