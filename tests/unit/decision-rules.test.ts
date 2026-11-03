import { describe, expect, it } from "vitest";
import { betaCdf, probabilityAbove, requiredSample, sampleFeasibility, sampleNeeded, verdict, verdictV1, verdictV2, wilson } from "@/lib/domain/stats";

// Methode 2026-11-b, deelpunt 6a: beslisregels per testtype met bekende waarden.
const base = { failThresholdPct: null, minSample: 20, endConditionReached: true } as const;

describe("bètaverdeling", () => {
  it("geeft bekende waarden van de Beta-CDF", () => {
    expect(betaCdf(0.5, 1, 1)).toBeCloseTo(0.5, 12);
    expect(betaCdf(0.3, 2, 1)).toBeCloseTo(0.09, 12); // x²
    expect(betaCdf(0.3, 1, 3)).toBeCloseTo(1 - 0.7 ** 3, 12);
    // Symmetrie: I_x(a,b) = 1 − I_{1−x}(b,a)
    expect(betaCdf(0.2, 7, 15) + betaCdf(0.8, 15, 7)).toBeCloseTo(1, 12);
  });
  it("6/20 bij 20%: P(p > 0,2 | Beta(7,15)) ≈ 0,891", () => {
    expect(probabilityAbove(6, 20, 20)).toBeCloseTo(0.891, 3);
  });
});

describe("kansregel", () => {
  it("6/20 bij een drempel van 20% is geslaagd, maar niet sterk bewezen", () => {
    const v = verdictV2({ ...base, successes: 6, n: 20, successThresholdPct: 20, rule: "probability" });
    expect(v.kind).toBe("pass");
    expect(v.probability).toBeCloseTo(0.891, 3);
    expect(v.interval.low).toBeCloseTo(0.1455, 3); // ≈ 0,146
    expect(v.strongProof).toBe(false);
    expect(v.label).toBe("geslaagd");
    // De oude intervalregel (2026-11-a) noemt hetzelfde resultaat onbeslist.
    expect(verdict({ ...base, successes: 6, n: 20, successThresholdPct: 20 }).kind).toBe("inconclusive");
    expect(verdictV1({ ...base, successes: 6, n: 20, successThresholdPct: 20 }).rule).toBe("interval");
  });
  it("geeft het label sterk bewezen als ook de Wilson-ondergrens boven de drempel ligt", () => {
    const v = verdictV2({ ...base, successes: 60, n: 200, successThresholdPct: 20, rule: "probability" });
    expect(wilson(60, 200).low).toBeGreaterThan(0.2);
    expect(v.kind).toBe("pass");
    expect(v.strongProof).toBe(true);
    expect(v.label).toBe("sterk bewezen");
  });
  it("0/n is niet geslaagd, n/n is sterk bewezen", () => {
    const zero = verdictV2({ ...base, successes: 0, n: 20, successThresholdPct: 20, rule: "probability" });
    expect(zero.probability).toBeCloseTo(0.8 ** 21, 10); // P(p > 0,2 | Beta(1,21)) = 0,8²¹
    expect(zero.kind).toBe("fail");
    const all = verdictV2({ ...base, successes: 20, n: 20, successThresholdPct: 20, rule: "probability" });
    expect(all.probability).toBeCloseTo(1 - 0.2 ** 21, 12);
    expect(all.kind).toBe("pass");
    expect(all.label).toBe("sterk bewezen");
  });
  it("gebruikt de faaldrempel voor niet geslaagd: P(p > faaldrempel) ≤ 0,20", () => {
    // 2/20 met succes 20% en faal 10%: P(p>0,2) laag, maar P(p>0,1) ≈ 0,37 → onbeslist.
    const v = verdictV2({ ...base, failThresholdPct: 10, successes: 2, n: 20, successThresholdPct: 20, rule: "probability" });
    expect(v.probabilityFail).toBeGreaterThan(0.2);
    expect(v.kind).toBe("inconclusive");
    const w = verdictV2({ ...base, failThresholdPct: 10, successes: 0, n: 30, successThresholdPct: 20, rule: "probability" });
    expect(w.probabilityFail).toBeLessThanOrEqual(0.2);
    expect(w.kind).toBe("fail");
  });
  it("is onbeslist tussen 0,20 en 0,80", () => {
    const v = verdictV2({ ...base, successes: 4, n: 20, successThresholdPct: 20, rule: "probability" });
    expect(v.probability!).toBeGreaterThan(0.2);
    expect(v.probability!).toBeLessThan(0.8);
    expect(v.kind).toBe("inconclusive");
  });
  it("zegt niets voor de eindconditie en is onbeslist onder de minimale steekproef", () => {
    expect(verdictV2({ ...base, endConditionReached: false, successes: 15, n: 20, successThresholdPct: 20, rule: "probability" }).kind).toBe("running");
    expect(verdictV2({ ...base, successes: 9, n: 10, successThresholdPct: 20, rule: "probability" }).kind).toBe("inconclusive");
  });
});

