import { describe, expect, it } from "vitest";
import {
  assumptionProbability,
  assumptionProbabilityV2,
  assumptionProbabilityV3,
  assumptionProbabilityV4,
  assumptionProbabilityV5,
  DEFAULT_CAPS,
  excludedRegisterItem,
  registerLine,
  registerTally,
  type ProbabilityClaim,
  type ProbabilityObservation,
} from "@/lib/domain/evidence";
import { METHOD_VERSIONS, METHODS } from "@/lib/domain/method";
import { deskRows } from "@/components/evidence/DeskEvidence";
import { PROBABILITY_CASES } from "./fixtures/probability-cases";

// Fase 1, punt 2: het bewijsregister. Per gekoppeld item of het meetelt in de kans, met de reden in gewone taal.
const obs = (id: string, kind: string, sourceKey: string | null, relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityObservation> = {}): ProbabilityObservation => ({
  id,
  kind,
  relation,
  isSynthetic: false,
  origin: "manual",
  sourceKey,
  sourceLabel: sourceKey ? `Interview ${sourceKey}` : null,
  recruitmentGroup: null,
  ...extra,
});
const claim = (id: string, status: ProbabilityClaim["status"], relation: "supports" | "contradicts" = "supports", extra: Partial<ProbabilityClaim> = {}): ProbabilityClaim => ({
  id,
  status,
  relation,
  sourceKey: `source:${id}`,
  sourceLabel: `Bron ${id}`,
  ...extra,
});
const byId = <T extends { id: string | null }>(items: T[], id: string): T => items.find((i) => i.id === id)!;

describe("bewijsregister: elk gekoppeld item staat erin", () => {
  it("in alle methodeversies één regel per bevinding en waarneming, in invoervolgorde", () => {
    for (const v of METHOD_VERSIONS) {
      for (const c of PROBABILITY_CASES) {
        const r = METHODS[v].probability(c.claims, c.observations, c.prior, c.overrides ?? {}, c.caps ?? DEFAULT_CAPS);
        expect(r.items, `${v} ${c.name}`).toHaveLength(c.claims.length + c.observations.length);
        expect(r.items.slice(0, c.claims.length).every((i) => i.itemType === "claim")).toBe(true);
        // Elk niet-meetellend item heeft een reden.
        expect(r.items.filter((i) => i.fate === "not_counted").every((i) => !!i.reason && !!i.code)).toBe(true);
      }
    }
  });
});

