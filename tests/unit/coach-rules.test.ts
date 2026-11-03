import { describe, expect, it } from "vitest";
import {
  DONE_COOLDOWN_DAYS,
  evaluateRules,
  hypotheticalQuestions,
  openForecastMoment,
  planNoteChanges,
  projectedSample,
  RULES,
  ruleLabel,
  type CoachFacts,
  type StoredNote,
} from "@/lib/coach/rules";

const ID = "00000000-0000-4000-8000-000000000001";
const base = `/app/ideas/${ID}`;
const NOW = Date.parse("2026-11-03T10:00:00Z");
const DAY = 86_400_000;
const iso = (offsetDays: number) => new Date(NOW + offsetDays * DAY).toISOString();

// A calm dossier: research done with alternatives, nothing that should trigger a note.
function facts(over: Partial<CoachFacts> = {}): CoachFacts {
  return {
    ideaId: ID,
    today: "2026-11-03",
    now: NOW,
    sprint: null,
    claims: [{ id: "c1", statement: "Er zijn 41.230 vestigingen", exactSources: [{ sourceType: "official_statistic", isPrimary: true }] }],
    competitorKinds: ["direct", "status_quo"],
    sourceTypes: ["official_statistic", "review_site"],
    assumptions: [],
    experiments: [],
    interviews: [],
    observations: [],
    learningCards: [],
    realityCheck: null,
    decisions: [],
    decisionDeadline: null,
    clientDeciderInvited: false,
    outcome: { defined: true, due: null, resolved: false, checkins: [] },
    forecasts: [
      { moment: "intake", kind: "consultant" },
      { moment: "research", kind: "consultant" },
    ],
    outreach: { replies: 0, latestReplyAt: null, latestImportAt: null },
    baseRateChosen: true,
    ...over,
  };
}

type Exp = CoachFacts["experiments"][number];
function exp(over: Partial<Exp> = {}): Exp {
  return {
    id: "e1",
    title: "Landingspagina demo-aanvraag",
    type: "landing",
    state: "draft",
    startedAt: null,
    endsAt: null,
    n: 0,
    minSample: 80,
    locked: false,
    successThresholdPct: 15,
    failThresholdPct: 5,
    guide: [],
    ...over,
  };
}

const codes = (f: CoachFacts) => evaluateRules(f).map((n) => n.code);

