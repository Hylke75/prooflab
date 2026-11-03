import { describe, expect, it } from "vitest";
import {
  ageInMonths,
  audienceKind,
  compareWithIntake,
  groundedScope,
  intakeScope,
  isReferenceDate,
  normalizeReferenceDate,
  regionMatches,
  relevanceWeight,
  scopeValue,
  UNKNOWN,
} from "@/lib/domain/claim-scope";

// Golf C, punt 7: populatie, regio en peildatum per bevinding, vergeleken met de intake.
const intake = { audience: "Zakelijke klanten (B2B) — evenementenbureaus", region: "Nederland", decisionDate: "2026-12-01" };
const today = new Date("2026-11-03T12:00:00Z");

describe("peildatum", () => {
  it("houdt een datum, maand of jaartal en maakt van vrije tekst het laatste jaartal", () => {
    expect(normalizeReferenceDate("2025-06-30")).toBe("2025-06-30");
    expect(normalizeReferenceDate("2025-06")).toBe("2025-06");
    expect(normalizeReferenceDate("Q3 2024")).toBe("2024");
    expect(normalizeReferenceDate("2019-2023")).toBe("2023");
    expect(normalizeReferenceDate("vorig jaar")).toBe(UNKNOWN);
    expect(normalizeReferenceDate("")).toBe(UNKNOWN);
    expect(normalizeReferenceDate(null)).toBe(UNKNOWN);
    expect(isReferenceDate("2025-13")).toBe(false);
    expect(isReferenceDate(UNKNOWN)).toBe(true);
  });

  it("meet de leeftijd tot de beslisdatum, met een jaartal tot en met 31 december", () => {
    expect(ageInMonths("2025", "2026-12-01")).toBe(12);
    expect(ageInMonths("2022-01", "2026-12-01")).toBe(59);
    expect(ageInMonths("2025", null, today)).toBe(11);
  });
});

describe("regio", () => {
  it("accepteert hetzelfde gebied en wijst een ander, breder of kleiner gebied af", () => {
    expect(regionMatches("Nederland", "Nederland")).toBe(true);
    expect(regionMatches("Nederland, 2025", "Nederland")).toBe(true);
    expect(regionMatches("EU-27", "Europa")).toBe(true);
    expect(regionMatches("Europa", "Nederland")).toBe(false);
    expect(regionMatches("Nederland en België", "Nederland")).toBe(false);
    expect(regionMatches("Amsterdam", "Nederland")).toBe(false);
    expect(regionMatches("Duitsland", "Nederland")).toBe(false);
  });

  it("vergelijkt een vrije regio in de intake op het woord", () => {
    expect(regionMatches("Provincie Utrecht", "Utrecht")).toBe(true);
    expect(regionMatches("Nederland", "Utrecht")).toBe(false);
  });
});

describe("populatie", () => {
  it("herkent het soort doelgroep", () => {
    expect(audienceKind("Zakelijke klanten (B2B)")).toBe("b2b");
    expect(audienceKind("Consumenten (B2C)")).toBe("b2c");
    expect(audienceKind("huishoudens in Nederland")).toBe("b2c");
    expect(audienceKind("mkb-bedrijven met 10-50 werknemers")).toBe("b2b");
    expect(audienceKind("eventmanagers")).toBeNull();
  });
});

describe("vergelijking met de intake", () => {
  it("is direct als alles klopt of onbekend is", () => {
    const ok = compareWithIntake({ population: "bedrijven", region: "Nederland", referenceDate: "2025" }, intake, today);
    expect(ok).toEqual({ relevance: "direct", warnings: [], unknown: [] });
    const unknown = compareWithIntake({ population: UNKNOWN, region: UNKNOWN, referenceDate: UNKNOWN }, intake, today);
    expect(unknown.relevance).toBe("direct");
    expect(unknown.unknown).toEqual(["population", "region", "referenceDate"]);
  });

  it("is indirect met een waarschuwing per afwijkend veld", () => {
    const res = compareWithIntake({ population: "huishoudens", region: "Europa", referenceDate: "2019", freshness: "statistic" }, intake, today);
    expect(res.relevance).toBe("indirect");
    expect(res.warnings).toHaveLength(3);
    expect(res.warnings[0]).toContain("andere doelgroep");
    expect(res.warnings[1]).toContain("niet de regio");
    expect(res.warnings[2]).toContain("beslisdatum");
  });

  it("meet de leeftijd per soort gegeven: een prijs veroudert sneller dan een statistiek", () => {
    const stat = compareWithIntake({ population: UNKNOWN, region: UNKNOWN, referenceDate: "2024", freshness: "statistic" }, intake, today);
    const price = compareWithIntake({ population: UNKNOWN, region: UNKNOWN, referenceDate: "2024", freshness: "price" }, intake, today);
    expect(stat.relevance).toBe("direct");
    expect(price.relevance).toBe("indirect");
  });

  it("neemt de intakevelden van een idee over", () => {
    expect(intakeScope({ target_audience: "Consumenten (B2C)", audience_detail: "ouders", region: "Nederland", region_detail: "Randstad", decision_deadline: null })).toEqual({
      audience: "Consumenten (B2C) — ouders",
      region: "Nederland",
      decisionDate: null,
    });
  });
});

describe("weging en AI-extractie", () => {
  it("telt indirect met halve sterkte (alleen in een nieuwe methodeversie)", () => {
    expect(relevanceWeight("indirect")).toBe(0.5);
    expect(relevanceWeight("direct")).toBe(1);
    expect(relevanceWeight(null)).toBe(1);
  });

  it("houdt een veld alleen als het uit het citaat of fragment blijkt", () => {
    const text = "In 2025 telde Nederland 4.100 evenementenbureaus, vooral kleine bedrijven.";
    expect(groundedScope("region", "Nederland", text)).toBe("Nederland");
    expect(groundedScope("region", "België", text)).toBe(UNKNOWN);
    expect(groundedScope("population", "evenementenbureaus", text)).toBe("evenementenbureaus");
    expect(groundedScope("population", "consumenten", text)).toBe(UNKNOWN);
    expect(groundedScope("referenceDate", "2025", text)).toBe("2025");
    expect(groundedScope("referenceDate", "2024", text)).toBe(UNKNOWN);
    expect(groundedScope("population", "onbekend", text)).toBe(UNKNOWN);
    expect(scopeValue("  ")).toBe(UNKNOWN);
  });
});
