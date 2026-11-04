import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { adoptProposedGoRule } from "@/app/app/ideas/[id]/experiments/actions";
import type { GoRuleProposal } from "@/lib/domain/decision-rule-proposal";

// Fase B5: bij de eerste Test Card stelt ProofLab de go-regel van het dossier voor. Eén klik legt hem vast; aanpassen
// kan op de aannamepagina zolang er nog geen test is goedgekeurd. Een hoofdtest start pas als de regel vastligt.
export function GoRuleProposalCard({ ideaId, proposal }: { ideaId: string; proposal: GoRuleProposal }) {
  return (
    <div className="note" id="go-regel" style={{ scrollMarginTop: 100 }}>
      <p style={{ marginTop: 0 }}>
        <span className="pill blue">Voorstel</span> <strong>Go-regel van het dossier</strong>
      </p>
      <p>{proposal.sentence}</p>
      <ActionForm action={adoptProposedGoRule.bind(null, ideaId, proposal.experimentId)} submitLabel="Leg deze go-regel vast" submitClass="btn primary sm" pendingLabel="Vastleggen…">
        <p className="tiny" style={{ margin: "0 0 8px" }}>
          Een hoofdtest start pas als de go-regel vastligt. Liever een andere kans of meer aannames?{" "}
          <Link className="text-link" href={`/app/ideas/${ideaId}/assumptions#beslisregel`}>Pas de regel aan op de aannamepagina</Link>.
        </p>
      </ActionForm>
    </div>
  );
}
