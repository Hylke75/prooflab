import { describe, expect, it } from "vitest";
import { CASES } from "./cases";
import { checkQuote, computeClaimStatus, type EvidenceForStatus } from "@/lib/domain/verify";
import { verdict } from "@/lib/domain/stats";
import { runRealityCheck, type DossierFacts } from "@/lib/domain/reality-check";

const NOW = new Date("2026-10-27");

const baseFacts: DossierFacts = {
  ideaAgeDays: 5,
  ideaRegion: "Nederland",
  clientDeciderInvited: true,
  claims: [{ status: "verified", section: "market", sourceTypes: ["official_statistic"], region: "Nederland" }],
  competitors: [{ kind: "direct" }, { kind: "status_quo" }],
  sizing: { established: true, assumedFactors: 2, totalFactors: 5, revenueFactorSourced: true },
  assumptions: [{ statement: "Probleem is urgent", importance: 4, category: "desirability", status: "testing", evidence: 0.4, contradicting: 0 }],
  experiments: [],
  interviews: [],
  observations: [],
  learningCards: [],
  decisionsAfterLastLearning: 0,
  isB2B: false,
};

describe("30 fixed practice cases (deterministic guards)", () => {
  it("contains exactly thirty cases", () => {
    expect(CASES).toHaveLength(30);
  });

  for (const c of CASES) {
    it(`#${c.id} ${c.title}`, () => {
      if (c.kind === "claims") {
        const byRef = new Map((c.excerpts ?? []).map((e) => [e.ref, e]));
        const accepted = (c.candidates ?? []).filter((k) => {
          const ex = byRef.get(k.ref);
          return ex && checkQuote(k.quote, ex.text, (k.stance ?? "supports") === "supports" ? k.statement : undefined) === "exact";
        });
        if (c.expect?.accepted !== undefined) expect(accepted.length).toBe(c.expect.accepted);
        if (c.expect?.status) {
          const first = c.candidates?.[0];
          const evidence: EvidenceForStatus[] = (c.candidates ?? []).map((k) => {
            const ex = byRef.get(k.ref)!;
            return {
              sourceType: ex.sourceType,
              isPrimary: !!ex.isPrimary,
              domain: ex.domain,
              publishedOn: ex.publishedOn,
              contentHash: ex.contentHash,
              quoteCheck: checkQuote(k.quote, ex.text, (k.stance ?? "supports") === "supports" ? k.statement : undefined),
              stance: k.stance ?? "supports",
            };
          });
          const s = computeClaimStatus({ evidenceType: first?.evidenceType ?? "ai_inference", freshness: first?.freshness ?? "general" }, evidence, NOW);
          expect(s.status).toBe(c.expect.status);
        }
      }
      if (c.kind === "stats" && c.stats) {
        const v = verdict({ successes: c.stats.successes, n: c.stats.n, successThresholdPct: c.stats.success, failThresholdPct: c.stats.fail, minSample: c.stats.minSample, endConditionReached: c.stats.ended });
        expect(v.kind).toBe(c.stats.expected);
      }
      if (c.kind === "reality" && c.reality) {
        const r = runRealityCheck({ ...baseFacts, ...(c.reality.patch as Partial<DossierFacts>) });
        const codes = r.findings.map((f) => f.code);
        for (const code of c.reality.expectCodes) expect(codes).toContain(code);
        if (c.reality.expectAdvice) expect(r.advice).toBe(c.reality.expectAdvice);
      }
    });
  }

  it("case #14: an injected instruction can only become a quoted claim, never a verified fact", () => {
    // The injected sentence is literally in the page, so it passes the quote check, but a single
    // secondary source can never reach 'verified'; the Reality Check and reviewers see it as an estimate.
    const c = CASES.find((x) => x.id === 14)!;
    const ex = c.excerpts![0];
    const s = computeClaimStatus(
      { evidenceType: "third_party_estimate", freshness: "statistic" },
      [{ sourceType: ex.sourceType, isPrimary: false, domain: ex.domain, publishedOn: ex.publishedOn, contentHash: ex.contentHash, quoteCheck: "exact", stance: "supports" }],
      NOW,
    );
    expect(s.status).not.toBe("verified");
  });
});
