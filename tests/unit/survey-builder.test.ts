import { describe, expect, it } from "vitest";
import { SurveyConfigSchema, templateSurvey, type ResponseRow, type SurveyConfig } from "@/lib/domain/survey";
import {
  addOption,
  addQuestion,
  auditSurvey,
  changeType,
  conditionCandidates,
  metricFromKey,
  moveQuestion,
  nextId,
  parseSurveyJson,
  removeOption,
  removeQuestion,
  setCondition,
  setKeyQuestion,
  surveyErrors,
  toggleSuccess,
  updateOption,
  updateQuestion,
} from "@/lib/domain/survey-editor";
import { MAX_DRAFT_QUESTIONS, sanitiseDraft, templateDraft, type DraftQuestion, type RawDraft } from "@/lib/domain/survey-draft";
import { csvCell, csvFilename, openAnswers, redactContact, surveyCsv, surveySplit, type ExportRow } from "@/lib/domain/survey-results";
import { recommend, testCardDefaults, valueOfInformation } from "@/lib/domain/recommend";
import { evaluateRules, RULES, SURVEY_SUGGEST_BELOW, type CoachFacts } from "@/lib/coach/rules";
import { runRealityCheck, type DossierFacts } from "@/lib/domain/reality-check";
import { isSignalSource } from "@/lib/domain/customer-signals";
import { KIND_DEFAULTS } from "@/lib/domain/evidence";

const base = () => templateSurvey({ assumption: "MKB-ondernemers zoeken actief naar hulp", audience: "MKB-ondernemers", researcher: "Link & Lead", product: "ProofLab" });

