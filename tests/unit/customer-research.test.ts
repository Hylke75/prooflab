import { describe, expect, it } from "vitest";
import {
  approvalChecks,
  asExploratory,
  auditStudy,
  CONSENT_NO,
  CONSENT_QUESTION_ID,
  CONSENT_YES,
  decisive,
  emptyExploratorySurvey,
  exploratoryHypothesis,
  interviewGuide,
  isExploratory,
  missingStudySchema,
  onlineInterviewConfig,
  studyFormatOf,
  usableResponses,
} from "@/lib/domain/customer-research";
import { assessResponse, countResponses, isKeySuccess, SurveyConfigSchema, summarise, templateSurvey, type ResponseRow } from "@/lib/domain/survey";
import { auditQuestion } from "@/lib/domain/interview-audit";
import { clearKeyQuestion, surveyErrors } from "@/lib/domain/survey-editor";
import { openAnswers } from "@/lib/domain/survey-results";

const ctx = { title: "Hoe plannen eventmanagers personeel?", goal: "Begrijpen hoe eventmanagers nu personeel inplannen.", audience: "eventmanagers", researcher: "Link & Lead" };
const template = templateSurvey({ assumption: "Eventmanagers zoeken actief naar hulp", audience: "eventmanagers", researcher: "Link & Lead", product: "ProofLab" });

const row = (answers: ResponseRow["answers"], extra: Partial<ResponseRow> = {}): ResponseRow => ({ answers, source: "open_link", channel: "network", duration_ms: 600000, ...extra });

describe("verkennend of beslissend", () => {
  it("herkent een verkennende hypothese aan de markering, en defensief aan een ontbrekende drempel of aanname", () => {
    expect(isExploratory({ exploratory: true, success_threshold_pct: null, assumption_id: null })).toBe(true);
    expect(isExploratory({ exploratory: false, success_threshold_pct: null, assumption_id: "a1" })).toBe(true);
    expect(isExploratory({ success_threshold_pct: 40, assumption_id: null })).toBe(true);
    expect(isExploratory({ exploratory: false, success_threshold_pct: 40, assumption_id: "a1" })).toBe(false);
    // Rijen van vóór de migratie hebben geen kolom exploratory: dan beslist de drempel.
    expect(isExploratory({ success_threshold_pct: 40, assumption_id: "a1" })).toBe(false);
    expect(isExploratory(null)).toBe(false);
  });

  it("decisive laat tests uit stap 3 ongemoeid en sluit verkennend onderzoek uit van elk oordeel", () => {
    const test = { exploratory: false, success_threshold_pct: 40, assumption_id: "a1", min_sample: 30 };
    expect(decisive(test)).toBe(test);
    expect(decisive({ exploratory: true, success_threshold_pct: null, assumption_id: null, min_sample: 30 })).toBeNull();
    expect(decisive(null)).toBeNull();
  });
});

describe("poorten bij goedkeuren", () => {
  it("houdt de controlepunten voor tests uit stap 3 precies gelijk", () => {
    expect(approvalChecks("survey", false)).toEqual(["check_honest", "check_privacy", "check_pretest"]);
    expect(approvalChecks("interview", false)).toEqual(["check_consent", "check_neutral"]);
    expect(approvalChecks("landing", false)).toEqual(["check_reveal", "check_privacy", "check_budget"]);
    expect(approvalChecks("pricing", false)).toEqual(["check_reveal", "check_privacy", "check_budget"]);
  });

  it("vraagt bij verkennend onderzoek geen pretest, bij een online interview wel neutrale vragen", () => {
    expect(approvalChecks("survey", true, "survey")).toEqual(["check_honest", "check_privacy"]);
    expect(approvalChecks("survey", true, "interview")).toEqual(["check_honest", "check_privacy", "check_neutral"]);
  });
});

describe("online interview (schriftelijk)", () => {
  const config = onlineInterviewConfig(ctx);

  it("is een geldige, verkennende configuratie met toestemming bovenaan en verder alleen open vragen", () => {
    expect(SurveyConfigSchema.safeParse(config).success).toBe(true);
    expect(config.purpose).toBe("explore");
    expect(config.format).toBe("interview");
    expect(config.questions[0].id).toBe(CONSENT_QUESTION_ID);
    expect(config.screening).toEqual({ question: CONSENT_QUESTION_ID, qualifying: [CONSENT_YES] });
    expect(config.questions.slice(1).every((q) => q.type === "text")).toBe(true);
    expect(config.key_question).toBe("");
    expect(config.success_options).toEqual([]);
  });

  it("de leidraad vraagt naar recent gedrag: geen hypothetische, sturende of verkopende vragen", () => {
    for (const q of interviewGuide()) {
      const kinds = auditQuestion(q, { productNames: ["ProofLab"] }).map((i) => i.kind);
      expect(kinds.filter((k) => k === "hypothetical" || k === "leading" || k === "pitch"), q).toEqual([]);
    }
    expect(auditStudy(config, ["ProofLab"])).toEqual([]);
  });

  it("wie geen toestemming geeft, telt niet mee en levert geen open antwoorden", () => {
    const rows = [
      row({ [CONSENT_QUESTION_ID]: CONSENT_YES, v1: "Vorige week moest ik op het laatste moment drie mensen vervangen." }),
      row({ [CONSENT_QUESTION_ID]: CONSENT_NO }),
    ];
    expect(assessResponse(config, rows[1].answers, 600000).qualified).toBe(false);
    expect(openAnswers(config, rows).map((a) => a.text)).toEqual(["Vorige week moest ik op het laatste moment drie mensen vervangen."]);
    const counts = countResponses(config, rows);
    expect(usableResponses(counts)).toEqual({ responses: 2, usable: 1, excluded: 1 });
  });

  it("weigert keuzevragen en een ontbrekende toestemmingsvraag", () => {
    const withChoice = { ...config, questions: [...config.questions, { id: "keuze", type: "single" as const, text: "Hoe vaak gebeurt dit?", required: true, options: [{ id: "a", label: "Vaak" }, { id: "b", label: "Zelden" }] }] };
    expect(surveyErrors(withChoice).join(" ")).toMatch(/open vragen/);
    const noConsent = { ...config, questions: config.questions.slice(1), screening: undefined };
    expect(surveyErrors(noConsent).join(" ")).toMatch(/toestemming/);
    expect(surveyErrors({ ...config, purpose: undefined }).join(" ")).toMatch(/altijd verkennend/);
  });

  it("beschrijft het onderzoek eerlijk: wie vraagt, waarvoor, en niets over gebruik van het product", () => {
    expect(config.intro).toContain("Link & Lead");
    expect(config.intro).toContain("eventmanagers");
    expect(config.intro).not.toMatch(/ProofLab/);
  });
});

