"use client";

import { useState } from "react";
import { CheckField, Field, RequiredMark, useFieldError } from "@/components/ui/ActionForm";
import { RECRUITMENT_GROUPS, RECRUITMENT_KEYS, type RecruitmentGroup } from "@/lib/domain/recruitment";
import { interviewRecruitmentDefault, OWN_NETWORK_OPTION } from "@/lib/domain/interview-intake";
import { CHANNELS } from "@/lib/domain/tracking";

// B0, punt 2: verplichte keuze bij een interview, zonder voorkeuze. Alleen een echt gesprek telt als bewijs.
export function PracticeChoice({ idPrefix = "iv-p", onChange }: { idPrefix?: string; onChange?: (v: "real" | "practice") => void }) {
  const error = useFieldError("is_practice");
  const hint = `${idPrefix}-hint`;
  const err = `${idPrefix}-err`;
  return (
    <fieldset className="form-line" style={{ border: 0, padding: 0, margin: "0 0 18px" }} aria-invalid={error ? true : undefined} aria-describedby={error ? `${err} ${hint}` : hint}>
      <legend style={{ fontSize: 14, fontWeight: 600, color: "var(--color-heading)", marginBottom: 8 }}>Echt gesprek of oefening?<RequiredMark /></legend>
      <label className="check-row">
        <input type="radio" name="is_practice" value="real" required onChange={() => onChange?.("real")} /> Echt gesprek met iemand uit de doelgroep
      </label>
      <label className="check-row">
        <input type="radio" name="is_practice" value="practice" required onChange={() => onChange?.("practice")} /> Oefening of fictief (rollenspel, testgesprek, verzonnen voorbeeld)
      </label>
      {error && <p className="field-error" id={err} role="alert">{error}</p>}
      <p className="field-hint" id={hint}>Alleen een echt gesprek telt als bewijs. Een oefening blijft zichtbaar, maar telt nergens mee, ook niet in de coach.</p>
    </fieldset>
  );
}

// Gebruikerstest C8: de velden van een nieuw interview die van elkaar afhangen.
// - Toestemming verschijnt (en is verplicht) alleen bij een echt gesprek.
// - Eén veld voor de wervingsgroep, met "eigen netwerk (bekende)" als optie; zonder keuze volgt de groep uit het
//   wervingskanaal. De server leidt "bekende" af uit de groep (lib/domain/interview-intake.ts).
export function InterviewIntakeFields({ testGroup, idPrefix = "iv" }: { testGroup: string | null; idPrefix?: string }) {
  const [practice, setPractice] = useState<"real" | "practice" | null>(null);
  const [via, setVia] = useState("network");
  const derived: RecruitmentGroup = interviewRecruitmentDefault(via, testGroup);
  return (
    <>
      <Field name="recruited_via" id={`${idPrefix}-c`} label="Geworven via" required>
        <select className="field" value={via} onChange={(e) => setVia(e.target.value)}>
          {Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </Field>
      <Field
        name="recruitment_group"
        id={`${idPrefix}-g`}
        label="Wervingsgroep"
        hint="Kies eigen netwerk als je deze persoon kent. Gesprekken uit dezelfde groep tellen afnemend mee."
      >
        <select className="field" defaultValue="">
          <option value="">Afleiden uit het wervingskanaal ({derived === "own_network" ? "eigen netwerk" : RECRUITMENT_GROUPS[derived].label.toLowerCase()})</option>
          {RECRUITMENT_KEYS.map((k) => <option key={k} value={k}>{k === "own_network" ? OWN_NETWORK_OPTION : RECRUITMENT_GROUPS[k].label}</option>)}
        </select>
      </Field>
      <PracticeChoice idPrefix={`${idPrefix}-p`} onChange={setPractice} />
      {practice === "real" && (
        <CheckField name="consent_recorded" id={`${idPrefix}-consent`} label="Toestemming voor verwerking is gegeven en vastgelegd (bewaartermijn 12 maanden)" required />
      )}
    </>
  );
}
