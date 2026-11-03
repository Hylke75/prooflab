import { describe, expect, it } from "vitest";
import {
  assessResponse,
  countResponses,
  isQualified,
  keyMetric,
  looksFixed,
  minimumDurationMs,
  presentOptions,
  presentQuestions,
  PublicSurveyConfigSchema,
  responseStatus,
  straightlined,
  summarise,
  SurveyConfigSchema,
  templateSurvey,
  validateAnswers,
  type Answers,
  type ResponseRow,
  type SurveyConfig,
} from "@/lib/domain/survey";
import { cleanShare, openAnswers, shareableQuestions, sharedSummaries, surveyCsv, surveySplit, surveySplitFromCounts } from "@/lib/domain/survey-results";
import { addAttentionCheck, metricFromKey, removeOption, setAttention, setKeyQuestion, setScreening, setShuffle, surveyErrors, toggleQualifying } from "@/lib/domain/survey-editor";
import { answersToClear, planSentence, planSurveySample } from "@/lib/domain/survey-plan";
import { sanitiseDraft, templateDraft, type DraftQuestion, type RawDraft } from "@/lib/domain/survey-draft";
import { verdict, wilson } from "@/lib/domain/stats";

const input = { assumption: "MKB-ondernemers zoeken actief naar hulp", audience: "MKB-ondernemers", researcher: "Link & Lead", product: "ProofLab" };
const screened = () => templateSurvey({ ...input, screen: true });

// Four scale questions and an attention check on top of the screened template.
function full(): SurveyConfig {
  let c = screened();
  const scale = (id: string) => ({ id, type: "scale" as const, text: `Hoeveel last had u van onderdeel ${id}?`, required: true, scale: { min: 1, max: 5, minLabel: "Geen", maxLabel: "Veel" } });
  c = { ...c, questions: [...c.questions, scale("s2"), scale("s3"), scale("s4")] };
  return addAttentionCheck(c);
}
const checkId = (c: SurveyConfig) => c.questions.find((q) => q.attention)!.id;

const goodAnswers = (c: SurveyConfig, over: Answers = {}): Answers => ({
  laatst: "maand",
  gezocht: "ja_betaald",
  last: 4,
  s2: 2,
  s3: 3,
  s4: 5,
  [checkId(c)]: "o2",
  ...over,
});

describe("screening question", () => {
  it("is valid only as the first choice question that is not the key question, with some (not all) answers qualifying", () => {
    const c = screened();
    expect(SurveyConfigSchema.safeParse(c).success).toBe(true);
    const notFirst = { ...c, questions: [c.questions[2], c.questions[0], c.questions[1], ...c.questions.slice(3)] };
    expect(surveyErrors(notFirst)).toEqual(["De screeningsvraag moet de eerste vraag zijn."]);
    expect(SurveyConfigSchema.safeParse({ ...c, screening: { question: "laatst", qualifying: ["week", "maand", "kwartaal", "langer", "nooit"] } }).success).toBe(false);
    expect(SurveyConfigSchema.safeParse({ ...c, screening: { question: "last", qualifying: ["week"] } }).success).toBe(false);
    expect(surveyErrors({ ...c, screening: { question: "laatst", qualifying: [] } })).toContain("Vink bij de screeningsvraag minstens één antwoord aan dat bij de doelgroep hoort.");
    expect(isQualified(c, { laatst: "week" })).toBe(true);
    expect(isQualified(c, { laatst: "nooit" })).toBe(false);
    expect(isQualified(c, {})).toBe(false);
    expect(isQualified(templateSurvey(input), {})).toBe(true);
  });

  it("stops validating after a non-qualifying screening answer and drops later answers", () => {
    const c = screened();
    const out = validateAnswers(c, { laatst: "nooit", gezocht: "ja_betaald" });
    expect(out).toEqual({ ok: true, answers: { laatst: "nooit" }, screenedOut: true });
    const inside = validateAnswers(c, { laatst: "week", gezocht: "nee", last: 2 });
    expect(inside.ok && inside.screenedOut).toBe(false);
    // Without the screening answer nothing is accepted.
    expect(validateAnswers(c, { gezocht: "nee", last: 2 }).ok).toBe(false);
    // The public config (no qualifying options) never screens anyone out in the browser.
    const pub = PublicSurveyConfigSchema.parse({ ...c, screening: { question: "laatst" } });
    expect(validateAnswers(pub, { laatst: "nooit", gezocht: "nee", last: 2 })).toMatchObject({ ok: true, screenedOut: false });
  });

  it("the public schema accepts the stripped config of get_public_survey", () => {
    const c = full();
    const rest: Record<string, unknown> = { ...c, screening: { question: c.screening!.question } };
    delete rest.key_question;
    delete rest.success_options;
    rest.questions = c.questions.map((q) => {
      const copy: Record<string, unknown> = { ...q };
      delete copy.attention;
      return copy;
    });
    expect(PublicSurveyConfigSchema.safeParse(rest).success).toBe(true);
    expect(SurveyConfigSchema.safeParse(rest).success).toBe(false);
  });
});

