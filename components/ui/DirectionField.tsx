"use client";

import { Field } from "@/components/ui/ActionForm";

// Gebruikerstest C1: één veld voor de richting van bewijs, overal hetzelfde patroon. Er zijn twee richtingen die
// gebruikers door elkaar haalden:
// - citaat → bevinding (claim_sources.stance): bevestigt of weerlegt de bron wat de bevinding zegt? Dat bepaalt de status
//   van de bevinding (geverifieerd, weerlegd, tegenstrijdig);
// - bevinding of uitspraak → aanname (assumption_claims.relation, assumption_observations.relation): maakt dit de aanname
//   waarschijnlijker of minder waarschijnlijk?
// Het veld noemt daarom altijd expliciet wat met wat wordt vergeleken, met een voorbeeld.

export type DirectionKind = "quote" | "finding" | "statement";

const COPY: Record<DirectionKind, { label: string; supports: string; contradicts: string; hint: string }> = {
  quote: {
    label: "Wat doet dit citaat met je bevinding?",
    supports: "Bevestigt de bevinding",
    contradicts: "Weerlegt de bevinding",
    hint: 'Vergelijk het citaat met je eigen zin. Voorbeeld: bevinding "Veel clubs zoeken vrijwilligers voor communicatie", citaat "62% van de clubs heeft een vacature voor communicatie": het citaat bevestigt de bevinding. Zegt de bron het tegendeel, kies dan "weerlegt".',
  },
  finding: {
    label: "Wat doet deze bevinding met de aanname?",
    supports: "Bevestigt de aanname",
    contradicts: "Weerlegt de aanname",
    hint: 'Ga uit van de bevinding zoals ze er staat. Voorbeeld: aanname "Clubs zijn te bereiken via bonden", bevinding "De KNVB mailt maandelijks alle 3.000 clubs": de bevinding bevestigt de aanname.',
  },
  statement: {
    label: "Wat doet deze uitspraak met de aanname?",
    supports: "Bevestigt de aanname",
    contradicts: "Weerlegt de aanname",
    hint: 'Voorbeeld: aanname "Besturen hebben geen tijd voor communicatie", uitspraak "Ik doe de nieuwsbrief er \'s avonds bij en dat lukt nooit": de uitspraak bevestigt de aanname.',
  },
};

export function DirectionField({
  kind,
  id,
  name,
  value,
  defaultValue = "supports",
  onChange,
  neutral = false,
}: {
  kind: DirectionKind;
  id: string;
  name: string;
  // Gecontroleerd (value + onChange) of ongecontroleerd (defaultValue).
  value?: string;
  defaultValue?: string;
  onChange?: (v: "supports" | "contradicts" | "neutral") => void;
  // Interviewuitspraken kunnen ook neutraal zijn (telt niet mee).
  neutral?: boolean;
}) {
  const c = COPY[kind];
  return (
    <Field name={name} id={id} label={c.label} hint={c.hint}>
      <select
        className="field"
        {...(value !== undefined ? { value } : { defaultValue })}
        onChange={onChange ? (e) => onChange(e.target.value as "supports" | "contradicts" | "neutral") : undefined}
      >
        <option value="supports">{c.supports}</option>
        <option value="contradicts">{c.contradicts}</option>
        {neutral && <option value="neutral">Neutraal (telt niet mee)</option>}
      </select>
    </Field>
  );
}