describe("survey editor helpers", () => {
  it("generates unique ids", () => {
    expect(nextId("q", ["q1", "q2"])).toBe("q3");
    expect(nextId("q", ["q3", "x"])).toBe("q4");
    expect(nextId("o", [])).toBe("o1");
  });

  it("adds a question with two empty options and validates only once it is filled in", () => {
    let c = addQuestion(base(), "single");
    const q = c.questions[c.questions.length - 1];
    expect(q.options).toHaveLength(2);
    expect(surveyErrors(c).some((e) => e.startsWith(`Vraag ${c.questions.length}:`))).toBe(true);
    c = updateQuestion(c, q.id, { text: "Hoe vaak deed u dit vorige maand?" });
    c = updateOption(c, q.id, q.options![0].id, "Eén keer");
    c = updateOption(c, q.id, q.options![1].id, "Vaker");
    expect(surveyErrors(c)).toEqual([]);
  });

  it("changing the type keeps or adds what the new type needs", () => {
    let c = changeType(base(), "toelichting", "scale");
    expect(c.questions.find((q) => q.id === "toelichting")?.scale).toBeDefined();
    c = changeType(c, "toelichting", "number");
    const q = c.questions.find((x) => x.id === "toelichting")!;
    expect(q.scale).toBeUndefined();
    expect(q.options).toBeUndefined();
  });

  it("turning the key question into an open question clears the key and dependent conditions", () => {
    const c = changeType(base(), "gezocht", "text");
    expect(c.key_question).toBe("");
    expect(c.success_options).toEqual([]);
    expect(c.questions.find((q) => q.id === "uitgaven")?.showIf).toBeUndefined();
    expect(surveyErrors(c)).toContain("Kies de kernvraag waarop de test wordt beoordeeld.");
  });

  it("removing a question removes conditions on it and the key when needed", () => {
    const c = removeQuestion(base(), "laatst");
    expect(c.questions.find((q) => q.id === "aanpak")?.showIf).toBeUndefined();
    expect(SurveyConfigSchema.safeParse(c).success).toBe(true);
    const noKey = removeQuestion(base(), "gezocht");
    expect(noKey.key_question).toBe("");
  });

  it("moves questions and drops a condition that would point at a later question", () => {
    const c = base();
    const up = moveQuestion(c, "aanpak", -1);
    expect(up.questions.map((q) => q.id).slice(0, 2)).toEqual(["aanpak", "laatst"]);
    expect(up.questions[0].showIf).toBeUndefined();
    expect(SurveyConfigSchema.safeParse(up).success).toBe(true);
    expect(moveQuestion(c, "laatst", -1)).toBe(c);
    expect(moveQuestion(c, "toelichting", 1)).toBe(c);
    const down = moveQuestion(c, "laatst", 1);
    expect(down.questions[1].id).toBe("laatst");
  });

  it("removing an option also removes it from success options and conditions", () => {
    let c = removeOption(base(), "gezocht", "ja_betaald");
    expect(c.success_options).toEqual(["ja_gezocht"]);
    expect(c.questions.find((q) => q.id === "uitgaven")?.showIf).toBeUndefined();
    c = addOption(c, "gezocht");
    expect(c.questions.find((q) => q.id === "gezocht")?.options).toHaveLength(3);
  });

  it("key question and success options: in question order, never all options", () => {
    let c = setKeyQuestion(base(), "laatst");
    expect(c.key_question).toBe("laatst");
    expect(c.success_options).toEqual([]);
    expect(c.questions[0].showIf).toBeUndefined();
    c = toggleSuccess(c, "maand", true);
    c = toggleSuccess(c, "week", true);
    expect(c.success_options).toEqual(["week", "maand"]);
    for (const o of ["kwartaal", "langer", "nooit"]) c = toggleSuccess(c, o, true);
    expect(surveyErrors(c)).toContain("Niet alle opties kunnen 'succes' zijn: dan meet de vraag niets.");
    expect(setKeyQuestion(base(), "last").key_question).toBe("gezocht"); // a scale cannot be the key question
  });

  it("conditions only on earlier choice questions", () => {
    const c = base();
    expect(conditionCandidates(c, "laatst")).toEqual([]);
    expect(conditionCandidates(c, "toelichting").map((q) => q.id)).toEqual(["laatst", "gezocht"]);
    const withCond = setCondition(c, "toelichting", "gezocht", ["nee"]);
    expect(withCond.questions.find((q) => q.id === "toelichting")?.showIf).toEqual({ question: "gezocht", options: ["nee"] });
    expect(setCondition(withCond, "toelichting", null).questions.find((q) => q.id === "toelichting")?.showIf).toBeUndefined();
    expect(setCondition(c, "gezocht", "laatst", ["week"]).questions.find((q) => q.id === "gezocht")?.showIf).toBeUndefined();
  });

  it("fills the testkaart metric from the key question", () => {
    const m = metricFromKey(base());
    expect(m.metric_numerator).toBe('respondenten die "Ja, en ik heb ervoor betaald" of "Ja, ik heb gezocht maar niets gekocht" kozen');
    expect(m.metric_denominator).toBe("respondenten die de kernvraag beantwoordden");
    expect(m.metric_label.startsWith("Kernvraag: Heeft u in het afgelopen jaar")).toBe(true);
    const none = metricFromKey({ ...base(), success_options: [] });
    expect(none.metric_numerator).toContain("kies de kernvraag");
  });

  it("explains validation errors in Dutch with the place they belong", () => {
    const c: SurveyConfig = { ...base(), title: "", estimated_minutes: 0 };
    const errors = surveyErrors(c);
    expect(errors).toContain("De titel is te kort (minimaal 3 tekens).");
    expect(errors).toContain("De geschatte duur is te laag (minimaal 1).");
    const q = updateQuestion(base(), "last", { text: "Hoe" });
    expect(surveyErrors(q)).toContain("Vraag 5: de vraagtekst is te kort (minimaal 5 tekens).");
    expect(errors.every((e) => !/expected|Too small|Invalid/.test(e))).toBe(true);
    expect(surveyErrors(null)).not.toEqual([]);
  });

  it("audits questions for hypothetical, leading, pitching and double questions, not for closed ones", () => {
    let c = updateQuestion(base(), "toelichting", { text: "Zou u ProofLab gebruiken als het gratis was?" });
    c = updateQuestion(c, "aanpak", { text: "Vindt u ook niet dat dit beter kan?" });
    const audit = auditSurvey(c, ["ProofLab"]);
    const kinds = Object.fromEntries(audit.map((a) => [a.id, a.issues.map((i) => i.kind)]));
    expect(kinds.toelichting).toEqual(expect.arrayContaining(["hypothetical", "pitch"]));
    expect(kinds.aanpak).toContain("leading");
    expect(kinds.gezocht).toBeUndefined(); // starts with "Heeft u": closed, fine in a survey
  });

  it("parses the posted JSON defensively", () => {
    expect(parseSurveyJson(JSON.stringify(base()))).toMatchObject({ key_question: "gezocht" });
    expect(parseSurveyJson("[1]")).toBeNull();
    expect(parseSurveyJson("{nope")).toBeNull();
    expect(parseSurveyJson(42)).toBeNull();
  });
});

