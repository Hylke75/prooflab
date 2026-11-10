import { describe, expect, it } from "vitest";
import { excludedCriticalCheck, GO_RULE_NOTE, isCriticalForRule, proposeGoRule } from "@/lib/domain/decision-rule-proposal";

// Gebruikerstest B1: de beslisregel neemt standaard alle kritieke aannames mee (gekozen om nu te testen én belang 5), plus
// altijd de aanname van de hoofdtest. Een kritieke aanname weglaten vraagt een motivering van minstens 15 tekens.

const assumptions = [
  { id: "a1", statement: "Clubs betalen € 49 per maand", importance: 5, selectedForTest: true },
  { id: "a2", statement: "Clubs zijn te bereiken via bonden", importance: 5, selectedForTest: true },
  { id: "a3", statement: "De dienst is AVG-conform", importance: 5, selectedForTest: true },
  { id: "a4", statement: "Vrijwilligers hebben weinig tijd", importance: 5, selectedForTest: false },
  { id: "a5", statement: "Besturen lezen nieuwsbrieven", importance: 4, selectedForTest: true },
];

describe("proposeGoRule met kritieke aannames", () => {
  it("3 kritieke aannames + 1 niet gekozen → 3 voorwaarden, de aanname van de hoofdtest eerst", () => {
    const p = proposeGoRule({ rule: null, assumption: assumptions[1], experiment: { id: "e1", title: "Kanaaltest" }, isPrimary: true, assumptions })!;
    expect(p.conditions.map((c) => c.assumptionId)).toEqual(["a2", "a1", "a3"]);
    expect(p.conditions.every((c) => c.minProbability === 0.7)).toBe(true);
    expect(p.conditions[0].main).toBe(true);
    expect(p.sentence).toMatch(/deze 3 aannames elk minstens 70% kans halen/);
  });

  it("de aanname van de hoofdtest komt er altijd in, ook als ze niet kritiek is", () => {
    const p = proposeGoRule({ rule: null, assumption: assumptions[4], experiment: { id: "e1", title: "Test" }, isPrimary: true, assumptions })!;
    expect(p.conditions.map((c) => c.assumptionId)).toEqual(["a5", "a1", "a2", "a3"]);
  });

  it("kritiek = gekozen én belang 5", () => {
    expect(assumptions.map(isCriticalForRule)).toEqual([true, true, true, false, false]);
  });
});

describe("excludedCriticalCheck", () => {
  const critical = assumptions.slice(0, 3).map((a) => ({ id: a.id, statement: a.statement }));

  it("alles gekozen: geen fout, toelichting ongewijzigd", () => {
    const r = excludedCriticalCheck({ critical, chosenIds: ["a1", "a2", "a3"], reasons: {}, baseNote: GO_RULE_NOTE });
    expect(r).toEqual({ error: null, note: GO_RULE_NOTE, excluded: [] });
  });

  it("uitsluiten zonder reden → fout", () => {
    const r = excludedCriticalCheck({ critical, chosenIds: ["a1", "a2"], reasons: { a3: "te kort" } });
    expect(r.error).toMatch(/minstens 15 tekens/);
    expect(r.error).toMatch(/AVG-conform/);
  });

  it("uitsluiten met reden → 'Uitgesloten: <aanname> – <reden>' in de toelichting", () => {
    const r = excludedCriticalCheck({ critical, chosenIds: ["a1", "a2"], reasons: { a3: "Juridische check loopt apart via de advocaat" }, baseNote: "Basis" });
    expect(r.error).toBeNull();
    if (r.error === null) {
      expect(r.note).toBe("Basis · Uitgesloten: De dienst is AVG-conform – Juridische check loopt apart via de advocaat");
      expect(r.excluded).toEqual(["a3"]);
    }
  });

  it("te lange toelichting → fout (de database staat maximaal 600 tekens toe)", () => {
    const r = excludedCriticalCheck({ critical, chosenIds: [], reasons: { a1: "x".repeat(200), a2: "y".repeat(200), a3: "z".repeat(200) } });
    expect(r.error).toMatch(/te lang/);
  });
});
