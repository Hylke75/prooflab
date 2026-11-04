import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { isExploratory, missingStudySchema, studyFormatOf, usableResponses, type StudyFormat } from "@/lib/domain/customer-research";
import { testRole, type TestRole } from "@/lib/domain/primary-test";
import { countsAsEvidence } from "@/lib/domain/practice";
import type { ExperimentState } from "@/lib/domain/labels";

// Eén regel in de lijst op het tabblad Klantonderzoek (Markt).
export type StudyRow = {
  id: string;
  title: string;
  // survey/interview: via de enquête-engine (link); live: een interviewronde uit stap 3 (gesprekken vastleggen).
  kind: StudyFormat | "live";
  state: ExperimentState;
  exploratory: boolean;
  role: TestRole;
  researchQuestionId: string | null;
  assumption: string | null;
  // Enquête-engine: alle ontvangen antwoorden en de bruikbare (uit de doelgroep of met toestemming, geloofwaardig).
  // Live interviews: echte gesprekken met toestemming (oefengesprekken tellen niet).
  responses: number | null;
  usable: number | null;
};

export type StudyList = { schemaReady: boolean; rows: StudyRow[] };

type Row = {
  id: string;
  title: string;
  type: string;
  state: string;
  config: unknown;
  hypotheses: {
    assumption_id: string | null;
    success_threshold_pct: number | null;
    exploratory?: boolean | null;
    research_question_id?: string | null;
    assumptions: { statement: string; primary_experiment_id: string | null } | null;
  } | null;
};

// Alle enquêtes en interviews van een dossier, ook de tests uit stap 3, met het aantal antwoorden. Zonder de
// migratie 20261111090000_markt_klantonderzoek kent de database de kolommen voor verkennend onderzoek nog niet:
// dan haalt ProofLab de lijst op zonder die kolommen en meldt schemaReady = false.
export async function loadStudies(ideaId: string): Promise<StudyList> {
  const supabase = await supabaseServer();
  const base = "id, title, type, state, config, created_at";
  const withStudy = await supabase
    .from("experiments")
    .select(`${base}, hypotheses(assumption_id, success_threshold_pct, exploratory, research_question_id, assumptions(statement, primary_experiment_id))`)
    .eq("idea_id", ideaId)
    .in("type", ["survey", "interview"])
    .order("created_at", { ascending: false });
  let schemaReady = true;
  let data: Row[] = (withStudy.data as Row[] | null) ?? [];
  if (withStudy.error) {
    if (!missingStudySchema(withStudy.error)) return { schemaReady: true, rows: [] };
    schemaReady = false;
    const fallback = await supabase
      .from("experiments")
      .select(`${base}, hypotheses(assumption_id, success_threshold_pct, assumptions(statement, primary_experiment_id))`)
      .eq("idea_id", ideaId)
      .in("type", ["survey", "interview"])
      .order("created_at", { ascending: false });
    data = (fallback.data as Row[] | null) ?? [];
  }

  const interviewIds = data.filter((e) => e.type === "interview").map((e) => e.id);
  const { data: conversations } = interviewIds.length
    ? await supabase.from("interviews").select("experiment_id, consent_recorded, is_practice").in("experiment_id", interviewIds)
    : { data: [] };

  const rows = await Promise.all(
    data.map(async (e): Promise<StudyRow> => {
      const h = e.hypotheses;
      const primaries = h?.assumption_id && h.assumptions ? [{ id: h.assumption_id, primary_experiment_id: h.assumptions.primary_experiment_id }] : [];
      const common = {
        id: e.id,
        title: e.title,
        state: e.state as ExperimentState,
        exploratory: isExploratory(h),
        role: testRole(e.id, h?.assumption_id, primaries),
        researchQuestionId: h?.research_question_id ?? null,
        assumption: h?.assumptions?.statement ?? null,
      };
      if (e.type === "interview") {
        const own = (conversations ?? []).filter((c) => c.experiment_id === e.id);
        // B0: alleen echte gesprekken met vastgelegde toestemming tellen; oefeningen en niet-aangegeven gesprekken niet.
        return { ...common, kind: "live", responses: own.length, usable: own.filter((c) => c.consent_recorded && countsAsEvidence(c.is_practice)).length };
      }
      const { data: counts, error } = await supabase.rpc("survey_key_counts", { p_experiment: e.id });
      const total = error ? null : usableResponses((counts ?? []).map((r) => ({ ...r, responses: Number(r.responses), screened_out: Number(r.screened_out), too_fast: Number(r.too_fast), failed_attention: Number(r.failed_attention), straightlining: Number(r.straightlining) })));
      return { ...common, kind: studyFormatOf(e.config as { format?: string } | null), responses: total?.responses ?? null, usable: total?.usable ?? null };
    }),
  );
  return { schemaReady, rows };
}