// ---------------------------------------------------------------------------

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
  ...over,
});

const draft = (over: Partial<RawDraft> = {}): RawDraft => ({
  title: "Onderzoek onder eventmanagers",
  intro: "We willen begrijpen hoe u events organiseert. Het duurt drie minuten.",
  thank_you: "Dank u wel.",
  estimated_minutes: 3,
  questions: [
    dq(),
    dq({ text: "Hoe heeft u dat event georganiseerd?", type: "text", options: [], show_if: { question_index: 0, option_labels: ["Afgelopen maand", "Afgelopen jaar"] } }),
    dq({ text: "Heeft u het afgelopen jaar betaald voor een eventtool?", options: ["Ja", "Nee"] }),
  ],
  key_question_index: 2,
  success_option_labels: ["Ja"],
  why: ["Vragen over het laatste event geven concreet gedrag.", "De kernvraag gaat over een betaling."],
  ...over,
});

describe("AI draft post-processing", () => {
  it("keeps a sound draft, generates ids and maps conditions and the key question", () => {
    const r = sanitiseDraft(draft(), ctx);
    expect(r.origin).toBe("ai");
    expect(SurveyConfigSchema.safeParse(r.config).success).toBe(true);
    expect(r.config.questions.map((q) => q.id)).toEqual(["q1", "q2", "q3"]);
    expect(r.config.questions[1].showIf).toEqual({ question: "q1", options: ["o1", "o2"] });
    expect(r.config.key_question).toBe("q3");
    expect(r.config.success_options).toEqual(["o1"]);
    expect(r.config.researcher).toBe("Link & Lead");
    expect(r.why).toHaveLength(2);
  });

  it("rewrites hypothetical questions to past behaviour, or drops them", () => {
    const r = sanitiseDraft(
      draft({
        questions: [
          dq(),
          dq({ text: "Zou u EventKit gebruiken?", type: "text", options: [], past_behaviour_version: "Welke tools gebruikte u bij uw laatste event?" }),
          dq({ text: "Stel dat het gratis is, wilt u het dan proberen?", type: "text", options: [], past_behaviour_version: "Zou u het willen proberen?" }),
          dq({ text: "Heeft u het afgelopen jaar betaald voor een eventtool?", options: ["Ja", "Nee"] }),
        ],
        key_question_index: 3,
      }),
      ctx,
    );
    const texts = r.config.questions.map((q) => q.text);
    expect(texts).toContain("Welke tools gebruikte u bij uw laatste event?");
    expect(texts.some((t) => /zou u|stel dat/i.test(t))).toBe(false);
    expect(r.changes.some((c) => c.includes("herschreven"))).toBe(true);
    expect(r.changes.some((c) => c.includes("weggelaten"))).toBe(true);
    expect(r.config.key_question).toBe("q3");
  });

  it("caps the survey at twelve questions and always keeps the key question", () => {
    const many = Array.from({ length: 15 }, (_, i) => dq({ text: `Hoe vaak deed u vorig jaar activiteit nummer ${i + 1}?`, type: "number", options: [] }));
    const key = dq({ text: "Heeft u het afgelopen jaar betaald voor een eventtool?", options: ["Ja", "Nee"] });
    const r = sanitiseDraft(draft({ questions: [...many, key], key_question_index: 15 }), ctx);
    expect(r.config.questions).toHaveLength(MAX_DRAFT_QUESTIONS);
    expect(r.config.questions.some((q) => q.id === r.config.key_question && q.text === key.text)).toBe(true);
    expect(r.changes.some((c) => c.includes("Ingekort"))).toBe(true);
  });

  it("replaces an unusable key question with the template's key question", () => {
    const allSuccess = sanitiseDraft(draft({ success_option_labels: ["Ja", "Nee"] }), ctx);
    expect(allSuccess.origin).toBe("ai");
    const key = allSuccess.config.questions.find((q) => q.id === allSuccess.config.key_question)!;
    expect(key.text).toContain("actief gezocht");
    expect(allSuccess.config.success_options).toEqual(["ja_betaald", "ja_gezocht"]);
    const hypoKey = sanitiseDraft(draft({ questions: [dq(), dq({ text: "Zou u betalen voor EventKit?", options: ["Ja", "Nee"] })], key_question_index: 1 }), ctx);
    expect(hypoKey.config.questions.find((q) => q.id === hypoKey.config.key_question)?.text).toContain("actief gezocht");
  });

  it("falls back to the template when the proposal is unusable", () => {
    const r = sanitiseDraft(draft({ title: "", intro: "" }), ctx);
    expect(r.origin).toBe("template");
    expect(r.why[0]).toContain("sjabloon");
    expect(SurveyConfigSchema.safeParse(r.config).success).toBe(true);
    const t = templateDraft(ctx, "AI is niet verbonden.");
    expect(t.origin).toBe("template");
    expect(t.config.researcher).toBe("Link & Lead");
  });
});

