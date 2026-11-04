import { describe, expect, it } from "vitest";
import { computeClaimStatus, type EvidenceForStatus, type QuoteCheck } from "@/lib/domain/verify";
import { claimStatusWithSupport, type EvidenceWithSupport } from "@/lib/domain/support";
import { CLAIM_STATUS } from "@/lib/domain/labels";

// Gebruikerstest A5: "weerlegd" (alleen gecontroleerde tegensprekende bronnen) naast "tegenstrijdig" (minstens één
// bevestigende én minstens één tegensprekende gecontroleerde bron). Alle combinaties van richting en citaatcontrole.

const now = new Date("2026-11-04T12:00:00Z");
const claim = { evidenceType: "third_party_estimate" as const, freshness: "statistic" as const };
let n = 0;
const ev = (stance: "supports" | "contradicts", quoteCheck: QuoteCheck | "unchecked" = "exact"): EvidenceForStatus => ({
  sourceType: "news",
  isPrimary: false,
  domain: `bron${n++}.nl`,
  publishedOn: "2026-03-01",
  contentHash: null,
  quoteCheck,
  stance,
});

describe("computeClaimStatus: weerlegd of tegenstrijdig", () => {
  const cases: { name: string; evidence: () => EvidenceForStatus[]; status: string }[] = [
    { name: "geen bronnen", evidence: () => [], status: "insufficient" },
    { name: "1 gecontroleerde tegensprekende bron", evidence: () => [ev("contradicts")], status: "refuted" },
    { name: "2 gecontroleerde tegensprekende bronnen", evidence: () => [ev("contradicts"), ev("contradicts")], status: "refuted" },
    { name: "1 bevestigend + 1 tegensprekend", evidence: () => [ev("supports"), ev("contradicts")], status: "contested" },
    { name: "2 bevestigend + 1 tegensprekend", evidence: () => [ev("supports"), ev("supports"), ev("contradicts")], status: "contested" },
    { name: "tegensprekend met mislukt citaat telt niet", evidence: () => [ev("contradicts", "not_found")], status: "insufficient" },
    { name: "tegensprekend nog niet gecontroleerd telt niet", evidence: () => [ev("contradicts", "unchecked")], status: "insufficient" },
    { name: "bevestigend met mislukt citaat + gecontroleerd tegensprekend", evidence: () => [ev("supports", "not_found"), ev("contradicts")], status: "refuted" },
    { name: "bevestigend gecontroleerd + tegensprekend met mislukt citaat", evidence: () => [ev("supports"), ev("contradicts", "numbers_mismatch")], status: "estimate" },
    { name: "alleen bevestigend (twee onafhankelijke)", evidence: () => [ev("supports"), ev("supports")], status: "verified" },
  ];
  for (const c of cases) {
    it(c.name, () => {
      expect(computeClaimStatus(claim, c.evidence(), now).status).toBe(c.status);
    });
  }

  it("synthetische simulatie blijft onvoldoende, ook met tegenspraak", () => {
    expect(computeClaimStatus({ evidenceType: "synthetic_simulation", freshness: "general" }, [ev("contradicts")], now).status).toBe("insufficient");
  });

  it("een bevestigend citaat dat de steuncontrole afwees, telt niet als bevestiging: weerlegd", () => {
    const e: EvidenceWithSupport[] = [
      { ...ev("supports"), support: "not_supported" },
      { ...ev("contradicts"), support: "unchecked" },
    ];
    expect(claimStatusWithSupport(claim, e, now).status).toBe("refuted");
  });

  it("weerlegd en tegenstrijdig hebben elk een Nederlands label", () => {
    expect(CLAIM_STATUS.refuted.label).toBe("Weerlegd");
    expect(CLAIM_STATUS.contested.label).toBe("Tegenstrijdige bronnen");
  });
});
