import { describe, expect, it } from "vitest";
import { aiSourceType, checkQuote, computeClaimStatus, extractNumbers, figuresAppearIn, independentCount, numericFromInput, registrableDomain, valueInQuote, type EvidenceForStatus } from "@/lib/domain/verify";
import { factorSourced } from "@/lib/domain/sizing";

const ev = (o: Partial<EvidenceForStatus>): EvidenceForStatus => ({
  sourceType: "news",
  isPrimary: false,
  domain: "example.nl",
  publishedOn: "2026-03-01",
  contentHash: null,
  quoteCheck: "exact",
  stance: "supports",
  ...o,
});

describe("quote verification", () => {
  const excerpt = "In 2025 telde Nederland 2.612.500 vestigingen van bedrijven, aldus het CBS. Dat is 3,4% meer dan een jaar eerder.";

  it("accepts a literal quote regardless of whitespace, case and typographic quotes", () => {
    expect(checkQuote("telde   Nederland 2.612.500 VESTIGINGEN", excerpt)).toBe("exact");
  });

  it("rejects a paraphrase", () => {
    expect(checkQuote("Nederland heeft ruim 2,6 miljoen bedrijven", excerpt)).toBe("not_found");
  });

  it("rejects a claim whose figure does not appear in the quote", () => {
    expect(checkQuote("Dat is 3,4% meer dan een jaar eerder", excerpt, "Het aantal vestigingen groeide met 5,1%")).toBe("numbers_mismatch");
    expect(checkQuote("Dat is 3,4% meer dan een jaar eerder", excerpt, "Het aantal vestigingen groeide met 3,4% in 2025")).toBe("exact");
  });

  it("normalises Dutch and English number notation", () => {
    expect(extractNumbers("€ 1.200,50 en 3,4% en 2,612,500 en 12.5")).toEqual(["1200.5", "3.4", "2612500", "12.5"]);
  });

  it("refuses very short quotes", () => {
    expect(checkQuote("CBS", excerpt)).toBe("not_found");
  });
});

describe("claim status", () => {
  const now = new Date("2026-10-27");

  it("treats AI inferences and assumptions without sources as insufficient", () => {
    expect(computeClaimStatus({ evidenceType: "ai_inference", freshness: "general" }, [], now).status).toBe("insufficient");
    expect(computeClaimStatus({ evidenceType: "synthetic_simulation", freshness: "general" }, [ev({})], now).status).toBe("insufficient");
  });

  it("verifies on an official statistic", () => {
    const r = computeClaimStatus({ evidenceType: "official_statistic", freshness: "statistic" }, [ev({ sourceType: "official_statistic", domain: "cbs.nl" })], now);
    expect(r.status).toBe("verified");
  });

  it("only gives an estimate for a single secondary source", () => {
    expect(computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [ev({})], now).status).toBe("estimate");
  });

  it("does not count the same press release on two sites twice", () => {
    const a = ev({ domain: "a.nl", contentHash: "h1" });
    const b = ev({ domain: "b.nl", contentHash: "h1" });
    expect(independentCount([a, b])).toBe(1);
    expect(computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [a, b], now).status).toBe("estimate");
    const c = ev({ domain: "c.nl", contentHash: "h2" });
    expect(computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [a, c], now).status).toBe("verified");
  });

  it("flags contradicting verified sources", () => {
    const r = computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [ev({}), ev({ domain: "x.nl", stance: "contradicts" })], now);
    expect(r.status).toBe("contested");
  });

  it("marks old price sources as outdated", () => {
    const r = computeClaimStatus({ evidenceType: "primary_document", freshness: "price" }, [ev({ sourceType: "primary_document", isPrimary: true, publishedOn: "2024-01-10" })], now);
    expect(r.status).toBe("outdated");
  });

  it("explains failed quote checks", () => {
    const r = computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [ev({ quoteCheck: "numbers_mismatch" })], now);
    expect(r.status).toBe("insufficient");
    expect(r.reason).toMatch(/getallen/);
  });

  it("derives registrable domains", () => {
    expect(registrableDomain("https://www.cbs.nl/nl-nl/cijfers")).toBe("cbs.nl");
    expect(registrableDomain("https://news.bbc.co.uk/x")).toBe("bbc.co.uk");
    expect(registrableDomain("niet een url ::")).toBeNull();
  });
});

describe("number extraction edge cases", () => {
  it("keeps a year and a following figure apart", () => {
    expect(extractNumbers("In 2026 telde Nederland 41.230 vestigingen")).toEqual(["2026", "41230"]);
  });
  it("reads no-break-space thousands", () => {
    expect(extractNumbers("1 200 bezoekers")).toEqual(["1200"]);
  });
});