// ---------------------------------------------------------------------------

const row = (gezocht: string | null, source: ResponseRow["source"], channel: string, duration = 60000, extra: Record<string, string | number> = {}): ExportRow => ({
  answers: { laatst: "maand", ...(gezocht ? { gezocht } : {}), last: 3, ...extra },
  source,
  channel,
  duration_ms: duration,
  created_at: "2026-11-02T10:00:00Z",
});

describe("survey metric split and warnings", () => {
  it("splits the key metric per source and channel over believable responses", () => {
    const rows = [
      row("ja_betaald", "invitation", "email"),
      row("nee", "invitation", "email"),
      row("ja_gezocht", "open_link", "linkedin"),
      row("nee", "open_link", "linkedin"),
      row("nee", "open_link", "linkedin"),
      row("ja_betaald", "open_link", "linkedin", 1000),
      row(null, "invitation", "email"),
    ];
    const s = surveySplit(base(), rows, 2);
    expect(s.all).toMatchObject({ n: 5, successes: 2, tooFast: 1 });
    expect(s.invitation).toMatchObject({ n: 2, successes: 1 });
    expect(s.openLink).toMatchObject({ n: 3, successes: 1 });
    expect(s.byChannel).toEqual([
      { channel: "linkedin", n: 3, successes: 1 },
      { channel: "email", n: 2, successes: 1 },
    ]);
    expect(s.openLinkShare).toBeCloseTo(0.6);
    expect(s.responses).toBe(7);
    expect(s.warnings.some((w) => w.startsWith("Open link: herkomst niet te controleren."))).toBe(true);
    expect(s.warnings.some((w) => w.startsWith("1 antwoord is niet meegeteld"))).toBe(true);
    expect(s.warnings.some((w) => w.includes("persoonlijk uitgenodigde"))).toBe(false);
  });

  it("warns when too few answers come from invited respondents, and is quiet without responses", () => {
    const s = surveySplit(base(), [row("nee", "invitation", "email"), row("ja_betaald", "invitation", "email")], 50);
    expect(s.warnings).toEqual(["Pas 2 van de minimaal 50 antwoorden komen van persoonlijk uitgenodigde, bekende respondenten."]);
    expect(surveySplit(base(), [], 50).warnings).toEqual([]);
    expect(surveySplit(base(), [], 50).openLinkShare).toBeNull();
  });
});

