import { describe, expect, it } from "vitest";
import { coachFor, nextAction, predictionTip, sprintStage, type ExperimentSummary, type IdeaProgress } from "@/lib/domain/coach";
import type { ForecastState } from "@/lib/domain/forecast";
import { addDays, phaseOfWeek, sprintMilestones, sprintStatus, testDay, todayInNL } from "@/lib/domain/sprint";

const ID = "00000000-0000-4000-8000-000000000001";
const base = `/app/ideas/${ID}`;

// A dossier with research and assumptions done, no tests yet.
function progress(over: Partial<IdeaProgress> = {}): IdeaProgress {
  const base: IdeaProgress = {
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
  // Fase B1c: de dossierstatus volgt uit dezelfde tellers. Markt is klaar met een beantwoorde beslissende vraag
  // met geverifieerde bron; aannames zijn klaar zodra er een hoofdtest is (hier: zodra er een test bestaat).
  return {
    ...base,
    dossier: over.dossier ?? {
      questions: base.questions,
      claims: base.claims,
      verifiedClaims: base.verifiedClaims,
      decisiveQuestion: base.claims > 0 && base.verifiedClaims > 0 ? { status: "answered", verifiedClaims: 1 } : base.questions > 0 ? { status: "open", verifiedClaims: 0 } : null,
      assumptions: base.assumptions,
      criticalWithPrimaryTest: base.experiments.length > 0 ? 1 : 0,
      assumptionsWithEvidence: base.assumptions - base.assumptionsWithoutEvidence,
      experiments: base.experiments.length,
      experimentsLive: base.experimentsLive,
      experimentsEnded: base.experimentsEnded,
      realTestObservations: base.behaviourObservations,
      decisions: base.decisions,
    },
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

describe("prediction loop in the coach", () => {
  const f = (over: Partial<ForecastState> = {}): ForecastState => ({
    outcomeDefined: true,
    baseRateChosen: true,
    outcomeDue: null,
    ownMoments: ["intake", "research"],
    checkins: 0,
    resolved: false,
    today: "2026-11-03",
    ...over,
  });

  it("leaves the existing route untouched when the prediction schema is absent", () => {
    expect(nextAction(progress()).title).toBe("Toets de grootste onzekerheid");
    expect(nextAction(progress({ forecast: f() })).title).toBe("Toets de grootste onzekerheid");
  });

  it("keeps the sprint order in week 1: research first, defining success is a side tip", () => {
    const week1 = progress({ questions: 0, forecast: f({ outcomeDefined: false, ownMoments: [] }) });
    expect(nextAction(week1)).toMatchObject({ title: "Maak de onderzoekskaart", href: `${base}/research` });
    expect(predictionTip(week1)).toMatchObject({ title: "Leg vast wanneer dit geslaagd is", href: `${base}/outcome#definitie` });
    expect(coachFor("dashboard", week1).suggestions.map((s) => s.label)).toEqual(["Maak de onderzoekskaart", "Nieuw idee onderzoeken", "Leg vast wanneer dit geslaagd is"]);
  });

  it("asks for a forecast only as a side tip, and only once a base rate is chosen", () => {
    expect(nextAction(progress({ forecast: f({ ownMoments: ["intake"] }) })).title).toBe("Toets de grootste onzekerheid");
    expect(predictionTip(progress({ forecast: f({ ownMoments: ["intake"] }) }))).toMatchObject({ title: "Geef je voorspelling", href: `${base}/outcome#voorspelling` });
    expect(predictionTip(progress({ claims: 0, forecast: f({ ownMoments: [] }) }))!.detail).toContain("Na de intake");
    expect(predictionTip(progress({ forecast: f({ baseRateChosen: false, ownMoments: [] }) }))).toMatchObject({ title: "Kies een basispercentage", href: `${base}/outcome#basispercentage` });
  });

  it("makes the prediction loop the main action at the decision moment", () => {
    const atDecision = learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", forecast: f() });
    expect(nextAction(atDecision)).toMatchObject({ title: "Geef je voorspelling", href: `${base}/evidence#voorspelling` });
    expect(coachFor("evidence", atDecision).suggestions.map((s) => s.label)).toEqual(expect.arrayContaining(["Geef je voorspelling", "Neem het besluit"]));
    expect(nextAction(learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", forecast: f({ baseRateChosen: false }) })).title).toBe("Kies een basispercentage");
    expect(nextAction(learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", forecast: f({ outcomeDefined: false }) })).title).toBe("Leg vast wanneer dit geslaagd is");
    expect(nextAction(learned({ latestRealityCheckAt: "2026-10-21T10:00:00Z", forecast: f({ ownMoments: ["decision"] }) })).title).toBe("Neem het besluit");
  });

  it("asks for the check-in after three months and the outcome after six", () => {
    const decided = { latestRealityCheckAt: "2026-10-21T10:00:00Z", decisions: 1, latestDecisionAt: "2026-11-03T10:00:00Z" };
    const due = "2027-05-03";
    expect(nextAction(learned({ ...decided, forecast: f({ outcomeDue: due, today: "2027-01-10", ownMoments: ["decision"] }) })).title).not.toMatch(/tussenstand|uitkomst/i);
    expect(nextAction(learned({ ...decided, forecast: f({ outcomeDue: due, today: "2027-02-03" }) }))).toMatchObject({ title: "Geef de tussenstand", href: `${base}/outcome#tussenstand` });
    expect(nextAction(learned({ ...decided, forecast: f({ outcomeDue: due, today: "2027-05-03" }) }))).toMatchObject({ title: "Leg de uitkomst vast", href: `${base}/outcome#uitkomst` });
    expect(nextAction(learned({ ...decided, forecast: f({ outcomeDue: due, today: "2027-06-01", checkins: 1, resolved: true }) })).title).not.toBe("Leg de uitkomst vast");
  });

  it("invites a client to forecast without assigning research work", () => {
    const c = coachFor("research", progress({ forecast: f({ ownMoments: [] }) }), { audience: "client" });
    expect(c.suggestions[0]).toMatchObject({ label: "Geef uw voorspelling", href: `${base}/outcome#voorspelling` });
    expect(c.suggestions.length).toBeLessThanOrEqual(3);
  });

  it("points the outcome page at the base rate when it is missing", () => {
    const c = coachFor("outcome", progress({ forecast: f({ baseRateChosen: false, ownMoments: [] }) }));
    expect(c.suggestions.map((s) => s.label)).toContain("Kies een basispercentage");
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

describe("dossieroverzicht", () => {
  it("toont vier stappen met aantallen en markeert één huidige stap", async () => {
    const { stepOverview } = await import("@/lib/steps");
    const steps = stepOverview(progress());
    expect(steps.map((s) => s.key)).toEqual(["market", "assumptions", "test", "decide"]);
    expect(steps.filter((s) => s.current).map((s) => s.key)).toEqual(["assumptions"]);
    expect(steps[0].counts).toBe("4 onderzoeksvragen · 6 bevindingen (3 geverifieerd)");
    expect(steps[2]).toMatchObject({ done: false, counts: "0 tests · 0 lopend · 0 afgerond", href: `${base}/experiments` });
    expect(stepOverview(progress({ claims: 0 })).find((s) => s.current)?.key).toBe("market");
  });
});

describe("coach per pagina (fase 3)", () => {
  it("verwijst op werkruimtepagina's naar het lopende idee in plaats van 'Begin met één idee'", () => {
    const c = coachFor("clients", null, { currentIdea: { id: ID, title: "AI-locatieadvies" } });
    expect(c.insight).toContain("AI-locatieadvies");
    expect(c.insight).not.toContain("Begin met één idee");
    expect(c.suggestions[0]).toMatchObject({ label: "Verder met AI-locatieadvies", href: base });
    // Zonder ideeën blijft het startadvies.
    expect(coachFor("clients", null).insight).toContain("Begin met één idee");
  });

  it("heeft voor Bronnen & koppelingen een eigen tekst en eigen suggesties", () => {
    const research = coachFor("research", progress());
    const integrations = coachFor("integrations", progress());
    expect(integrations.title).not.toBe(research.title);
    expect(integrations.copy).not.toBe(research.copy);
    expect(integrations.suggestions.map((s) => s.href)).toContain(`${base}/integrations#bulk-import`);
    expect(coachFor("integrations", progress(), { audience: "client" }).title).toBe("Wat zeggen klanten zelf?");
  });
});
