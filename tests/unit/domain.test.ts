import { describe, expect, it } from "vitest";
import { assumptionEvidence, KIND_DEFAULTS, strength } from "@/lib/domain/evidence";
import { computeSizing, computeUnitEconomics } from "@/lib/domain/sizing";
import { checkHypothesis } from "@/lib/domain/hypothesis";
import { runRealityCheck, type DossierFacts } from "@/lib/domain/reality-check";
import { templatePlan } from "@/lib/domain/research-plan";
import { assignVariant, channelFrom, clientIp, isLikelyBot, visitorHash } from "@/lib/domain/tracking";

describe("evidence strength", () => {
  it("ranks a deposit above a demo request above an opinion, and synthetic at zero", () => {
    const s = (k: keyof typeof KIND_DEFAULTS) => strength({ ...KIND_DEFAULTS[k], isSynthetic: false });
    expect(s("deposit")).toBeGreaterThan(s("demo_request"));
    expect(s("demo_request")).toBeGreaterThan(s("opinion"));
    expect(strength({ ...KIND_DEFAULTS.deposit, isSynthetic: true })).toBe(0);
  });
  it("caps desk research below field evidence on the assumption map", () => {
    const desk = assumptionEvidence(Array.from({ length: 20 }, () => ({ status: "verified" as const, relation: "supports" as const })), []);
    expect(desk.score).toBeLessThanOrEqual(0.45);
    const field = assumptionEvidence([], Array.from({ length: 10 }, () => ({ ...KIND_DEFAULTS.deposit, isSynthetic: false, relation: "supports" as const })));
    expect(field.score).toBeGreaterThan(desk.score);
  });
});

describe("market sizing", () => {
  it("computes TAM/SAM/SOM bottom-up with a visible formula", () => {
    const r = computeSizing("b2b_accounts", [
      { key: "base_count", value: 12000, claimStatus: "verified" },
      { key: "fit_pct", value: 20 },
      { key: "reach_pct", value: 50 },
      { key: "winnable_pct", value: 5 },
      { key: "revenue_per_customer", value: 1200 },
    ]);
    expect(r.samCount).toBe(1200);
    expect(r.somCount).toBe(60);
    expect(r.somRevenue).toBe(72000);
    expect(r.formula).toContain("12.000");
    expect(r.established).toBe(true);
    expect(r.provenance).toEqual({ sourced: 1, assumed: 4, total: 5 });
  });
  it("labels an unsourced base as exploratory", () => {
    const r = computeSizing("b2c_people", [{ key: "base_count", value: 1_000_000 }]);
    expect(r.label).toMatch(/niet vastgesteld/);
  });
  it("computes unit economics and warns on weak ratios", () => {
    const u = computeUnitEconomics({ pricePerCustomerYear: 1200, grossMarginPct: 50, cacEur: 900, annualChurnPct: 50, fixedCostsYear: 60000, upfrontInvestment: 25000 });
    expect(u.marginPerCustomerYear).toBe(600);
    expect(u.paybackMonths).toBe(18);
    expect(u.lifetimeValue).toBe(1200);
    expect(u.breakEvenCustomers).toBe(100);
    expect(u.warnings.join(" ")).toMatch(/3×/);
  });
});

describe("hypothesis coach", () => {
  const ok = {
    we_believe: "Zakelijke eventmanagers vragen een persoonlijke demonstratie aan op een pagina met een concreet aanbod",
    target_group: "Nederlandse zakelijke eventmanagers",
    metric_numerator: "unieke aanvragen",
    metric_denominator: "unieke relevante bezoekers",
    success_threshold_pct: 15,
    fail_threshold_pct: 5,
    min_sample: 80,
    max_duration_days: 21,
  };
  it("accepts a precise, single, measurable hypothesis", () => {
    expect(checkHypothesis(ok).ok).toBe(true);
  });
  it("rejects vague and compound hypotheses", () => {
    const r = checkHypothesis({ ...ok, we_believe: "Eventmanagers vinden dit interessant en willen betalen en delen het" });
    expect(r.ok).toBe(false);
    expect(r.issues.map((i) => i.message).join(" ")).toMatch(/één ding|niet meetbaar/);
  });
});

