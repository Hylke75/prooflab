import { describe, expect, it } from "vitest";
import type { ExperimentSummary, IdeaProgress } from "@/lib/domain/coach";
import type { DossierInput } from "@/lib/domain/dossier-status";
import { ideaTasks, taskAfter, taskPosition, type TaskKey } from "@/lib/domain/tasks";

const ID = "00000000-0000-4000-8000-000000000001";

function dossier(over: Partial<DossierInput> = {}): DossierInput {
  return {
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
    decisionRule: "missing",
    ...over,
  };
}

function progress(over: Partial<IdeaProgress> = {}, d: Partial<DossierInput> = {}): IdeaProgress {
  return {
    ideaId: ID,
    questions: 0,
    claims: 0,
    verifiedClaims: 0,
    weakClaims: 0,
    competitors: 0,
    hasAlternatives: false,
    segments: 0,
    sizingEstablished: false,
    assumptions: 0,
    assumptionsWithoutEvidence: 0,
    untestedCritical: 0,
    topAssumption: null,
    experiments: [],
    experimentsDraft: 0,
    experimentsLive: 0,
    experimentsEnded: 0,
    learningCardsDraft: 0,
    learningCardsApproved: 0,
    latestCardApprovedAt: null,
    latestRealityCheckAt: null,
    decisions: 0,
    latestDecisionAt: null,
    latestDecisionAction: null,
    latestDecisionConfirmed: false,
    reports: 0,
    latestReportAt: null,
    latestReportShared: false,
    behaviourObservations: 0,
    ...over,
    dossier: dossier(d),
  };
}

const exp = (id: string, state: string): ExperimentSummary => ({ id, title: `Test ${id}`, state, startedAt: null, endsAt: null, hasApprovedCard: false });
const status = (p: IdeaProgress, key: TaskKey) => ideaTasks(p).phases.flatMap((ph) => ph.tasks).find((t) => t.key === key)?.status;

