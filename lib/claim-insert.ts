import "server-only";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { recomputeClaim } from "@/lib/claims";
import { checkQuote, numericFromInput, valueInQuote, type QuoteCheck } from "@/lib/domain/verify";
import { isUnknown, normalizeReferenceDate, scopeValue, UNKNOWN } from "@/lib/domain/claim-scope";
import { evidenceTypeError } from "@/lib/domain/source-defaults";

// Een bevinding met letterlijk citaat vastleggen: gedeeld door het gewone bevindingformulier en het importeren van
// een bestaand rapport. De status wordt altijd berekend uit het citaat en de bron (recomputeClaim), nooit gekozen.

const blank = (s: unknown) => {
  const v = typeof s === "string" ? s.trim() : "";
  return v === "" ? null : v;
};

// De velden van een bevinding, zonder het fragment (dat kiest de aanroeper: een fragment-ID, of een geïmporteerd rapport).
export const ClaimFieldsSchema = z.object({
  statement: z.string().trim().min(10, "Formuleer de bevinding in één zin.").max(600),
  quote: z.string().trim().min(8, "Neem een letterlijk citaat over (minimaal 8 tekens).").max(1500),
  stance: z.enum(["supports", "contradicts"]),
  evidence_type: z.enum(["official_statistic", "third_party_estimate", "primary_document", "qualitative_observation", "self_reported_intent", "observed_action", "verified_transaction", "verified_commitment", "internal_assumption"]),
  section: z.enum(["market", "customers", "competition", "pricing", "sizing", "regulation", "other"]),
  freshness_kind: z.enum(["statistic", "price", "regulation", "product", "general"]),
  question_id: z.string().optional(),
  // Golf C, punt 7: verplicht, of expliciet "onbekend".
  population: z.string().trim().min(1, "Vul de populatie in, of schrijf \"onbekend\".").max(200),
  region: z.string().trim().min(1, "Vul de regio in, of schrijf \"onbekend\".").max(120),
  reference_date: z
    .string()
    .trim()
    .min(1, "Vul de peildatum in, of schrijf \"onbekend\".")
    .max(40)
    .refine((v) => isUnknown(v) || normalizeReferenceDate(v) !== UNKNOWN, "Schrijf de peildatum als jaartal (2025), maand (2025-06) of datum, of \"onbekend\"."),
  period: z.string().trim().max(60).optional(),
  numeric_value: z.string().trim().optional(),
  unit: z.string().trim().max(40).optional(),
  definition: z.string().trim().max(400).optional(),
  supports: z.string().trim().max(400).optional(),
  does_not_prove: z.string().trim().min(5, "Vul in wat deze bevinding nog níét bewijst.").max(400),
  limitations: z.string().trim().max(400).optional(),
});
export type ClaimFields = z.infer<typeof ClaimFieldsSchema>;

export type InsertClaimResult = { error: string } | { error: null; claimId: string; check: QuoteCheck; reason: string | null };

export async function insertClaimWithQuote(
  ideaId: string,
  v: ClaimFields,
  excerpt: { id: string; text: string; source_id: string },
  origin: "manual" | "ai" = "manual",
): Promise<InsertClaimResult> {
  const supabase = await supabaseServer();
  // Gebruikerstest B2: wat mensen zelf zeggen (interview, outreach, enquête) is nooit een officiële statistiek.
  // Fase 2 · punt 5: een eigen wervingsregistratie ook niet, en evenmin een primaire bron.
  if (v.evidence_type === "official_statistic" || v.evidence_type === "primary_document") {
    const { data: src } = await supabase.from("sources").select("source_type").eq("id", excerpt.source_id).maybeSingle();
    const typeError = evidenceTypeError(src?.source_type, v.evidence_type);
    if (typeError) return { error: typeError };
  }
  const check = checkQuote(v.quote, excerpt.text, v.stance === "supports" ? v.statement : undefined);
  const numericRaw = blank(v.numeric_value);
  const numeric = numericFromInput(numericRaw);
  if (numericRaw && numeric == null) return { error: "Het getal is niet leesbaar. Schrijf één getal, bijvoorbeeld 41.230 of 1,5 miljoen." };
  // The stored figure feeds the market sizing, so it must be the figure in the quote.
  if (numeric != null && !valueInQuote(numeric, v.quote)) return { error: "Het getal staat niet in het citaat. Neem het getal over zoals de bron het noemt." };
  const { data: claim, error } = await supabase
    .from("claims")
    .insert({
      idea_id: ideaId,
      question_id: v.question_id && /^[0-9a-f-]{36}$/.test(v.question_id) ? v.question_id : null,
      section: v.section,
      statement: v.statement,
      evidence_type: v.evidence_type,
      population: scopeValue(v.population, 200),
      region: scopeValue(v.region),
      reference_date: normalizeReferenceDate(v.reference_date),
      period: blank(v.period),
      numeric_value: numeric,
      unit: blank(v.unit),
      definition: blank(v.definition),
      supports: blank(v.supports),
      does_not_prove: v.does_not_prove,
      limitations: blank(v.limitations),
      freshness_kind: v.freshness_kind,
      origin,
    })
    .select("id")
    .single();
  if (error || !claim) return { error: "De bevinding kon niet worden opgeslagen." };
  await supabase.from("claim_sources").insert({
    claim_id: claim.id,
    idea_id: ideaId,
    source_id: excerpt.source_id,
    excerpt_id: excerpt.id,
    quote: v.quote,
    stance: v.stance,
    quote_check: check,
  });
  const result = await recomputeClaim(claim.id);
  return { error: null, claimId: claim.id, check, reason: result?.reason ?? null };
}
