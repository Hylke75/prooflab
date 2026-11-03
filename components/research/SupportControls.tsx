"use client";

import { ActionForm, type FormState } from "@/components/ui/ActionForm";

type Action = (s: FormState, f: FormData) => Promise<FormState>;

// Per quote: ask the AI for a proposal, or give the consultant's own verdict (which always wins).
export function SupportControls({
  id,
  checkedBy,
  current,
  aiConnected,
  checkAction,
  overrideAction,
}: {
  id: string;
  checkedBy: string | null;
  current: string;
  aiConnected: boolean;
  checkAction: Action;
  overrideAction: Action;
}) {
  return (
    <details style={{ marginTop: 6 }}>
      <summary className="text-link">Draagt dit citaat de bewering?</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        {checkedBy !== "consultant" &&
          (aiConnected ? (
            <ActionForm action={checkAction} submitLabel={checkedBy === "ai" ? "Laat AI opnieuw beoordelen" : "Laat AI beoordelen (voorstel)"} submitClass="btn soft sm" pendingLabel="Beoordelen…">
              <span />
            </ActionForm>
          ) : (
            <p className="tiny">AI niet verbonden: beoordeel het citaat zelf hieronder.</p>
          ))}
        <ActionForm action={overrideAction} submitLabel="Oordeel vastleggen" submitClass="btn white sm">
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="tiny" style={{ fontWeight: 800 }}>Jouw oordeel als consultant</legend>
            {[
              ["supports", "Draagt de bewering"],
              ["partial", "Draagt de bewering deels"],
              ["not_supported", "Draagt de bewering niet (telt niet als bewijs)"],
            ].map(([v, l]) => (
              <label key={v} className="check-row" style={{ margin: "2px 0" }}>
                <input type="radio" name="verdict" value={v} defaultChecked={current === v} /> {l}
              </label>
            ))}
          </fieldset>
          <label className="field-label" htmlFor={`sn-${id}`}>Toelichting (optioneel)</label>
          <input className="field" id={`sn-${id}`} name="note" maxLength={500} />
        </ActionForm>
      </div>
    </details>
  );
}
