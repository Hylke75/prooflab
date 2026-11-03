import { describe, expect, it } from "vitest";
import {
  assumptionProbabilityV2,
  assumptionProbabilityV3,
  diminishing,
  explainContribution,
  OBSERVATION_LR,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";
import { explainRecruitment, interviewRecruitment, recruitmentLabel, recruitmentMissing } from "@/lib/domain/recruitment";

// Methode 2026-11-c (golf A). Punt 4: herhaling binnen dezelfde wervingsgroep over verschillende bronnen heen telt
// afnemend mee.
const obs = (kind: string, sourceKey: string, recruitmentGroup: string | null, extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  kind,
  relation: "supports",
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: `Bron ${sourceKey}`,
  recruitmentGroup,
  ...extra,
});
const logit = (p: number) => Math.log(p / (1 - p));

describe("punt 4: wervingsgroep", () => {
  it("zonder wervingsgroepen rekent 2026-11-c precies als 2026-11-b", () => {
    const list = [obs("demo_request", "e1", null), obs("demo_request", "e2", null), obs("objection", "i1", null, { relation: "contradicts" })];
    const b = assumptionProbabilityV2([], list);
    const c = assumptionProbabilityV3([], list);
    expect(c.probability).toBe(b.probability);
    expect(c.shift).toBe(b.shift);
    expect(c.recruitment).toEqual([]);
  });

  it("drie bronnen uit hetzelfde eigen netwerk tellen samen minder dan drie onafhankelijke bronnen", () => {
    const same = [obs("survey_answer", "e1", "own_network"), obs("survey_answer", "e2", "own_network"), obs("survey_answer", "e3", "own_network")];
    const spread = [obs("survey_answer", "e1", "own_network"), obs("survey_answer", "e2", "cold"), obs("survey_answer", "e3", "paid_panel")];
    const c = assumptionProbabilityV3([], same);
    const independent = assumptionProbabilityV3([], spread);
    // Onafhankelijk: ln(1,3) × log₂(4) = 2 × ln(1,3).
    expect(independent.shift).toBeCloseTo(Math.log(1.3) * diminishing(3), 12);
    // Dezelfde groep: factoren 1; log₂3 − 1; 2 − log₂3, gewogen met de afnemende reeks per soort.
    const d = [1, diminishing(2) - diminishing(1), diminishing(3) - diminishing(2)];
    const effective = d.reduce((s, x, k) => s + x * (diminishing(k + 1) - diminishing(k)), 0);
    expect(c.shift).toBeCloseTo(Math.log(1.3) * effective, 12);
    expect(c.shift).toBeLessThan(independent.shift);
    expect(c.recruitment).toEqual([{ group: "own_network", sources: 3 }]);
    expect(c.contributions[0].effective).toBeCloseTo(effective, 12);
    expect(explainContribution(c.contributions[0])).toMatch(/minder door herhaling binnen dezelfde wervingsgroep/);
    // 2026-11-b kent geen wervingsgroep.
    expect(assumptionProbabilityV2([], same).shift).toBeCloseTo(independent.shift, 12);
  });

  it("het sterkste signaal van een groep telt volledig, de rest afnemend", () => {
    const r = assumptionProbabilityV3([], [obs("waitlist_signup", "e1", "warm"), obs("demo_request", "e2", "warm")]);
    // Twee verschillende soorten: elk een eigen groep met één signaal; het tweede krijgt factor log₂3 − 1.
    const lr = OBSERVATION_LR.demo_request.lr;
    expect(r.shift).toBeCloseTo(Math.log(lr) + Math.log(lr) * (diminishing(2) - diminishing(1)), 12);
  });

  it("onbekend telt als één groep; bureauonderzoek (zonder werving) valt erbuiten", () => {
    const r = assumptionProbabilityV3(
      [
        { status: "verified", relation: "supports", sourceKey: "s1" },
        { status: "verified", relation: "supports", sourceKey: "s2" },
      ],
      [obs("demo_request", "e1", "unknown"), obs("demo_request", "e2", "unknown")],
    );
    expect(r.recruitment).toEqual([{ group: "unknown", sources: 2 }]);
    const claims = r.contributions.find((c) => c.key.startsWith("claim:"))!;
    expect(claims.effective).toBeUndefined();
  });

  it("samenvoegen per bron gaat vóór de wervingsgroep: twaalf antwoorden uit één enquête zijn één signaal", () => {
    const r = assumptionProbabilityV3([], Array.from({ length: 12 }, () => obs("survey_answer", "e1", "own_network")));
    expect(r.recruitment).toEqual([]);
    expect(r.merged?.[0].signals).toBe(12);
  });

  it("tegenbewijs wordt niet gedempt", () => {
    const against = [obs("objection", "i1", "own_network", { relation: "contradicts" }), obs("objection", "i2", "own_network", { relation: "contradicts" })];
    expect(assumptionProbabilityV3([], against).shift).toBeCloseTo(assumptionProbabilityV2([], against).shift, 12);
  });

  it("de kans blijft binnen het plafond en meer bewijs verlaagt de kans nooit", () => {
    const one = assumptionProbabilityV3([], [obs("demo_request", "e1", "cold")]);
    const two = assumptionProbabilityV3([], [obs("demo_request", "e1", "cold"), obs("demo_request", "e2", "cold")]);
    expect(two.probability).toBeGreaterThanOrEqual(one.probability);
    expect(logit(two.probability)).toBeLessThanOrEqual(logit(0.6) + 1e-12);
  });

  it("labels en interviews: een bekende is eigen netwerk", () => {
    expect(interviewRecruitment(true, "cold")).toBe("own_network");
    expect(interviewRecruitment(false, "cold")).toBe("cold");
    expect(interviewRecruitment(false, null, "warm")).toBe("warm");
    expect(interviewRecruitment(false, null)).toBe("unknown");
    expect(recruitmentLabel("paid_panel")).toBe("Betaald panel");
    expect(recruitmentLabel("iets")).toBe("Onbekend");
    expect(explainRecruitment({ group: "own_network", sources: 3 })).toBe("3 signalen uit dezelfde wervingsgroep (eigen netwerk): herhaling telt afnemend mee.");
  });
});

describe("punt 13: wervingsgroep verplicht op de Test Card", () => {
  it("bij enquête-, landing- en prijstests; niet bij interviews (per gesprek)", () => {
    for (const t of ["survey", "landing", "pricing"]) {
      expect(recruitmentMissing(t, "")).toBe(true);
      expect(recruitmentMissing(t, "vrienden")).toBe(true);
      expect(recruitmentMissing(t, "unknown")).toBe(false);
      expect(recruitmentMissing(t, "cold")).toBe(false);
    }
    expect(recruitmentMissing("interview", null)).toBe(false);
  });
});
