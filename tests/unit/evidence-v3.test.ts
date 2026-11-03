import { describe, expect, it } from "vitest";
import {
  assumptionProbability,
  assumptionProbabilityV2,
  assumptionProbabilityV3,
  DEFAULT_CAPS,
  diminishing,
  explainContribution,
  OBSERVATION_LR,
  outcomeWithLevel,
  testEvidenceLevel,
  type ProbabilityClaim,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";
import { explainIndirect } from "@/lib/domain/claim-scope";
import { METHODS } from "@/lib/domain/method";
import { changesBetween } from "@/lib/domain/method/describe";
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

describe("punt 14: bewijsniveau naast de uitkomst", () => {
  it("volgt de niveau-indeling van de plafonds", () => {
    expect(testEvidenceLevel("survey")).toBe("opinion");
    expect(testEvidenceLevel("landing")).toBe("small_action");
    expect(testEvidenceLevel("pricing")).toBe("quote");
    expect(testEvidenceLevel("interview")).toBe("problem");
    expect(testEvidenceLevel("interview", { decisionRule: "absolute" })).toBe("deposit");
  });

  it("'Geslaagd · niveau: mening'", () => {
    expect(outcomeWithLevel("geslaagd", "opinion")).toBe("Geslaagd · niveau: mening");
    expect(outcomeWithLevel("sterk bewezen", "deposit")).toBe("Sterk bewezen · niveau: aanbetaling");
    expect(outcomeWithLevel("onbeslist", null)).toBe("Onbeslist");
  });
});

// Koppeling golf C → methode 2026-11-c: een indirecte bevinding (claims.relevance) telt met halve sterkte.
describe("relevantie: indirect bewijs telt half in 2026-11-c", () => {
  const claim = (sourceKey: string, relevance: string | null, relation: "supports" | "contradicts" = "supports"): ProbabilityClaim => ({
    status: "verified",
    relation,
    sourceKey,
    sourceLabel: `Bron ${sourceKey}`,
    relevance,
  });

  it("een indirecte bevinding verschuift de log-odds half zo veel als een directe", () => {
    const direct = assumptionProbabilityV3([claim("s1", "direct")], []);
    const indirect = assumptionProbabilityV3([claim("s1", "indirect")], []);
    expect(direct.shift).toBeCloseTo(Math.log(1.5), 12);
    expect(indirect.shift).toBeCloseTo(0.5 * Math.log(1.5), 12);
    expect(indirect.indirect).toBe(1);
    expect(direct.indirect).toBe(0);
    expect(indirect.top[0].weight).toBe(0.5);
    expect(indirect.top[0].label).toMatch(/indirect bewijs/);
    expect(explainContribution(indirect.top[0])).toMatch(/half gewicht/);
  });

  it("ook tegenbewijs uit een indirecte bevinding telt half", () => {
    const p = assumptionProbabilityV3([claim("s1", "indirect", "contradicts")], []);
    expect(p.shift).toBeCloseTo(-0.5 * Math.log(1.5), 12);
  });

  it("zonder relevantie (oude gegevens) telt een bevinding als direct", () => {
    expect(assumptionProbabilityV3([claim("s1", null)], []).shift).toBe(assumptionProbabilityV3([claim("s1", "direct")], []).shift);
  });

  it("2026-11-a en 2026-11-b rekenen exact ongewijzigd", () => {
    const list = [claim("s1", "indirect"), claim("s2", "indirect"), claim("s3", "direct"), claim("s4", "indirect", "contradicts")];
    const plain = list.map((c) => ({ status: c.status, relation: c.relation, sourceKey: c.sourceKey, sourceLabel: c.sourceLabel }));
    for (const prior of [0.2, 0.5, 0.7]) {
      expect(assumptionProbability(list, [], prior)).toEqual(assumptionProbability(plain, [], prior));
      expect(assumptionProbabilityV2(list, [], prior)).toEqual(assumptionProbabilityV2(plain, [], prior));
      expect(METHODS["2026-11-a"].probability(list, [], prior, {}, DEFAULT_CAPS)).toEqual(METHODS["2026-11-a"].probability(plain, [], prior, {}, DEFAULT_CAPS));
      expect(METHODS["2026-11-b"].probability(list, [], prior, {}, DEFAULT_CAPS)).toEqual(METHODS["2026-11-b"].probability(plain, [], prior, {}, DEFAULT_CAPS));
    }
    // Vaste waarden: drie ondersteunende geverifieerde bevindingen (afnemend) en één tegensprekende.
    const a = assumptionProbability(list, []);
    expect(a.shift).toBeCloseTo(Math.log(1.5) * diminishing(3) - Math.log(1.5), 12);
    expect("indirect" in a).toBe(false);
    const b = assumptionProbabilityV2(list, []);
    expect(b.shift).toBeCloseTo(Math.log(1.5) * diminishing(3) - Math.log(1.5), 12);
    expect("indirect" in b).toBe(false);
    // 2026-11-c rekent wel anders: twee ondersteunende indirecte bevindingen en één tegensprekende tellen half.
    const c = assumptionProbabilityV3(list, []);
    expect(c.shift).toBeCloseTo(Math.log(1.5) * (1 + 0.5 * diminishing(2)) - 0.5 * Math.log(1.5), 12);
    expect(c.indirect).toBe(3);
  });

  it("de toelichting op de aannamepagina en de overstappagina", () => {
    expect(explainIndirect(1)).toMatch(/^Telt half: indirect bewijs \(1 bevinding /);
    expect(explainIndirect(2)).toMatch(/2 bevindingen gaan/);
    expect(changesBetween("2026-11-b", "2026-11-c")[0]).toMatch(/indirect bewijs .* telt half/);
    expect(METHODS["2026-11-c"].rules.some((r) => /indirecte bevinding .* halve sterkte/.test(r))).toBe(true);
    expect(METHODS["2026-11-b"].rules.some((r) => /indirect/.test(r))).toBe(false);
  });
});
