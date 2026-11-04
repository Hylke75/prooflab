import { describe, expect, it } from "vitest";
import { getDossierStatus, testsWithVerdict, type DossierInput } from "@/lib/domain/dossier-status";
import { sprintStatus } from "@/lib/domain/sprint";

const empty: DossierInput = {
  questions: 0,
  claims: 0,
  verifiedClaims: 0,
  decisiveQuestion: null,
  assumptions: 0,
  criticalWithPrimaryTest: 0,
  assumptionsWithEvidence: 0,
  experiments: 0,
  experimentsLive: 0,
  experimentsEnded: 0,
  testsWithVerdict: 0,
  realTestObservations: 0,
  decisions: 0,
  latestDecisionAction: null,
  decisionRule: "unknown",
};
const status = (over: Partial<DossierInput>) => getDossierStatus({ ...empty, ...over });
const step = (over: Partial<DossierInput>, key: string) => status(over).steps.find((s) => s.key === key)!;

describe("getDossierStatus: markt (B1c)", () => {
  it("is niet klaar met 2 onderbouwde bevindingen zolang de beslissende vraag open is (het geval uit de opdracht)", () => {
    const s = step({ questions: 5, claims: 18, verifiedClaims: 2, decisiveQuestion: { status: "open", verifiedClaims: 0 } }, "market");
    expect(s.state).toBe("running");
    expect(s.statusLabel).toBe("Verkenning");
    expect(s.why).toMatch(/geen geverifieerde bron/);
  });

  it("is niet klaar als de beslissende vraag op beantwoord staat zonder geverifieerde bron", () => {
    expect(step({ questions: 1, decisiveQuestion: { status: "answered", verifiedClaims: 0 } }, "market").state).toBe("running");
  });

  it("is niet klaar met geverifieerde bron als de vraag nog niet beantwoord is", () => {
    expect(step({ questions: 1, verifiedClaims: 1, decisiveQuestion: { status: "needs_customer_research", verifiedClaims: 1 } }, "market").statusLabel).toBe("Verkenning");
  });

  it("is klaar als de beslissende vraag beantwoord is met minstens één geverifieerde bron", () => {
    const s = step({ questions: 5, claims: 3, verifiedClaims: 1, decisiveQuestion: { status: "answered", verifiedClaims: 1 } }, "market");
    expect(s.state).toBe("done");
    expect(s.statusLabel).toBe("Klaar");
  });

  it("is leeg zonder vragen en bevindingen", () => {
    expect(step({}, "market")).toMatchObject({ state: "empty", statusLabel: "Nog niet gestart" });
  });
});

describe("getDossierStatus: aannames (B1c)", () => {
  it("is pas klaar met een kritieke aanname met hoofdtest", () => {
    expect(step({ assumptions: 6 }, "assumptions").state).toBe("running");
    expect(step({ assumptions: 6, criticalWithPrimaryTest: 1 }, "assumptions").state).toBe("done");
  });

  it("gebruikerstest A6: met hoofdtest maar zonder beslisregel loopt de stap nog", () => {
    const s = step({ assumptions: 6, criticalWithPrimaryTest: 1, decisionRule: "missing" }, "assumptions");
    expect(s.state).toBe("running");
    expect(s.statusLabel).toBe("Loopt");
    expect(s.why).toBe("Leg de beslisregel vast.");
    expect(status({ decisiveQuestion: { status: "answered", verifiedClaims: 1 }, assumptions: 6, criticalWithPrimaryTest: 1, decisionRule: "missing" }).current).toBe("assumptions");
  });

  it("gebruikerstest A6: met hoofdtest en vastgelegde beslisregel is de stap klaar", () => {
    const s = step({ assumptions: 6, criticalWithPrimaryTest: 1, decisionRule: "saved" }, "assumptions");
    expect(s.state).toBe("done");
    expect(s.why).toMatch(/beslisregel ligt vast/);
  });

  it("gebruikerstest A6: een beslisregel zonder hoofdtest maakt de stap niet klaar", () => {
    expect(step({ assumptions: 6, decisionRule: "saved" }, "assumptions").state).toBe("running");
  });
});

describe("getDossierStatus: stappen met bewijs (B1c)", () => {
  it("telt niets zonder één waarneming of geverifieerde bron (het geval '3 van 5 met bewijs')", () => {
    const s = status({ questions: 5, claims: 18, assumptions: 6, assumptionsWithEvidence: 3, experiments: 1, experimentsLive: 1 });
    expect(s.stepsWithEvidence).toBe(0);
  });

  it("telt markt met een geverifieerde bron en testen alleen met echte waarnemingen", () => {
    expect(status({ claims: 2, verifiedClaims: 2 }).stepsWithEvidence).toBe(1);
    expect(status({ experiments: 1, experimentsLive: 1, realTestObservations: 0 }).steps[2].hasEvidence).toBe(false);
    expect(status({ experiments: 1, experimentsLive: 1, realTestObservations: 4 }).steps[2].hasEvidence).toBe(true);
  });

  it("telt aannames alleen als er onder het bewijs ook echt bewijs zit", () => {
    expect(step({ assumptions: 3, assumptionsWithEvidence: 3 }, "assumptions").hasEvidence).toBe(false);
    expect(step({ assumptions: 3, assumptionsWithEvidence: 1, verifiedClaims: 1 }, "assumptions").hasEvidence).toBe(true);
  });

  it("telt een besluit zonder bewijs niet als stap met bewijs", () => {
    expect(step({ decisions: 1, latestDecisionAction: "continue" }, "decide")).toMatchObject({ state: "done", hasEvidence: false });
    expect(step({ decisions: 1, latestDecisionAction: "continue", realTestObservations: 2 }, "decide").hasEvidence).toBe(true);
  });
});

