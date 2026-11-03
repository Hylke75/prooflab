"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { rulePrimaryOptions, type PrimaryRef } from "@/lib/domain/primary-test";

// Golf B tegenover golf A: als hoofdtest van de beslisregel kun je alleen een test kiezen die bij een gekozen aanname
// als hoofdtest is aangewezen. De keuzelijst volgt de aangevinkte aannames (cond_<id>) in hetzelfde formulier; de
// server-actie controleert hetzelfde (rulePrimaryProblem).
export function RulePrimarySelect({
  ideaId,
  assumptions,
  experiments,
  defaultValue,
  initialChosen,
}: {
  ideaId: string;
  assumptions: (PrimaryRef & { statement: string })[];
  experiments: { id: string; title: string }[];
  defaultValue: string | null;
  initialChosen: string[];
}) {
  const ref = useRef<HTMLSelectElement>(null);
  const [chosen, setChosen] = useState<string[]>(initialChosen);
  const [value, setValue] = useState<string>(defaultValue ?? "");

  useEffect(() => {
    const form = ref.current?.form;
    if (!form) return;
    const read = () =>
      setChosen(assumptions.filter((a) => (form.elements.namedItem(`cond_${a.id}`) as HTMLInputElement | null)?.checked).map((a) => a.id));
    read();
    form.addEventListener("change", read);
    return () => form.removeEventListener("change", read);
  }, [assumptions]);

  const options = rulePrimaryOptions(chosen, assumptions);
  const anyPrimary = assumptions.some((a) => a.primary_experiment_id);
  const selected = options.some((o) => o.experimentId === value) ? value : "";
  const title = (id: string) => experiments.find((e) => e.id === id)?.title ?? "Test";
  const statement = (id: string) => assumptions.find((a) => a.id === id)?.statement ?? "";
  const experimentsHref = `/app/ideas/${ideaId}/experiments`;

  return (
    <>
      <label className="field-label" htmlFor="dr-primary">Hoofdtest die moet slagen</label>
      <select className="field" id="dr-primary" name="primary_experiment_id" ref={ref} value={selected} onChange={(e) => setValue(e.target.value)}>
        <option value="">Geen hoofdtest</option>
        {options.map((o) => (
          <option key={o.experimentId} value={o.experimentId}>
            {title(o.experimentId)} · hoofdtest van: {statement(o.assumptionId)}
          </option>
        ))}
      </select>
      {!anyPrimary ? (
        <p className="field-hint" role="status">
          Er is nog geen hoofdtest aangewezen. Alleen een hoofdtest van een aanname kan in de beslisregel de doorslag geven.{" "}
          <Link className="text-link" href={experimentsHref}>Wijs bij een aanname een hoofdtest aan</Link>.
        </p>
      ) : options.length === 0 ? (
        <p className="field-hint" role="status">
          Geen van de gekozen aannames heeft een hoofdtest. Vink een aanname met een hoofdtest aan, of{" "}
          <Link className="text-link" href={experimentsHref}>wijs een hoofdtest aan</Link>.
        </p>
      ) : (
        <p className="field-hint">Alleen tests die bij een gekozen aanname als hoofdtest zijn aangewezen. Verkennende tests beslissen niet.</p>
      )}
      {defaultValue && !assumptions.some((a) => a.primary_experiment_id === defaultValue) && (
        <p className="field-hint">
          De huidige hoofdtest in de regel ({title(defaultValue)}) is bij geen aanname als hoofdtest aangewezen. Kies opnieuw voordat je de regel opslaat.
        </p>
      )}
    </>
  );
}
