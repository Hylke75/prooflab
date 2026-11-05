// Bevestiging van een besluit door de opdrachtgever (fase B1). Alleen een dossier met een opdrachtgever (ideas.client_id)
// kent een wachtstatus: de opdrachtgever bevestigt het besluit zelf in ProofLab. Zonder opdrachtgever is een
// definitief besluit (doorgaan of stoppen) direct definitief. Dat wordt afgeleid, niet opgeslagen: client_confirmed_at
// blijft leeg, zodat nergens een bevestiging staat die niemand heeft gegeven.
//
// Gebruikerstest D1: verder testen, de verlengde testfase, bijsturen en pauzeren zijn nooit definitief, ook niet zonder
// opdrachtgever. Die krijgen de toestand "not_final" (tussenbesluit). Er wacht dan ook geen bevestiging.

import { isConclusiveDecision } from "@/lib/domain/dossier-status";

export type DecisionConfirmation = "confirmed" | "awaiting" | "not_needed" | "not_final";

export function decisionConfirmation(clientConfirmedAt: string | null | undefined, hasClient: boolean, action: string | null | undefined): DecisionConfirmation {
  if (!isConclusiveDecision(action)) return "not_final";
  if (clientConfirmedAt) return "confirmed";
  return hasClient ? "awaiting" : "not_needed";
}

// Het besluit wacht nergens meer op: bevestigd, geen opdrachtgever die moet bevestigen, of een tussenbesluit.
export const decisionSettled = (c: DecisionConfirmation): boolean => c !== "awaiting";

export const CONFIRMATION_LABELS: Record<DecisionConfirmation, string> = {
  confirmed: "Besluit bevestigd",
  awaiting: "Besluit wacht op bevestiging",
  not_needed: "Besluit definitief (geen opdrachtgever)",
  not_final: "Tussenbesluit: nog geen definitief besluit",
};
