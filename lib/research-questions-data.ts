import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { derivePlan, isGenericTemplate, pickDecisiveIndex, decisiveQuestionFor, type IntakeFacts } from "@/lib/research-questions";
import { log } from "@/lib/log";

// Fase B2, punt 1: de onderzoekskaart uit de intake opslaan en de beslissende vraag bijhouden.
// Zolang de migratie 20261109090000_b2_onderzoek.sql niet live staat, bestaat de kolom is_decisive niet: dan
// worden de vragen zonder markering opgeslagen en geldt de eerste vraag als beslissend (zoals voor fase B2).

type Db = Awaited<ReturnType<typeof supabaseServer>>;

// Postgres "kolom bestaat niet" of PostgREST "kolom niet in het schema".
export const missingColumn = (e: { code?: string; message?: string } | null | undefined) =>
  !!e && (e.code === "42703" || e.code === "PGRST204" || /is_decisive|column .* does not exist/i.test(e.message ?? ""));

// Nieuwe onderzoekskaart bij de intake: sjabloon met de specifieke doelgroep en de beslissende vraag.
export async function insertDerivedQuestions(supabase: Db, ideaId: string, intake: IntakeFacts): Promise<void> {
  const plan = derivePlan(intake);
  const rows = plan.questions.map((q, i) => ({ ...q, idea_id: ideaId, position: i + 1, origin: "template", is_decisive: i === plan.decisiveIndex }));
  const { error } = await supabase.from("research_questions").insert(rows);
  if (!error) return;
  if (missingColumn(error)) {
    await supabase.from("research_questions").insert(rows.map(({ is_decisive: _unused, ...r }) => r));
    return;
  }
  await log.warn("research_questions_seed_failed", { ideaId, code: error.code });
}

type QuestionRow = { id: string; position: number; question: string; origin: string; expected_source: string | null; is_decisive?: boolean };

// Zorgt dat het dossier een beslissende vraag heeft, vóór een onderzoeksrun of na een nieuw AI-plan:
// - is er al een gemarkeerde vraag, dan blijft die (de consultant kan hem zelf verplaatsen);
// - dragen de sjabloonvragen nog de brede doelgroep terwijl de intake specifieker is, dan worden ze per positie
//   bijgewerkt met de afgeleide tekst (dezelfde rij, dus gekoppelde bevindingen blijven gekoppeld);
// - anders wordt de vraag gemarkeerd die de onzekerheid raakt; zonder zo'n vraag komt de afgeleide beslissende
//   vraag erbij als er plaats is, en anders wordt de eerste vraag beslissend.
// Geeft het id van de beslissende vraag terug (of null zonder vragen).
export async function ensureDecisiveQuestion(ideaId: string, intake: IntakeFacts, opts: { refreshTemplates?: boolean } = {}): Promise<string | null> {
  const supabase = await supabaseServer();
  const full = await supabase.from("research_questions").select("id, position, question, origin, expected_source, is_decisive").eq("idea_id", ideaId).order("position");
  const hasColumn = !full.error;
  const questions: QuestionRow[] = hasColumn
    ? (full.data ?? [])
    : ((await supabase.from("research_questions").select("id, position, question, origin, expected_source").eq("idea_id", ideaId).order("position")).data ?? []);
  if (questions.length === 0) return null;
  const marked = questions.find((q) => q.is_decisive === true);
  if (marked && !opts.refreshTemplates) return marked.id;

  // Sjabloonvragen met de brede doelgroep: per positie bijwerken naar de afgeleide kaart.
  const plan = derivePlan(intake);
  let decisiveId: string | null = marked?.id ?? null;
  let refreshed = false;
  for (const q of questions) {
    if (!isGenericTemplate(q, intake)) continue;
    const next = plan.questions[q.position - 1];
    if (!next) continue;
    const { error } = await supabase.from("research_questions").update({ ...next }).eq("id", q.id).eq("idea_id", ideaId).eq("origin", "template");
    if (error) continue;
    refreshed = true;
    q.question = next.question;
    q.expected_source = next.expected_source;
    if (q.position - 1 === plan.decisiveIndex && !marked) decisiveId = q.id;
  }
  if (!hasColumn) return questions[0].id;
  if (!decisiveId) {
    const idx = pickDecisiveIndex(questions, intake);
    if (idx >= 0) decisiveId = questions[idx].id;
  }
  if (!decisiveId && questions.length < 5) {
    // Geen vraag raakt de onzekerheid: de afgeleide beslissende vraag komt erbij.
    const used = new Set(questions.map((q) => q.position));
    const position = [1, 2, 3, 4, 5].find((p) => !used.has(p))!;
    const { data } = await supabase
      .from("research_questions")
      .insert({ ...decisiveQuestionFor(intake), idea_id: ideaId, position, origin: "template", is_decisive: false })
      .select("id")
      .single();
    decisiveId = data?.id ?? null;
  }
  decisiveId ??= questions[0].id;
  if (decisiveId !== marked?.id) await markDecisive(supabase, ideaId, decisiveId);
  if (refreshed) await log.info("research_questions_refreshed", { ideaId });
  return decisiveId;
}

// Eén beslissende vraag per idee: eerst de oude markering weg, dan de nieuwe (partiële unieke index).
export async function markDecisive(supabase: Db, ideaId: string, questionId: string): Promise<boolean> {
  const off = await supabase.from("research_questions").update({ is_decisive: false }).eq("idea_id", ideaId).eq("is_decisive", true).neq("id", questionId);
  if (off.error) return false;
  const on = await supabase.from("research_questions").update({ is_decisive: true }).eq("id", questionId).eq("idea_id", ideaId);
  return !on.error;
}

// De vragen voor een onderzoeksrun, met de markering van de beslissende vraag (zonder migratie: zonder).
export async function loadRunQuestions(supabase: Db, ideaId: string): Promise<{ id: string; position: number; question: string; is_decisive?: boolean }[]> {
  const full = await supabase.from("research_questions").select("id, position, question, is_decisive").eq("idea_id", ideaId).order("position");
  if (!full.error) return full.data ?? [];
  const { data } = await supabase.from("research_questions").select("id, position, question").eq("idea_id", ideaId).order("position");
  return data ?? [];
}
