"use client";

import { useState } from "react";
import { DEVIATION_MIN_CHARS } from "@/lib/domain/decision-rule";

// Gebruikerstest B1: één aanname als voorwaarde van de beslisregel, met een vinkje. Haal je een kritieke aanname (gekozen
// om nu te testen, belang 5) eruit, dan verschijnt een verplicht veld voor de motivering (minstens 15 tekens). De server
// controleert hetzelfde (excludedCriticalCheck). De aanname van de hoofdtest blijft altijd in de regel.
export function RuleConditionRow({
  id,
  statement,
  importance,
  critical,
  defaultChecked,
  main = false,
  minInput,
}: {
  id: string;
  statement: string;
  importance?: number;
  critical: boolean;
  defaultChecked: boolean;
  main?: boolean;
  // Optioneel veld voor de minimale kans (aannamepagina); op de testpagina geldt vast 70%.
  minInput?: React.ReactNode;
}) {
  const [checked, setChecked] = useState(main || defaultChecked);
  const reasonId = `reason-${id}`;
  return (
    <div className="rule-cond">
      <div className="rule-cond-main">
        <label className="check-row" style={{ margin: "6px 0" }}>
          <input type="checkbox" name={main ? undefined : `cond_${id}`} checked={checked} disabled={main} onChange={(e) => setChecked(e.target.checked)} />{" "}
          {statement}
          {importance != null && <span className="tiny"> (belang {importance}/5)</span>}
          {critical && <> <span className="pill coral">Kritiek</span></>}
          {main && <> <span className="pill blue">Aanname van de hoofdtest</span></>}
        </label>
        {main && <input type="hidden" name={`cond_${id}`} value="on" />}
        {minInput}
      </div>
      {critical && !checked && (
        <div className="form-line" style={{ margin: "4px 0 10px 28px" }}>
          <label htmlFor={reasonId}>Waarom laat je deze kritieke aanname weg?</label>
          <textarea className="field" id={reasonId} name={`reason_${id}`} rows={2} required minLength={DEVIATION_MIN_CHARS} maxLength={200} aria-describedby={`${reasonId}-hint`} />
          <p className="field-hint" id={`${reasonId}-hint`}>Minstens {DEVIATION_MIN_CHARS} tekens. Komt als &ldquo;Uitgesloten&rdquo; in de toelichting van de regel, het auditspoor en het rapport.</p>
        </div>
      )}
    </div>
  );
}
