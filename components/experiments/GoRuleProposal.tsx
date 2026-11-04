import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { RuleConditionRow } from "@/components/decision/RuleConditionRow";
import { adoptProposedGoRule } from "@/app/app/ideas/[id]/experiments/actions";
import type { GoRuleProposal } from "@/lib/domain/decision-rule-proposal";

// Fase B5: bij de eerste Test Card stelt ProofLab de go-regel van het dossier voor. Eén klik legt hem vast; aanpassen
// kan op de aannamepagina zolang er nog geen test is goedgekeurd. Een hoofdtest start pas als de regel vastligt.
// Gebruikerstest B1: per aanname een vinkje; alle kritieke aannames staan standaard aan, de aanname van de hoofdtest
// altijd. Een kritieke aanname uitvinken vraagt een motivering.
export function GoRuleProposalCard({ ideaId, proposal }: { ideaId: string; proposal: GoRuleProposal }) {
  return (
    <div className="note" id="go-regel" style={{ scrollMarginTop: 100 }}>
      <p style={{ marginTop: 0 }}>
        <span className="pill blue">Voorstel</span> <strong>Go-regel van het dossier</strong>
      </p>
      <p>{proposal.sentence}</p>
      <ActionForm action={adoptProposedGoRule.bind(null, ideaId, proposal.experimentId)} submitLabel="Leg deze go-regel vast" submitClass="btn primary sm" pendingLabel="Vastleggen…">
        {proposal.conditions.length > 1 && (
          <fieldset style={{ border: 0, padding: 0, margin: "0 0 8px" }}>
            <legend className="field-label">Aannames in de regel (elk minstens {Math.round(proposal.minProbability * 100)}% kans)</legend>
            {proposal.conditions.map((c) => (
              <RuleConditionRow key={c.assumptionId} id={c.assumptionId} statement={c.statement} critical={!c.main} defaultChecked main={c.main} />
            ))}
          </fieldset>
        )}
        <p className="tiny" style={{ margin: "0 0 8px" }}>
          Een hoofdtest start pas als de go-regel vastligt. Liever een andere kans of andere aannames?{" "}
          <Link className="text-link" href={`/app/ideas/${ideaId}/assumptions#beslisregel`}>Pas de regel aan op de aannamepagina</Link>.
        </p>
      </ActionForm>
    </div>
  );
}