describe("CSV export and open answers", () => {
  it("quotes cells and defuses formulas", () => {
    expect(csvCell('Zei "ja"')).toBe('"Zei ""ja"""');
    expect(csvCell("=SOM(A1)")).toBe(`"'=SOM(A1)"`);
    expect(csvCell("-5")).toBe(`"'-5"`);
  });

  it("removes e-mail addresses and phone numbers from open answers", () => {
    expect(redactContact("Mail me op jan@voorbeeld.nl of bel 06-12345678")).toBe("Mail me op [e-mailadres verwijderd] of bel [telefoonnummer verwijderd]");
    expect(redactContact("We hebben 1.200 euro uitgegeven in 2025")).toBe("We hebben 1.200 euro uitgegeven in 2025");
  });

  it("writes one row per response with labels, source, channel and date", () => {
    const csv = surveyCsv(base(), [
      row("ja_betaald", "invitation", "email", 60000, { uitgaven: 1200.5, toelichting: "Te duur, mail: a@b.nl" }),
      row("nee", "open_link", "linkedin", 1000),
    ]);
    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('"respons";"datum";"bron";"kanaal";"duur_seconden";"meegeteld";"1. Wanneer had u');
    expect(lines[1]).toContain('"1";"2026-11-02";"uitnodiging";"email";"60";"ja";"In de afgelopen maand"');
    expect(lines[1]).toContain('"Ja, en ik heb ervoor betaald"');
    expect(lines[1]).toContain('"1200,5"');
    expect(lines[1]).toContain('"Te duur, mail: [e-mailadres verwijderd]"');
    expect(csv).not.toContain("a@b.nl");
    expect(lines[2]).toContain('"open link";"linkedin";"1";"nee (te snel)"');
    expect(csvFilename("Enquête: MKB & hulp!", "2026-11-03")).toBe("enquete-enquete-mkb-hulp-2026-11-03.csv");
  });

  it("collects non-empty open answers from believable responses", () => {
    const rows = [
      row("nee", "invitation", "email", 60000, { toelichting: "  Te   weinig tijd  ", aanpak: "Zelf gedaan" }),
      row("nee", "open_link", "linkedin", 60000, { toelichting: "" }),
      row("nee", "open_link", "linkedin", 1000, { toelichting: "Bot-antwoord" }),
    ];
    const open = openAnswers(base(), rows);
    expect(open).toEqual([
      { text: "Zelf gedaan", question: "aanpak", source: "invitation", respondent: 1 },
      { text: "Te weinig tijd", question: "toelichting", source: "invitation", respondent: 1 },
    ]);
  });
});

// ---------------------------------------------------------------------------

