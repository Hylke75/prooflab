import { describe, expect, it } from "vitest";
import { SurveyConfigSchema, keyMetric, minimumDurationMs, summarise, templateSurvey, validateAnswers, type ResponseRow } from "@/lib/domain/survey";
import { auditQuestion } from "@/lib/domain/interview-audit";

const config = templateSurvey({ assumption: "MKB-ondernemers zoeken actief naar hulp", audience: "MKB-ondernemers", researcher: "Link & Lead", product: "ProofLab" });

describe("survey definition", () => {
  it("produces a valid template with a pre-registered key question", () => {
    expect(SurveyConfigSchema.safeParse(config).success).toBe(true);
    expect(config.key_question).toBe("gezocht");
  });

  it("asks about past behaviour, not hypothetical intentions", () => {
    for (const q of config.questions) {
      expect(auditQuestion(q.text, { productNames: ["ProofLab"] }).filter((i) => i.kind === "hypothetical" || i.kind === "leading" || i.kind === "pitch")).toEqual([]);
    }
  });

  it("rejects a key question where every option counts as success", () => {
    const bad = { ...config, success_options: ["ja_betaald", "ja_gezocht", "nee"] };
    expect(SurveyConfigSchema.safeParse(bad).success).toBe(false);
  });

  it("rejects a condition on a later question", () => {
    const bad = { ...config, questions: [{ ...config.questions[0], showIf: { question: "gezocht", options: ["nee"] } }, ...config.questions.slice(1)] };
    expect(SurveyConfigSchema.safeParse(bad).success).toBe(false);
  });
});

describe("answers", () => {
  const good = { laatst: "maand", aanpak: "Zelf uitgezocht", gezocht: "ja_betaald", uitgaven: "1.200", last: 4, toelichting: "" };

  it("accepts valid answers and drops hidden or unknown questions", () => {
    const r = validateAnswers(config, { ...good, onbekend: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.answers.onbekend).toBeUndefined();
      expect(r.answers.uitgaven).toBe(1200); // Dutch thousands separator, read like everywhere in ProofLab
    }
    const hidden = validateAnswers(config, { ...good, laatst: "nooit", aanpak: "Zou niet getoond zijn" });
    expect(hidden.ok && hidden.answers.aanpak).toBeFalsy();
  });

  it("requires visible required questions and valid options", () => {
    expect(validateAnswers(config, { ...good, gezocht: undefined }).ok).toBe(false);
    expect(validateAnswers(config, { ...good, gezocht: "misschien" }).ok).toBe(false);
    expect(validateAnswers(config, { ...good, last: 9 }).ok).toBe(false);
  });
});

describe("key metric", () => {
  const row = (gezocht: string, source: ResponseRow["source"] = "invitation", duration = 60000): ResponseRow => ({
    answers: { laatst: "maand", gezocht, last: 3 },
    source,
    channel: source === "invitation" ? "email" : "linkedin",
    duration_ms: duration,
  });

  it("counts success options, separates sources and ignores implausibly fast responses", () => {
    const rows = [row("ja_betaald"), row("ja_gezocht"), row("nee"), row("nee", "open_link"), row("ja_betaald", "open_link", 1000)];
    const all = keyMetric(config, rows);
    expect(all).toMatchObject({ n: 4, successes: 2, tooFast: 1 });
    expect(keyMetric(config, rows, "invitation")).toMatchObject({ n: 3, successes: 2 });
    expect(minimumDurationMs(config)).toBe(12000);
  });

  it("summarises choices, scales and open answers", () => {
    const s = summarise(config, [row("ja_betaald"), row("nee")]);
    const gezocht = s.find((q) => q.id === "gezocht");
    expect(gezocht && gezocht.type === "single" && gezocht.options.find((o) => o.id === "nee")?.count).toBe(1);
    const last = s.find((q) => q.id === "last");
    expect(last && last.type === "scale" && last.mean).toBe(3);
  });
});
