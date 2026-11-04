import "server-only";
import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { checkQuote, normalizeText, type FreshnessKind } from "@/lib/domain/verify";
import { claimStatusWithSupport, isSupportCheck, type EvidenceWithSupport } from "@/lib/domain/support";
import type { EvidenceType, SourceType } from "@/lib/domain/labels";
import { compareWithIntake, intakeScope, type Relevance } from "@/lib/domain/claim-scope";

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 24);
}

// Re-evaluates one claim from its stored evidence. Called after every change to a claim or
// its sources, so the status shown is always derived from the evidence, never typed in. A quote that
// the support check judged "not supported" counts like a failed quote check; a quote no longer found on
// the live page (competitor recheck) makes the finding outdated.
export async function recomputeClaim(claimId: string) {
  const supabase = await supabaseServer();
  // Gebruikerstest A10: bevinding en bronkoppelingen tegelijk laden; de intakevergelijking loopt parallel met de
  // citaatcontroles, en gewijzigde controles worden samen bijgewerkt.
  const [{ data: claim }, { data: links }] = await Promise.all([
    supabase
      .from("claims")
      .select("id, idea_id, statement, evidence_type, freshness_kind, population, region, reference_date")
      .eq("id", claimId)
      .single(),
    supabase
      .from("claim_sources")
      .select("id, quote, stance, quote_check, support_check, excerpt_id, source_excerpts(text), live_found, sources(source_type, is_primary, domain, publisher, published_on, content_hash)")
      .eq("claim_id", claimId),
  ]);
  if (!claim) return;
  // Golf C, punt 7: wijken populatie, regio of peildatum af van de intake, dan telt de bevinding als indirect.
  const relevancePromise = claimRelevance(claim);
  const evidence: EvidenceWithSupport[] = [];
  const updates: PromiseLike<unknown>[] = [];
  for (const l of links ?? []) {
    const excerpt = l.source_excerpts?.text ?? "";
    const check = excerpt ? checkQuote(l.quote, excerpt, l.stance === "supports" ? claim.statement : undefined) : "not_found";
    if (check !== l.quote_check) updates.push(supabase.from("claim_sources").update({ quote_check: check }).eq("id", l.id));
    if (!l.sources) continue;
    evidence.push({
      sourceType: l.sources.source_type as SourceType,
      isPrimary: l.sources.is_primary,
      domain: l.sources.domain,
      publisher: l.sources.publisher,
      publishedOn: l.sources.published_on,
      contentHash: l.sources.content_hash,
      quoteCheck: check,
      stance: l.stance as "supports" | "contradicts",
      support: isSupportCheck(l.support_check) ? l.support_check : "unchecked",
      liveMissing: l.live_found === false,
    });
  }
  const result = claimStatusWithSupport(
    { evidenceType: claim.evidence_type as EvidenceType, freshness: claim.freshness_kind as FreshnessKind },
    evidence,
  );
  const [relevance] = await Promise.all([relevancePromise, ...updates]);
  const extra = relevance ? { relevance } : {};
  const { error } = await supabase.from("claims").update({ status: result.status, status_reason: result.reason, ...extra }).eq("id", claimId);
  // Gebruikerstest A5: zolang migratie 20261112090000 niet live staat, kent de database "refuted" niet. Dan valt de
  // bevinding terug op de oude status voor dit geval (tegenstrijdig), zodat ze niet op een verouderde status blijft staan.
  if (error && result.status === "refuted") {
    await supabase.from("claims").update({ status: "contested", status_reason: result.reason, ...extra }).eq("id", claimId);
    return { status: "contested" as const, reason: result.reason };
  }
  return result;
}

// Vergelijkt de bevinding met de intake van het idee (doelgroep, regio, beslisdatum). Null als het idee niet te
// lezen is; de opgeslagen relevantie blijft dan staan.
async function claimRelevance(claim: {
  idea_id: string;
  population: string | null;
  region: string | null;
  reference_date: string | null;
  freshness_kind: string;
}): Promise<Relevance | null> {
  const supabase = await supabaseServer();
  const { data: idea } = await supabase
    .from("ideas")
    .select("target_audience, audience_detail, region, region_detail, decision_deadline")
    .eq("id", claim.idea_id)
    .maybeSingle();
  if (!idea) return null;
  return compareWithIntake(
    { population: claim.population, region: claim.region, referenceDate: claim.reference_date, freshness: claim.freshness_kind as FreshnessKind },
    intakeScope(idea),
  ).relevance;
}
