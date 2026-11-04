import { describe, expect, it } from "vitest";
import { assumptionEvidence, assumptionProbabilityV4, assumptionProbabilityV5, deskTally, deskVerdict, notCountedLine, REFUTED_WEIGHT } from "@/lib/domain/evidence";
import { CURRENT_METHOD, METHODS } from "@/lib/domain/method";
import type { ClaimStatus } from "@/lib/domain/labels";

// Gebruikerstest A2/A5: gekoppeld bureauonderzoek per aanname. Wat telt mee (en in welke richting) en wat niet, met reden.

const link = (status: ClaimStatus, relation: "supports" | "contradicts" = "supports") => ({ status, relation });

describe("deskVerdict en deskTally", () => {
  it("geverifieerd en schatting tellen mee in de richting van de koppeling", () => {
    expect(deskVerdict(link("verified"))).toMatchObject({ counts: true, direction: "supports" });
    expect(deskVerdict(link("estimate", "contradicts"))).toMatchObject({ counts: true, direction: "contradicts" });
  });

  it("tegenstrijdig en onvoldoende tellen niet mee, met een reden", () => {
    const t = deskTally([link("contested"), link("insufficient")]);
    expect(t.supporting).toHaveLength(0);
    expect(t.contradicting).toHaveLength(0);
    expect(t.notCounted.map((c) => c.reasonText)).toEqual(["bronnen spreken elkaar tegen", "geen controleerbaar citaat (onvoldoende bewijs)"]);
  });

  it("weerlegd onder een oude methode: telt nog niet mee, met reden", () => {
    const t = deskTally([link("refuted")], { refutedCounts: false });
    expect(t.contradicting).toHaveLength(0);
    expect(t.notCounted[0].reason).toBe("refuted_old_method");
    expect(t.notCounted[0].reasonText).toMatch(/2026-11-e/);
  });

  it("weerlegd onder 2026-11-e: een bevinding waarop de aanname leunt, telt als tegenbewijs", () => {
    const t = deskTally([link("refuted", "supports")], { refutedCounts: true });
    expect(t.contradicting).toHaveLength(1);
    expect(t.notCounted).toHaveLength(0);
  });

  it("weerlegd onder 2026-11-e: een weerlegde tegenbevinding is geen steun (geen dubbele ontkenning)", () => {
    const t = deskTally([link("refuted", "contradicts")], { refutedCounts: true });
    expect(t.supporting).toHaveLength(0);
    expect(t.contradicting).toHaveLength(0);
    expect(t.notCounted[0].reason).toBe("refuted_counter");
  });

  it("de bewijsas telt een weerlegde bevinding alleen onder 2026-11-e", () => {
    expect(assumptionEvidence([link("refuted")], [])).toEqual({ score: 0, supporting: 0, contradicting: 0 });
    const e = assumptionEvidence([link("refuted")], [], { refutedCounts: true });
    expect(e.contradicting).toBe(1);
    expect(e.score).toBeCloseTo(REFUTED_WEIGHT * 0.15);
  });

  it("de zin voor scherm en melding", () => {
    expect(notCountedLine([])).toBeNull();
    expect(notCountedLine(["bronnen spreken elkaar tegen"])).toBe("1 gekoppeld, telt nog niet mee: bronnen spreken elkaar tegen");
    expect(notCountedLine(["a", "a", "b"])).toBe("3 gekoppeld, tellen nog niet mee: a; b");
  });
});

describe("kans: weerlegde bevinding per methodeversie", () => {
  it("2026-11-d rekent ongewijzigd: weerlegd is neutraal", () => {
    const p = assumptionProbabilityV4([{ ...link("refuted"), sourceKey: "s1" }], [], 0.5);
    expect(p.shift).toBe(0);
    expect(p.ignored.neutral).toBe(1);
  });

  it("2026-11-e: weerlegd verlaagt de kansverhouding met factor 1,2", () => {
    const p = assumptionProbabilityV5([{ ...link("refuted"), sourceKey: "s1" }], [], 0.5);
    expect(p.shift).toBeCloseTo(-Math.log(1.2), 9);
    expect(p.contributions[0].direction).toBe("contradicts");
  });

  it("2026-11-e: een weerlegde tegenbevinding verandert de kans niet", () => {
    const p = assumptionProbabilityV5([{ ...link("refuted", "contradicts"), sourceKey: "s1" }], [], 0.5);
    expect(p.shift).toBe(0);
    expect(p.ignored.neutral).toBe(1);
  });

  it("2026-11-e is de nieuwe standaard en telt weerlegd mee; oudere versies niet", () => {
    expect(CURRENT_METHOD).toBe("2026-11-e");
    expect(METHODS["2026-11-e"].refutedCounts).toBe(true);
    for (const v of ["2026-11-a", "2026-11-b", "2026-11-c", "2026-11-d"] as const) expect(METHODS[v].refutedCounts).toBe(false);
  });
});
