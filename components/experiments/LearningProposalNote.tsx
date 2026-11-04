import { isUnchangedProposal } from "@/lib/domain/learning-proposal";

// Fase B5: "Daaruit leren we" en "Daarom gaan we" staan vooraf ingevuld als voorstel (AI of regelgebaseerd). Zolang de
// tekst ongewijzigd is, zegt de kaart dat; de consultant past aan en bevestigt met goedkeuren.
export function LearningProposalNote({ card }: { card: { we_learned: string; therefore: string; metrics: unknown } }) {
  const p = isUnchangedProposal(card, card.metrics);
  if (!p || (!p.learned && !p.therefore)) return null;
  const fields = p.learned && p.therefore ? "“Daaruit leren we” en “Daarom gaan we” zijn" : p.learned ? "“Daaruit leren we” is" : "“Daarom gaan we” is";
  return (
    <div className="note" role="status">
      <span className="pill blue">{p.source === "ai" ? "Voorstel (AI)" : "Voorstel"}</span> {fields} een voorstel
      {p.source === "ai" ? " van de AI, op basis van de berekende uitkomst en de drempels" : ", gemaakt uit de berekende uitkomst en de vooraf vastgelegde drempels"}. Pas
      aan wat niet klopt en sla op; met goedkeuren bevestig je de tekst.
    </div>
  );
}
