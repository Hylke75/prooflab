"use client";

import { ActionForm, Field, type FormState } from "@/components/ui/ActionForm";
import { DirectionField } from "@/components/ui/DirectionField";

// Fase 2 · punt 5: de formulieren van de wervingstrechter. Eigen clientcomponenten: de trechter zelf is een
// servercomponent, en ActionForm met Field direct vanuit die servercomponent gaf in de productiebundel een leeg
// elementtype (React-fout 130) op de testpagina. Binnen één clientmodule speelt dat niet.
export function RecruitmentEntryForm({
  action,
  channels,
  steps,
  today,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  channels: { key: string; label: string }[];
  steps: { key: string; label: string }[];
  today: string;
}) {
  return (
    <ActionForm action={action} submitLabel="Vastleggen" submitClass="btn primary sm" resetOnSuccess noValidate>
      <div className="double-field mt-8">
        <Field name="entry_date" id="rec-date" label="Datum" required>
          <input className="field" type="date" defaultValue={today} max={today} />
        </Field>
        <Field name="channel" id="rec-channel" label="Kanaal" required>
          <select className="field" defaultValue="linkedin">
            {channels.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </Field>
      </div>
      <div className="double-field">
        <Field name="step" id="rec-step" label="Stap" required>
          <select className="field" defaultValue="approached">
            {steps.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </Field>
        <Field name="quantity" id="rec-qty" label="Aantal" required>
          <input className="field" type="number" min={1} max={10000} step={1} inputMode="numeric" />
        </Field>
      </div>
      <fieldset className="recruit-kind">
        <legend className="field-label">Soort regel</legend>
        <label className="check-row"><input type="radio" name="kind" value="add" defaultChecked /> Toevoegen</label>
        <label className="check-row"><input type="radio" name="kind" value="correction" /> Correctie: dit aantal aftrekken (reden verplicht)</label>
      </fieldset>
      <Field name="note" id="rec-note" label="Notitie (optioneel; bij een correctie de reden)" hint="Geen namen of contactgegevens: alleen aantallen en context.">
        <input className="field" maxLength={500} />
      </Field>
    </ActionForm>
  );
}

// Expandi-campagne koppelen.
export function RecruitmentCampaignForm({ action, options }: { action: (state: FormState, form: FormData) => Promise<FormState>; options: string[] }) {
  return (
    <ActionForm action={action} submitLabel="Koppel campagne" submitClass="btn white sm">
      <Field name="campaign" id="rec-campaign" label="Campagne uit de ontvangen Expandi-gebeurtenissen" required>
        <select className="field">
          {options.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
    </ActionForm>
  );
}

// Respons per kanaal vastleggen als bevinding (optioneel gekoppeld aan een aanname).
export function RecruitmentResponseForm({
  action,
  channel,
  assumptions,
}: {
  action: (state: FormState, form: FormData) => Promise<FormState>;
  channel: string;
  assumptions: { id: string; statement: string; channel: boolean }[];
}) {
  return (
    <ActionForm action={action} submitLabel="Leg vast als bevinding" submitClass="btn primary sm">
      <input type="hidden" name="channel" value={channel} />
      <p className="tiny">
        Wordt een bevinding met als bron &ldquo;Eigen wervingsregistratie&rdquo; (een eigen meting, geen officiële of primaire bron). Het fragment is
        de telling zelf, zodat de citaatcontrole exact is.
      </p>
      {assumptions.length > 0 && (
        <>
          <Field name="assumption_id" id={`rec-a-${channel}`} label="Koppel aan een aanname (optioneel)">
            <select className="field" defaultValue="">
              <option value="">Niet koppelen</option>
              {assumptions.map((a) => <option key={a.id} value={a.id}>{a.channel ? "Kanaal · " : ""}{a.statement.slice(0, 110)}</option>)}
            </select>
          </Field>
          <DirectionField kind="finding" id={`rec-rel-${channel}`} name="relation" />
        </>
      )}
    </ActionForm>
  );
}

// Een regel tegenboeken (met reden).
export function RecruitmentReverseForm({ action, entryId }: { action: (state: FormState, form: FormData) => Promise<FormState>; entryId: string }) {
  return (
    <ActionForm action={action} submitLabel="Tegenboeken" submitClass="btn white sm">
      <Field name="note" id={`rev-${entryId}`} label="Reden" required>
        <input className="field" minLength={5} maxLength={500} />
      </Field>
    </ActionForm>
  );
}