describe("coach rules", () => {
  it("has at least fifteen rules and stays quiet on a calm dossier", () => {
    expect(Object.keys(RULES).length).toBeGreaterThanOrEqual(15);
    expect(evaluateRules(facts())).toEqual([]);
  });

  it("every note has a Dutch title, a short body and a link into the app", () => {
    const all = evaluateRules(
      facts({
        competitorKinds: [],
        claims: [{ id: "c", statement: "x".repeat(200), exactSources: [{ sourceType: "blog", isPrimary: false }] }, ...facts().claims, ...facts().claims],
        observations: [1, 2, 3].map(() => ({ kind: "opinion", isBehaviour: false, isSynthetic: false, createdAt: iso(-1) })),
        learningCards: [{ id: "l1", status: "draft", approvedAt: null }],
        decisionDeadline: "2026-11-05",
        sourceTypes: [],
      }),
    );
    expect(all.length).toBeGreaterThan(4);
    for (const n of all) {
      expect(n.href.startsWith("/app/")).toBe(true);
      expect(n.title.length).toBeGreaterThanOrEqual(3);
      expect(n.title.length).toBeLessThanOrEqual(160);
      expect(n.body.length).toBeLessThanOrEqual(400);
      expect(n.body.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 1).length).toBeLessThanOrEqual(3);
      expect(n.code.length).toBeLessThanOrEqual(80);
    }
  });

  it("asks for current alternatives once research has started", () => {
    expect(codes(facts({ competitorKinds: ["direct"] }))).toContain("alternatives_missing");
    expect(codes(facts({ claims: [], competitorKinds: [] }))).not.toContain("alternatives_missing");
    const n = evaluateRules(facts({ competitorKinds: [] })).find((x) => x.code === "alternatives_missing")!;
    expect(n.href).toBe(`${base}/research?tab=competitors`);
  });

  it("flags claims that rest on a single secondary source", () => {
    const weak = facts({ claims: [{ id: "c2", statement: "De markt groeit 12% per jaar", exactSources: [{ sourceType: "news", isPrimary: false }] }] });
    expect(codes(weak)).toContain("single_secondary_source");
    const two = facts({ claims: [{ id: "c2", statement: "De markt groeit", exactSources: [{ sourceType: "news", isPrimary: false }, { sourceType: "blog", isPrimary: false }] }] });
    expect(codes(two)).not.toContain("single_secondary_source");
  });

  it("warns about many opinions without behaviour, and praises the first behaviour once", () => {
    const opinions = [1, 2, 3].map(() => ({ kind: "opinion", isBehaviour: false, isSynthetic: false, createdAt: iso(-1) }));
    expect(codes(facts({ observations: opinions }))).toContain("opinions_no_behaviour");
    const synthetic = [{ kind: "deposit", isBehaviour: true, isSynthetic: true, createdAt: iso(-1) }];
    expect(codes(facts({ observations: [...opinions, ...synthetic] }))).toContain("opinions_no_behaviour");
    const real = [...opinions, { kind: "demo_request", isBehaviour: true, isSynthetic: false, createdAt: iso(-1) }];
    const c = codes(facts({ observations: real }));
    expect(c).not.toContain("opinions_no_behaviour");
    expect(c).toContain("praise_first_behaviour");
    expect(evaluateRules(facts({ observations: real })).find((n) => n.code === "praise_first_behaviour")?.once).toBe(true);
  });

  it("warns when a critical assumption is still untested in sprint week 3 or later", () => {
    const assumptions = [
      { id: "a1", statement: "Eventmanagers betalen €49 per maand", importance: 5, status: "untested" },
      { id: "a2", statement: "Minder belangrijk", importance: 2, status: "untested" },
    ];
    const week2 = facts({ assumptions, sprint: { week: 2, weeks: 5, state: "running", behindReason: null } });
    const week3 = facts({ assumptions, sprint: { week: 3, weeks: 5, state: "running", behindReason: null } });
    expect(codes(week2).some((c) => c.startsWith("critical_untested"))).toBe(false);
    expect(codes(week3)).toContain("critical_untested:a1");
  });

  it("extrapolates the pace of a live test and warns before it misses its minimum sample", () => {
    const slow = exp({ state: "live", startedAt: iso(-5), endsAt: iso(9), n: 10, minSample: 80 });
    expect(projectedSample(slow, NOW)?.projected).toBe(28);
    expect(codes(facts({ experiments: [slow] }))).toContain("test_pace:e1");
    const fast = exp({ state: "live", startedAt: iso(-5), endsAt: iso(9), n: 40, minSample: 80 });
    expect(codes(facts({ experiments: [fast] }))).not.toContain("test_pace:e1");
    const tooEarly = exp({ state: "live", startedAt: iso(-1), endsAt: iso(13), n: 0 });
    expect(codes(facts({ experiments: [tooEarly] }))).not.toContain("test_pace:e1");
  });

  it("spots hypothetical questions in an interview guide", () => {
    expect(hypotheticalQuestions(["Wanneer deed u dit voor het laatst?", "Zou u dit gebruiken?", "Stel dat het gratis is, wat dan?"])).toEqual([
      "Zou u dit gebruiken?",
      "Stel dat het gratis is, wat dan?",
    ]);
    expect(hypotheticalQuestions(["Hoe lost u dit nu op?", "Wat kostte dat u vorig jaar?"])).toEqual([]);
    const e = exp({ type: "interview", guide: ["Hoe gaat het nu?", "Zou je hiervoor betalen?", "Wat deed je toen?"] });
    expect(codes(facts({ experiments: [e] }))).toContain("interview_hypothetical:e1");
  });

  it("warns when more than half of the interviewees are acquaintances", () => {
    const i = (k: boolean) => ({ isAcquaintance: k });
    expect(codes(facts({ interviews: [i(true), i(true), i(false)] }))).toContain("acquaintances_majority");
    expect(codes(facts({ interviews: [i(true), i(false), i(false), i(true)] }))).not.toContain("acquaintances_majority");
  });

  it("asks to approve a waiting Learning Card and to redo a stale Reality Check", () => {
    expect(codes(facts({ learningCards: [{ id: "l1", status: "draft", approvedAt: null }] }))).toContain("learning_card_waiting");
    const rc = { id: "rc1", createdAt: iso(-3) };
    expect(codes(facts({ realityCheck: rc, learningCards: [{ id: "l1", status: "approved", approvedAt: iso(-1) }] }))).toContain("reality_check_stale:rc1");
    expect(codes(facts({ realityCheck: rc, learningCards: [{ id: "l1", status: "approved", approvedAt: iso(-5) }] }))).not.toContain("reality_check_stale:rc1");
  });

  it("warns about a decision deadline within seven days without a decision", () => {
    expect(codes(facts({ decisionDeadline: "2026-11-09" }))).toContain("decision_deadline:2026-11-09");
    expect(codes(facts({ decisionDeadline: "2026-11-20" }))).not.toContain("decision_deadline:2026-11-20");
    const past = evaluateRules(facts({ decisionDeadline: "2026-11-01" })).find((n) => n.code.startsWith("decision_deadline"));
    expect(past?.title).toMatch(/verstreken/);
    expect(codes(facts({ decisionDeadline: "2026-11-05", decisions: [{ id: "d1", decidedAt: iso(-1), confirmed: false }] })).some((c) => c.startsWith("decision_deadline"))).toBe(false);
  });

  it("explains a decision waiting for confirmation to everyone", () => {
    const n = evaluateRules(facts({ clientDeciderInvited: true, decisions: [{ id: "d1", decidedAt: iso(-1), confirmed: false }] })).find((x) => x.code === "decision_confirm:d1");
    expect(n?.audience).toBe("everyone");
    expect(n?.title).toBe("Er staat een besluit klaar om te bevestigen");
  });

  it("asks for a forecast at the open moment and for an outcome definition first", () => {
    expect(codes(facts({ outcome: { defined: false, due: null, resolved: false, checkins: [] } }))).toContain("outcome_undefined");
    const ended = facts({ experiments: [exp({ state: "ended" })] });
    expect(openForecastMoment(ended)).toBe("experiment");
    expect(codes(ended)).toContain("forecast:experiment");
    expect(codes(facts({ experiments: [exp({ state: "ended" })], forecasts: [{ moment: "experiment", kind: "consultant" }] }))).not.toContain("forecast:experiment");
    expect(openForecastMoment(facts({ claims: [], competitorKinds: [] }))).toBe("intake");
  });

  it("asks for a base rate before a forecast, never for a forecast the page refuses", () => {
    const ended = { experiments: [exp({ state: "ended" })] };
    for (const chosen of [false, undefined]) {
      const c = codes(facts({ ...ended, baseRateChosen: chosen }));
      expect(c).toContain("base_rate_missing");
      expect(c).not.toContain("forecast:experiment");
    }
    expect(evaluateRules(facts({ ...ended, baseRateChosen: false })).find((n) => n.code === "base_rate_missing")?.href).toBe(`${base}/outcome#basispercentage`);
    expect(codes(facts({ ...ended, baseRateChosen: true }))).toContain("forecast:experiment");
    // Geen open moment of al voorspeld: ook geen basispercentage-tip uit deze regel.
    expect(codes(facts({ baseRateChosen: false, outcome: { defined: true, due: null, resolved: true, checkins: [] } }))).not.toContain("base_rate_missing");
  });

  it("reminds about the three-month check-in and the outcome date", () => {
    const decided = { decisions: [{ id: "d1", decidedAt: iso(-100), confirmed: true }] };
    expect(codes(facts({ ...decided, forecasts: [{ moment: "decision", kind: "consultant" }] }))).toContain("outcome_checkin:d1");
    expect(codes(facts({ ...decided, outcome: { defined: true, due: null, resolved: false, checkins: [iso(-20)] } }))).not.toContain("outcome_checkin:d1");
    const due = codes(facts({ ...decided, outcome: { defined: true, due: "2026-11-01", resolved: false, checkins: [] } }));
    expect(due).toContain("outcome_due");
    expect(due).not.toContain("outcome_checkin:d1");
  });

  it("reports a sprint that is behind, and nudges towards customer signals", () => {
    const n = evaluateRules(facts({ sprint: { week: 3, weeks: 5, state: "running", behindReason: "Week 3: er loopt nog geen test." } })).find((x) => x.code === "sprint_behind:w3");
    expect(n?.body).toMatch(/^Week 3: er loopt nog geen test\./);
    const threeClaims = [...facts().claims, ...facts().claims, ...facts().claims].map((c, i) => ({ ...c, id: `c${i}` }));
    expect(codes(facts({ claims: threeClaims, sourceTypes: ["official_statistic"] }))).toContain("no_customer_voice");
    expect(codes(facts({ outreach: { replies: 2, latestReplyAt: iso(-1), latestImportAt: iso(-3) } }))).toContain("outreach_unimported");
    expect(codes(facts({ outreach: { replies: 2, latestReplyAt: iso(-3), latestImportAt: iso(-1) } }))).not.toContain("outreach_unimported");
  });

  it("praises a properly pre-registered test", () => {
    expect(codes(facts({ experiments: [exp({ state: "approved", locked: true })] }))).toContain("praise_prereg:e1");
    expect(codes(facts({ experiments: [exp({ state: "approved", locked: true, failThresholdPct: null })] }))).not.toContain("praise_prereg:e1");
  });
});

