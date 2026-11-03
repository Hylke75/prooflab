import "server-only";
import type { Dossier } from "@/lib/dossier";
import { againstSummary, type AgainstSummary } from "@/lib/domain/against";
import { deviationLabel } from "@/lib/domain/decision-rule";

// De samenvatting "Wat ging tegen" (golf B, punt 18) voor één besluit, uit het dossier zoals het nu is.
export function againstFor(d: Dossier, decision: { action: string; rule_met?: boolean | null; rule_deviation_reason?: string | null }): AgainstSummary {
  const latest = new Map<string, { verdict: string; version: number; created_at: string }>();
  for (const c of d.learningCards.filter((x) => x.status === "approved")) {
    const prev = latest.get(c.experiment_id);
    if (!prev || c.version > prev.version || (c.version === prev.version && c.created_at > prev.created_at)) latest.set(c.experiment_id, c);
  }
  return againstSummary({
    tests: d.experiments.map((e) => ({ id: e.id, title: e.title, verdict: (latest.get(e.id)?.verdict as "pass" | "fail" | "inconclusive" | undefined) ?? null })),
    contradictedClaims: d.claims
      .filter((c) => (c.claim_sources ?? []).some((s) => s.stance === "contradicts" && s.quote_check === "exact"))
      .map((c) => ({ id: c.id, statement: c.statement })),
    counterObservations: d.observations.map((o) => ({ id: o.id, kind: o.kind, summary: o.summary, isSynthetic: o.is_synthetic })),
    assumptions: d.assumptions.map((a) => ({ id: a.id, statement: a.statement, capActive: !!a.probability.cap?.active, capReason: a.probability.cap?.reason ?? null })),
    deviation: decision.rule_deviation_reason && decision.rule_met != null ? { label: deviationLabel(decision.action, decision.rule_met), reason: decision.rule_deviation_reason } : null,
  });
}