describe("option order per respondent", () => {
  const options = ["a", "b", "c", "d", "e"].map((id) => ({ id, label: id.toUpperCase() })).concat([{ id: "x", label: "Weet ik niet", fixed: true } as never]);

  it("is deterministic per seed, keeps fixed options in place and differs between respondents", () => {
    const one = presentOptions(options, true, "visitor-1:q1");
    expect(presentOptions(options, true, "visitor-1:q1")).toEqual(one);
    expect(one.at(-1)?.id).toBe("x");
    expect(one.map((o) => o.id).sort()).toEqual(["a", "b", "c", "d", "e", "x"]);
    const orders = new Set(Array.from({ length: 20 }, (_, i) => presentOptions(options, true, `v${i}`).map((o) => o.id).join("")));
    expect(orders.size).toBeGreaterThan(5);
    expect(presentOptions(options, false, "v1")).toBe(options);
  });

  it("only shuffles choice questions marked shuffle", () => {
    const c = templateSurvey(input);
    const shown = presentQuestions(c.questions, "token-abc");
    expect(shown.find((q) => q.id === "laatst")?.options).toEqual(c.questions.find((q) => q.id === "laatst")?.options);
    expect(shown.find((q) => q.id === "gezocht")?.options?.map((o) => o.id).sort()).toEqual(["ja_betaald", "ja_gezocht", "nee"]);
    expect(SurveyConfigSchema.safeParse({ ...c, questions: c.questions.map((q) => (q.id === "last" ? { ...q, shuffle: true } : q)) }).success).toBe(false);
  });

  it("recognises options that belong at the end", () => {
    for (const l of ["Anders", "Anders, namelijk", "Weet ik niet", "Weet niet", "Geen van deze", "N.v.t.", "Zeg ik liever niet"]) expect(looksFixed(l)).toBe(true);
    for (const l of ["Andersom", "Nooit", "Ja", "In de afgelopen week"]) expect(looksFixed(l)).toBe(false);
  });
});