describe("figures with scale words, percentages and both decimal styles", () => {
  const same = (statement: string, quote: string) => checkQuote(quote, `Bron: ${quote}`, statement);

  it("rejects a figure that only matches without its scale or unit", () => {
    expect(same("De markt is 3 miljoen euro", "De markt is goed voor 30 miljoen euro")).toBe("numbers_mismatch");
    expect(same("De markt is 2 miljard euro", "De markt is goed voor 30 miljoen euro")).toBe("numbers_mismatch");
    expect(same("De omzet is 45 miljoen", "De omzet steeg met 45% tot 10 miljoen")).toBe("numbers_mismatch");
  });

  it("no longer skips small numbers: 3 aanbieders must be in the quote", () => {
    expect(same("Er zijn 3 aanbieders", "Er zijn drie aanbieders actief in deze markt")).toBe("numbers_mismatch");
    expect(same("Er zijn 3 aanbieders", "Er zijn 3 aanbieders actief in deze markt")).toBe("exact");
  });

  it("accepts the same quantity written differently", () => {
    expect(same("1,5 miljoen bezoekers", "In totaal kwamen er 1.500.000 bezoekers")).toBe("exact");
    expect(same("Conversie van 0,125", "the conversion was 0.125 overall")).toBe("exact");
    expect(same("Groei van 12,5%", "een groei van 12.5 procent per jaar")).toBe("exact");
    expect(same("€ 3,4 mln omzet", "een omzet van 3.400.000 euro")).toBe("exact");
  });

  it("treats a year as context, not as the claimed figure", () => {
    expect(same("In 2026 waren er 41.230 vestigingen", "telde Nederland 41.230 vestigingen")).toBe("exact");
  });

  it("does not read square metres as millions", () => {
    expect(same("Een zaal van 100 m²", "een zaal van 100 miljoen")).toBe("numbers_mismatch");
  });
});

describe("claim status edge cases", () => {
  const now = new Date("2026-10-27T12:00:00Z");

  it("calls a claim contested when only contradicting sources exist", () => {
    const r = computeClaimStatus({ evidenceType: "third_party_estimate", freshness: "statistic" }, [ev({ stance: "contradicts" })], now);
    expect(r.status).toBe("contested");
  });

  it("does not count two sources without a domain as independent", () => {
    const a = ev({ domain: null, publisher: null });
    const b = ev({ domain: null, publisher: null });
    expect(independentCount([a, b])).toBe(1);
    expect(independentCount([ev({ domain: null, publisher: "CBS" }), ev({ domain: null, publisher: "KvK" })])).toBe(2);
  });

  it("never treats a future publication date as fresh", () => {
    const r = computeClaimStatus(
      { evidenceType: "official_statistic", freshness: "statistic" },
      [ev({ sourceType: "official_statistic", publishedOn: "2062-01-01" })],
      now,
    );
    expect(r.status).toBe("insufficient");
  });
});

describe("source typing and price checks for AI research", () => {
  it("only lets code decide which sources are official", () => {
    expect(aiSourceType("seo-blog.nl", "official_statistic")).toBe("other");
    expect(aiSourceType("seo-blog.nl", "primary_document")).toBe("other");
    expect(aiSourceType("seo-blog.nl", "news")).toBe("news");
    expect(aiSourceType("cbs.nl", "blog")).toBe("official_statistic");
  });
  it("accepts a competitor price only when the full amount is quoted", () => {
    expect(figuresAppearIn("€ 19,99 per maand", "Vanaf € 19,95 per maand")).toBe(false);
    expect(figuresAppearIn("€ 19,99 per maand", "Vanaf € 19,99 per maand, excl. btw")).toBe(true);
    expect(figuresAppearIn("Op aanvraag", "Prijs op aanvraag")).toBe(false);
  });
});

describe("figures typed by a consultant", () => {
  it("parses Dutch and English input with scale words", () => {
    expect(numericFromInput("41.230")).toBe(41230);
    expect(numericFromInput("1,5 miljoen")).toBe(1_500_000);
    expect(numericFromInput("0.25")).toBe(0.25);
    expect(numericFromInput("1.5")).toBe(1.5);
    expect(numericFromInput("tussen 3 en 5")).toBeNull();
    expect(numericFromInput("")).toBeNull();
  });
  it("checks the figure against the quote", () => {
    expect(valueInQuote(1_500_000, "In totaal 1,5 miljoen bezoekers")).toBe(true);
    expect(valueInQuote(15, "In totaal 1,5 miljoen bezoekers")).toBe(false);
  });
});

describe("market sizing provenance", () => {
  it("only counts a factor as sourced when its value is the figure in the linked claim", () => {
    expect(factorSourced({ key: "base_count", value: 41230, claimStatus: "verified", claimValue: 41230 })).toBe(true);
    expect(factorSourced({ key: "base_count", value: 500000, claimStatus: "verified", claimValue: 41230 })).toBe(false);
    expect(factorSourced({ key: "base_count", value: 41230, claimStatus: "verified", claimValue: null })).toBe(false);
    expect(factorSourced({ key: "base_count", value: 41230, claimStatus: "insufficient", claimValue: 41230 })).toBe(false);
  });
});
