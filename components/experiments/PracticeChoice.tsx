"use client";

import { RequiredMark, useFieldError } from "@/components/ui/ActionForm";

// B0, punt 2: verplichte keuze bij een interview, zonder voorkeuze. Alleen een echt gesprek telt als bewijs.
export function PracticeChoice({ idPrefix = "iv-p" }: { idPrefix?: string }) {
  const error = useFieldError("is_practice");
  const hint = `${idPrefix}-hint`;
  const err = `${idPrefix}-err`;
  return (
    <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 18px" }} aria-invalid={error ? true : undefined} aria-describedby={error ? `${err} ${hint}` : hint}>
      <legend style={{ fontSize: 14, fontWeight: 600, color: "var(--color-heading)", marginBottom: 8 }}>Echt gesprek of oefening?<RequiredMark /></legend>
      <label className="check-row">
        <input type="radio" name="is_practice" value="real" required /> Echt gesprek met iemand uit de doelgroep
      </label>
      <label className="check-row">
        <input type="radio" name="is_practice" value="practice" required /> Oefening of fictief (rollenspel, testgesprek, verzonnen voorbeeld)
      </label>
      {error && <p className="field-error" id={err} role="alert">{error}</p>}
      <p className="field-hint" id={hint}>Alleen een echt gesprek telt als bewijs. Een oefening blijft zichtbaar, maar telt nergens mee, ook niet in de coach.</p>
    </fieldset>
  );
}
