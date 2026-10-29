import "server-only";
import { createHash } from "node:crypto";
import { supabaseServer } from "@/lib/supabase/server";
import { checkQuote, computeClaimStatus, normalizeText, type EvidenceForStatus, type FreshnessKind } from "@/lib/domain/verify";
import type { EvidenceType, SourceType } from "@/lib/domain/labels";

export function contentHash(text: string): string {
  return createHash("sha256").update(normalizeText(text)).digest("hex").slice(0, 24);
}

// Re-evaluates one claim from its stored evidence. Called after every change to a claim or
// its sources, so the status shown is always derived from the evidence, never typed in.
export async function recomputeClaim(claimId: string) {
  const supabase = await supabaseServer();
  const { data: claim } = await supabase.from("claims").select("id, statement, evidence_type, freshness_kind").eq("id", claimId).single();
  if (!claim) return;
  const { data: links } = await supabase
    .from("claim_sources")
    .select("id, quote, stance, quote_check, excerpt_id, source_excerpts(text), sources(source_type, is_primary, domain, publisher, published_on, content_hash)")
    .eq("claim_id", claimId);
  const evidence: EvidenceForStatus[] = [];
  for (const l of links ?? []) {
    const excerpt = l.source_excerpts?.text ?? "";
    const check = excerpt ? checkQuote(l.quote, excerpt, l.stance === "supports" ? claim.statement : undefined) : "not_found";
    if (check !== l.quote_check) await supabase.from("claim_sources").update({ quote_check: check }).eq("id", l.id);
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
    });
  }
  const result = computeClaimStatus(
    { evidenceType: claim.evidence_type as EvidenceType, freshness: claim.freshness_kind as FreshnessKind },
    evidence,
  );
  await supabase.from("claims").update({ status: result.status, status_reason: result.reason }).eq("id", claimId);
  return result;
}
