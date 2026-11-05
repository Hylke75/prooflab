import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { countsFromRpc, themeCounts, type RpcRow, type ThemeCounts } from "@/lib/domain/theme-counts";
import { missingImportSchema } from "@/lib/domain/interview-import";

// Fase 1 · punt 3: "X van N geïnterviewden" per thema en aanname.
// - Consultant: uit de tabellen, met per thema de citaten (doorklik) en de interviews; optioneel alleen één test.
// - Opdrachtgever: via interview_theme_counts (alleen aantallen, geen citaten of interviews).
// Zonder migratie: null (de pagina meldt dat thema's nog niet beschikbaar zijn).

export type QuoteRef = { codeId: string; interviewId: string; experimentId: string | null; participant: string; quote: string | null; counts: boolean };
export type ConsultantCounts = ThemeCounts & { quotes: QuoteRef[] };

export async function loadThemeCountsForConsultant(ideaId: string, experimentId?: string): Promise<ConsultantCounts | null> {
  const supabase = await supabaseServer();
  let ivQuery = supabase.from("interviews").select("id, experiment_id, participant_label, dmu_role, is_acquaintance, recruitment_group, is_practice, consent_recorded").eq("idea_id", ideaId);
  if (experimentId) ivQuery = ivQuery.eq("experiment_id", experimentId);
  const [{ data: interviews }, { data: experiments }, { data: codes, error: codesError }, { data: assignments }, { data: observations }, { data: links }, { data: assumptions }] = await Promise.all([
    ivQuery,
    supabase.from("experiments").select("id, recruitment_group").eq("idea_id", ideaId),
    supabase.from("interview_codes").select("id, label, status").eq("idea_id", ideaId).order("label"),
    supabase.from("observation_codes").select("observation_id, code_id, origin, review_status").eq("idea_id", ideaId).limit(10000),
    supabase.from("observations").select("id, interview_id, quote, origin, review_status, is_synthetic").eq("idea_id", ideaId).not("interview_id", "is", null).limit(10000),
    supabase.from("assumption_observations").select("assumption_id, observation_id").eq("idea_id", ideaId),
    supabase.from("assumptions").select("id, statement").eq("idea_id", ideaId).order("created_at"),
  ]);
  if (codesError && missingImportSchema(codesError)) return null;
  const testGroup = new Map((experiments ?? []).map((e) => [e.id, e.recruitment_group]));
  const ivs = interviews ?? [];
  const ivIds = new Set(ivs.map((i) => i.id));
  const obsById = new Map((observations ?? []).filter((o) => o.interview_id && ivIds.has(o.interview_id)).map((o) => [o.id, o]));
  const codeStatus = new Map((codes ?? []).map((c) => [c.id, c.status]));
  const asg = (assignments ?? []).filter((a) => obsById.has(a.observation_id));
  const counts = themeCounts({
    interviews: ivs.map((i) => ({
      id: i.id,
      dmuRole: i.dmu_role,
      isAcquaintance: i.is_acquaintance,
      recruitmentGroup: i.recruitment_group,
      testGroup: i.experiment_id ? (testGroup.get(i.experiment_id) ?? null) : null,
      isPractice: i.is_practice,
      consent: i.consent_recorded,
    })),
    codes: codes ?? [],
    assignments: asg.map((a) => ({ interviewId: obsById.get(a.observation_id)!.interview_id!, codeId: a.code_id, origin: a.origin, reviewStatus: a.review_status })),
    assumptions: assumptions ?? [],
    links: (links ?? [])
      .filter((l) => obsById.has(l.observation_id))
      .map((l) => {
        const o = obsById.get(l.observation_id)!;
        return { interviewId: o.interview_id!, assumptionId: l.assumption_id, origin: o.origin, reviewStatus: o.review_status, isSynthetic: o.is_synthetic };
      }),
  });
  const ivById = new Map(ivs.map((i) => [i.id, i]));
  const quotes: QuoteRef[] = asg.map((a) => {
    const o = obsById.get(a.observation_id)!;
    const iv = ivById.get(o.interview_id!)!;
    return {
      codeId: a.code_id,
      interviewId: iv.id,
      experimentId: iv.experiment_id,
      participant: iv.participant_label,
      quote: o.quote,
      counts: codeStatus.get(a.code_id) === "accepted" && (a.origin === "manual" || a.review_status === "accepted") && iv.is_practice === false && iv.consent_recorded,
    };
  });
  return { ...counts, quotes };
}

export async function loadThemeCountsForClient(ideaId: string): Promise<ThemeCounts | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("interview_theme_counts", { p_idea: ideaId });
  if (error) return missingImportSchema(error) ? null : { total: 0, items: [] };
  return countsFromRpc((data ?? []) as RpcRow[]);
}