describe("survey in the recommender, evidence and checks", () => {
  it("offers the survey as a fourth option without changing the information-value choice", () => {
    const r = recommend({ category: "desirability", evidence: 0.3, hasDiscoveryEvidence: true });
    expect(r.options.map((o) => o.type)).toEqual(["interview", "landing", "pricing", "survey"]);
    expect(r.options[3].strength).toBe("Zwak");
    const v = valueOfInformation({ id: "a", statement: "x", importance: 5, probability: 0.5, category: "desirability", evidence: 0.3, hasDiscoveryEvidence: true });
    expect(v.test.type).not.toBe("survey");
    expect(testCardDefaults("survey", "x", "y").metric_denominator).toBe("respondenten die de kernvraag beantwoordden");
  });

  it("a survey answer is self-reported, never behaviour, and open answers are signal sources", () => {
    expect(KIND_DEFAULTS.survey_answer.isBehaviour).toBe(false);
    expect(isSignalSource({ source_type: "survey", origin: "manual" })).toBe(true);
  });

  const facts: DossierFacts = {
    ideaAgeDays: 5,
    ideaRegion: "Nederland",
    clientDeciderInvited: true,
    claims: [],
    competitors: [],
    sizing: null,
    assumptions: [],
    experiments: [{ type: "survey", state: "ended", assumptionCategory: "desirability", verdict: "pass", n: 80, minSample: 50, endedEarly: false, channels: ["outreach"] }],
    interviews: [],
    observations: [{ kind: "survey_answer", isBehaviour: false, isSynthetic: false, isCostly: false }],
    learningCards: [],
    decisionsAfterLastLearning: 0,
    isB2B: false,
  };

  it("the realiteitscheck does not let a positive survey pass for behaviour", () => {
    const r = runRealityCheck(facts);
    expect(r.findings.map((f) => f.code)).toContain("survey_not_behaviour");
    expect(r.advice).toBe("test_more");
    const running = runRealityCheck({ ...facts, experiments: [{ ...facts.experiments[0], state: "live", verdict: "running" }] });
    expect(running.findings.map((f) => f.code)).toContain("survey_self_reported");
  });
});

describe("coach suggests a survey draft", () => {
  const ID = "00000000-0000-4000-8000-000000000001";
  const f = (over: Partial<CoachFacts> = {}): CoachFacts => ({
    ideaId: ID,
    today: "2026-11-03",
    now: Date.parse("2026-11-03T10:00:00Z"),
    sprint: null,
    claims: [],
    competitorKinds: ["status_quo"],
    sourceTypes: [],
    assumptions: [{ id: "a1", statement: "Eventmanagers zoeken actief naar betere tools", importance: 5, status: "testing" }],
    experiments: [
      { id: "e1", title: "Interviews", type: "interview", state: "live", startedAt: null, endsAt: null, n: 6, minSample: 8, locked: true, successThresholdPct: 60, failThresholdPct: 30, guide: [], assumptionId: "a1" },
    ],
    interviews: [],
    observations: [],
    learningCards: [],
    realityCheck: null,
    decisions: [],
    decisionDeadline: null,
    clientDeciderInvited: false,
    outcome: { defined: true, due: null, resolved: false, checkins: [] },
    forecasts: [{ moment: "intake", kind: "consultant" }],
    outreach: { replies: 0, latestReplyAt: null, latestImportAt: null },
    ...over,
  });

  it("suggests a survey for a critical assumption with interview evidence but few data points", () => {
    const n = RULES.survey_suggest(f(), `/app/ideas/${ID}`);
    expect(n).toMatchObject({ code: "survey_suggest:a1", kind: "tip", href: `/app/ideas/${ID}/experiments?assumption=a1&type=survey`, audience: "consultant" });
    expect(evaluateRules(f()).map((x) => x.code)).toContain("survey_suggest:a1");
  });

  it("stays quiet without interviews, with enough data, with a survey already, or for minor or settled assumptions", () => {
    const e = f().experiments[0];
    expect(RULES.survey_suggest(f({ experiments: [] }), "")).toBeNull();
    expect(RULES.survey_suggest(f({ experiments: [{ ...e, assumptionId: null }] }), "")).toBeNull();
    expect(RULES.survey_suggest(f({ experiments: [e, { ...e, id: "e2", type: "landing", n: SURVEY_SUGGEST_BELOW }] }), "")).toBeNull();
    expect(RULES.survey_suggest(f({ experiments: [e, { ...e, id: "e3", type: "survey", n: 0, state: "draft" }] }), "")).toBeNull();
    expect(RULES.survey_suggest(f({ assumptions: [{ id: "a1", statement: "x", importance: 3, status: "testing" }] }), "")).toBeNull();
    expect(RULES.survey_suggest(f({ assumptions: [{ id: "a1", statement: "x", importance: 5, status: "supported" }] }), "")).toBeNull();
  });
});
