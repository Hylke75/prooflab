import { describe, expect, it } from "vitest";
import {
  applyCap,
  assumptionProbability,
  assumptionProbabilityV2,
  campaignFromTitle,
  DEFAULT_CAPS,
  evidenceSourceKey,
  explainMerged,
  KIND_LEVEL,
  OBSERVATION_LR,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";

// Methode 2026-11-b, deelpunt 6b: één factor per bron per aanname, tegenbewijs niet samengevoegd, plafond per niveau.
const obs = (kind: string, sourceKey: string | null, relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: sourceKey ? `Bron ${sourceKey}` : null,
  ...extra,
});
const times = <T,>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const odds = (p: number) => p / (1 - p);

describe("de factoren werken op de kansverhouding (odds)", () => {
  it("één aanbetaling bij 50%: odds 1 × 6 = 6, dus 6/7", () => {
    expect(assumptionProbabilityV2([], [obs("deposit", "a")]).probability).toBeCloseTo(6 / 7, 12);
  });
  it("bij een beginwaarde van 20%: odds 0,25 × 2 = 0,5", () => {
    const r = assumptionProbabilityV2([], [obs("current_behaviour", "a")], 0.2);
    expect(odds(r.probability)).toBeCloseTo(0.25 * 2, 12);
  });
  it("tegenbewijs deelt de odds", () => {
    expect(odds(assumptionProbabilityV2([], [obs("objection", "a")]).probability)).toBeCloseTo(1 / 1.5, 12);
  });
});

describe("samenvoegen per bron", () => {
  it("12 signalen uit één enquête tellen als één signaal", () => {
    const r = assumptionProbabilityV2([], times(12, () => obs("survey_answer", "experiment:enquete-x")), 0.2);
    expect(odds(r.probability)).toBeCloseTo(0.25 * 1.3, 12);
    expect(r.merged).toEqual([{ key: "experiment:enquete-x", label: "Bron experiment:enquete-x", signals: 12, kept: OBSERVATION_LR.survey_answer.label }]);
    expect(explainMerged(r.merged![0])).toMatch(/^12 signalen uit .* samengevoegd/);
    // Zonder samenvoegen (methode 2026-11-a) tellen ze afnemend mee: hoger.
    expect(assumptionProbability([], times(12, () => obs("survey_answer", "experiment:enquete-x")), 0.2).probability).toBeGreaterThan(r.probability);
  });
  it("houdt per bron alleen de sterkste factor", () => {
    const r = assumptionProbabilityV2([], [obs("opinion", "interview:1"), obs("current_spend", "interview:1"), obs("problem_confirmed", "interview:1")]);
    expect(r.contributions).toHaveLength(1);
    expect(r.contributions[0].lr).toBe(OBSERVATION_LR.current_spend.lr);
    expect(r.merged![0].signals).toBe(3);
  });
  it("verschillende bronnen tellen elk mee, afnemend per soort", () => {
    const r = assumptionProbabilityV2([], [obs("opinion", "interview:1"), obs("opinion", "interview:2"), obs("opinion", "interview:3")]);
    expect(r.contributions[0].count).toBe(3);
    expect(r.merged).toEqual([]);
  });
  it("signalen zonder bron zijn elk hun eigen bron", () => {
    const r = assumptionProbabilityV2([], [obs("opinion", null), obs("opinion", null)]);
    expect(r.contributions[0].count).toBe(2);
  });
  it("bevindingen uit dezelfde bron worden samengevoegd", () => {
    const r = assumptionProbabilityV2(
      [
        { status: "verified", relation: "supports", sourceKey: "source:cbs", sourceLabel: "CBS" },
        { status: "estimate", relation: "supports", sourceKey: "source:cbs", sourceLabel: "CBS" },
      ],
      [],
      0.2,
    );
    expect(odds(r.probability)).toBeCloseTo(0.25 * 1.5, 12);
    expect(r.merged![0]).toMatchObject({ label: "CBS", signals: 2 });
  });
  it("een half meetellende AI-codering wint niet van een volle waarneming uit hetzelfde interview", () => {
    const r = assumptionProbabilityV2([], [obs("current_behaviour", "interview:1"), obs("current_spend", "interview:1", "supports", { origin: "ai", reviewStatus: null })]);
    // ln 3 × 0,5 < ln 2 × 1
    expect(r.contributions[0].lr).toBe(2);
    expect(r.contributions[0].weight).toBe(1);
  });
});

