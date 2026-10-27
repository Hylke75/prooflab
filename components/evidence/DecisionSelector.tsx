"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { DECISIONS, type DecisionAction } from "@/lib/domain/labels";

export function DecisionSelector({ advised, action, disabledReason }: { advised: DecisionAction | null; action: (s: FormState, f: FormData) => Promise<FormState>; disabledReason: string | null }) {
  const [choice, setChoice] = useState<DecisionAction>(advised ?? "test_more");
  return (
    <ActionForm action={action} submitLabel="Bewaar mijn keuze ✓" submitClass="btn primary hidden">
      <input type="hidden" name="action" value={choice} />
      <div role="radiogroup" aria-label="Besluit">
        {(Object.keys(DECISIONS) as DecisionAction[]).map((k) => (
          <button type="button" key={k} role="radio" aria-checked={choice === k} className={`decision-option${choice === k ? " active" : ""}`} onClick={() => setChoice(k)}>
            <span className="radio" />
            <span>
              <strong>{DECISIONS[k].label}</strong>
              <small>{advised === k ? `Advies van de Reality Check. ${DECISIONS[k].hint}` : DECISIONS[k].hint}</small>
            </span>
          </button>
        ))}
      </div>
      <label className="field-label" htmlFor="dec-why">Waarom? (komt in het rapport)</label>
      <textarea className="field" id="dec-why" name="rationale" rows={3} required minLength={15} />
      <label className="field-label" htmlFor="dec-next">Concrete volgende stap</label>
      <input className="field" id="dec-next" name="next_step" placeholder="Bijv. prijs-/aanbodtest met drie prijspunten in november" />
      {disabledReason && <div className="note">{disabledReason}</div>}
      <button className="btn primary" style={{ width: "100%", marginTop: 20 }} disabled={!!disabledReason}>
        Bewaar mijn keuze <Icon name="check" size="sm" />
      </button>
    </ActionForm>
  );
}
