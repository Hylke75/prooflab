"use server";

import { aiConfigured } from "@/lib/env";
import { getIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { nextAction } from "@/lib/domain/coach";
import { coachAnswer } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { loadDossier } from "@/lib/dossier";
import { coachContextLines } from "@/lib/coach/context";
import { supabaseServer } from "@/lib/supabase/server";
import { isNoteStep, NOTE_STEP_LABELS } from "@/lib/domain/step-files";

export type CoachAnswerState = { answer: string | null; error: string | null };

export async function askCoach(_: CoachAnswerState, form: FormData): Promise<CoachAnswerState> {
  const ideaId = String(form.get("ideaId") ?? "");
  const question = String(form.get("question") ?? "").trim().slice(0, 600);
  if (!question) return { answer: null, error: "Typ eerst je vraag." };
  if (!aiConfigured()) return { answer: null, error: "AI is niet verbonden in deze omgeving." };
  const { idea } = await getIdea(ideaId);
  const [p, dossier] = await Promise.all([loadProgress(ideaId), loadDossier(idea)]);
  const next = nextAction(p);
  const context = [
    `Onderzoeksvragen: ${p.questions}; bevindingen: ${p.claims} (geverifieerd ${p.verifiedClaims}, onvoldoende bewijs ${p.weakClaims})`,
    `Concurrenten/alternatieven: ${p.competitors}; huidige alternatieven in kaart: ${p.hasAlternatives ? "ja" : "nee"}`,
    `Marktomvang vastgesteld: ${p.sizingEstablished ? "ja" : "nee"}`,
    `Aannames: ${p.assumptions}; grootste risico: ${p.topAssumption?.statement ?? "onbekend"}`,
    `Experimenten: concept ${p.experimentsDraft}, lopend ${p.experimentsLive}, afgerond ${p.experimentsEnded}`,
    `Waargenomen klantgedrag: ${p.behaviourObservations}; besluiten: ${p.decisions}`,
    `Volgende stap volgens de regels: ${next.title}`,
    // Fase B4/B6: intake, experimenten (type, status, drempels, uitkomst) en echte interviews, zonder persoonsgegevens.
    ...coachContextLines(dossier),
  ].join("\n");
  // De AI leest ook de eigen notities bij de stap waar de vraag gesteld wordt (via RLS: alleen wat deze gebruiker ziet).
  const step = form.get("step");
  let notes: { step: string; text: string } | undefined;
  if (isNoteStep(step)) {
    const supabase = await supabaseServer();
    const { data } = await supabase.from("step_notes").select("title, body").eq("idea_id", ideaId).eq("step", step).order("updated_at", { ascending: false }).limit(8);
    const text = (data ?? []).map((n) => `- ${n.title ? `${n.title}: ` : ""}${n.body}`).join("\n").slice(0, 4000);
    if (text) notes = { step: NOTE_STEP_LABELS[step], text };
  }
  try {
    const res = await runAi(ideaId, "coach", (p) => coachAnswer(ideaContext(idea), context, question, p, notes));
    return { answer: res.text, error: null };
  } catch (e) {
    return { answer: null, error: aiErrorMessage(e, "De coach kon nu geen antwoord geven. Probeer het later opnieuw.") };
  }
}