describe("tegenbewijs wordt niet samengevoegd", () => {
  it("drie bezwaren uit hetzelfde interview tellen alle drie", () => {
    const list = times(3, () => obs("objection", "interview:1"));
    const r = assumptionProbabilityV2([], list);
    expect(r.contributions[0].count).toBe(3);
    expect(r.probability).toBeCloseTo(assumptionProbability([], list).probability, 12);
    expect(r.merged).toEqual([]);
  });
  it("tegenbewijs blijft staan naast samengevoegd ondersteunend bewijs uit dezelfde bron", () => {
    const r = assumptionProbabilityV2([], [obs("opinion", "interview:1"), obs("opinion", "interview:1"), obs("problem_absent", "interview:1"), obs("problem_absent", "interview:1")]);
    const against = r.contributions.find((c) => c.direction === "contradicts")!;
    const support = r.contributions.find((c) => c.direction === "supports")!;
    expect(against.count).toBe(2);
    expect(support.count).toBe(1);
  });
});

describe("plafond per bewijsniveau", () => {
  it("meningen en bureauonderzoek: hoogstens 40%", () => {
    const r = assumptionProbabilityV2([{ status: "verified", relation: "supports", sourceKey: "source:a" }, { status: "verified", relation: "supports", sourceKey: "source:b" }], times(10, (i) => obs("opinion", `interview:${i}`)));
    expect(r.cap!.uncapped).toBeGreaterThan(0.4);
    expect(r.probability).toBe(0.4);
    expect(r.cap).toMatchObject({ level: "opinion", max: 0.4, active: true });
    expect(r.cap!.reason).toBe("begrensd op 40%: nog geen probleem in eigen gedrag of huidige uitgaven");
    expect(r.band.high).toBeLessThanOrEqual(0.4);
  });
  it("demo-aanvragen: hoogstens 60%, met de reden wat ontbreekt", () => {
    const r = assumptionProbabilityV2([], times(3, (i) => obs("demo_request", `experiment:${i}`)));
    expect(r.probability).toBe(0.6);
    expect(r.cap!.reason).toBe("begrensd op 60%: nog geen offerte of gekozen prijsaanbod");
  });
  it("gekozen prijsaanbod: 75%, nog geen aanbetaling", () => {
    const r = assumptionProbabilityV2([], times(3, (i) => obs("quote_request", `experiment:${i}`)));
    expect(r.probability).toBe(0.75);
    expect(r.cap!.reason).toBe("begrensd op 75%: nog geen aanbetaling");
  });
  it("aanbetaling: 90%; herhaalaankoop: geen plafond (wel 99%)", () => {
    expect(assumptionProbabilityV2([], times(3, (i) => obs("deposit", `i:${i}`))).probability).toBe(0.9);
    const repeat = assumptionProbabilityV2([], times(3, (i) => obs("repeat_purchase", `i:${i}`)));
    expect(repeat.cap).toMatchObject({ level: "repeat", max: null, active: false });
    expect(repeat.probability).toBeGreaterThan(0.95);
  });
  it("het plafond volgt het hoogste niveau, niet het meeste bewijs", () => {
    const r = assumptionProbabilityV2([], [...times(5, (i) => obs("opinion", `o:${i}`)), obs("deposit", "d")]);
    expect(r.cap!.level).toBe("deposit");
  });
  it("is instelbaar per werkruimte", () => {
    const r = assumptionProbabilityV2([], times(3, (i) => obs("demo_request", `e:${i}`)), 0.5, {}, { ...DEFAULT_CAPS, small_action: 0.7 });
    expect(r.probability).toBe(0.7);
  });
  it("begrenst ook zonder bewijs en bij een hoge beginwaarde", () => {
    const none = assumptionProbabilityV2([], []);
    expect(none.probability).toBe(0.4);
    expect(none.cap!.reason).toMatch(/^begrensd op 40%/);
    expect(assumptionProbabilityV2([], [obs("opinion", "a")], 0.7).probability).toBe(0.4);
    expect(applyCap(0.8, 0.4)).toBe(0.4);
    expect(applyCap(0.3, 0.4)).toBe(0.3);
    expect(applyCap(0.97, null)).toBe(0.97);
  });
  it("meer ondersteunend bewijs verlaagt de kans nooit", () => {
    const before = assumptionProbabilityV2([], [obs("opinion", "a")]).probability;
    const after = assumptionProbabilityV2([], [obs("opinion", "a"), obs("survey_answer", "b")]).probability;
    expect(after).toBeGreaterThanOrEqual(before);
  });
  it("niet beoordeelde AI-codering tilt het niveau niet op", () => {
    const r = assumptionProbabilityV2([], times(4, (i) => obs("deposit", `i:${i}`, "supports", { origin: "ai", reviewStatus: null })), 0.3);
    expect(r.cap!.level).toBe("opinion");
    expect(r.probability).toBe(0.4);
  });
  it("laat tegenbewijs alleen ongemoeid", () => {
    const r = assumptionProbabilityV2([], [obs("counter_example", "a")]);
    expect(r.cap!.active).toBe(false);
    expect(r.probability).toBeCloseTo(1 / 3, 12);
  });
  it("koppelt elke soort waarneming aan een niveau", () => {
    expect(Object.keys(KIND_LEVEL).sort()).toEqual(Object.keys(OBSERVATION_LR).sort());
  });
});

