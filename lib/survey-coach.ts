import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { aiConfigured } from "@/lib/env";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { AiBudgetError } from "@/lib/ai/client";
import { draftSurvey } from "@/lib/ai/survey";
import { ideaContext } from "@/lib/idea-context";
import { dossierSummaryForAi, loadDossier } from "@/lib/dossier";
import { sanitiseDraft, templateDraft, type DraftResult } from "@/lib/domain/survey-draft";
import type { IdeaAccess } from "@/lib/data";
import type { Json } from "@/lib/database.types";

export type CoachDraft = { draft: DraftResult; draftId: string | null };

// De eerste opzet van een enquête door de coach, voor een testkaart (onderwerp = de aanname) én voor verkennend
// klantonderzoek vanuit Markt (onderwerp = de onderzoeksvraag). Zonder AI (niet verbonden, budget op of een fout)
// het sjabloon, met de reden erbij. Het AI-origineel wordt bewaard (golf A, punt 17); lukt dat niet, dan werkt de
// opzet gewoon, alleen zonder vergelijking.
export async function coachSurveyDraft(
  idea: IdeaAccess["idea"],
  input: { subject: string; audience: string; researcher: string },
): Promise<CoachDraft> {
  const ctx = { assumption: input.subject, audience: input.audience, researcher: input.researcher, product: idea.title, productNames: [idea.title] };
  if (!aiConfigured()) return { draft: templateDraft(ctx, "AI is niet verbonden; dit is het sjabloon van ProofLab, geen AI-opzet."), draftId: null };
  try {
    const dossier = dossierSummaryForAi(await loadDossier(idea));
    const res = await runAi(idea.id, "survey_draft", (p) =>
      draftSurvey({ idea: ideaContext(idea), assumption: input.subject, audience: input.audience, decisionQuestion: idea.decision_question, dossier }, p),
    );
    const draft = sanitiseDraft(res.data, ctx);
    const supabase = await supabaseServer();
    const { data: saved } = await supabase.from("ai_drafts").insert({ idea_id: idea.id, kind: "survey", content: draft.config as unknown as Json }).select("id").single();
    return { draft, draftId: saved?.id ?? null };
  } catch (e) {
    if (e instanceof AiBudgetError) return { draft: templateDraft(ctx, `${e.message} Daarom staat hieronder het sjabloon van ProofLab, geen AI-opzet.`), draftId: null };
    return { draft: templateDraft(ctx, `${aiErrorMessage(e, "De coach kon geen opzet maken.")} Daarom staat hieronder het sjabloon van ProofLab, geen AI-opzet.`), draftId: null };
  }
}