describe("believability", () => {
  const c = full();
  const slow = minimumDurationMs(c) + 1000;

  it("accepts a careful response", () => {
    expect(SurveyConfigSchema.safeParse(c).success).toBe(true);
    expect(assessResponse(c, goodAnswers(c), slow)).toEqual({ qualified: true, quality: "ok" });
  });

  it("flags screened-out, too fast, failed attention check and straightlining, in that order", () => {
    expect(assessResponse(c, { laatst: "nooit" }, 1000)).toEqual({ qualified: false, quality: "ok" });
    expect(assessResponse(c, goodAnswers(c, { [checkId(c)]: "o3" }), 1000).quality).toBe("too_fast");
    expect(assessResponse(c, goodAnswers(c, { [checkId(c)]: "o3" }), slow).quality).toBe("attention");
    expect(assessResponse(c, goodAnswers(c, { last: 3, s2: 3, s3: 3, s4: 3 }), slow).quality).toBe("straightlining");
    expect(assessResponse(c, goodAnswers(c, { [checkId(c)]: "o3", last: 3, s2: 3, s3: 3, s4: 3 }), slow).quality).toBe("attention");
    expect(assessResponse(c, goodAnswers(c), null).quality).toBe("ok");
  });

  it("needs at least four answered scale questions for straightlining", () => {
    expect(straightlined(c, { last: 2, s2: 2, s3: 2 })).toBe(false);
    expect(straightlined(c, { last: 2, s2: 2, s3: 2, s4: 2 })).toBe(true);
    expect(straightlined(c, { last: 2, s2: 2, s3: 2, s4: 1 })).toBe(false);
  });

  it("counts every response once, uses stored flags when present and excludes the rest from the verdict", () => {
    const row = (answers: Answers, over: Partial<ResponseRow> = {}): ResponseRow => ({ answers, source: "invitation", channel: "email", duration_ms: slow, ...over });
    const rows = [
      row(goodAnswers(c)),
      row(goodAnswers(c, { gezocht: "nee" })),
      row({ laatst: "nooit" }),
      row(goodAnswers(c), { duration_ms: 500 }),
      row(goodAnswers(c, { [checkId(c)]: "o1" }), { source: "open_link", channel: "linkedin" }),
      row(goodAnswers(c, { last: 1, s2: 1, s3: 1, s4: 1 }), { source: "open_link", channel: "linkedin" }),
      // Stored flags win over recomputation (the database counts these).
      row(goodAnswers(c), { source: "open_link", channel: "linkedin", qualified: true, quality: "attention" }),
      row(goodAnswers(c), { source: "open_link", channel: "linkedin", qualified: true, quality: "ok", duration_ms: 1 }),
    ];
    const k = keyMetric(c, rows);
    expect(k).toMatchObject({ n: 3, successes: 2, responses: 8, screenedOut: 1, tooFast: 1, failedAttention: 2, straightlining: 1 });
    expect(responseStatus(c, rows[2])).toBe("screened_out");
    const counts = countResponses(c, rows);
    expect(counts.reduce((s, r) => s + r.responses, 0)).toBe(8);
    const split = surveySplitFromCounts(c, counts, 2);
    expect(split.all.n).toBe(3);
    expect(split.warnings.some((w) => w.includes("niet geloofwaardig") && w.includes("te snel 1") && w.includes("controlevraag 2") && w.includes("zelfde antwoord overal 1"))).toBe(true);
    expect(split.warnings.some((w) => w.startsWith("1 respondent viel buiten de doelgroep"))).toBe(true);
    expect(surveySplit(c, rows, 2)).toEqual(split);
  });

  it("leaves excluded responses out of the summaries, the open answers and marks them in the CSV", () => {
    const rows = [
      { answers: goodAnswers(c, { toelichting: "Echt antwoord" }), source: "invitation" as const, channel: "email", duration_ms: slow, created_at: "2026-11-04T10:00:00Z" },
      { answers: { laatst: "nooit" }, source: "open_link" as const, channel: "linkedin", duration_ms: slow, created_at: "2026-11-04T10:00:00Z", qualified: false, quality: "ok" as const },
      { answers: goodAnswers(c, { [checkId(c)]: "o4", toelichting: "Bot" }), source: "open_link" as const, channel: "linkedin", duration_ms: slow, created_at: "2026-11-04T10:00:00Z" },
    ];
    const s = summarise(c, rows);
    expect(s.find((q) => q.id === "laatst")?.n).toBe(1);
    expect(s.some((q) => q.id === checkId(c))).toBe(false);
    expect(openAnswers(c, rows).map((o) => o.text)).toEqual(["Echt antwoord"]);
    const csv = surveyCsv(c, rows);
    expect(csv).toContain('"nee (buiten doelgroep)"');
    expect(csv).toContain('"nee (controlevraag)"');
  });
});

describe("sample-size planner", () => {
  it("finds the smallest n for which the interval clears the threshold, consistent with the verdict", () => {
    const r = answersToClear(40, 25)!;
    expect(r.side).toBe("above");
    expect(wilson(0.4 * r.n, r.n).low).toBeGreaterThanOrEqual(0.25);
    expect(wilson(0.4 * (r.n - 1), r.n - 1).low).toBeLessThan(0.25);
    // With that many answers and the expected rate observed, the pre-registered verdict passes.
    const n = r.n + 2;
    expect(verdict({ successes: Math.ceil(0.4 * n), n, successThresholdPct: 25, failThresholdPct: null, minSample: 1, endConditionReached: true }).kind).toBe("pass");
    const below = answersToClear(10, 25, 20)!;
    expect(below.side).toBe("below");
    expect(wilson(0.1 * below.n, below.n).high).toBeLessThan(0.2);
    expect(answersToClear(25, 25)).toBeNull();
    expect(answersToClear(22, 25, 20)).toBeNull(); // between the fail and success thresholds
  });

  it("applies the Test Card minimum and turns answers into invitations and open-link visitors", () => {
    const p = planSurveySample({ successPct: 25, expectedPct: 60, minSample: 50 });
    expect(p.statistical).toBeLessThan(50);
    expect(p.needed).toBe(50);
    expect(p.invitations).toBe(Math.ceil(50 / (0.15 * 0.9)));
    expect(p.openVisitors).toBe(Math.ceil(50 / (0.3 * 0.9)));
    expect(planSentence(p, 25)).toContain("de Test Card vraagt minimaal 50");
    const custom = planSurveySample({ successPct: 25, expectedPct: 40, minSample: 10, inviteResponsePct: 50, usablePct: 100 });
    expect(custom.invitations).toBe(custom.needed! * 2);
  });

  it("defaults the expected rate to the threshold: no single number, a table above and below instead", () => {
    const p = planSurveySample({ successPct: 30, minSample: 20 });
    expect(p.needed).toBeNull();
    expect(planSentence(p, 30)).toContain("onbeslist");
    expect(p.rows.map((r) => r.expectedPct)).toEqual([50, 45, 40, 35, 25, 20, 15, 10]);
    const n = (pct: number) => p.rows.find((r) => r.expectedPct === pct)!.n!;
    expect(n(35)).toBeGreaterThan(n(40));
    expect(n(40)).toBeGreaterThan(n(50));
  });
});

