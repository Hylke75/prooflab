import { describe, expect, it } from "vitest";
import { sampleNeeded, verdict, wilson } from "@/lib/domain/stats";

describe("wilson interval", () => {
  it("matches the textbook value for 12/80", () => {
    const i = wilson(12, 80);
    expect(i.low).toBeCloseTo(0.0878, 3);
    expect(i.high).toBeCloseTo(0.2443, 3);
  });
  it("handles zero samples", () => {
    expect(wilson(0, 0)).toEqual({ low: 0, high: 1, point: 0 });
  });
});

describe("pre-registered verdict", () => {
  const base = { successThresholdPct: 15, failThresholdPct: 5, minSample: 80, endConditionReached: true };

  it("does not declare anything before the end condition", () => {
    expect(verdict({ ...base, successes: 30, n: 60, endConditionReached: false }).kind).toBe("running");
  });
  it("calls 13/80 = 16,25% inconclusive against a 15% threshold", () => {
    expect(verdict({ ...base, successes: 13, n: 80 }).kind).toBe("inconclusive");
  });
  it("passes when the lower bound clears the threshold", () => {
    expect(verdict({ ...base, successes: 60, n: 200 }).kind).toBe("pass");
  });
  it("fails when the upper bound is under the fail threshold", () => {
    expect(verdict({ ...base, successes: 2, n: 200 }).kind).toBe("fail");
  });
  it("is inconclusive with too few participants", () => {
    const v = verdict({ ...base, successes: 10, n: 20 });
    expect(v.kind).toBe("inconclusive");
    expect(v.reason).toMatch(/Te weinig/);
  });
  it("estimates the sample needed", () => {
    expect(sampleNeeded(25, 15)).toBeGreaterThan(30);
    expect(sampleNeeded(25, 15)).toBeLessThan(80);
    expect(sampleNeeded(10, 15)).toBeNull();
  });
});
