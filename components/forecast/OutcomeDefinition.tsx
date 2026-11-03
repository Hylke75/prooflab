import { ActionForm } from "@/components/ui/ActionForm";
import { calendarDate } from "@/components/sprint/SprintCard";
import { saveOutcomeDefinition } from "@/app/app/ideas/[id]/outcome/actions";
import type { ForecastView } from "@/lib/forecast-data";

const fmt = (n: number) => n.toLocaleString("nl-NL");

// "Wanneer is dit geslaagd?": shown as a fixed statement once forecasts exist, editable before that.
export function OutcomeDefinition({ view }: { view: ForecastView }) {
  const o = view.outcome;
  const editable = view.canWrite && !view.definitionLocked && !view.resolved;
  return (
    <div className="card" id="definitie" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>Wanneer is dit geslaagd?</h3>
        {o.statement ? (
          <span className={`pill ${view.definitionLocked ? "dark" : "green"}`}>{view.definitionLocked ? "Ligt vast" : "Vastgelegd"}</span>
        ) : (
          <span className="pill orange">Nog niet vastgelegd</span>
        )}
      </div>
      {o.statement && (
        <>
          <p style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.5 }}>{o.statement}</p>
          <div className="data-row"><span>Maatstaf</span><strong>{o.metric ?? "—"}</strong></div>
          <div className="data-row"><span>Doelwaarde</span><strong className="num">{o.target == null ? "—" : fmt(o.target)}</strong></div>
          <div className="data-row">
            <span>Gemeten op</span>
            <strong>{o.due ? calendarDate(o.due, { day: "numeric", month: "long", year: "numeric" }) : "Zes maanden na het besluit"}</strong>
          </div>
        </>
      )}
      <p className="tiny" id="definitie-hint">
        Gemeten zes maanden na het besluit. Zodra er een voorspelling is, ligt deze definitie vast: niemand kan achteraf het doel verschuiven.
      </p>
      {editable && (
        <details open={!o.statement} className="mt-12">
          <summary className="text-link">{o.statement ? "Definitie aanpassen" : "Leg de uitkomst vast"}</summary>
          <ActionForm action={saveOutcomeDefinition.bind(null, view.ideaId)} submitLabel="Uitkomst vastleggen">
            <label className="field-label" htmlFor="od-statement">Geslaagd als… (één zin)</label>
            <textarea
              className="field"
              id="od-statement"
              name="outcome_statement"
              maxLength={400}
              rows={2}
              style={{ minHeight: 80 }}
              defaultValue={o.statement ?? ""}
              aria-describedby="definitie-hint"
              placeholder="Bijv. Zes maanden na het besluit hebben minstens 15 MKB-klanten een betaald abonnement."
              required
            />
            <div className="double-field">
              <div>
                <label className="field-label" htmlFor="od-metric">Wat meet je?</label>
                <input className="field" id="od-metric" name="outcome_metric" maxLength={160} defaultValue={o.metric ?? ""} placeholder="Bijv. betalende klanten" required />
              </div>
              <div>
                <label className="field-label" htmlFor="od-target">Doelwaarde</label>
                <input className="field" id="od-target" name="outcome_target" inputMode="decimal" defaultValue={o.target == null ? "" : String(o.target)} placeholder="Bijv. 15" required />
              </div>
            </div>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
