import { describe, expect, it } from "vitest";
import {
  computeBusinessCase,
  computeScenario,
  costSuggestions,
  emptyInputs,
  initialInputs,
  missingInputs,
  newStream,
  suggestStreams,
  unitEconomicsFromCase,
  type BusinessCaseInputs,
} from "@/lib/domain/business-case";
import { BusinessCaseSchema, parseStoredInputs } from "@/lib/business-case-schema";

const est = (v: number) => ({ v, label: "estimate" as const });

// Evenementenlocatie: 2 zalen, 10 dagdelen per week, 70% bezet, € 400 per dagdeel, € 60 kosten per dagdeel.
function venue(): BusinessCaseInputs {
  const x = emptyInputs();
  x.description = "Een evenementenlocatie voor zakelijke bijeenkomsten, workshops en culturele evenementen";
  const s = newStream("rental", "zaal");
  s.volume = est(2);
  s.slotsPerWeek = est(10);
  s.occupancyPct = est(70);
  s.price = est(400);
  s.unitCost = est(60);
  x.streams = [s];
  x.ramp = "direct";
  x.fixedCosts = [{ id: "huur", name: "Huur", perMonth: est(6000) }, { id: "pers", name: "Personeel", perMonth: est(5000) }];
  x.investments = [{ id: "verb", name: "Verbouwing", amount: est(60000), years: 5 }];
  x.answered = ["idea", "earn", "sales", "growth", "unit_costs", "fixed", "invest"];
  return x;
}

describe("businesscase: rekenkern", () => {
  it("verhuur: omzet, kosten, resultaat en kas per maand kloppen met de hand", () => {
    const r = computeScenario(venue(), "realistic");
    // 2 × 10 × 70% × 52 / 12 = 60,67 dagdelen per maand.
    const qty = (2 * 10 * 0.7 * 52) / 12;
    const m0 = r.months[0];
    expect(m0.revenue).toBeCloseTo(qty * 400, 6);
    expect(m0.variableCosts).toBeCloseTo(qty * 60, 6);
    expect(m0.fixedCosts).toBe(11000);
    expect(m0.depreciation).toBeCloseTo(1000, 6); // 60.000 over 60 maanden
    expect(m0.investment).toBe(60000);
    expect(m0.operating).toBeCloseTo(qty * 340 - 11000, 6);
    expect(m0.cash).toBeCloseTo(qty * 340 - 11000 - 60000, 6);
    expect(r.months).toHaveLength(36);
    expect(r.years).toHaveLength(3);
    expect(r.years[0].revenue).toBeCloseTo(qty * 400 * 12, 4);
    // Elke maand ≈ € 9.627 over: vanaf maand 1 quitte, investering terug in maand 7.
    expect(r.breakEvenMonth).toBe(0);
    expect(r.startCapital).toBeCloseTo(60000 - (qty * 340 - 11000), 4);
    const monthly = qty * 340 - 11000;
    expect(r.paybackMonth).toBe(Math.ceil(60000 / monthly) - 1);
  });

  it("aanloop: gemiddeld = binnen 12 maanden lineair op niveau", () => {
    const x = venue();
    x.ramp = "medium";
    const r = computeScenario(x, "realistic");
    expect(r.months[0].revenue).toBeCloseTo(r.months[11].revenue / 12, 6);
    expect(r.months[11].revenue).toBeCloseTo(r.months[30].revenue, 6);
  });

  it("scenario's: conservatief minder verkoop, hogere kosten en later op gang; optimistisch beter", () => {
    const x = venue();
    const c = computeScenario(x, "conservative");
    const r = computeScenario(x, "realistic");
    const o = computeScenario(x, "optimistic");
    expect(c.months[0].revenue).toBe(0); // zes maanden vertraging
    expect(c.months[0].fixedCosts).toBeCloseTo(12100, 6); // +10%
    expect(c.totalResult).toBeLessThan(r.totalResult);
    expect(o.totalResult).toBeGreaterThan(r.totalResult);
  });

  it("abonnement: wervingskosten voor nieuwe en vervangende klanten", () => {
    const x = emptyInputs();
    const s = newStream("subscription", "abo");
    s.volume = est(120);
    s.price = est(50);
    s.unitCost = est(5);
    s.churnPct = est(24);
    s.cac = est(100);
    x.streams = [s];
    x.ramp = "direct";
    const r = computeScenario(x, "realistic");
    expect(r.months[0].acquisitionCosts).toBeCloseTo(120 * 100, 6); // alle 120 nieuw
    expect(r.months[1].acquisitionCosts).toBeCloseTo(120 * 0.02 * 100, 6); // 2% per maand vervangen
    expect(r.months[1].revenue).toBeCloseTo(6000, 6);
  });

  it("stichting: toegezegd telt altijd, aangevraagd realistisch, een idee alleen optimistisch", () => {
    const x = emptyInputs();
    const a = newStream("funding", "a");
    a.price = est(12000);
    a.certainty = "certain";
    const b = newStream("funding", "b");
    b.price = est(24000);
    b.certainty = "applied";
    const c = newStream("funding", "c");
    c.price = est(36000);
    c.certainty = "idea";
    x.streams = [a, b, c];
    expect(computeScenario(x, "conservative").years[0].revenue).toBeCloseTo(12000 * 1, 4);
    expect(computeScenario(x, "realistic").years[0].revenue).toBeCloseTo(36000, 4);
    expect(computeScenario(x, "optimistic").years[0].revenue).toBeCloseTo(72000, 4);
  });

  it("een voorstel telt pas mee na overnemen; onbekend is geen 0", () => {
    const x = venue();
    x.streams[0].price = { v: 400, label: "proposal" };
    const r = computeBusinessCase(x);
    expect(r.scenarios.realistic.months[0].revenue).toBe(0);
    expect(r.revenueKnown).toBe(false);
    expect(r.verdict).toBe("unknown");
    expect(r.missing.some((m) => m.text.includes("de prijs"))).toBe(true);
  });
});