describe("reality check", () => {
  const facts: DossierFacts = {
    ideaAgeDays: 30,
    ideaRegion: "Nederland",
    clientDeciderInvited: false,
    claims: Array.from({ length: 12 }, () => ({ status: "estimate" as const, section: "market", sourceTypes: ["company_page"] })),
    competitors: [{ kind: "direct" }],
    sizing: { established: false, assumedFactors: 5, totalFactors: 5, revenueFactorSourced: false },
    assumptions: [{ statement: "Klanten betalen", importance: 5, category: "viability", status: "untested", evidence: 0.1, contradicting: 0 }],
    experiments: [],
    interviews: [],
    observations: [],
    learningCards: [],
    decisionsAfterLastLearning: 0,
    isB2B: true,
  };
  it("flags analysis paralysis, the time trap and research red flags, and advises more testing", () => {
    const r = runRealityCheck(facts);
    const codes = r.findings.map((f) => f.code);
    expect(codes).toEqual(expect.arrayContaining(["analysis_paralysis", "time_trap", "no_independent_source", "missing_alternatives", "sizing_unestablished", "price_assumed", "outsourced_testing"]));
    expect(r.advice).toBe("test_more");
  });
  it("blocks on interviews without consent", () => {
    const r = runRealityCheck({ ...facts, interviews: [{ dmuRole: "user", isAcquaintance: false, consent: false }] });
    expect(r.findings[0].severity).toBe("blocker");
    expect(r.advice).toBe("pause");
  });
  it("advises stopping when tests repeatedly refute a critical assumption", () => {
    const r = runRealityCheck({
      ...facts,
      clientDeciderInvited: true,
      assumptions: [{ ...facts.assumptions[0], status: "refuted" }],
      learningCards: [{ status: "approved", verdict: "fail" }, { status: "approved", verdict: "fail" }],
      decisionsAfterLastLearning: 1,
    });
    expect(r.advice).toBe("stop");
  });
});

describe("research plan templates", () => {
  it("returns at most five questions with a done criterion", () => {
    for (const t of ["new_business", "new_product", "expansion", "revenue_model", "internal_innovation"] as const) {
      const p = templatePlan(t, "events");
      expect(p.length).toBe(5);
      expect(p.every((q) => q.done_criterion.length > 10)).toBe(true);
    }
  });
});

describe("cookieless tracking", () => {
  it("produces a code that is stable per test but differs between tests", () => {
    const a = visitorHash({ salt: "s", ip: "1.2.3.4", userAgent: "Mozilla/5.0 test", slug: "x" });
    const b = visitorHash({ salt: "s", ip: "1.2.3.4", userAgent: "Mozilla/5.0 test", slug: "x" });
    const other = visitorHash({ salt: "s", ip: "1.2.3.4", userAgent: "Mozilla/5.0 test", slug: "y" });
    const otherSecret = visitorHash({ salt: "t", ip: "1.2.3.4", userAgent: "Mozilla/5.0 test", slug: "x" });
    expect(a).toBe(b);
    expect(a).not.toBe(other);
    expect(a).not.toBe(otherSecret);
    expect(a).toHaveLength(32);
    // The same visitor keeps the same price variant for the whole test.
    expect(assignVariant(a, 3)).toBe(assignVariant(b, 3));
  });
  it("trusts only the platform or the right-most proxy for the client IP", () => {
    const h = (m: Record<string, string>) => (n: string) => m[n] ?? null;
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6, 10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(h({ "x-forwarded-for": "6.6.6.6", "x-vercel-forwarded-for": "198.51.100.4" }))).toBe("198.51.100.4");
    expect(clientIp(h({}))).toBe("0.0.0.0");
  });
  it("filters bots and maps channels", () => {
    expect(isLikelyBot("LinkedInBot/1.0 (compatible; Mozilla/5.0)")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Safari/605.1.15")).toBe(false);
    expect(channelFrom("linkedin_ads")).toBe("linkedin_ads");
    expect(channelFrom("tiktok")).toBe("other");
    expect(channelFrom(undefined)).toBe("direct");
    expect(assignVariant("ffffffff", 3)).toBe(0xffffffff % 3);
  });
});

import { dossierLabel } from "@/lib/domain/dossier-label";

describe("dossier labels", () => {
  const claims = [
    { status: "verified", domain: "cbs.nl", sourceType: "official_statistic" },
    { status: "estimate", domain: "a.nl", sourceType: "news" },
    { status: "estimate", domain: "a.nl", sourceType: "company_page" },
  ];
  const base = { claims, competitorKinds: ["direct", "indirect", "status_quo"], sizingComputed: true, behaviourCards: [] };
  it("stays at exploration when independent sources are missing", () => {
    expect(dossierLabel({ ...base, claims: claims.slice(1) }).label).toBe("Verkenning");
  });
  it("reaches a substantiated market picture, then behaviour evidence", () => {
    expect(dossierLabel(base).label).toBe("Onderbouwd marktbeeld");
    expect(dossierLabel({ ...base, behaviourCards: [{ verdict: "inconclusive", channels: ["linkedin"], endedOn: "2026-10-01" }] }).label).toBe("Eerste gedragsbewijs");
  });
  it("requires two passes in different periods or channels for repeated evidence", () => {
    const one = { verdict: "pass", channels: ["linkedin"], endedOn: "2026-09-01" };
    expect(dossierLabel({ ...base, behaviourCards: [one, { ...one }] }).label).toBe("Eerste gedragsbewijs");
    expect(dossierLabel({ ...base, behaviourCards: [one, { ...one, channels: ["meta_ads"] }] }).label).toBe("Herhaald marktgedragsbewijs");
  });
});
