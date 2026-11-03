"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import { DECISIONS, type DecisionAction } from "@/lib/domain/labels";
import { DEVIATION_MIN_CHARS, deviates, deviationLabel } from "@/lib/domain/decision-rule";
import { EXTEND_WEEK_OPTIONS } from "@/lib/domain/extension";

// ruleMet: de toets aan de beslisregel van het dossier (null = geen regel). Wijkt de keuze af, dan is een motivering
// verplicht (golf B, punt 6); die gaat naar het auditspoor en het rapport.
export function DecisionSelector({
  advised,
  action,
  disabledReason,
  ruleMet = null,
  blocked = {},
}: {
  advised: DecisionAction | null;
  action: (s: FormState, f: FormData) => Promise<FormState>;
  disabledReason: string | null;
  ruleMet?: boolean | null;
  // Golf B, punt 20: per keuze waarom die nu niet kan (verlengde testfase loopt, of al gehad).
  blocked?: Partial<Record<DecisionAction, string>>;
}) {
  const [choice, setChoice] = useState<DecisionAction>(advised ?? "test_more");
  const deviation = deviates(choice, ruleMet);
  const choiceBlocked = blocked[choice] ?? null;
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
      {choice === "extend" && !choiceBlocked && (
        <>
          <label className="field-label" htmlFor="dec-weeks">Hoeveel weken extra testen?</label>
          <select className="field" id="dec-weeks" name="extend_weeks" defaultValue="4">
            {EXTEND_WEEK_OPTIONS.map((w) => <option key={w} value={w}>{w} weken</option>)}
          </select>
          <p className="field-hint">Het definitieve besluit en de uitkomstklok starten pas na deze verlengde testfase.</p>
        </>
      )}
      {deviation && ruleMet != null && (
        <>
          <div className="note" role="note">
            <strong>{deviationLabel(choice, ruleMet)}.</strong> Je wijkt af van de beslisregel die vooraf is vastgelegd. Motiveer waarom; de motivering komt in het
            auditspoor en in het rapport, en de opdrachtgever ziet haar bij het bevestigen.
          </div>
          <label className="field-label" htmlFor="dec-deviation">Waarom wijk je af van de beslisregel?</label>
          <textarea className="field" id="dec-deviation" name="rule_deviation_reason" rows={3} required minLength={DEVIATION_MIN_CHARS} maxLength={2000} />
        </>
      )}
      <label className="field-label" htmlFor="dec-next">Concrete volgende stap</label>
      <input className="field" id="dec-next" name="next_step" placeholder="Bijv. prijs-/aanbodtest met drie prijspunten in november" />
      {disabledReason && <div className="note">{disabledReason}</div>}
      {!disabledReason && choiceBlocked && <div className="note">{choiceBlocked}</div>}
      <button className="btn primary" style={{ width: "100%", marginTop: 20 }} disabled={!!disabledReason || !!choiceBlocked}>
        Bewaar mijn keuze <Icon name="check" size="sm" />
      </button>
    </ActionForm>
  );
}
