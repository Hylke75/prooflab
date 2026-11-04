import { describe, expect, it } from "vitest";
import { checkedSources, computeClaimStatus, REFUTED_NEXT_STEP, type EvidenceForStatus } from "@/lib/domain/verify";

// Gebruikerstest C2: juiste vervoeging bij één of meer bronnen, met een vervolgstap.

const now = new Date("2026-11-04T12:00:00Z");
let n = 0;
const ev = (stance: "supports" | "contradicts"): EvidenceForStatus => ({
  sourceType: "news",
  isPrimary: false,
  domain: `b${n++}.nl`,
  publishedOn: "2026-03-01",
  contentHash: null,
  quoteCheck: "exact",
  stance,
});
const claim = { evidenceType: "third_party_estimate" as const, freshness: "statistic" as const };

describe("checkedSources", () => {
  it("enkelvoud en meervoud", () => {
    expect(checkedSources(1, "spreekt dit tegen", "spreken dit tegen")).toBe("1 gecontroleerde bron spreekt dit tegen");
    expect(checkedSources(2, "spreekt dit tegen", "spreken dit tegen")).toBe("2 gecontroleerde bronnen spreken dit tegen");
  });
});

describe("redenen bij weerlegd en tegenstrijdig", () => {
  it("n = 1: enkelvoud en vervolgstap", () => {
    const r = computeClaimStatus(claim, [ev("contradicts")], now);
    expect(r.reason).toBe(`1 gecontroleerde bron spreekt dit tegen; geen bron bevestigt het. ${REFUTED_NEXT_STEP}`);
  });
  it("n = 2: meervoud", () => {
    const r = computeClaimStatus(claim, [ev("contradicts"), ev("contradicts")], now);
    expect(r.reason).toMatch(/^2 gecontroleerde bronnen spreken dit tegen; /);
  });
  it("tegenstrijdig: ook de bevestigende telling klopt", () => {
    expect(computeClaimStatus(claim, [ev("supports"), ev("contradicts")], now).reason).toMatch(/^1 gecontroleerde bron bevestigt dit, 1 gecontroleerde bron spreekt het tegen\./);
    expect(computeClaimStatus(claim, [ev("supports"), ev("supports"), ev("contradicts"), ev("contradicts")], now).reason).toMatch(
      /^2 gecontroleerde bronnen bevestigen dit, 2 gecontroleerde bronnen spreken het tegen\./,
    );
  });
});