describe("getDossierStatus: huidige stap (B1c)", () => {
  it("staat op Testen zodra er een test loopt, ook als de markt nog verkenning is", () => {
    const s = status({ questions: 5, claims: 18, verifiedClaims: 2, decisiveQuestion: { status: "open", verifiedClaims: 0 }, assumptions: 6, experiments: 1, experimentsLive: 1 });
    expect(s.current).toBe("test");
    expect(s.currentLabel).toBe("Test loopt");
  });

  it("is anders de eerste stap die nog niet klaar is", () => {
    expect(status({ questions: 2 }).current).toBe("market");
    expect(status({ questions: 2, decisiveQuestion: { status: "answered", verifiedClaims: 1 }, assumptions: 2 }).current).toBe("assumptions");
    expect(
      status({ decisiveQuestion: { status: "answered", verifiedClaims: 1 }, criticalWithPrimaryTest: 1, experimentsEnded: 1, testsWithVerdict: 1, decisions: 1, latestDecisionAction: "stop" }).current,
    ).toBe("done");
  });

  it("zet de sprintbalk op de echte stap, niet op de kalenderweek", () => {
    // Week 1 van 5 (kalender: onderzoek), maar er loopt al een test: de balk toont Testen als huidige mijlpaal.
    const s = sprintStatus({ start: "2026-11-02", weeks: 5, today: "2026-11-03", stage: 3, testsStarted: true });
    if (!s.planned) throw new Error("niet gepland");
    expect(s.milestones.find((m) => m.status === "current")?.phase).toBe("test");
  });
});

describe("getDossierStatus: besluit (B1, na verder testen, bijsturen of pauzeren)", () => {
  const tested = { decisiveQuestion: { status: "answered", verifiedClaims: 1 }, criticalWithPrimaryTest: 1, experiments: 1, experimentsEnded: 1, testsWithVerdict: 1, decisions: 1 } as const;

  it("is alleen klaar na doorgaan of stoppen", () => {
    expect(status({ ...tested, latestDecisionAction: "continue" })).toMatchObject({ current: "done", currentLabel: "Besloten" });
    expect(status({ ...tested, latestDecisionAction: "stop" }).current).toBe("done");
  });

  it.each([
    ["test_more", "Verder testen"],
    // B6: verder testen en de verlengde testfase zijn één keuze; beide heten "Verder testen".
    ["extend", "Verder testen"],
    ["adjust", "Bijsturen"],
  ])("staat na %s op Testen, niet op Besloten", (action, label) => {
    const s = status({ ...tested, latestDecisionAction: action });
    expect(s.current).toBe("test");
    expect(s.currentLabel).toBe(label);
    expect(s.steps[3]).toMatchObject({ state: "running", statusLabel: label });
    expect(s.steps[3].why).toMatch(/definitieve besluit/);
  });

  it("staat na pauzeren op Besluit · gepauzeerd", () => {
    const s = status({ ...tested, latestDecisionAction: "pause" });
    expect(s.current).toBe("decide");
    expect(s.currentLabel).toBe("Besluit · gepauzeerd");
    expect(s.steps[3].state).toBe("running");
  });

  it("toont een lopende vervolgtest na verder testen als Test loopt", () => {
    expect(status({ ...tested, experiments: 2, experimentsLive: 1, latestDecisionAction: "test_more" }).currentLabel).toBe("Test loopt");
  });
});

describe("getDossierStatus: testen pas klaar met een uitslag (B1)", () => {
  it("is niet klaar met alleen een afgeronde test zonder uitslag", () => {
    const s = step({ experiments: 1, experimentsEnded: 1, testsWithVerdict: 0 }, "test");
    expect(s).toMatchObject({ state: "running", statusLabel: "Nog geen uitslag" });
    expect(s.why).toMatch(/Onbeslist telt niet/);
  });

  it("is klaar met een afgeronde test met uitslag geslaagd of niet geslaagd", () => {
    expect(step({ experiments: 1, experimentsEnded: 1, testsWithVerdict: 1 }, "test")).toMatchObject({ state: "done", statusLabel: "Klaar" });
  });

  it("telt alleen afgeronde tests met een Learning Card met pass of fail", () => {
    const exps = [
      { id: "a", state: "analyzed" },
      { id: "b", state: "decided" },
      { id: "c", state: "ended" },
      { id: "d", state: "live" },
    ];
    const cards = [
      { experiment_id: "a", verdict: "inconclusive" },
      { experiment_id: "b", verdict: "fail" },
      { experiment_id: "d", verdict: "pass" },
    ];
    expect(testsWithVerdict(exps, cards)).toBe(1);
    expect(testsWithVerdict(exps, [{ experiment_id: "a", verdict: "inconclusive" }])).toBe(0);
    expect(testsWithVerdict(exps, [{ experiment_id: "c", verdict: "pass" }])).toBe(1);
  });

  it("staat niet op Besluit zolang alleen een onbesliste test is afgerond", () => {
    const s = status({ decisiveQuestion: { status: "answered", verifiedClaims: 1 }, criticalWithPrimaryTest: 1, experiments: 1, experimentsEnded: 1 });
    expect(s.current).toBe("test");
  });
});