describe("businesscase: oordeel, ontbrekend, controles", () => {
  it("haalbaar als ook conservatief quitte speelt; krap als alleen realistisch", () => {
    expect(computeBusinessCase(venue()).verdict).toBe("looks_feasible");
    const tight = venue();
    tight.fixedCosts[1].perMonth = est(8000); // realistisch nog net positief
    const r = computeBusinessCase(tight);
    expect(r.scenarios.realistic.totalResult).toBeGreaterThan(0);
    expect(r.verdict).toBe("tight");
    const no = venue();
    no.fixedCosts[1].perMonth = est(20000);
    expect(computeBusinessCase(no).verdict).toBe("not_yet");
  });

  it("vroeg resultaat: met alleen verkoop en prijs al een omzet, oordeel 'alleen omzet'", () => {
    const x = venue();
    x.fixedCosts = [];
    x.investments = [];
    x.answered = ["idea", "earn", "sales"];
    const r = computeBusinessCase(x);
    expect(r.verdict).toBe("revenue_only");
    expect(r.scenarios.realistic.years[0].revenue).toBeGreaterThan(0);
    expect(r.missing.map((m) => m.step)).toEqual(expect.arrayContaining(["fixed", "invest"]));
  });

  it("ontbrekende gegevens per stap; lege invoer geeft geen crash", () => {
    const r = computeBusinessCase(emptyInputs());
    expect(r.verdict).toBe("unknown");
    expect(r.scenarios.realistic.totalResult).toBe(0);
    expect(missingInputs(emptyInputs()).map((m) => m.step)).toEqual(["idea", "earn", "fixed", "invest"]);
  });

  it("onrealistisch: kosten boven prijs, bezetting > 85%, geen huur bij een locatie, 0% verloop, meer klanten dan de markt", () => {
    const x = venue();
    x.streams[0].unitCost = est(450);
    x.streams[0].occupancyPct = est(95);
    x.fixedCosts = [{ id: "p", name: "Personeel", perMonth: est(5000) }];
    const texts = computeBusinessCase(x).checks.map((c) => c.text).join(" | ");
    expect(texts).toMatch(/verlies je dan geld/);
    expect(texts).toMatch(/uitzonderlijk hoog/);
    expect(texts).toMatch(/geen huur/);
    const abo = emptyInputs();
    const s = newStream("subscription", "s");
    s.volume = est(500);
    s.price = est(20);
    s.churnPct = est(0);
    abo.streams = [s];
    const t2 = computeBusinessCase(abo, { somCount: 300, somRevenue: null, intakePricePerYear: 480 }).checks.map((c) => c.text).join(" | ");
    expect(t2).toMatch(/0% klantverloop/);
    expect(t2).toMatch(/haalbare markt in Marktpotentieel 300/);
    expect(t2).toMatch(/wijkt af van de prijs uit de intake/);
  });

  it("wat weegt het zwaarst: bezetting en prijs boven een kleine kostenpost", () => {
    const x = venue();
    x.fixedCosts.push({ id: "v", name: "Verzekering", perMonth: est(100) });
    const d = computeBusinessCase(x).drivers;
    expect(d).toHaveLength(3);
    expect(d.map((x) => x.name)).not.toContain("Verzekering");
    expect(d[0].swing).toBeGreaterThanOrEqual(d[1].swing);
  });

  it("betrouwbaarheid telt bevestigd, schatting en voorstel", () => {
    const x = venue();
    x.fixedCosts[0].perMonth = { v: 6000, label: "confirmed", source: "Huurcontract" };
    const r = computeBusinessCase(x).reliability;
    expect(r.confirmed).toBe(1);
    expect(r.total).toBe(8);
    expect(r.level).toBe("low");
  });
});

