import { describe, expect, it } from "vitest";
import { describeDraftEdit, draftEdit, questionDraftText, surveyDraftText } from "@/lib/domain/ai-draft";
import { assumptionProbabilityV2, assumptionProbabilityV3, type ProbabilityObservation } from "@/lib/domain/evidence";
import { METHODS } from "@/lib/domain/method";

// Golf A, punt 17: AI-codering telt in 2026-11-c pas na beoordeling; bij AI-concepten blijft zichtbaar wat de mens
// aanpaste.
const ai = (reviewStatus: string | null, sourceKey: string): ProbabilityObservation => ({
  kind: "problem_confirmed",
  relation: "supports",
  isSynthetic: false,
  origin: "ai",
  reviewStatus,
  sourceKey,
});

describe("punt 17: AI-codering telt pas na beoordeling (2026-11-c)", () => {
  it("onbeoordeelde AI-codering telt niet mee; in 2026-11-b voor de helft", () => {
    const c = assumptionProbabilityV3([], [ai(null, "i1")]);
    expect(c.shift).toBe(0);
    expect(c.probability).toBe(0.4); // geen bewijs: het laagste plafond
    expect(c.ignored.unreviewed).toBe(1);
    const b = assumptionProbabilityV2([], [ai(null, "i1")]);
    expect(b.shift).toBeCloseTo(Math.log(1.5) * 0.5, 12);
    expect(b.ignored.unreviewed).toBeUndefined();
  });

  it("na akkoord telt AI-codering volledig, afgekeurd niet", () => {
    expect(assumptionProbabilityV3([], [ai("accepted", "i1")]).shift).toBeCloseTo(Math.log(1.5), 12);
    const rejected = assumptionProbabilityV3([], [ai("rejected", "i1")]);
    expect(rejected.shift).toBe(0);
    expect(rejected.ignored.rejected).toBe(1);
  });

  it("de rekenmodule van 2026-11-c gebruikt dit; 2026-11-a niet", () => {
    const list = [ai(null, "i1"), ai(null, "i2")];
    expect(METHODS["2026-11-c"].probability([], list, 0.5, {}, { opinion: 0.4, problem: 0.5, small_action: 0.6, quote: 0.75, deposit: 0.9 }).shift).toBe(0);
    expect(METHODS["2026-11-a"].probability([], list, 0.5, {}, { opinion: 0.4, problem: 0.5, small_action: 0.6, quote: 0.75, deposit: 0.9 }).shift).toBeGreaterThan(0);
  });
});

describe("punt 17: wat heeft de mens aan een AI-concept veranderd?", () => {
  it("ongewijzigd (ook met andere witruimte): niet aangepast", () => {
    const e = draftEdit("Hoeveel events organiseert u per jaar?\nKlaar als: aantal bekend", "  Hoeveel events organiseert u  per jaar? \n\nKlaar als: aantal bekend");
    expect(e).toMatchObject({ edited: false, changedLines: 0 });
    expect(describeDraftEdit(e)).toBe("Door mens aangepast: nee");
  });

  it("telt gewijzigde, toegevoegde en verwijderde regels", () => {
    expect(draftEdit("a\nb\nc", "a\nB\nc").changedLines).toBe(1);
    expect(draftEdit("a\nb\nc", "a\nb\nc\nd\ne").changedLines).toBe(2);
    expect(draftEdit("a\nb\nc", "a").changedLines).toBe(2);
    expect(draftEdit("a\nb", "b\na").changedLines).toBe(1);
    expect(describeDraftEdit(draftEdit("a\nb\nc", "a\nB\nC"))).toBe("Door mens aangepast: ja (2 regels gewijzigd)");
    expect(describeDraftEdit(draftEdit("a", "b"))).toBe("Door mens aangepast: ja (1 regel gewijzigd)");
  });

  it("onderzoeksvragen en enquêtes als regels", () => {
    expect(questionDraftText({ question: "Hoeveel bureaus?", done_criterion: "Aantal met bron" })).toBe("Hoeveel bureaus?\nAantal met bron");
    const survey = {
      title: "Events 2026",
      intro: "Korte enquête over uw events.",
      thank_you: "Bedankt!",
      questions: [{ text: "Hoe vaak organiseert u een event?", options: [{ label: "Maandelijks" }, { label: "Jaarlijks" }] }],
    };
    const text = surveyDraftText(survey);
    expect(text.split("\n")).toEqual(["Events 2026", "Korte enquête over uw events.", "Hoe vaak organiseert u een event?", "- Maandelijks", "- Jaarlijks", "Bedankt!"]);
    const edited = surveyDraftText({ ...survey, questions: [{ ...survey.questions[0], options: [{ label: "Maandelijks" }, { label: "Per kwartaal" }, { label: "Jaarlijks" }] }] });
    expect(draftEdit(text, edited)).toMatchObject({ edited: true, changedLines: 1 });
  });
});
