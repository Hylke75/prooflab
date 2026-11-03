import { ActionForm } from "@/components/ui/ActionForm";
import { calendarDate } from "@/components/sprint/SprintCard";
import { saveOutcomeDefinition } from "@/app/app/ideas/[id]/outcome/actions";
import type { ForecastView } from "@/lib/forecast-data";

const fmt = (n: number) => n.toLocaleString("nl-NL");
const eur = (n: number) => `€ ${n.toLocaleString("nl-NL", { maximumFractionDigits: 0 })}`;
const longDate = (d: string) => calendarDate(d, { day: "numeric", month: "long", year: "numeric" });

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
          <div className="data-row"><span>Minimumbedrag per klant</span><strong className="num">{o.minValuePerCustomer == null ? "Niet vastgelegd" : eur(o.minValuePerCustomer)}</strong></div>
          <div className="data-row"><span>Omzetdoel</span><strong className="num">{o.revenueTarget == null ? "Niet vastgelegd" : eur(o.revenueTarget)}</strong></div>
          <div className="data-row">
            <span>Gemeten op</span>
            <strong>{o.due ? longDate(o.due) : o.measureDate ? `${longDate(o.measureDate)} (gepland)` : "Zes maanden na het besluit"}</strong>
          </div>
        </>
      )}
      <p className="tiny" id="definitie-hint">
        Gemeten op de geplande meetdatum, uiterlijk zes maanden na het besluit. Zodra er een voorspelling is, ligt deze definitie vast: niemand kan achteraf het doel verschuiven.
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
            <div className="double-field">
              <div>
                <label className="field-label" htmlFor="od-min-value">Minimumbedrag per klant (€)</label>
                <input className="field" id="od-min-value" name="outcome_min_value_per_customer" inputMode="decimal" defaultValue={o.minValuePerCustomer == null ? "" : String(o.minValuePerCustomer)} placeholder="Bijv. 1500" aria-describedby="od-value-hint" />
              </div>
              <div>
                <label className="field-label" htmlFor="od-revenue">Omzetdoel (€)</label>
                <input className="field" id="od-revenue" name="outcome_revenue_target" inputMode="decimal" defaultValue={o.revenueTarget == null ? "" : String(o.revenueTarget)} placeholder="Bijv. 22500" aria-describedby="od-value-hint" />
              </div>
            </div>
            <p className="field-hint" id="od-value-hint">Vul minstens één van beide in: een aantal klanten zegt pas iets met een bedrag erbij.</p>
            <label className="field-label" htmlFor="od-measure">Meetdatum (optioneel)</label>
            <input className="field" id="od-measure" name="outcome_measure_date" type="date" defaultValue={o.measureDate ?? ""} min={view.decisionDate ?? undefined} aria-describedby="od-measure-hint" />
            <p className="field-hint" id="od-measure-hint">
              Na de beslisdatum{view.decisionDate ? ` (${longDate(view.decisionDate)})` : ""} en uiterlijk zes maanden daarna. Leeg: zes maanden na het besluit.
            </p>
          </ActionForm>
        </details>
      )}
    </div>
  );
}
