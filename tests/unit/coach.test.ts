import { describe, expect, it } from "vitest";
import { coachFor, nextAction, sprintStage, type ExperimentSummary, type IdeaProgress } from "@/lib/domain/coach";
import { addDays, phaseOfWeek, sprintMilestones, sprintStatus, testDay, todayInNL } from "@/lib/domain/sprint";

const ID = "00000000-0000-4000-8000-000000000001";
const base = `/app/ideas/${ID}`;

// A dossier with research and assumptions done, no tests yet.
function progress(over: Partial<IdeaProgress> = {}): IdeaProgress {
  return {
    ideaId: ID,
    questions: 4,
    claims: 6,
    verifiedClaims: 3,
    weakClaims: 0,
    competitors: 3,
    hasAlternatives: true,
    segments: 2,
    sizingEstablished: true,
    assumptions: 4,
    assumptionsWithoutEvidence: 0,
    untestedCritical: 1,
    topAssumption: { id: "a1", statement: "Eventmanagers betalen hiervoor", evidence: 0.1 },
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
    latestDecisionConfirmed: false,
    reports: 0,
    latestReportAt: null,
    latestReportShared: false,
    behaviourObservations: 0,
    ...over,
  };
}

const exp = (state: string, over: Partial<ExperimentSummary> = {}): ExperimentSummary => ({
  id: `e-${state}`,
  title: `Test ${state}`,
  state,
  startedAt: null,
  endsAt: null,
  hasApprovedCard: false,
  ...over,
});

// Dossier after one finished test with an approved card.
const learned = (over: Partial<IdeaProgress> = {}) =>
  progress({
    experiments: [exp("analyzed", { hasApprovedCard: true })],
    experimentsEnded: 1,
    learningCardsApproved: 1,
    latestCardApprovedAt: "2026-10-20T10:00:00Z",
    behaviourObservations: 3,
    ...over,
  });

