import { describe, expect, it } from "vitest";
import { EXTEND_WEEK_OPTIONS, extendedPhase, extensionBlocker } from "@/lib/domain/extension";
import { DECISIONS } from "@/lib/domain/labels";
import { evaluateRules, type CoachFacts } from "@/lib/coach/rules";

// Golf B, punt 20: verlengde testfase van 2 tot 8 weken na de sprint.

const extend = { action: "extend", decidedOn: "2026-11-07", extendWeeks: 4 };

describe("verlengde testfase", () => {
  it("biedt 2 tot 8 weken en heeft een eigen besluittype", () => {
    expect(EXTEND_WEEK_OPTIONS).toEqual([2, 3, 4, 5, 6, 7, 8]);
    // B6: in het scherm samengevoegd met "Verder testen" (één keuze met een duur).
    expect(DECISIONS.extend.label).toBe("Verder testen");
    expect(DECISIONS.test_more.label).toBe("Verder testen");
  });

  it("loopt tot het aantal weken na het tussenbesluit", () => {
    expect(extendedPhase([extend], "2026-11-20")).toEqual({ start: "2026-11-07", end: "2026-12-05", weeks: 4, active: true });
    expect(extendedPhase([extend], "2026-12-05")?.active).toBe(false);
    // Een definitief besluit sluit de fase af.
    expect(extendedPhase([extend, { action: "continue", decidedOn: "2026-12-06", extendWeeks: null }], "2026-12-10")).toBeNull();
    expect(extendedPhase([], "2026-12-10")).toBeNull();
  });

  it("weigert een definitief besluit tijdens de fase, en een tweede verlenging", () => {
    expect(extensionBlocker("continue", [extend], "2026-11-20", false)).toMatch(/loopt tot 2026-12-05/);
    expect(extensionBlocker("stop", [extend], "2026-11-20", false)).toMatch(/loopt tot/);
    expect(extensionBlocker("adjust", [extend], "2026-11-20", false)).toBeNull();
    expect(extensionBlocker("continue", [extend], "2026-12-05", false)).toBeNull();
    expect(extensionBlocker("extend", [extend], "2026-12-05", false)).toMatch(/al een verlengde testfase/);
    expect(extensionBlocker("extend", [], "2026-11-07", true)).toMatch(/Na een definitief besluit/);
    expect(extensionBlocker("extend", [], "2026-11-07", false)).toBeNull();
  });

  it("de coach meldt het einde van de fase", () => {
    const facts = (today: string): CoachFacts => ({
      ideaId: "i1",
      today,
      now: Date.parse(`${today}T10:00:00Z`),
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
      decisions: [{ id: "d1", decidedAt: "2026-11-07T10:00:00Z", confirmed: true, action: "extend", extendWeeks: 4 }],
      decisionDeadline: null,
      clientDeciderInvited: false,
      outcome: { defined: false, due: null, resolved: false, checkins: [] },
      forecasts: [],
      outreach: { replies: 0, latestReplyAt: null, latestImportAt: null },
    });
    const code = (today: string) => evaluateRules(facts(today)).find((n) => n.code.startsWith("extension_ending"));
    expect(code("2026-11-10")).toBeUndefined();
    expect(code("2026-12-01")?.kind).toBe("tip");
    expect(code("2026-12-06")?.kind).toBe("warning");
  });
});
