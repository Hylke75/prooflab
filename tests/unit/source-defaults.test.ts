import { describe, expect, it } from "vitest";
import { defaultsForSource, deviationHint, evidenceTypeDeviates, evidenceTypeError, OWN_MEASUREMENT_SOURCES, SELF_REPORTED_SOURCES, SOURCE_DEFAULTS } from "@/lib/domain/source-defaults";
import { EVIDENCE_TYPES, SOURCE_TYPES, type SourceType } from "@/lib/domain/labels";
import { FRESHNESS_MONTHS } from "@/lib/domain/verify";

// Gebruikerstest B2: standaard soort informatie en versheid per brontype, en de harde weigering.

const expected: Record<SourceType, [string, string]> = {
  official_statistic: ["official_statistic", "statistic"],
  research_report: ["third_party_estimate", "statistic"],
  primary_document: ["primary_document", "general"],
  company_page: ["primary_document", "product"],
  news: ["third_party_estimate", "general"],
  review_site: ["qualitative_observation", "general"],
  forum: ["qualitative_observation", "general"],
  blog: ["qualitative_observation", "general"],
  interview: ["qualitative_observation", "general"],
  outreach: ["qualitative_observation", "general"],
  survey: ["self_reported_intent", "general"],
  dataset_upload: ["third_party_estimate", "statistic"],
  recruitment_log: ["observed_action", "general"],
  other: ["qualitative_observation", "general"],
};

describe("defaultsForSource", () => {
  for (const type of Object.keys(SOURCE_TYPES) as SourceType[]) {
    it(`${type} → ${expected[type].join(" / ")}`, () => {
      const d = defaultsForSource(type);
      expect([d.evidenceType, d.freshness]).toEqual(expected[type]);
      // Altijd een bestaande soort informatie en versheid.
      expect(d.evidenceType in EVIDENCE_TYPES).toBe(true);
      expect(d.freshness in FRESHNESS_MONTHS).toBe(true);
      // De standaard zelf is nooit een afwijking en nooit geweigerd.
      expect(evidenceTypeDeviates(type, d.evidenceType)).toBe(false);
      expect(evidenceTypeError(type, d.evidenceType)).toBeNull();
    });
  }

  it("elk brontype heeft een standaard", () => {
    expect(Object.keys(SOURCE_DEFAULTS).sort()).toEqual(Object.keys(SOURCE_TYPES).sort());
  });

  it("een onbekend brontype valt terug op overig", () => {
    expect(defaultsForSource("iets")).toEqual(SOURCE_DEFAULTS.other);
    expect(defaultsForSource(null)).toEqual(SOURCE_DEFAULTS.other);
  });

  it("afwijking is afgeleid en heeft een leesbare hint", () => {
    expect(evidenceTypeDeviates("interview", "third_party_estimate")).toBe(true);
    expect(deviationHint("company_page")).toBe("Afwijkend van de standaard voor bedrijfswebsite");
  });
});

describe("evidenceTypeError", () => {
  it.each(SELF_REPORTED_SOURCES.map((s) => [s]))("weigert officiële statistiek bij %s", (s) => {
    expect(evidenceTypeError(s, "official_statistic")).toMatch(/geen officiële statistiek/);
  });
  it("staat officiële statistiek toe bij andere bronnen", () => {
    for (const s of (Object.keys(SOURCE_TYPES) as SourceType[]).filter((x) => !SELF_REPORTED_SOURCES.includes(x) && !OWN_MEASUREMENT_SOURCES.includes(x))) {
      expect(evidenceTypeError(s, "official_statistic")).toBeNull();
    }
  });
});
