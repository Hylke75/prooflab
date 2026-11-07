import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { missingImportSchema } from "@/lib/domain/interview-import";
import type { Database } from "@/lib/database.types";

// Gegevens van de AI-interviewer voor het onderzoeksteam (RLS: alleen wie het dossier kan bewerken). Zonder de
// migratie 20261118090000_ai_interviews: schemaMissing, zodat het scherm dat netjes kan zeggen.

export type AiConfigRow = Database["public"]["Tables"]["ai_interview_configs"]["Row"];
export type AiSessionRow = Pick<
  Database["public"]["Tables"]["ai_interview_sessions"]["Row"],
  | "id"
  | "status"
  | "answers"
  | "started_at"
  | "last_activity_at"
  | "ended_at"
  | "end_reason"
  | "interview_id"
  | "excluded_at"
  | "exclusion_reason"
  | "injections"
  | "fallbacks"
  | "sensitive_notices"
  | "dmu_role"
  | "segment"
  | "channel"
  | "cost_usd"
  | "retention_until"
>;

// now: het moment van laden (voor "afgebroken" na een uur zonder activiteit).
export type AiInterviewSetup = { schemaMissing: boolean; config: AiConfigRow | null; sessions: AiSessionRow[]; budget: { spent: number; cap: number } | null; now: number };

const SESSION_COLUMNS =
  "id, status, answers, started_at, last_activity_at, ended_at, end_reason, interview_id, excluded_at, exclusion_reason, injections, fallbacks, sensitive_notices, dmu_role, segment, channel, cost_usd, retention_until";

export async function loadAiInterviewSetup(ideaId: string, expId: string): Promise<AiInterviewSetup> {
  const supabase = await supabaseServer();
  const [{ data: config, error }, { data: spend }] = await Promise.all([
    supabase.from("ai_interview_configs").select("*").eq("experiment_id", expId).eq("idea_id", ideaId).maybeSingle(),
    supabase.rpc("org_ai_spend", { p_idea: ideaId }),
  ]);
  const budget = spend?.[0] ? { spent: Number(spend[0].spent), cap: Number(spend[0].cap) } : null;
  const now = Date.now();
  if (error) return { schemaMissing: missingImportSchema(error), config: null, sessions: [], budget, now };
  if (!config) return { schemaMissing: false, config: null, sessions: [], budget, now };
  const { data: sessions } = await supabase.from("ai_interview_sessions").select(SESSION_COLUMNS).eq("config_id", config.id).order("started_at", { ascending: false }).limit(500);
  return { schemaMissing: false, config, sessions: (sessions ?? []) as AiSessionRow[], budget, now };
}

// Eén gesprek met alle beurten, voor de transcriptpagina van het team.
export async function loadAiConversation(ideaId: string, expId: string, sessionId: string) {
  const supabase = await supabaseServer();
  const [{ data: session, error }, { data: turns }, { data: exp }] = await Promise.all([
    supabase.from("ai_interview_sessions").select("*").eq("id", sessionId).eq("experiment_id", expId).eq("idea_id", ideaId).maybeSingle(),
    supabase.from("ai_interview_turns").select("seq, role, kind, text, checks, flags, created_at").eq("session_id", sessionId).order("seq"),
    supabase.from("experiments").select("title").eq("id", expId).eq("idea_id", ideaId).maybeSingle(),
  ]);
  return { schemaMissing: !!error && missingImportSchema(error), session, turns: turns ?? [], expTitle: exp?.title ?? null, now: Date.now() };
}
