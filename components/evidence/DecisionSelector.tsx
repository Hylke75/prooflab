"use client";

import { useState } from "react";
import { Icon } from "@/components/Icon";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { DECISIONS, type DecisionAction } from "@/lib/domain/labels";
import { DEVIATION_MIN_CHARS, deviates, deviationLabel } from "@/lib/domain/decision-rule";
import { EXTEND_WEEK_OPTIONS } from "@/lib/domain/extension";
import type { DecisionBlocker, DecisionStepKey } from "@/lib/domain/forecast";

const STEP_LINKS: Record<DecisionStepKey, string> = {
  definitie: "Leg vast wanneer dit idee geslaagd is →",
  basispercentage: "Kies het basispercentage →",
  voorspelling: "Geef je eigen voorspelling →",
};

// De keuzes in het scherm. "extend" (verlengde testfase) is sinds B6 opgenomen in "Verder testen" met een duur.
const VISIBLE_CHOICES = (Object.keys(DECISIONS) as DecisionAction[]).filter((k) => k !== "extend");

// ruleMet: de toets aan de beslisregel van het dossier (null = geen regel). Wijkt de keuze af, dan is een motivering
// verplicht (golf B, punt 6); die gaat naar het auditspoor en het rapport.
export function DecisionSelector({
  advised,
  action,
  disabledReason,
  ruleMet = null,
  blocked = {},
  forecastStep = null,
  forecast = null,
}: {
  advised: DecisionAction | null;
  action: (s: FormState, f: FormData) => Promise<FormState>;
  disabledReason: string | null;
  ruleMet?: boolean | null;
  // Golf B, punt 20: per keuze waarom die nu niet kan (verlengde testfase loopt, of al gehad).
  blocked?: Partial<Record<DecisionAction, string>>;
  // Gebruikerstest D12: stap 1 vóór het besluit (uitkomst, basispercentage, eigen voorspelling) en de compacte invoer.
  forecastStep?: { done: boolean; missing: DecisionBlocker[] } | null;
  forecast?: React.ReactNode;
}) {
  // B6: "Verder testen" en de verlengde testfase zijn één keuze met een duur; de server kiest hoe die wordt opgeslagen.
  const [choice, setChoice] = useState<DecisionAction>(advised && advised !== "extend" ? advised : "test_more");
  const deviation = deviates(choice, ruleMet);
  const choiceBlocked = blocked[choice] ?? null;
  return (
    <>
      {forecastStep && (
        <ol className="decision-steps" aria-label="Stappen naar het besluit">
          <li className={forecastStep.done ? "done" : "open"}>
            <strong>1. Voorspelling</strong> <span className={`pill ${forecastStep.done ? "green" : "orange"}`}>{forecastStep.done ? "✓ klaar" : "open"}</span>
            {forecastStep.missing.length > 0 && (
              <ul>
                {forecastStep.missing.map((m) => (
                  <li key={m.step}>
                    <a className="text-link" href={m.href}>{STEP_LINKS[m.step]}</a>
                  </li>
                ))}
              </ul>
            )}
          </li>
          <li className={forecastStep.done ? "open" : "later"} aria-current={forecastStep.done ? "step" : undefined}>
            <strong>2. Besluit</strong>
          </li>
        </ol>
      )}
      {forecastStep && forecast}
    <ActionForm
      action={action}
      submitLabel="Bewaar mijn keuze"
      submitIcon={<Icon name="check" size="sm" />}
      pendingLabel="Besluit opslaan…"
      submitStyle={{ width: "100%", marginTop: 8 }}
      disabled={!!disabledReason || !!choiceBlocked}
      describedBy={disabledReason || choiceBlocked ? "dec-blocked" : undefined}
      noValidate
    >
      <input type="hidden" name="action" value={choice} />
      <div role="radiogroup" aria-label="Besluit">
        {VISIBLE_CHOICES.map((k) => (
          <button type="button" key={k} role="radio" aria-checked={choice === k} className={`decision-option${choice === k ? " active" : ""}`} onClick={() => setChoice(k)}>
            <span className="radio" />
            <span>
              <strong>{DECISIONS[k].label}</strong>
              <small>{advised === k ? `Advies van de Reality Check. ${DECISIONS[k].hint}` : DECISIONS[k].hint}</small>
            </span>
          </button>
        ))}
      </div>
      <Field className="" labelClassName="field-label" name="rationale" id="dec-why" label="Waarom? (komt in het rapport)" required hint="Minstens één zin (15 tekens).">
        <textarea className="field" rows={3} minLength={15} maxLength={2000} />
      </Field>
      {choice === "test_more" && (
        <Field
          className=""
          labelClassName="field-label"
          name="extend_weeks"
          id="dec-weeks"
          label="Hoe lang test je verder?"
          required
          hint={
            blocked.extend
              ? "Dit dossier had al een verlengde testfase of de uitkomstklok loopt: de duur wordt een streefdatum en houdt een definitief besluit niet tegen."
              : "Het definitieve besluit (doorgaan of stoppen) en de uitkomstklok volgen na deze periode."
          }
        >
          <select className="field" defaultValue="4">
            {EXTEND_WEEK_OPTIONS.map((w) => <option key={w} value={w}>{w} weken</option>)}
          </select>
        </Field>
      )}
      {deviation && ruleMet != null && (
        <>
          <div className="note" role="note">
            <strong>{deviationLabel(choice, ruleMet)}.</strong> Je wijkt af van de beslisregel die vooraf is vastgelegd. Motiveer waarom; de motivering komt in het
            auditspoor en in het rapport, en de opdrachtgever ziet haar bij het bevestigen.
          </div>
          <Field className="" labelClassName="field-label" name="rule_deviation_reason" id="dec-deviation" label="Waarom wijk je af van de beslisregel?" required hint={`Minstens ${DEVIATION_MIN_CHARS} tekens.`}>
            <textarea className="field" rows={3} minLength={DEVIATION_MIN_CHARS} maxLength={2000} />
          </Field>
        </>
      )}
      <Field className="" labelClassName="field-label" name="next_step" id="dec-next" label="Concrete volgende stap (optioneel)">
        <input className="field" placeholder="Bijv. prijs-/aanbodtest met drie prijspunten in november" maxLength={600} />
      </Field>
      {disabledReason && <div className="note" id="dec-blocked">{disabledReason}</div>}
      {!disabledReason && choiceBlocked && <div className="note" id="dec-blocked">{choiceBlocked}</div>}
    </ActionForm>
    </>
  );
}
