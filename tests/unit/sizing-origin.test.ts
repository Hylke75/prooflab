import { describe, expect, it } from "vitest";
import { factorConsistency, sameRegion, simulateSizing, widenRange } from "@/lib/domain/sizing";

// Golf C, punt 8: jaar en regio per sizing-factor; bij verschil een waarschuwing en een bredere band.

const factors = [
  { key: "base_count", value: 4000, low: 3500, high: 4500 },
  { key: "fit_pct", value: 20, low: 10, high: 30 },
  { key: "reach_pct", value: 50 },
  { key: "winnable_pct", value: 3, low: 1, high: 6 },
  { key: "revenue_per_customer", value: 1200, low: 0, high: 2400 },
];

describe("factorConsistency", () => {
  it("ziet geen verschil bij jaren binnen 2 jaar en hetzelfde gebied", () => {
    const c = factorConsistency([
      { key: "base_count", year: 2023, region: "Nederland" },
      { key: "fit_pct", year: 2025, region: "NL" },
      { key: "winnable_pct", year: null, region: null },
    ]);
    expect(c).toMatchObject({ yearGap: 2, yearMismatch: false, regionMismatch: false, widen: 1, warnings: [] });
    expect(c.unknownYear).toEqual(["winnable_pct"]);
    expect(c.unknownRegion).toEqual(["winnable_pct"]);
  });

  it("waarschuwt bij meer dan 2 jaar verschil en verbreedt ×1,5", () => {
    const c = factorConsistency([
      { key: "base_count", label: "Organisaties", year: 2020 },
      { key: "fit_pct", label: "Deel", year: 2025 },
    ]);
    expect(c.yearMismatch).toBe(true);
    expect(c.widen).toBe(1.5);
    expect(c.warnings[0]).toContain("5 jaar");
    expect(c.warnings[0]).toContain("Organisaties: 2020");
  });

  it("waarschuwt bij verschillende regio's; jaar en regio samen verbreden ×2", () => {
    const c = factorConsistency([
      { key: "base_count", year: 2020, region: "Nederland" },
      { key: "fit_pct", year: 2025, region: "Europa" },
      { key: "reach_pct", region: "onbekend" },
    ]);
    expect(c.regionMismatch).toBe(true);
    expect(c.regions).toEqual(["Nederland", "Europa"]);
    expect(c.widen).toBe(2);
    expect(c.warnings).toHaveLength(3);
  });

  it("herkent dezelfde regio in verschillende schrijfwijzen", () => {
    expect(sameRegion("Nederland", "NL")).toBe(true);
    expect(sameRegion("Nederland", "Europa")).toBe(false);
  });
});

describe("bredere onzekerheidsband in de simulatie", () => {
  it("verbreedt een log-normale band rond het geometrisch midden en een driehoek naar boven", () => {
    const ln = widenRange({ key: "base_count", value: 4000, low: 1000, high: 4000 }, "count", 1.5);
    expect(Math.sqrt(ln.low * ln.high)).toBeCloseTo(2000, 6);
    expect(Math.log(ln.high / ln.low)).toBeCloseTo(1.5 * Math.log(4), 6);
    const tri = widenRange({ key: "revenue_per_customer", value: 1200, low: 0, high: 2400 }, "eur", 2);
    expect(tri).toMatchObject({ low: 0, high: 3600 });
    const pct = widenRange({ key: "fit_pct", value: 50, low: 20, high: 90 }, "percent", 2);
    expect(pct.high).toBe(100);
  });

  it("laat de uitkomst zonder verschil ongewijzigd en maakt P10–P90 breder bij verschil", () => {
    const plain = simulateSizing("b2b_accounts", factors)!;
    const same = simulateSizing("b2b_accounts", factors, { widen: 1 })!;
    expect(same).toEqual(plain);
    expect(plain.widen).toBe(1);
    const wide = simulateSizing("b2b_accounts", factors, { widen: 2 })!;
    expect(wide.widen).toBe(2);
    expect(wide.somRevenue.p90 - wide.somRevenue.p10).toBeGreaterThan(plain.somRevenue.p90 - plain.somRevenue.p10);
    expect(wide.somRevenue.p10).toBeLessThan(plain.somRevenue.p10);
    expect(wide.method).toContain("verbreed");
  });
});