describe("reconciling rule output with stored notes", () => {
  const draft = evaluateRules(facts({ competitorKinds: [] }));
  const note = (over: Partial<StoredNote>): StoredNote => ({ id: "n1", code: "alternatives_missing", source: "rules", status: "open", resolvedAt: null, ...over });

  it("creates a note once while it is open", () => {
    expect(planNoteChanges(draft, [], NOW).create.map((d) => d.code)).toEqual(["alternatives_missing"]);
    expect(planNoteChanges(draft, [note({})], NOW).create).toEqual([]);
  });

  it("closes its own open note when the condition is gone, but leaves AI notes alone", () => {
    const plan = planNoteChanges([], [note({}), note({ id: "n2", code: "ai:pricing", source: "ai" })], NOW);
    expect(plan.close).toEqual(["n1"]);
  });

  it("respects the consultant: dismissed stays silent, done waits a week, once means once", () => {
    expect(planNoteChanges(draft, [note({ status: "dismissed", resolvedAt: iso(-30) })], NOW).create).toEqual([]);
    expect(planNoteChanges(draft, [note({ status: "done", resolvedAt: iso(-1) })], NOW).create).toEqual([]);
    expect(planNoteChanges(draft, [note({ status: "done", resolvedAt: iso(-(DONE_COOLDOWN_DAYS + 1)) })], NOW).create).toHaveLength(1);
    const praise = evaluateRules(facts({ observations: [{ kind: "deposit", isBehaviour: true, isSynthetic: false, createdAt: iso(-1) }] }));
    const old = { id: "p", code: "praise_first_behaviour", source: "rules", status: "done", resolvedAt: iso(-60) };
    expect(planNoteChanges(praise, [old], NOW).create.map((d) => d.code)).not.toContain("praise_first_behaviour");
  });
});