describe("businesscase: koppelingen en opslag", () => {
  it("startwaarden uit Financiële haalbaarheid", () => {
    const x = initialInputs({ description: "Idee", question: "Doorgaan?", ue: { fixed_costs_year: 120000, upfront_investment: 50000 } });
    expect(x.fixedCosts[0].perMonth.v).toBe(10000);
    expect(x.investments[0].amount.v).toBe(50000);
    expect(x.answered).toEqual(["fixed", "invest"]);
  });

  it("terug naar Financiële haalbaarheid: alleen wat bekend is", () => {
    const x = emptyInputs();
    const s = newStream("subscription", "s");
    s.volume = est(100);
    s.price = est(50);
    s.unitCost = est(10);
    s.churnPct = est(20);
    x.streams = [s];
    x.fixedCosts = [{ id: "a", name: "Huur", perMonth: est(1000) }];
    x.answered = ["fixed"];
    expect(unitEconomicsFromCase(x)).toEqual({ price_per_customer_year: 600, annual_churn_pct: 20, gross_margin_pct: 80, fixed_costs_year: 12000 });
    expect(unitEconomicsFromCase(emptyInputs())).toEqual({});
  });

  it("schema: geldige invoer gaat door, rare invoer niet", () => {
    expect(BusinessCaseSchema.safeParse(venue()).success).toBe(true);
    const bad = venue();
    bad.streams[0].occupancyPct = est(140);
    expect(BusinessCaseSchema.safeParse(bad).success).toBe(false);
    const neg = venue();
    neg.fixedCosts[0].perMonth = est(-5);
    expect(BusinessCaseSchema.safeParse(neg).success).toBe(false);
    const unsourced = venue();
    unsourced.fixedCosts[0].perMonth = { v: 1, label: "confirmed" };
    expect(BusinessCaseSchema.safeParse(unsourced).success).toBe(false);
    expect(BusinessCaseSchema.safeParse({ ...venue(), extra: 1 }).success).toBe(false);
    expect(parseStoredInputs({ nonsense: true })).toBeNull();
    expect(parseStoredInputs(venue())).toEqual(venue());
  });

  it("suggesties: herkent het soort onderneming, zonder bedragen", () => {
    expect(suggestStreams("Een evenementenlocatie met horeca en workshops").map((s) => s.kind)).toEqual(["rental", "unit_sale", "service"]);
    expect(suggestStreams("Een stichting voor een buurtproject met subsidie").map((s) => s.kind)).toEqual(["funding"]);
    const c = costSuggestions(["rental"], ["Huur"]);
    expect(c).toContain("Energie en water");
    expect(c).not.toContain("Huur");
  });
});