describe("ideaTasks", () => {
  it("heeft vijf fasen in vaste volgorde", () => {
    expect(ideaTasks(progress()).phases.map((p) => p.label)).toEqual(["Markt", "Aannames", "Testen", "Besluit", "Rapport"]);
  });

  it("een leeg idee begint bij de onderzoeksvraag; latere taken zeggen waarom ze nog niet kunnen", () => {
    const list = ideaTasks(progress());
    expect(list.current).toBe("market");
    expect(list.next?.key).toBe("market-question");
    const plan = list.phases[2].tasks.find((t) => t.key === "test-plan")!;
    expect(plan.status).toBe("locked");
    expect(plan.why).toMatch(/eerst/i);
    expect(status(progress(), "decide-decision")).toBe("locked");
  });

  it("een lopende test is de volgende taak, ook als de markt nog niet klaar is", () => {
    const p = progress({ assumptions: 2, experiments: [exp("e1", "live")], experimentsLive: 1 }, { assumptions: 2, experiments: 1, experimentsLive: 1, criticalWithPrimaryTest: 1 });
    const list = ideaTasks(p);
    expect(list.current).toBe("test");
    expect(list.next?.key).toBe("test-run");
    expect(list.next?.path).toBe("/experiments/e1");
  });

  it("een concepttest maakt de testkaart 'bezig' en linkt naar dat concept", () => {
    const p = progress({ assumptions: 1, experiments: [exp("e2", "draft")] }, { assumptions: 1, experiments: 1 });
    const plan = ideaTasks(p).phases[2].tasks[0];
    expect(plan.status).toBe("busy");
    expect(plan.path).toBe("/experiments/e2");
  });

  it("Besluit: eerst leerkaart, dan realiteitscheck, dan besluit", () => {
    const ended = { assumptions: 1, experiments: [exp("e1", "ended")], experimentsEnded: 1 };
    const d = { assumptions: 1, experiments: 1, experimentsEnded: 1, criticalWithPrimaryTest: 1, decisionRule: "saved" as const };
    expect(status(progress({ ...ended, learningCardsDraft: 1 }, d), "decide-learned")).toBe("busy");
    expect(status(progress({ ...ended, learningCardsApproved: 1 }, d), "decide-decision")).toBe("locked");
    const checked = progress({ ...ended, learningCardsApproved: 1, latestCardApprovedAt: "2026-11-01", latestRealityCheckAt: "2026-11-02" }, { ...d, testsWithVerdict: 1 });
    expect(status(checked, "decide-check")).toBe("done");
    expect(status(checked, "decide-decision")).toBe("todo");
    expect(ideaTasks(checked).next?.key).toBe("decide-decision");
  });

  it("nieuw bewijs na de realiteitscheck maakt de check weer 'bezig'", () => {
    const p = progress({ learningCardsApproved: 1, latestCardApprovedAt: "2026-11-05", latestRealityCheckAt: "2026-11-02" });
    expect(status(p, "decide-check")).toBe("busy");
  });

  it("na een definitief besluit staat de app op Rapport, niet op een oude stap", () => {
    const p = progress(
      { assumptions: 1, experiments: [exp("e1", "decided")], experimentsEnded: 1, learningCardsApproved: 1, latestRealityCheckAt: "2026-11-02", decisions: 1, latestDecisionAction: "continue" },
      { questions: 1, decisiveQuestion: { status: "answered", verifiedClaims: 1 }, verifiedClaims: 1, assumptions: 1, experiments: 1, experimentsEnded: 1, criticalWithPrimaryTest: 1, decisionRule: "saved", testsWithVerdict: 1, decisions: 1, latestDecisionAction: "continue" },
    );
    const list = ideaTasks(p);
    expect(list.current).toBe("report");
    expect(list.next?.key).toBe("report-read");
    expect(list.phases[3].status).toBe("done");
  });

  it("zonder beslisregeltabel (unknown) geen taak voor de beslisregel", () => {
    const keys = ideaTasks(progress({}, { decisionRule: "unknown" })).phases[1].tasks.map((t) => t.key);
    expect(keys).not.toContain("assumptions-rule");
  });

  it("optionele markttaken bepalen niet of de fase klaar is", () => {
    const p = progress({ questions: 1, verifiedClaims: 1 }, { questions: 1, verifiedClaims: 1, decisiveQuestion: { status: "answered", verifiedClaims: 1 } });
    expect(ideaTasks(p).phases[0].status).toBe("done");
  });

  it("taak zonder AI zegt dat ook (ai: null), een berekening heet nooit AI", () => {
    const decision = ideaTasks(progress()).phases[3].tasks.find((t) => t.key === "decide-decision")!;
    expect(decision.ai).toBeNull();
  });

  it("positie en volgende taak", () => {
    const list = ideaTasks(progress());
    expect(taskPosition(list, "decide-check")).toMatchObject({ index: 2, total: 3 });
    expect(taskAfter(list, "decide-decision")?.key).toBe("report-read");
  });
});

describe("ideaTasks na verder testen", () => {
  it("na 'verder testen' zonder nieuwe test: terug naar Testen, testkaart staat weer open", () => {
    const p = progress(
      { assumptions: 1, experiments: [exp("e1", "decided")], experimentsEnded: 1, learningCardsApproved: 1, latestRealityCheckAt: "2026-11-02", decisions: 1, latestDecisionAt: "2026-11-03", latestDecisionAction: "test_more", reports: 1 },
      { assumptions: 1, experiments: 1, experimentsEnded: 1, criticalWithPrimaryTest: 1, decisionRule: "saved", testsWithVerdict: 1, decisions: 1, latestDecisionAction: "test_more" },
    );
    const list = ideaTasks(p);
    expect(list.current).toBe("test");
    expect(list.next?.key).toBe("test-plan");
    expect(list.next?.why).toMatch(/volgende test/);
  });

  it("met een nieuwe test na het besluit telt de testkaart weer als klaar", () => {
    const e2 = { ...exp("e2", "ended"), startedAt: "2026-11-05" };
    const p = progress(
      { assumptions: 1, experiments: [exp("e1", "decided"), e2], experimentsEnded: 2, learningCardsApproved: 1, decisions: 1, latestDecisionAt: "2026-11-03", latestDecisionAction: "test_more" },
      { assumptions: 1, experiments: 2, experimentsEnded: 2, decisions: 1, latestDecisionAction: "test_more" },
    );
    expect(status(p, "test-plan")).toBe("done");
  });
});