describe("starting calibration: forecast_overconfident", () => {
  const br = { low: 0.1, high: 0.4 }; // midpoint 25%
  const calm = (over: Partial<CoachFacts> = {}) =>
    facts({
      baseRate: br,
      orgResolved: 3,
      forecasts: [
        { moment: "intake", kind: "consultant", probability: 0.3 },
        { moment: "research", kind: "consultant", probability: 0.35 },
      ],
      ...over,
    });

  it("stays quiet when forecasts are near the base rate", () => {
    expect(evaluateRules(calm())).toEqual([]);
  });

  it("asks about a forecast more than 25 points from the base rate, at the latest such moment", () => {
    const f = calm({
      forecasts: [
        { moment: "intake", kind: "consultant", probability: 0.8 },
        { moment: "research", kind: "client", probability: 0.6 },
      ],
    });
    const n = evaluateRules(f).find((x) => x.code.startsWith("forecast_overconfident"))!;
    expect(n.code).toBe("forecast_overconfident:research");
    expect(n.kind).toBe("question");
    expect(n.audience).toBe("consultant");
    expect(n.href).toBe(`${base}/outcome#kalibratiehulp`);
    expect(n.body).toMatch(/basispercentage/);
    expect(n.body).toContain("(10–40%)");
    // Blind rule: the note names no value, person or direction.
    expect(n.body).not.toMatch(/60%|80%|hoger|lager|opdrachtgever/i);
    expect(n.body.length).toBeLessThanOrEqual(400);
    expect(n.body.split(/[.!?](\s|$)/).filter((s) => s && s.trim().length > 1).length).toBeLessThanOrEqual(3);
  });

  it("is silent once a behaviour test ended, without a base rate, with ten own outcomes, or after resolution", () => {
    const far: Partial<CoachFacts> = { forecasts: [{ moment: "research", kind: "consultant", probability: 0.9 }] };
    const code = "forecast_overconfident:research";
    expect(codes(calm(far))).toContain(code);
    expect(codes(calm({ ...far, experiments: [exp({ type: "pricing", state: "ended" })] }))).not.toContain(code);
    // An interview is not behaviour; a landing page still running has not ended.
    expect(codes(calm({ ...far, experiments: [exp({ type: "interview", state: "ended" }), exp({ id: "e2", type: "landing", state: "live" })] }))).toContain(code);
    expect(codes(calm({ ...far, baseRate: null }))).not.toContain(code);
    expect(codes(calm({ ...far, orgResolved: 10 }))).not.toContain(code);
    expect(codes(calm({ ...far, outcome: { defined: true, due: null, resolved: true, checkins: [] } }))).not.toContain(code);
  });

  it("ignores AI forecasts and forecasts without a visible probability", () => {
    const f = calm({ forecasts: [{ moment: "research", kind: "ai", probability: 0.95 }, { moment: "research", kind: "consultant" }] });
    expect(codes(f)).not.toContain("forecast_overconfident:research");
  });

  it("has a Dutch label for every rule on the learning page", () => {
    for (const code of Object.keys(RULES)) {
      const prefix = code === "praise_preregistered" ? "praise_prereg" : code === "forecast_missing" ? "forecast" : code;
      expect(ruleLabel(prefix)).not.toBe(prefix);
    }
    expect(ruleLabel("ai")).toBe("AI-coach");
    expect(ruleLabel("onbekend")).toBe("onbekend");
  });
});
