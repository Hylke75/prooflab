import { describe, expect, it } from "vitest";
import { checkQuote, computeClaimStatus, extractNumbers, independentCount, registrableDomain, type EvidenceForStatus } from "@/lib/domain/verify";

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