describe("editor: screening, shuffle and attention checks", () => {
  it("moves the screening question to the top and keeps the survey consistent", () => {
    let c = templateSurvey(input);
    c = setScreening(c, "last"); // a scale cannot screen
    expect(c.screening).toBeUndefined();
    c = setScreening(templateSurvey(input), "gezocht"); // the key question cannot screen
    expect(c.screening).toBeUndefined();
    const base = { ...templateSurvey(input), questions: [...templateSurvey(input).questions, { id: "rol", type: "single" as const, text: "Wat is uw rol in het bedrijf?", required: true, options: [{ id: "eig", label: "Eigenaar" }, { id: "med", label: "Medewerker" }] }] };
    c = setScreening(base, "rol");
    expect(c.questions[0].id).toBe("rol");
    expect(surveyErrors(c)).toContain("Vink bij de screeningsvraag minstens één antwoord aan dat bij de doelgroep hoort.");
    c = toggleQualifying(c, "eig", true);
    expect(surveyErrors(c)).toEqual([]);
    expect(metricFromKey(c).metric_denominator).toContain("uit de doelgroep");
    expect(removeOption(c, "rol", "eig").screening?.qualifying).toEqual([]);
    expect(setKeyQuestion(c, "rol").screening).toBeUndefined();
    expect(setScreening(c, null).screening).toBeUndefined();
  });

  it("marks 'Anders' style options fixed when shuffling is switched on", () => {
    const c = { ...templateSurvey(input), questions: templateSurvey(input).questions.map((q) => (q.id === "gezocht" ? { ...q, shuffle: false, options: [...q.options!, { id: "anders", label: "Anders" }] } : q)) };
    const on = setShuffle(c, "gezocht", true).questions.find((q) => q.id === "gezocht")!;
    expect(on.shuffle).toBe(true);
    expect(on.options!.find((o) => o.id === "anders")?.fixed).toBe(true);
    expect(on.options!.find((o) => o.id === "nee")?.fixed).toBeUndefined();
  });

  it("adds a valid attention check and never on the key or screening question", () => {
    const c = addAttentionCheck(screened());
    expect(surveyErrors(c)).toEqual([]);
    const q = c.questions.find((x) => x.attention)!;
    expect(c.questions.indexOf(q)).toBeGreaterThan(0);
    expect(q.options!.find((o) => o.id === q.attention!.option)?.label).toBe("Soms");
    expect(setAttention(c, "gezocht", "nee").questions.find((x) => x.id === "gezocht")?.attention).toBeUndefined();
    expect(setAttention(c, q.id, null).questions.find((x) => x.id === q.id)?.attention).toBeUndefined();
    expect(SurveyConfigSchema.safeParse({ ...c, questions: c.questions.map((x) => (x.id === q.id ? { ...x, required: false } : x)) }).success).toBe(false);
  });
});

