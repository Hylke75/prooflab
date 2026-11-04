import { describe, expect, it } from "vitest";
import {
  assumptionProbabilityV3,
  assumptionProbabilityV4,
  DEFAULT_CAPS,
  diminishing,
  explainMerged,
  mergedShort,
  OBSERVATION_LR,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";
import { CURRENT_METHOD, isLaterMethod, METHODS } from "@/lib/domain/method";
import { changesBetween } from "@/lib/domain/method/describe";

// Methode 2026-11-d: tegenbewijs telt per bron één keer, net als ondersteunend bewijs.
const obs = (kind: string, sourceKey: string, relation: "supports" | "contradicts" = "contradicts", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: `Interview ${sourceKey}`,
  recruitmentGroup: null,
  ...extra,
});
const times = <T>(n: number, f: (i: number) => T): T[] => Array.from({ length: n }, (_, i) => f(i));
const objection = OBSERVATION_LR.objection.lrAgainst ?? OBSERVATION_LR.objection.lr;

describe("methode 2026-11-d: tegenbewijs per bron", () => {
  it("vijf bezwaren van één interview geven dezelfde kansverlaging als één bezwaar", () => {
    const one = assumptionProbabilityV4([], [obs("objection", "interview:1")]);
    const five = assumptionProbabilityV4([], times(5, () => obs("objection", "interview:1")));
    expect(five.probability).toBe(one.probability);
    expect(five.shift).toBe(one.shift);
    expect(five.shift).toBeCloseTo(-Math.log(objection), 12);
    expect(five.probability).toBeLessThan(0.5);
    expect(five.merged).toEqual([{ key: "interview:1:tegen", label: "Interview interview:1", signals: 5, kept: "Bezwaar", direction: "contradicts" }]);
    expect(explainMerged(five.merged![0])).toBe("5 tegensignalen uit Interview interview:1 samengevoegd: alleen het sterkste tegenbewijs telt (Bezwaar).");
    expect(mergedShort(five.merged![0])).toBe("5 tegensignalen uit Interview interview:1 samengevoegd");
  });

  it("bezwaren van vijf verschillende interviews tellen elk mee (afnemend per soort)", () => {
    const one = assumptionProbabilityV4([], [obs("objection", "interview:1")]);
    const five = assumptionProbabilityV4([], times(5, (i) => obs("objection", `interview:${i}`)));
    expect(five.shift).toBeCloseTo(-Math.log(objection) * diminishing(5), 12);
    expect(five.probability).toBeLessThan(one.probability);
    expect(five.contributions).toHaveLength(1);
    expect(five.contributions[0].count).toBe(5);
    expect(five.merged).toEqual([]);
  });

  it("2026-11-c telt dezelfde vijf bezwaren van één interview nog per citaat", () => {
    const list = times(5, () => obs("objection", "interview:1"));
    const c = assumptionProbabilityV3([], list);
    expect(c.shift).toBeCloseTo(-Math.log(objection) * diminishing(5), 12);
    expect(c.probability).toBeLessThan(assumptionProbabilityV4([], list).probability);
  });

  it("per bron telt het sterkste tegensignaal; steunend bewijs uit dezelfde bron blijft apart meetellen", () => {
    const list = [obs("objection", "interview:1"), obs("counter_example", "interview:1"), obs("objection", "interview:1"), obs("problem_confirmed", "interview:1", "supports")];
    const r = assumptionProbabilityV4([], list);
    const against = r.contributions.filter((c) => c.direction === "contradicts");
    expect(against).toHaveLength(1);
    expect(against[0].label).toBe(OBSERVATION_LR.counter_example.label);
    expect(against[0].count).toBe(1);
    expect(r.contributions.filter((c) => c.direction === "supports")).toHaveLength(1);
  });

  it("tegenbewijs zonder bron (eigen sleutel per signaal) wordt niet samengevoegd", () => {
    const list = times(3, () => obs("objection", "", "contradicts", { sourceKey: null }));
    expect(assumptionProbabilityV4([], list).shift).toBeCloseTo(-Math.log(objection) * diminishing(3), 12);
  });

  it("de afnemende factor binnen een wervingsgroep geldt niet voor tegenbewijs", () => {
    const same = times(3, (i) => obs("objection", `interview:${i}`, "contradicts", { recruitmentGroup: "own_network" }));
    const r = assumptionProbabilityV4([], same);
    expect(r.shift).toBeCloseTo(-Math.log(objection) * diminishing(3), 12);
    expect(r.recruitment).toEqual([]);
  });

  it("plafonds blijven gelden zoals in 2026-11-c", () => {
    const list = [...times(4, (i) => obs("demo_request", `e${i}`, "supports")), obs("objection", "interview:9"), obs("objection", "interview:9")];
    const d = assumptionProbabilityV4([], list, 0.5, {}, DEFAULT_CAPS);
    const c = assumptionProbabilityV3([], list, 0.5, {}, DEFAULT_CAPS);
    expect(d.cap?.level).toBe(c.cap?.level);
    expect(d.cap?.max).toBe(c.cap?.max);
  });

  it("zonder herhaald tegenbewijs uit één bron rekent 2026-11-d precies als 2026-11-c", () => {
    const list = [obs("demo_request", "e1", "supports"), obs("demo_request", "e1", "supports"), obs("objection", "interview:1"), obs("objection", "interview:2")];
    const c = assumptionProbabilityV3([], list);
    const d = assumptionProbabilityV4([], list);
    expect(d.probability).toBe(c.probability);
    expect(d.shift).toBe(c.shift);
    expect(d.merged).toEqual(c.merged);
  });
});

describe("methodeversie 2026-11-d", () => {
  it("is de versie voor nieuwe dossiers en alleen vooruit bereikbaar", () => {
    expect(CURRENT_METHOD).toBe("2026-11-d");
    expect(isLaterMethod("2026-11-c", "2026-11-d")).toBe(true);
    expect(isLaterMethod("2026-11-d", "2026-11-c")).toBe(false);
    expect(changesBetween("2026-11-c", "2026-11-d")).toEqual([expect.stringMatching(/^2026-11-d: Ook tegenbewijs telt per bron één keer/)]);
  });

  it("rekent via assumptionProbabilityV4 en neemt oordeel en regels van 2026-11-c over", () => {
    const d = METHODS["2026-11-d"];
    const list = times(5, () => obs("objection", "interview:1"));
    expect(d.probability([], list, 0.5, {}, DEFAULT_CAPS)).toEqual(assumptionProbabilityV4([], list, 0.5, {}, DEFAULT_CAPS));
    expect(d.verdict).toBe(METHODS["2026-11-c"].verdict);
    expect(d.primaryDecides && d.usesCaps && d.usesRules).toBe(true);
    expect(d.rules.slice(0, -1)).toEqual(METHODS["2026-11-c"].rules);
    expect(d.rules.at(-1)).toMatch(/Tegenbewijs telt per bron één keer/);
  });
});
