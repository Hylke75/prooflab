"use client";

import { useState } from "react";
import { ActionForm, type FormState } from "@/components/ui/ActionForm";
import type { OwnBaseRate, ReferenceClass } from "@/lib/forecast-data";
import { NO_REFERENCE, pct } from "@/lib/domain/forecast";

type Option = { value: string; title: string; range: string; source: React.ReactNode; caveat: string | null; preferred?: boolean };

// Choose the outside view: the own base rate when there are enough resolved ideas, an external reference
// class with its source and caveat, or explicitly "no good reference".
export function BaseRatePicker({
  classes,
  own,
  current,
  action,
}: {
  classes: ReferenceClass[];
  own: OwnBaseRate | null;
  current: string | null;
  action: (s: FormState, f: FormData) => Promise<FormState>;
}) {
  const options: Option[] = [
    ...(own
      ? [
          {
            value: "own",
            title: `Eigen basispercentage · ${own.projectTypeLabel}`,
            range: pct(own.achieved),
            source: `Bron: ${own.resolved} afgeronde dossiers van deze werkruimte, gemeten zes maanden na het besluit.`,
            caveat: "Gebaseerd op jullie eigen uitkomsten; dit heeft de voorkeur boven een externe referentie.",
            preferred: true,
          },
        ]
      : []),
    ...classes.map((c) => ({
      value: c.id,
      title: c.label,
      range: c.low === c.high ? pct(c.low) : `${pct(c.low)}–${pct(c.high)}`,
      source: (
        <>
          Bron:{" "}
          <a href={c.sourceUrl} target="_blank" rel="noreferrer noopener" onClick={(e) => e.stopPropagation()}>
            {c.sourceTitle}
          </a>
        </>
      ),
      caveat: c.caveat,
    })),
    { value: NO_REFERENCE, title: "Geen goede referentie", range: "onbekend", source: "Licht hieronder toe waarom geen van de referenties past.", caveat: null },
  ];
  const initial = current && options.some((o) => o.value === current) ? current : (options[0]?.value ?? NO_REFERENCE);
  const [choice, setChoice] = useState(initial);
  return (
    <ActionForm action={action} submitLabel="Leg het basispercentage vast" submitClass="btn primary">
      <input type="hidden" name="reference" value={choice} />
      <div role="radiogroup" aria-label="Referentieklasse" className="stack" style={{ gap: 10, marginTop: 6 }}>
        {options.map((o) => (
          <div
            key={o.value}
            role="radio"
            tabIndex={choice === o.value ? 0 : -1}
            aria-checked={choice === o.value}
            className={`choice${choice === o.value ? " selected" : ""}`}
            onClick={() => setChoice(o.value)}
            onKeyDown={(e) => {
              const i = options.findIndex((x) => x.value === choice);
              if (e.key === " " || e.key === "Enter") {
                e.preventDefault();
                setChoice(o.value);
              } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === "ArrowUp" || e.key === "ArrowLeft") {
                e.preventDefault();
                const next = options[(i + (e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : options.length - 1)) % options.length];
                setChoice(next.value);
                const el = (e.currentTarget.parentElement?.children[options.indexOf(next)] as HTMLElement | undefined);
                el?.focus();
              }
            }}
            style={{ cursor: "pointer", minHeight: 44 }}
          >
            <div className="row between" style={{ gap: 8 }}>
              <span>{o.title}</span>
              <span className="row" style={{ gap: 6 }}>
                {o.preferred && <span className="pill green">Voorkeur</span>}
                <span className="pill blue num">{o.range}</span>
              </span>
            </div>
            <span className="tiny" style={{ display: "block", fontWeight: 500, marginTop: 6 }}>{o.source}</span>
            {o.caveat && <span className="tiny" style={{ display: "block", fontWeight: 500, marginTop: 4 }}>Let op: {o.caveat}</span>}
          </div>
        ))}
      </div>
      <label className="field-label" htmlFor="base_rate_note">
        Toelichting {choice === NO_REFERENCE ? "(verplicht)" : "(optioneel)"}
      </label>
      <textarea
        className="field"
        id="base_rate_note"
        name="base_rate_note"
        rows={2}
        maxLength={500}
        style={{ minHeight: 70 }}
        placeholder={choice === NO_REFERENCE ? "Waarom past geen van de referenties bij dit idee?" : "Waarin wijkt dit idee af van de referentie?"}
      />
    </ActionForm>
  );
}