describe("bewijsregister: redenen in gewone taal", () => {
  it("oefening/synthetisch, AI afgewezen en (vanaf 2026-11-c) AI niet beoordeeld", () => {
    const list = [
      obs("syn", "deposit", "a", "supports", { isSynthetic: true }),
      obs("rej", "problem_confirmed", "b", "supports", { origin: "ai", reviewStatus: "rejected" }),
      obs("unr", "demo_request", "c", "supports", { origin: "ai", reviewStatus: null }),
    ];
    const c = assumptionProbabilityV3([], list);
    expect(byId(c.items, "syn")).toMatchObject({ fate: "not_counted", code: "synthetic", reason: "oefengesprek of synthetische data: telt nooit als bewijs" });
    expect(byId(c.items, "rej")).toMatchObject({ fate: "not_counted", code: "ai_rejected" });
    expect(byId(c.items, "unr")).toMatchObject({ fate: "not_counted", code: "ai_unreviewed", reason: "AI-codering nog niet beoordeeld: telt pas mee na akkoord van een consultant" });
    // In 2026-11-a en -b telt onbeoordeelde AI-codering half mee.
    expect(byId(assumptionProbability([], list).items, "unr")).toMatchObject({ fate: "counted", notes: ["ai_half"], reason: "telt half mee: AI-codering nog niet beoordeeld" });
    // 2026-11-b: half gewicht, en de kans zit aan het plafond van het laagste niveau (40%).
    expect(byId(assumptionProbabilityV2([], list).items, "unr")).toMatchObject({
      fate: "counted",
      notes: ["ai_half", "capped"],
      reason: "telt half mee: AI-codering nog niet beoordeeld; telt mee, maar het plafond van 40% is bereikt (nog geen probleem in eigen gedrag of huidige uitgaven)",
    });
  });

  it("status van de bevinding: onvoldoende, tegenstrijdig, verouderd", () => {
    const r = assumptionProbabilityV4([claim("i", "insufficient"), claim("c", "contested"), claim("o", "outdated"), claim("v", "verified")], []);
    expect(byId(r.items, "i")).toMatchObject({ fate: "not_counted", code: "claim_insufficient", reason: "geen controleerbaar citaat (onvoldoende bewijs)" });
    expect(byId(r.items, "c")).toMatchObject({ fate: "not_counted", code: "claim_contested", reason: "bronnen spreken elkaar tegen" });
    expect(byId(r.items, "o")).toMatchObject({ fate: "not_counted", code: "claim_outdated" });
    // Eén geverifieerde bevinding brengt de kans boven 40%: bureauonderzoek alleen komt niet verder dan dat plafond.
    expect(byId(r.items, "v")).toMatchObject({ fate: "counted", direction: "supports", notes: ["capped"] });
    expect(byId(assumptionProbability([claim("v", "verified")], []).items, "v")).toMatchObject({ fate: "counted", notes: [], reason: null });
  });

  it("weerlegd volgt de methodeversie", () => {
    const list = [claim("rs", "refuted", "supports"), claim("rc", "refuted", "contradicts")];
    const d = assumptionProbabilityV4(list, []);
    expect(byId(d.items, "rs")).toMatchObject({ fate: "not_counted", code: "claim_refuted_old_method", direction: "supports" });
    const e = assumptionProbabilityV5(list, []);
    expect(byId(e.items, "rs")).toMatchObject({ fate: "counted", direction: "contradicts" });
    expect(byId(e.items, "rc")).toMatchObject({ fate: "not_counted", code: "claim_refuted_counter" });
  });

  it("samengevoegd met een sterker signaal uit dezelfde bron", () => {
    const r = assumptionProbabilityV2([], [obs("op", "opinion", "x"), obs("demo", "demo_request", "x"), obs("pr", "problem_confirmed", "x")]);
    expect(byId(r.items, "demo").fate).toBe("counted");
    expect(byId(r.items, "op")).toMatchObject({ fate: "not_counted", code: "merged", reason: 'samengevoegd met een sterker signaal uit dezelfde bron (Interview x): alleen "Demo aangevraagd" telt' });
    expect(byId(r.items, "pr").code).toBe("merged");
    // Tegenbewijs per bron pas vanaf 2026-11-d.
    const against = [obs("b1", "objection", "y", "contradicts"), obs("b2", "objection", "y", "contradicts")];
    expect(assumptionProbabilityV3([], against).items.every((i) => i.fate === "counted")).toBe(true);
    expect(assumptionProbabilityV4([], against).items.map((i) => i.fate)).toEqual(["counted", "not_counted"]);
  });

  it("telt mee maar het plafond is bereikt", () => {
    const r = assumptionProbabilityV4([], [obs("w", "waitlist_signup", "a"), obs("d", "demo_request", "b"), obs("w2", "waitlist_signup", "c")], 0.8);
    expect(r.cap?.active).toBe(true);
    expect(byId(r.items, "w")).toMatchObject({ fate: "counted", notes: ["capped"], reason: "telt mee, maar het plafond van 60% is bereikt (nog geen offerte of gekozen prijsaanbod)" });
  });

  it("bezwaren zijn altijd tegenbewijs; soort 'overig' verandert de kans niet", () => {
    const r = assumptionProbabilityV4([], [obs("bz", "objection", "a", "supports"), obs("ov", "other", "b")]);
    expect(byId(r.items, "bz")).toMatchObject({ fate: "counted", direction: "contradicts" });
    expect(byId(r.items, "ov")).toMatchObject({ fate: "not_counted", code: "neutral" });
  });

  it("indirect bewijs telt half (vanaf 2026-11-c)", () => {
    const r = assumptionProbabilityV3([claim("ind", "verified", "supports", { relevance: "indirect" })], []);
    expect(byId(r.items, "ind")).toMatchObject({ fate: "counted" });
    expect(byId(r.items, "ind").notes[0]).toBe("indirect");
  });

  it("uit een test die onbeslist is of onder de steekproef bleef", () => {
    const x = excludedRegisterItem(
      { itemType: "observation", id: "o1", kind: "waitlist_signup", relation: "supports" },
      { title: "Landingpagina", reason: "under_sample", text: "telt niet mee: onder de minimale steekproef van 30" },
    );
    expect(x).toMatchObject({ fate: "not_counted", code: "excluded_test", reason: 'komt uit de test "Landingpagina", die niet meetelt: onder de minimale steekproef van 30' });
    const y = excludedRegisterItem({ itemType: "claim", id: "c1", status: "verified", relation: "supports" }, { title: "Enquête", reason: "inconclusive", text: "telt niet mee: onbeslist" });
    expect(y.reason).toBe('komt uit de test "Enquête", die niet meetelt: onbeslist');
  });
});

describe("bewijsregister: telling", () => {
  it('"3 voor (2 tellen mee) · 1 tegen"', () => {
    const r = assumptionProbabilityV4([claim("c", "contested")], [obs("a", "demo_request", "a"), obs("b", "problem_confirmed", "b"), obs("bz", "objection", "c", "contradicts")]);
    const t = registerTally(r.items);
    expect(t).toEqual({ supports: 3, supportsCounted: 2, contradicts: 1, contradictsCounted: 1, notCounted: 1 });
    expect(registerLine(t)).toBe("3 voor (2 tellen mee) · 1 tegen");
    expect(registerLine(registerTally([]))).toBe("0 voor · 0 tegen");
  });

  it("Bewijs & besluit (bureauonderzoek per aanname) volgt het register", () => {
    const r = assumptionProbabilityV5([claim("v", "verified"), claim("o", "outdated"), claim("rs", "refuted")], []);
    const links = ["v", "o", "rs"].map((id) => ({ assumptionId: "a1", claimId: id, relation: "supports" as const, statement: id, status: "verified" as const }));
    const rows = deskRows(links, r.items);
    expect(rows.supporting.map((x) => x.claimId)).toEqual(["v"]);
    expect(rows.contradicting.map((x) => x.claimId)).toEqual(["rs"]);
    expect(rows.notCounted.map((x) => x.claimId)).toEqual(["o"]);
  });
});