describe("AI draft: screening and option order", () => {
  const ctx = { assumption: "Eventmanagers zoeken actief naar betere tools", audience: "Eventmanagers", researcher: "Link & Lead", product: "EventKit", productNames: ["EventKit"] };
  const dq = (over: Partial<DraftQuestion> = {}): DraftQuestion => ({
    text: "Wanneer organiseerde u voor het laatst een zakelijk event?",
    type: "single",
    help: null,
    required: true,
    options: ["Afgelopen maand", "Afgelopen jaar", "Langer geleden"],
    scale: null,
    show_if: null,
    past_behaviour_version: null,
    ordered_options: true,
    ...over,
  });
  const draft = (over: Partial<RawDraft> = {}): RawDraft => ({
    title: "Onderzoek onder eventmanagers",
    intro: "We willen begrijpen hoe u events organiseert. Het duurt drie minuten.",
    thank_you: "Dank u wel.",
    estimated_minutes: 3,
    questions: [
      dq(),
      dq({ text: "Welke omschrijving past het best bij uw werk?", options: ["Ik organiseer events", "Ik bezoek events", "Anders"], ordered_options: false }),
      dq({ text: "Heeft u het afgelopen jaar betaald voor een eventtool?", options: ["Ja", "Nee"], ordered_options: false }),
    ],
    key_question_index: 2,
    success_option_labels: ["Ja"],
    screening: { question_index: 1, qualifying_option_labels: ["Ik organiseer events"] },
    why: ["Vragen over het laatste event geven concreet gedrag.", "De kernvraag gaat over een betaling."],
    ...over,
  });

  it("moves the proposed screening question to the top and shuffles only unordered options", () => {
    const r = sanitiseDraft(draft(), ctx);
    expect(r.origin).toBe("ai");
    expect(r.config.questions[0].text).toBe("Welke omschrijving past het best bij uw werk?");
    expect(r.config.screening).toEqual({ question: r.config.questions[0].id, qualifying: ["o1"] });
    expect(r.config.questions[0].shuffle).toBe(true);
    expect(r.config.questions[0].options!.find((o) => o.label === "Anders")?.fixed).toBe(true);
    expect(r.config.questions[1].shuffle).toBeUndefined();
  });

  it("drops an unusable screening proposal with a note", () => {
    const all = sanitiseDraft(draft({ screening: { question_index: 1, qualifying_option_labels: ["Ik organiseer events", "Ik bezoek events", "Anders"] } }), ctx);
    expect(all.config.screening).toBeUndefined();
    expect(all.changes.some((c) => c.includes("niet als screening"))).toBe(true);
    const key = sanitiseDraft(draft({ screening: { question_index: 2, qualifying_option_labels: ["Ja"] } }), ctx);
    expect(key.config.screening).toBeUndefined();
  });

  it("the template draft screens out people who never met the situation", () => {
    const t = templateDraft(ctx, "AI is niet verbonden.");
    expect(t.config.screening).toEqual({ question: "laatst", qualifying: ["week", "maand", "kwartaal", "langer"] });
    expect(SurveyConfigSchema.safeParse(t.config).success).toBe(true);
  });
});

describe("sharing summaries with clients", () => {
  const c = full();

  it("only offers closed questions that are not attention checks", () => {
    const ids = shareableQuestions(c).map((q) => q.id);
    expect(ids).toContain("gezocht");
    expect(ids).toContain("last");
    expect(ids).not.toContain("aanpak");
    expect(ids).not.toContain("toelichting");
    expect(ids).not.toContain(checkId(c));
    expect(cleanShare(c, ["toelichting", "last", "gezocht", 3, "nope"])).toEqual(["gezocht", "last"]);
  });

  it("rebuilds summaries from the aggregate rows and hides shared questions without rows", () => {
    const rows = [
      { question_id: "gezocht", value: "ja_betaald", answers: 6, count: 2 },
      { question_id: "gezocht", value: "nee", answers: 6, count: 4 },
      { question_id: "last", value: "2", answers: 6, count: 3 },
      { question_id: "last", value: "5", answers: 6, count: 3 },
    ];
    const view = sharedSummaries(c, rows, ["gezocht", "last", "uitgaven"]);
    expect(view.hidden).toEqual(["uitgaven"]);
    const g = view.summaries.find((q) => q.id === "gezocht");
    expect(g && g.type === "single" && g.options.map((o) => o.count)).toEqual([2, 0, 4]);
    const l = view.summaries.find((q) => q.id === "last");
    expect(l && l.type === "scale" && [l.n, l.mean, l.median]).toEqual([6, 3.5, 3.5]);
    expect(sharedSummaries(c, rows, []).summaries).toEqual([]);
  });
});