describe("definitie van dezelfde bron", () => {
  it("interview, experiment, bron, campagne", () => {
    expect(evidenceSourceKey({ itemType: "observation", itemId: "o1", interviewId: "i1", experimentId: "e1", interviewLabel: "Eventmanager A" })).toEqual({ key: "interview:i1", label: "Interview Eventmanager A" });
    expect(evidenceSourceKey({ itemType: "observation", itemId: "o1", experimentId: "e1", experimentTitle: "Enquête X" })).toEqual({ key: "experiment:e1", label: "Enquête X" });
    expect(evidenceSourceKey({ itemType: "observation", itemId: "o1" }).key).toBe("observation:o1");
    expect(evidenceSourceKey({ itemType: "claim", itemId: "c1", sourceId: "s1", sourceTitle: "CBS" })).toEqual({ key: "source:s1", label: "CBS" });
    expect(evidenceSourceKey({ itemType: "claim", itemId: "c1" }).key).toBe("claim:c1");
    expect(evidenceSourceKey({ itemType: "claim", itemId: "c1", sourceId: "s9", surveyExperimentId: "e1", experimentTitle: "Enquête X" }).key).toBe("experiment:e1");
    const a = evidenceSourceKey({ itemType: "claim", itemId: "c1", sourceId: "s1", sourceType: "outreach", sourceTitle: "Outreach-antwoorden – Event-Q4 – 3 november 2026" });
    const b = evidenceSourceKey({ itemType: "claim", itemId: "c2", sourceId: "s2", sourceType: "outreach", sourceTitle: "Expandi-antwoorden – Event-Q4 – 9 november 2026" });
    expect(a.key).toBe("campaign:Event-Q4");
    expect(b.key).toBe(a.key);
    expect(campaignFromTitle("Outreach-antwoorden – Campagne – met streepje – 3 november 2026")).toBe("Campagne – met streepje");
    // Oude opgeslagen titels (vóór de neutrale benaming) horen bij dezelfde campagne.
    expect(campaignFromTitle("Expandi-antwoorden – Campagne – met streepje – 3 november 2026")).toBe("Campagne – met streepje");
    expect(campaignFromTitle("Antwoorden – Campagne – 3 november 2026")).toBeNull();
  });
});
