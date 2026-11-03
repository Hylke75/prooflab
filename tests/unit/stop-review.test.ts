import { describe, expect, it } from "vitest";
import { followUp, openMoment, outcomeDueForQuestion, outcomeQuestionFor, type MomentInput } from "@/lib/domain/forecast";
import { evaluateRules, type CoachFacts } from "@/lib/coach/rules";

// Golf B, punt 1: na een stop of pauze vervalt de uitkomstvraag; na zes maanden "Was stoppen achteraf terecht?".

const moment = (over: Partial<MomentInput> = {}): MomentInput => ({
  outcomeDefined: true,
  resolved: false,
  marketDone: true,
  experimentEnded: true,
  realityCheckDone: true,
  outcomeDue: "2027-05-03",
  clockStart: "2026-11-03",
  today: "2026-11-05",
  ...over,
});

function facts(over: Partial<CoachFacts> = {}): CoachFacts {
  return {
    ideaId: "00000000-0000-4000-8000-000000000001",
    today: "2027-05-04",
    now: Date.parse("2027-05-04T10:00:00Z"),
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
    decisions: [{ id: "d1", decidedAt: "2026-11-03T10:00:00Z", confirmed: true }],
    decisionDeadline: null,
    clientDeciderInvited: false,
    outcome: { defined: true, due: "2027-05-03", resolved: false, checkins: [], clockStart: "2026-11-03", question: "stop_review" },
    forecasts: [{ moment: "decision", kind: "consultant" }],
    outreach: { replies: 0, latestReplyAt: null, latestImportAt: null },
    baseRateChosen: true,
    ...over,
  };
}

describe("uitkomstvraag na stop of pauze", () => {
  it("kiest de stopvraag bij stoppen en pauzeren, anders de succesvraag", () => {
    expect(outcomeQuestionFor("stop")).toBe("stop_review");
    expect(outcomeQuestionFor("pause")).toBe("stop_review");
    expect(outcomeQuestionFor("continue")).toBe("success");
  });

  it("zet de stopvraag altijd zes maanden na het besluit, ook met een eerdere meetdatum", () => {
    expect(outcomeDueForQuestion("stop_review", "2026-11-03", "2027-02-01")).toBe("2027-05-03");
    expect(outcomeDueForQuestion("success", "2026-11-03", "2027-02-01")).toBe("2027-02-01");
  });

  it("sluit het voorspelmoment na een stop: er is geen slagingskans meer", () => {
    expect(openMoment(moment())).toBe("decision");
    expect(openMoment(moment({ stopped: true }))).toBeNull();
  });

  it("vraagt bij de stopvraag geen tussenstand, wel het antwoord na zes maanden", () => {
    const early = followUp({ outcomeDue: "2027-05-03", clockStart: "2026-11-03", checkins: 0, resolved: false, today: "2027-02-10", question: "stop_review" });
    expect(early).toEqual({ checkinDate: null, outcomeDate: "2027-05-03", checkinDue: false, outcomeDue: false });
    const due = followUp({ outcomeDue: "2027-05-03", clockStart: "2026-11-03", checkins: 0, resolved: false, today: "2027-05-03", question: "stop_review" });
    expect(due.outcomeDue).toBe(true);
    // De succesvraag houdt de tussenstand na drie maanden.
    expect(followUp({ outcomeDue: "2027-05-03", clockStart: "2026-11-03", checkins: 0, resolved: false, today: "2027-02-10" }).checkinDue).toBe(true);
  });

  it("de coach vraagt na zes maanden of stoppen terecht was, niet naar de uitkomst of de tussenstand", () => {
    const codes = evaluateRules(facts()).map((n) => n.code);
    expect(codes).toContain("stop_review_due");
    expect(codes).not.toContain("outcome_due");
    expect(codes.some((c) => c.startsWith("outcome_checkin"))).toBe(false);
    expect(evaluateRules(facts({ outcome: { ...facts().outcome, resolved: true } })).map((n) => n.code)).not.toContain("stop_review_due");
    expect(evaluateRules(facts({ outcome: { ...facts().outcome, question: "success" } })).map((n) => n.code)).toContain("outcome_due");
  });
});
