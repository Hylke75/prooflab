"use client";

import { useState } from "react";
import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { UndoDeleteButton } from "@/components/ui/UndoDelete";
import { ProofLabel } from "@/components/tasks/TaskHeader";

export type ProposedAssumption = { id: string; statement: string; importance: number; origin: "ai" | "template" };

// Microsoft HAX G8/G9 en NN/g: voorgestelde aannames (AI of standaardset) één voor één overnemen, aanpassen of
// weggooien. Zolang je niets kiest, blijven ze zichtbaar als voorstel; ze staan wel al op de risicokaart.
export function AssumptionProposals({
  items,
  confirmActions,
  reviseActions,
  deleteActions,
  confirmAll,
}: {
  items: ProposedAssumption[];
  confirmActions: Record<string, () => Promise<void>>;
  reviseActions: Record<string, (state: FormState, form: FormData) => Promise<FormState>>;
  deleteActions: Record<string, () => Promise<void>>;
  confirmAll: () => Promise<void>;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  if (items.length === 0) return null;
  const fromAi = items.some((i) => i.origin === "ai");
  return (
    <section className="card" aria-labelledby="voorstellen-titel">
      <div className="section-title">
        <h2 className="as-h3" id="voorstellen-titel">Voorstellen ({items.length})</h2>
        <form action={confirmAll}>
          <button className="btn white sm">Alles overnemen</button>
        </form>
      </div>
      <p className="tiny" style={{ marginTop: -6 }}>
        {fromAi ? "De AI stelde deze aannames voor op basis van je idee en je onderzoek." : "Deze aannames komen uit de standaardset."} Neem over wat klopt, pas aan wat
        bijna klopt en gooi weg wat niet bij jouw idee past.
      </p>
      <ul className="proposal-list">
        {items.map((a) => (
          <li key={a.id} data-undo-item className="proposal-item">
            <div>
              <ProofLabel kind={a.origin === "ai" ? "ai" : "template"} /> <span className="tiny">belang {a.importance}</span>
              <p style={{ margin: "6px 0 0" }}>{a.statement}</p>
            </div>
            {editing === a.id ? (
              <ActionForm action={reviseActions[a.id]} submitLabel="Opslaan en overnemen" submitClass="btn primary sm" footer={<button type="button" className="btn white sm" onClick={() => setEditing(null)}>Annuleren</button>}>
                <Field name="statement" id={`rev-${a.id}`} label="Aanname">
                  <textarea className="field" rows={2} defaultValue={a.statement} maxLength={400} />
                </Field>
              </ActionForm>
            ) : (
              <div className="row" role="group" aria-label={`Wat doe je met: ${a.statement}`} style={{ gap: 8, flexWrap: "wrap" }}>
                <form action={confirmActions[a.id]}>
                  <button className="btn white sm">Overnemen</button>
                </form>
                <button type="button" className="btn white sm" onClick={() => setEditing(a.id)}>
                  Aanpassen
                </button>
                <UndoDeleteButton action={deleteActions[a.id]} label="Weggooien" what="Voorstel" />
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