describe("aantalregel", () => {
  const abs = { ...base, minSample: 15, successThresholdPct: 20, rule: "absolute" as const, successCount: 3 };
  it("minstens 3 aanbetalingen uit 15 gesprekken", () => {
    expect(verdictV2({ ...abs, successes: 3, n: 15 }).kind).toBe("pass");
    expect(verdictV2({ ...abs, successes: 2, n: 15 }).kind).toBe("fail");
    expect(verdictV2({ ...abs, successes: 2, n: 15 }).successCount).toBe(3);
  });
  it("wacht op de eindconditie en is onbeslist als de test niet volledig is uitgevoerd", () => {
    expect(verdictV2({ ...abs, endConditionReached: false, successes: 5, n: 10 }).kind).toBe("running");
    expect(verdictV2({ ...abs, successes: 2, n: 10 }).kind).toBe("inconclusive");
    expect(verdictV2({ ...abs, successes: 3, n: 10 }).kind).toBe("pass");
  });
  it("heeft geen kans", () => {
    expect(verdictV2({ ...abs, successes: 3, n: 15 }).probability).toBeNull();
  });
});

describe("benodigd aantal deelnemers", () => {
  it("is de kleinste n met P(p > drempel) ≥ 0,8 bij het verwachte aandeel", () => {
    const n = requiredSample({ rule: "probability", expectedPct: 40, thresholdPct: 30 })!;
    expect(n).toBe(12);
    expect(probabilityAbove(0.4 * n, n, 30)).toBeGreaterThanOrEqual(0.8);
    expect(probabilityAbove(0.4 * (n - 1), n - 1, 30)).toBeLessThan(0.8);
    const m = requiredSample({ rule: "probability", expectedPct: 60, thresholdPct: 50 })!;
    expect(probabilityAbove(0.6 * m, m, 50)).toBeGreaterThanOrEqual(0.8);
    expect(probabilityAbove(0.6 * (m - 1), m - 1, 50)).toBeLessThan(0.8);
  });
  it("blijft daarna gehaald en heeft een ondergrens van 5 (de vlakke prior geeft bij lage drempels al 0,8)", () => {
    // Zonder data: P(p > 0,2 | Beta(1,1)) = 0,8. De kans zakt eerst (n = 1–3) en stijgt daarna.
    expect(probabilityAbove(0, 0, 20)).toBeCloseTo(0.8, 12);
    const n = requiredSample({ rule: "probability", expectedPct: 30, thresholdPct: 20 })!;
    expect(n).toBeGreaterThanOrEqual(5);
    for (let k = n; k < n + 200; k++) expect(probabilityAbove(0.3 * k, k, 20)).toBeGreaterThanOrEqual(0.8);
    expect(requiredSample({ rule: "probability", expectedPct: 25, thresholdPct: 15 })).toBe(5);
  });
  it("is kleiner dan voor de intervalregel", () => {
    expect(requiredSample({ rule: "probability", expectedPct: 40, thresholdPct: 30 })!).toBeLessThan(sampleNeeded(40, 30)!);
  });
  it("vindt ook grote aantallen bij een klein verschil", () => {
    const n = requiredSample({ rule: "probability", expectedPct: 21, thresholdPct: 20 })!;
    expect(n).toBeGreaterThan(400);
    expect(probabilityAbove(0.21 * n, n, 20)).toBeGreaterThanOrEqual(0.8);
    expect(probabilityAbove(0.21 * (n - 1), n - 1, 20)).toBeLessThan(0.8);
  });
  it("is null als de verwachting de drempel niet haalt", () => {
    expect(requiredSample({ rule: "probability", expectedPct: 20, thresholdPct: 20 })).toBeNull();
    expect(requiredSample({ rule: "probability", expectedPct: 10, thresholdPct: 20 })).toBeNull();
  });
  it("voor de aantalregel: aantal ÷ verwacht aandeel, naar boven afgerond", () => {
    expect(requiredSample({ rule: "absolute", expectedPct: 20, thresholdPct: 20, successCount: 3 })).toBe(15);
    expect(requiredSample({ rule: "absolute", expectedPct: 25, thresholdPct: 20, successCount: 3 })).toBe(12);
  });
  it("waarschuwt als het binnen de looptijd niet haalbaar is", () => {
    const f = sampleFeasibility({ requiredN: 60, availablePerWeek: 10, maxDurationDays: 21, minSample: 60 });
    expect(f.capacity).toBe(30);
    expect(f.warnings[0]).toMatch(/Niet realistisch/);
    expect(sampleFeasibility({ requiredN: 60, availablePerWeek: 30, maxDurationDays: 21, minSample: 60 }).warnings).toEqual([]);
    expect(sampleFeasibility({ requiredN: 60, availablePerWeek: null, maxDurationDays: 21, minSample: 40 }).warnings[0]).toMatch(/minimale steekproef/);
  });
});
