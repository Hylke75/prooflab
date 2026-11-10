import { describe, expect, it } from "vitest";
import { breakEvenRevenue, computeSizing, computeUnitEconomics, simulateSizing } from "@/lib/domain/sizing";

// Vastlegtests (businesscase-opdracht, fase 2): de bestaande financiële formules mogen niet ongemerkt veranderen.
// De verwachte waarden zijn met de hand nagerekend.

describe("bestaande berekeningen blijven gelijk", () => {
  it("marktomvang zakelijk: aantal × aandelen × omzet per klant", () => {
    const r = computeSizing("b2b_accounts", [
      { key: "base_count", value: 10000 },
      { key: "fit_pct", value: 20 },
      { key: "reach_pct", value: 50 },
      { key: "winnable_pct", value: 3 },
      { key: "revenue_per_customer", value: 1200 },
    ]);
    expect(r.tamCount).toBe(10000);
    expect(r.samCount).toBeCloseTo(1000, 6);
    expect(r.somCount).toBeCloseTo(30, 6);
    expect(r.tamRevenue).toBeCloseTo(12_000_000, 2);
    expect(r.samRevenue).toBeCloseTo(1_200_000, 2);
    expect(r.somRevenue).toBeCloseTo(36_000, 2);
    expect(r.missing).toEqual([]);
    expect(r.provenance).toEqual({ sourced: 0, assumed: 5, total: 5 });
  });

  it("marktomvang per aankoop: frequentie × besteding", () => {
    const r = computeSizing("transactions", [
      { key: "base_count", value: 50000 },
      { key: "fit_pct", value: 10 },
      { key: "reach_pct", value: 40 },
      { key: "winnable_pct", value: 5 },
      { key: "frequency", value: 4 },
      { key: "ticket", value: 25 },
    ]);
    expect(r.somCount).toBeCloseTo(100, 6);
    expect(r.somRevenue).toBeCloseTo(10_000, 4);
  });

  it("financiële haalbaarheid: marge, terugverdientijd, klantwaarde, break-even", () => {
    const r = computeUnitEconomics({ pricePerCustomerYear: 1200, grossMarginPct: 75, cacEur: 450, annualChurnPct: 20, fixedCostsYear: 90000, upfrontInvestment: 50000 });
    expect(r.marginPerCustomerYear).toBe(900);
    expect(r.paybackMonths).toBeCloseTo(6, 6);
    expect(r.lifetimeValue).toBeCloseTo(4500, 6);
    expect(r.ltvToCac).toBeCloseTo(10, 6);
    expect(r.breakEvenCustomers).toBe(100);
    expect(r.missing).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(breakEvenRevenue({ grossMarginPct: 75, fixedCostsYear: 90000 })).toBeCloseTo(120000, 6);
    expect(breakEvenRevenue({ grossMarginPct: null, fixedCostsYear: 90000 })).toBeNull();
  });

  it("financiële haalbaarheid: waarschuwingen en ontbrekende velden", () => {
    const r = computeUnitEconomics({ pricePerCustomerYear: 100, grossMarginPct: 50, cacEur: 200, annualChurnPct: 50, fixedCostsYear: null, upfrontInvestment: null });
    expect(r.ltvToCac).toBeCloseTo(0.5, 6);
    expect(r.paybackMonths).toBeCloseTo(48, 6);
    expect(r.breakEvenCustomers).toBeNull();
    expect(r.missing).toEqual(["vaste kosten per jaar"]);
    expect(r.warnings).toHaveLength(2);
  });

  it("simulatie: zelfde invoer, zelfde uitkomst (vaste seed)", () => {
    const factors = [
      { key: "base_count", value: 10000, low: 8000, high: 12000 },
      { key: "fit_pct", value: 20, low: 10, high: 30 },
      { key: "reach_pct", value: 50 },
      { key: "winnable_pct", value: 3, low: 1, high: 6 },
      { key: "revenue_per_customer", value: 1200 },
    ];
    const a = simulateSizing("b2b_accounts", factors, { threshold: 30000 })!;
    const b = simulateSizing("b2b_accounts", factors, { threshold: 30000 })!;
    expect(a).toEqual(b);
    expect(a.draws).toBe(5000);
    expect(a.rangedFactors).toBe(3);
    // Mediaan rond het product van de geometrische middens: 9798 × 17,3% × 50% × 2,45% × 1200 ≈ € 24.900.
    expect(a.somRevenue.p50).toBeGreaterThan(20000);
    expect(a.somRevenue.p50).toBeLessThan(30000);
    expect(a.somRevenue.p10).toBeLessThan(a.somRevenue.p50);
    expect(a.somRevenue.p90).toBeGreaterThan(a.somRevenue.p50);
    expect(a.drivers[0].key).toBe("winnable_pct");
  });
});