describe("nextAction", () => {
  it("starts with the research map, sources and alternatives", () => {
    expect(nextAction(progress({ questions: 0 })).title).toBe("Maak de onderzoekskaart");
    expect(nextAction(progress({ claims: 0 })).href).toBe(`${base}/research?tab=sources`);
    expect(nextAction(progress({ hasAlternatives: false })).href).toBe(`${base}/research?tab=competitors`);
    expect(nextAction(progress({ assumptions: 0, topAssumption: null })).title).toBe("Maak je aannames zichtbaar");
  });

  it("points at a test for the biggest uncertainty when there are no experiments", () => {
    const a = nextAction(progress());
    expect(a.title).toBe("Toets de grootste onzekerheid");
    expect(a.href).toBe(`${base}/experiments?assumption=a1`);
  });

  it("walks a Test Card through draft, review and approval to publication", () => {
    expect(nextAction(progress({ experiments: [exp("draft")] }))).toMatchObject({
      title: "Rond je Test Card af en zet hem ter review",
      href: `${base}/experiments/e-draft`,
    });
    expect(nextAction(progress({ experiments: [exp("ready_for_review")] })).title).toBe("Keur de Test Card goed");
    expect(nextAction(progress({ experiments: [exp("approved")] })).title).toBe("Publiceer de test");
    // The most advanced card leads.
    expect(nextAction(progress({ experiments: [exp("draft"), exp("approved")] })).title).toBe("Publiceer de test");
  });

  it("asks for recruitment while a test is live, and for a decision on a paused test", () => {
    expect(nextAction(progress({ experiments: [exp("live"), exp("draft")] })).title).toBe("Werf deelnemers voor je lopende test");
    expect(nextAction(progress({ experiments: [exp("paused")] })).title).toBe("Hervat of beëindig de gepauzeerde test");
  });

  it("asks for a Learning Card after a test ends", () => {
    const a = nextAction(progress({ experiments: [exp("ended")], experimentsEnded: 1 }));
    expect(a.title).toBe("Leg vast wat je hebt geleerd");
    expect(a.href).toBe(`${base}/experiments/e-ended`);
    expect(nextAction(progress({ experiments: [exp("ended")], experimentsEnded: 1, learningCardsDraft: 1 })).href).toBe(`${base}/evidence`);
  });

  it("requires a Reality Check after an approved card, also when an older check exists", () => {
    expect(nextAction(learned()).title).toBe("Doe de Reality Check");
    expect(nextAction(learned({ latestRealityCheckAt: "2026-10-10T10:00:00Z" })).title).toBe("Doe de Reality Check");
  });

  it("asks for the decision once the check is newer than the card", () => {
    expect(nextAction(learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z" })).title).toBe("Neem het besluit");
  });

  it("makes the first report when none exists", () => {
    const p = learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", decisions: 1, latestDecisionAt: "2026-10-22T10:00:00Z" });
    expect(nextAction(p)).toMatchObject({ title: "Maak het eerste rapport", href: `${base}/report` });
  });

  it("only says 'Werk het rapport bij' when a decision is newer than the latest report", () => {
    const decided = { latestRealityCheckAt: "2026-10-21T10:00:00Z", decisions: 1, latestDecisionAt: "2026-10-22T10:00:00Z", reports: 1 };
    expect(nextAction(learned({ ...decided, latestReportAt: "2026-10-21T12:00:00Z" })).title).toBe("Werk het rapport bij");
    const fresh = nextAction(learned({ ...decided, latestReportAt: "2026-10-23T09:00:00Z" }));
    expect(fresh.title).not.toBe("Werk het rapport bij");
    expect(fresh.title).toBe("Deel het rapport met de opdrachtgever");
  });

  it("waits for the client, then moves on to the next assumption", () => {
    const done = {
      latestRealityCheckAt: "2026-10-21T10:00:00Z",
      decisions: 1,
      latestDecisionAt: "2026-10-22T10:00:00Z",
      reports: 1,
      latestReportAt: "2026-10-23T09:00:00Z",
      latestReportShared: true,
    };
    expect(nextAction(learned(done)).title).toBe("Wacht op bevestiging van het besluit");
    expect(nextAction(learned({ ...done, latestDecisionConfirmed: true })).title).toBe("Kies de volgende aanname om te toetsen");
  });
});

describe("coachFor", () => {
  it("gives at most three suggestions, specific to the screen", () => {
    const p = progress({ weakClaims: 2, segments: 0, sizingEstablished: false, hasAlternatives: false });
    const c = coachFor("research", p);
    expect(c.suggestions.length).toBeLessThanOrEqual(3);
    expect(c.suggestions.every((s) => s.href.startsWith(`${base}/research`))).toBe(true);
    expect(c.insight).toContain("onvoldoende bewijs");
  });

  it("points the experiments screen at the card that needs work", () => {
    const c = coachFor("experiments", progress({ experiments: [exp("ready_for_review")] }));
    expect(c.suggestions[0]).toMatchObject({ label: "Keur de Test Card goed", href: `${base}/experiments/e-ready_for_review` });
  });

  it("points the report screen at the first report", () => {
    const c = coachFor("report", learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", decisions: 1, latestDecisionAt: "2026-10-22T10:00:00Z" }));
    expect(c.suggestions[0].label).toBe("Maak het eerste rapport");
  });

  it("explains instead of assigning work to a client", () => {
    const c = coachFor("evidence", learned({ decisions: 1, latestDecisionAt: "2026-10-22T10:00:00Z" }), { audience: "client", isClientDecider: true });
    expect(c.audience).toBe("client");
    expect(c.suggestions[0].label).toBe("Bekijk en bevestig het besluit");
    expect(c.suggestions.some((s) => /Test Card|Reality Check doen|Publiceer/.test(s.label))).toBe(false);
    expect(c.suggestions.length).toBeLessThanOrEqual(3);
  });
});

describe("sprint", () => {
  it("lays out the milestones of a 4, 5 and 6 week sprint", () => {
    const span = (w: number) => sprintMilestones(w).map((m) => `${m.phase}:${m.fromWeek}-${m.toWeek}`).join(" ");
    expect(span(4)).toBe("research:1-1 assumptions:2-2 test:3-3 decide:4-4");
    expect(span(5)).toBe("research:1-1 assumptions:2-2 test:3-4 decide:5-5");
    expect(span(6)).toBe("research:1-1 assumptions:2-2 test:3-5 decide:6-6");
    expect(phaseOfWeek(5, 5)).toBe("decide");
  });

  it("computes the current week and the end date", () => {
    const s = sprintStatus({ start: "2026-10-19", weeks: 5, today: "2026-10-29", stage: 2, testsStarted: false });
    expect(s).toMatchObject({ planned: true, state: "running", week: 2, weeks: 5, phase: "assumptions", endDate: "2026-11-22", behind: false });
  });

  it("flags a dossier that lags the week", () => {
    const s = sprintStatus({ start: "2026-10-12", weeks: 5, today: "2026-10-29", stage: 2, testsStarted: false });
    expect(s.planned && s.week).toBe(3);
    expect(s.planned && s.behind).toBe(true);
    const research = sprintStatus({ start: "2026-10-19", weeks: 5, today: "2026-10-29", stage: 1, testsStarted: false });
    expect(research.planned && research.behind).toBe(true);
  });

  it("flags testing weeks without a live test", () => {
    const s = sprintStatus({ start: "2026-10-12", weeks: 5, today: "2026-10-29", stage: 3, testsStarted: false });
    expect(s.planned && s.behindReason).toContain("nog geen test");
    const ok = sprintStatus({ start: "2026-10-12", weeks: 5, today: "2026-10-29", stage: 3, testsStarted: true });
    expect(ok.planned && ok.behind).toBe(false);
  });

  it("handles sprints that have not started or are over", () => {
    const early = sprintStatus({ start: "2026-11-02", weeks: 4, today: "2026-10-29", stage: 1, testsStarted: false });
    expect(early).toMatchObject({ state: "not_started", week: 1, daysToStart: 4, behind: false });
    const late = sprintStatus({ start: "2026-09-01", weeks: 4, today: "2026-10-29", stage: 4, testsStarted: true });
    expect(late).toMatchObject({ state: "finished", week: 4, behind: true });
    expect(sprintStatus({ start: null, weeks: 5, today: "2026-10-29", stage: 1, testsStarted: false })).toEqual({ planned: false });
  });

  it("derives the stage from the dossier", () => {
    expect(sprintStage(progress({ claims: 0 }))).toBe(1);
    expect(sprintStage(progress())).toBe(2);
    expect(sprintStage(progress({ experiments: [exp("live")], experimentsLive: 1 }))).toBe(3);
    expect(sprintStage(learned())).toBe(4);
    expect(sprintStage(learned({ decisions: 1, latestDecisionAt: "2026-10-22T10:00:00Z", reports: 1, latestReportAt: "2026-10-23T10:00:00Z" }))).toBe(5);
  });

  it("counts test days and calendar dates", () => {
    expect(testDay("2026-10-20T10:00:00Z", "2026-11-03T10:00:00Z", new Date("2026-10-22T12:00:00Z"))).toEqual({ day: 3, of: 14 });
    expect(testDay(null, "2026-11-03T10:00:00Z")).toBeNull();
    expect(addDays("2026-10-30", 3)).toBe("2026-11-02");
    expect(todayInNL(new Date("2026-10-29T23:30:00Z"))).toBe("2026-10-30");
  });
});
