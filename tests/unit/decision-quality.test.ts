import { describe, expect, it } from "vitest";
import { assessDecisionQuestion, formatStake, isStakeKind, rewriteExample } from "@/lib/domain/decision-quality";

describe("vaagheidscontrole van de beslisvraag", () => {
  it.each([
    "Is er voldoende markt?",
    "Is er voldoende markt voor dit aanbod?",
    "is er vraag naar dit product",
    "Kan dit werken?",
    "Is dit een goed idee voor onze klanten?",
    "Heeft dit idee potentie in Nederland?",
  ])("waarschuwt bij de vage vraag %j", (q) => {
    const r = assessDecisionQuestion(q);
    expect(r.ok).toBe(false);
    expect(r.warnings.length).toBeGreaterThan(0);
    expect(r.example).toMatch(/^Investeren we/);
  });

  it.each([
    "Investeren we €25.000 in een eerste versie voor eventmanagers?",
    "Lanceren we het abonnement vóór 1 maart in de Benelux?",
    "Stoppen we met de huidige dienst of bouwen we een nieuwe?",
    "Nemen we in het voorjaar een extra consultant aan?",
    "Kiezen we voor MKB of voor zorginstellingen als eerste doelgroep?",
    "Starten we een pilot met drie gemeenten?",
  ])("laat de concrete keuze %j door", (q) => {
    expect(assessDecisionQuestion(q)).toEqual({ ok: true, warnings: [], example: null });
  });

  it("waarschuwt als een keuzewerkwoord ontbreekt", () => {
    const r = assessDecisionQuestion("Welke doelgroep biedt de grootste kans?");
    expect(r.ok).toBe(false);
    expect(r.warnings.join(" ")).toMatch(/geen keuze/);
  });

  it("blokkeert nooit: het resultaat is alleen advies, ook voor lege invoer", () => {
    expect(assessDecisionQuestion("").ok).toBe(true);
    expect(assessDecisionQuestion("markt?").ok).toBe(true);
  });

  it("maakt het herschrijfvoorbeeld concreet met inzet, idee, doelgroep en datum", () => {
    const ex = rewriteExample({ title: "Locatie-assistent", audience: "Zakelijke klanten (B2B)", stake: { kind: "amount", value: 25000 }, deadline: "2027-03-01" });
    expect(ex).toContain("€ 25.000");
    expect(ex).toContain('"Locatie-assistent"');
    expect(ex).toContain("zakelijke klanten (B2B)");
    expect(ex).toContain("1 maart 2027");
    expect(rewriteExample({ stake: { kind: "time", value: 120 } })).toContain("120 uur");
    expect(rewriteExample()).toContain("vóór de beslisdatum");
  });
});

describe("inzet", () => {
  it("formatteert bedrag, tijd en capaciteit", () => {
    expect(formatStake("amount", 25000)).toBe("€ 25.000");
    expect(formatStake("time", 120)).toBe("120 uur");
    expect(formatStake("capacity", 1.5)).toBe("1,5 fte");
  });
  it("herkent alleen de drie soorten", () => {
    expect(isStakeKind("amount")).toBe(true);
    expect(isStakeKind("geld")).toBe(false);
  });
});
