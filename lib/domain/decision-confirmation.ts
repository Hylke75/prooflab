// Bevestiging van een besluit door de opdrachtgever (fase B1). Alleen een dossier met een opdrachtgever (ideas.client_id)
// kent een wachtstatus: de opdrachtgever bevestigt het besluit zelf in ProofLab. Zonder opdrachtgever is het besluit
// direct definitief. Dat wordt afgeleid, niet opgeslagen: client_confirmed_at blijft leeg, zodat nergens een
// bevestiging staat die niemand heeft gegeven.

export type DecisionConfirmation = "confirmed" | "awaiting" | "not_needed";

export function decisionConfirmation(clientConfirmedAt: string | null | undefined, hasClient: boolean): DecisionConfirmation {
  if (clientConfirmedAt) return "confirmed";
  return hasClient ? "awaiting" : "not_needed";
}

// Het besluit wacht nergens meer op: bevestigd, of er is geen opdrachtgever die moet bevestigen.
export const decisionSettled = (c: DecisionConfirmation): boolean => c !== "awaiting";

export const CONFIRMATION_LABELS: Record<DecisionConfirmation, string> = {
  confirmed: "Besluit bevestigd",
  awaiting: "Besluit wacht op bevestiging",
  not_needed: "Besluit definitief (geen opdrachtgever)",
};