describe("verkennende enquête", () => {
  it("een lege enquête is geldig zonder kernvraag", () => {
    const c = emptyExploratorySurvey(ctx);
    expect(SurveyConfigSchema.safeParse(c).success).toBe(true);
    expect(c.key_question).toBe("");
    expect(studyFormatOf(c)).toBe("survey");
  });

  it("een sjabloon of AI-opzet mag zijn kernvraag houden, en de kernvraag kan weer weg", () => {
    const c = asExploratory(template);
    expect(SurveyConfigSchema.safeParse(c).success).toBe(true);
    expect(c.key_question).toBe("gezocht");
    const without = clearKeyQuestion(c);
    expect(without.key_question).toBe("");
    expect(without.success_options).toEqual([]);
    expect(SurveyConfigSchema.safeParse(without).success).toBe(true);
    // Zonder kernvraag is er niets te tellen als succes.
    expect(isKeySuccess(without, { gezocht: "ja_betaald" })).toBeNull();
  });

  it("succesopties zonder kernvraag zijn een fout", () => {
    const c = { ...asExploratory(template), key_question: "", success_options: ["ja_betaald"] };
    expect(surveyErrors(c).join(" ")).toMatch(/Succesopties horen bij een kernvraag/);
  });

  it("de antwoorden per vraag werken ook zonder kernvraag", () => {
    const c = emptyExploratorySurvey(ctx);
    const s = summarise(c, [row({ q1: "Ik bel iedereen af." }), row({ q1: "Via een app." })]);
    expect(s[0]).toMatchObject({ type: "text", n: 2 });
  });
});

describe("regels voor tests uit stap 3 blijven gelijk", () => {
  it("een test zonder kernvraag of succesopties is nog steeds ongeldig", () => {
    expect(surveyErrors({ ...template, key_question: "" })).toContain("Kies de kernvraag waarop de test wordt beoordeeld.");
    expect(surveyErrors({ ...template, success_options: [] })).toContain("Kies minstens één succesoptie bij de kernvraag.");
    expect(clearKeyQuestion(template)).toBe(template);
  });

  it("een online interview kan geen test zijn", () => {
    expect(SurveyConfigSchema.safeParse({ ...template, format: "interview" }).success).toBe(false);
  });
});

describe("hypothese van een verkennend onderzoek", () => {
  it("heeft geen aanname, drempel of beslisregel; streefaantal en looptijd blijven binnen de grenzen", () => {
    const h = exploratoryHypothesis({ format: "interview", goal: ctx.goal, audience: "eventmanagers", targetN: 0, maxDays: 400, researchQuestionId: "q1" });
    expect(h).toMatchObject({ assumption_id: null, exploratory: true, success_threshold_pct: null, fail_threshold_pct: null, decision_rule: null, success_count: null, research_question_id: "q1" });
    expect(h.min_sample).toBe(1);
    expect(h.max_duration_days).toBe(180);
    expect(h.test_method).toMatch(/Online interview/);
  });
});

describe("respons tellen", () => {
  it("telt per persoon en trekt buiten de doelgroep en niet geloofwaardig af", () => {
    const counts = [
      { responses: 10, screened_out: 2, too_fast: 1, failed_attention: 0, straightlining: 1 },
      { responses: 5, screened_out: 0, too_fast: 0, failed_attention: 1, straightlining: 0 },
    ];
    expect(usableResponses(counts)).toEqual({ responses: 15, usable: 10, excluded: 5 });
    expect(usableResponses([])).toEqual({ responses: 0, usable: 0, excluded: 0 });
  });
});

describe("zonder migratie", () => {
  it("herkent een ontbrekende kolom als 'database-update nodig'", () => {
    expect(missingStudySchema({ code: "PGRST204", message: "Could not find the 'exploratory' column of 'hypotheses' in the schema cache" })).toBe(true);
    expect(missingStudySchema({ code: "42703", message: "column hypotheses_1.exploratory does not exist" })).toBe(true);
    expect(missingStudySchema({ code: "23505", message: "duplicate key" })).toBe(false);
    expect(missingStudySchema(null)).toBe(false);
  });
});
