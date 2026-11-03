import { describe, expect, it } from "vitest";
import { assumptionStatusFromCards, canDesignatePrimary, chanceOfLuck, primaryTestFor, testRole } from "@/lib/domain/primary-test";
import { METHODS } from "@/lib/domain/method";

// Golf A, punt 11: per aanname één hoofdtest; de rest is verkennend.
const assumptions = [
  { id: "a1", primary_experiment_id: "e1" },
  { id: "a2", primary_experiment_id: null },
];

describe("hoofdtest per aanname", () => {
  it("primaryTestFor geeft de aangewezen hoofdtest of null", () => {
    expect(primaryTestFor("a1", assumptions)).toBe("e1");
    expect(primaryTestFor("a2", assumptions)).toBeNull();
    expect(primaryTestFor("onbekend", assumptions)).toBeNull();
  });

  it("de andere tests van een aanname zijn verkennend", () => {
    expect(testRole("e1", "a1", assumptions)).toBe("primary");
    expect(testRole("e2", "a1", assumptions)).toBe("exploratory");
    expect(testRole("e3", "a2", assumptions)).toBe("exploratory");
    expect(testRole("e1", null, assumptions)).toBe("exploratory");
  });

  it("aanwijzen kan alleen vóór de goedkeuring, en niet over een vastgelegde hoofdtest heen", () => {
    expect(canDesignatePrimary({ state: "draft" }, null).ok).toBe(true);
    expect(canDesignatePrimary({ state: "ready_for_review" }, { state: "draft" }).ok).toBe(true);
    expect(canDesignatePrimary({ state: "approved" }, null).ok).toBe(false);
    expect(canDesignatePrimary({ state: "ended" }, null).reason).toMatch(/vóór de goedkeuring/);
    expect(canDesignatePrimary({ state: "draft" }, { state: "live" }).reason).toMatch(/ligt vast/);
  });

  it("2026-11-c: alleen de hoofdtest beslist over de status; a en b: alle tests", () => {
    const cards = [
      { verdict: "pass" as const, experimentId: "e2" },
      { verdict: "fail" as const, experimentId: "e1" },
    ];
    expect(METHODS["2026-11-c"].primaryDecides).toBe(true);
    expect(METHODS["2026-11-b"].primaryDecides).toBe(false);
    expect(assumptionStatusFromCards(cards, "e1", true)).toBe("refuted");
    expect(assumptionStatusFromCards(cards, "e1", false)).toBe("inconclusive");
    // Alleen een geslaagde verkennende test: richting, geen besluit.
    expect(assumptionStatusFromCards([{ verdict: "pass", experimentId: "e2" }], "e1", true)).toBe("testing");
    expect(assumptionStatusFromCards([{ verdict: "pass", experimentId: "e2" }], null, true)).toBe("testing");
    expect(assumptionStatusFromCards([{ verdict: "pass", experimentId: "e2" }], null, false)).toBe("supported");
  });

  it("kans op toeval = 1 − P, alleen bij een geslaagde kansregel", () => {
    expect(chanceOfLuck({ rule: "probability", label: "geslaagd", probability: 0.89 })).toBeCloseTo(0.11, 12);
    expect(chanceOfLuck({ rule: "probability", label: "sterk bewezen", probability: 0.97 })).toBeCloseTo(0.03, 12);
    expect(chanceOfLuck({ rule: "probability", label: "onbeslist", probability: 0.6 })).toBeNull();
    expect(chanceOfLuck({ rule: "absolute", label: "geslaagd", probability: null })).toBeNull();
    expect(chanceOfLuck({ rule: "interval", label: "geslaagd", probability: null })).toBeNull();
  });
});
