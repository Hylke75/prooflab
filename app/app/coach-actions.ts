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
  try {
    const res = await runAi(ideaId, "coach", (p) => coachAnswer(ideaContext(idea), context, question, p));
    return { answer: res.text, error: null };
  } catch (e) {
    return { answer: null, error: aiErrorMessage(e, "De coach kon nu geen antwoord geven. Probeer het later opnieuw.") };
  }
}
