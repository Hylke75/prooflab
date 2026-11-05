import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { codingAcceptance, supportAgreement, themeAcceptance, type QualityMeasure } from "@/lib/domain/ai-quality";

// AI quality across every dossier the consultant can edit (row level security limits the rows to the
// workspace). Clients do not see these measures.
export const loadAiQuality = cache(async (): Promise<{ support: QualityMeasure; coding: QualityMeasure; themes: QualityMeasure }> => {
  const supabase = await supabaseServer();
  const [{ data: checks }, { data: reviews }, { data: themeReviews }] = await Promise.all([
    supabase.from("claim_sources").select("support_check, support_checked_by, ai_support_check").eq("support_checked_by", "consultant").limit(5000),
    supabase.from("observations").select("review_status").eq("origin", "ai").not("review_status", "is", null).limit(5000),
    // Fase 1 · punt 3: beoordeelde AI-toewijzingen van thema's (zonder migratie: geen rijen, dus "te weinig gegevens").
    supabase.from("observation_codes").select("review_status").eq("origin", "ai").not("review_status", "is", null).limit(5000),
  ]);
  return { support: supportAgreement(checks ?? []), coding: codingAcceptance(reviews ?? []), themes: themeAcceptance(themeReviews ?? []) };
});
