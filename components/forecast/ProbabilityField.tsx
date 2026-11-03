"use client";

import { useId, useState } from "react";
import { checkProbabilityInput } from "@/lib/domain/forecast";

// Fase B0, punt 5: een voorspelling start leeg. Geen schuif en geen vooringevulde waarde (het basispercentage
// staat erboven als referentie), zodat niemand op een voorgezet getal ankert. Het getal wordt gecontroleerd
// (0–100, zie checkProbabilityInput) en vóór het vastleggen staat er wat er precies wordt vastgelegd.
export function ProbabilityField({ describedBy }: { describedBy?: string }) {
  const [text, setText] = useState("");
  const [touched, setTouched] = useState(false);
  const id = useId();
  const check = checkProbabilityInput(text);
  const showError = touched && text.trim() !== "" && !check.ok;
  return (
    <div className="form-line" style={{ marginTop: 18 }}>
      <label htmlFor={`${id}-num`} style={{ fontWeight: 700 }}>
        Kans dat het doel wordt gehaald (%)
      </label>
      <div className="row" style={{ alignItems: "center", gap: 8, flexWrap: "nowrap" }}>
        <input
          id={`${id}-num`}
          className="field num"
          name="probability"
          type="number"
          inputMode="numeric"
          min={0}
          max={100}
          step={1}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => setTouched(true)}
          aria-invalid={showError || undefined}
          aria-describedby={[describedBy, `${id}-msg`].filter(Boolean).join(" ")}
          placeholder="Bijv. 35"
          style={{ width: 120, minHeight: 44, padding: "10px 12px" }}
        />
        <span aria-hidden="true" className="tiny">%</span>
      </div>
      <p id={`${id}-msg`} aria-live="polite" className={showError ? "field-error" : "field-hint"}>
        {showError
          ? check.message
          : check.ok
            ? <strong>Je legt {check.pct}% vast. Dit kan daarna niet meer veranderen.</strong>
            : "Vul een getal in. Er staat bewust niets voor: begin bij het basispercentage hierboven en pas het aan."}
      </p>
    </div>
  );
}
