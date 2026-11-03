import { describe, expect, it } from "vitest";
import { asMethodVersion, CURRENT_METHOD, LEGACY_METHOD, METHODS, methodOf } from "@/lib/domain/method";
import { describeMethodology } from "@/lib/domain/method/describe";
import { assumptionProbability, DEFAULT_CAPS, type ProbabilityObservation } from "@/lib/domain/evidence";
import { verdict } from "@/lib/domain/stats";

// Methode 2026-11-a blijft exact de oude rekenwijze; 2026-11-b gebruikt de nieuwe regels (6c).
const obs = (kind: string, sourceKey: string): ProbabilityObservation => ({ kind, relation: "supports", isSynthetic: false, origin: "manual", sourceKey });
const input = { successes: 6, n: 20, successThresholdPct: 20, failThresholdPct: null, minSample: 20, endConditionReached: true };

describe("methodeversies", () => {
  it("onbekende of lege versie = 2026-11-a; nieuwe dossiers 2026-11-b", () => {
    expect(asMethodVersion(undefined)).toBe("2026-11-a");
    expect(asMethodVersion("2099-01-z")).toBe(LEGACY_METHOD);
    expect(asMethodVersion("2026-11-b")).toBe("2026-11-b");
    expect(CURRENT_METHOD).toBe("2026-11-b");
    expect(methodOf(null).version).toBe("2026-11-a");
  });

  it("2026-11-a rekent precies als voorheen, ook met een beslisregel op de Test Card", () => {
    const a = METHODS["2026-11-a"];
    const list = [obs("survey_answer", "e1"), obs("survey_answer", "e1"), obs("demo_request", "e2")];
    expect(a.probability([], list, 0.5, {}, DEFAULT_CAPS)).toEqual(assumptionProbability([], list, 0.5, {}));
    const v = a.verdict({ decision_rule: "probability" }, input);
    expect(v.kind).toBe(verdict(input).kind);
    expect(v.kind).toBe("inconclusive");
    expect(v.rule).toBe("interval");
  });

  it("2026-11-b gebruikt de beslisregel; zonder vastgelegde regel de kansregel", () => {
    const b = METHODS["2026-11-b"];
    expect(b.verdict({}, input).kind).toBe("pass");
    expect(b.verdict({}, input).rule).toBe("probability");
    expect(b.verdict({ decision_rule: "absolute", success_count: 7 }, input).kind).toBe("fail");
    expect(b.verdict({ decision_rule: "absolute", success_count: 6 }, input).kind).toBe("pass");
  });

  it("2026-11-b voegt per bron samen en begrenst", () => {
    const b = METHODS["2026-11-b"];
    const r = b.probability([], [obs("demo_request", "e1"), obs("demo_request", "e1"), obs("demo_request", "e2"), obs("demo_request", "e3")], 0.5, {}, DEFAULT_CAPS);
    expect(r.merged?.[0].signals).toBe(2);
    expect(r.probability).toBe(0.6);
  });

  it("beschrijft de methode, regels en plafonds voor het rapport", () => {
    const d = describeMethodology({ version: "2026-11-b", label: "Methode 2026-11-b", rules: METHODS["2026-11-b"].rules, caps: DEFAULT_CAPS, capsCustom: false });
    expect(d.title).toBe("Methode 2026-11-b");
    expect(d.lines.join(" ")).toMatch(/kansregel/);
    expect(d.lines.at(-1)).toMatch(/standaardwaarden.*aanbetaling 90%.*herhaalaankoop geen plafond/);
    expect(describeMethodology(null).title).toBe("Methode 2026-11-a");
  });
});
