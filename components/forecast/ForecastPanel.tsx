import Link from "next/link";
import { ActionForm } from "@/components/ui/ActionForm";
import { ProbabilityField } from "./ProbabilityField";
import { BaseRateSummary, baseRateStart } from "./BaseRate";
import { requestAiForecast, submitForecast } from "@/app/app/ideas/[id]/outcome/actions";
import type { ForecastRow, ForecastView } from "@/lib/forecast-data";
import { aggregate, aiAsOneVote, FORECAST_MOMENTS, MOMENT_LABELS, pct, type ForecastMoment } from "@/lib/domain/forecast";
import { PROVIDER_LABELS } from "@/lib/ai/providers/config";
import { ensembleMean } from "@/lib/ai/providers/select";

const KIND_PILL = { consultant: "blue", client: "orange", ai: "gray" } as const;

// Golf B, punt 15: de AI telt als één stem, het gemiddelde van de modellen. De losse modellen staan eronder ter info.
function ForecastList({ rows }: { rows: ForecastRow[] }) {
  const people = rows.filter((r) => r.kind !== "ai");
  const agg = aggregate(people.map((r) => r.probability));
  const aiRows = rows.filter((r) => r.kind === "ai");
  const aiMean = ensembleMean(aiRows.map((r) => r.probability));
  const all = aggregate(aiAsOneVote(rows).map((v) => v.probability));
  return (
    <>
      {agg && (
        <div className="kpi-row" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", margin: "12px 0 4px" }}>
          <div>
            <div className="tiny">Gemiddelde (mensen)</div>
            <div className="mini-kpi num" style={{ fontSize: 24 }}>{pct(agg.mean)}</div>
          </div>
          <div>
            <div className="tiny">Spreiding</div>
            <div className="mini-kpi num" style={{ fontSize: 24 }}>{agg.n > 1 ? `${pct(agg.min)}–${pct(agg.max)}` : "—"}</div>
          </div>
          <div>
            <div className="tiny">Voorspellers</div>
            <div className="mini-kpi num" style={{ fontSize: 24 }}>{agg.n}{aiMean != null ? " + AI" : ""}</div>
          </div>
        </div>
      )}
      {agg && agg.n > 1 && (
        <p className="tiny">Standaardafwijking {Math.round(agg.sd * 100)} procentpunt. Een grote spreiding betekent dat de inschattingen uiteenlopen: bespreek waarom.</p>
      )}
      {people.map((r) => (
        <div className="evidence-event" key={r.id}>
          <div className="icon-circle num" style={{ width: 46, fontSize: 14, fontWeight: 700, borderRadius: "var(--radius-pill)" }}>{pct(r.probability)}</div>
          <div>
            <strong>{r.name}</strong> <span className={`pill ${KIND_PILL[r.kind]}`}>{r.kind === "consultant" ? "Consultant" : "Opdrachtgever"}</span>
            <p>{r.rationale}</p>
            <p className="tiny">{new Date(r.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" })}</p>
          </div>
        </div>
      ))}
      {aiMean != null && (
        <div className="evidence-event">
          <div className="icon-circle num" style={{ width: 46, fontSize: 14, fontWeight: 700, borderRadius: "var(--radius-pill)" }}>{pct(aiMean)}</div>
          <div>
            <strong>AI{aiRows.length > 1 ? ` (gemiddelde van ${aiRows.length} modellen)` : ""}</strong> <span className={`pill ${KIND_PILL.ai}`}>AI-voorspelling · één stem · geen bewijs</span>
            {aiRows.length === 1 && <p>{aiRows[0].rationale}</p>}
            {aiRows.length > 1 && (
              <details className="mt-8">
                <summary className="text-link">Per model</summary>
                {aiRows.map((r) => (
                  <p key={r.id}>
                    <strong>{r.name.replace(/^AI · /, "")} {pct(r.probability)}</strong>: {r.rationale}
                  </p>
                ))}
              </details>
            )}
            <p className="tiny">{aiRows.map((r) => r.model).filter(Boolean).map((m) => `model ${m}`).join(" · ")}</p>
          </div>
        </div>
      )}
      {aiMean != null && (
        <p className="tiny">
          De AI telt als één stem: het gemiddelde van de modellen{all ? `; met de AI als één stem erbij is het gemiddelde ${pct(all.mean)}` : ""}. Modellen lezen hetzelfde dossier, dus
          hun overeenstemming is geen onafhankelijk oordeel en nooit bewijs. In de kalibratie telt de AI ook als één voorspeller.
        </p>
      )}
    </>
  );
}

// Blind forecasts at the open moment: you give your own probability first (starting at the base rate) and
// only then see the others, their mean and spread. Compact on the evidence page, with history on the
// outcome page.
export function ForecastPanel({ view, compact = false }: { view: ForecastView; compact?: boolean }) {
  const base = `/app/ideas/${view.ideaId}`;
  const m = view.openMoment;
  const given = m ? view.ownMoments.includes(m) : false;
  const rows = m ? view.forecasts.filter((f) => f.moment === m) : [];
  const hintId = `base-rate-${compact ? "c" : "f"}`;
  const history = FORECAST_MOMENTS.filter((x) => x !== m && view.forecasts.some((f) => f.moment === x));

  let body: React.ReactNode;
  if (view.resolved) {
    body = <p className="sub">De uitkomst is vastgelegd; voorspellen is gesloten. De scores staan bij de uitkomst.</p>;
  } else if (!view.outcome.statement) {
    body = (
      <p className="sub">
        Voorspellen kan zodra vastligt wanneer dit idee geslaagd is.{" "}
        {view.canWrite ? <Link className="text-link" href={`${base}/outcome#definitie`}>Leg de uitkomst vast →</Link> : "Het onderzoeksteam legt dat vast."}
      </p>
    );
  } else if (!view.baseRate) {
    body = (
      <p className="sub">
        Elke voorspelling start bij een basispercentage.{" "}
        {view.canWrite ? <Link className="text-link" href={`${base}/outcome#basispercentage`}>Kies het basispercentage →</Link> : "Het onderzoeksteam kiest dat eerst."}
      </p>
    );
  } else if (!m) {
    body = <p className="sub">Er is nu geen voorspelmoment open. Momenten: na de intake, na het marktonderzoek, na het eerste experiment en bij het besluit.</p>;
  } else if (!given) {
    body = (
      <>
        <p className="sub">
          <strong>{MOMENT_LABELS[m].label}.</strong> Hoe groot is de kans dat het doel wordt gehaald? Begin bij het basispercentage en pas het aan op wat dit
          dossier anders maakt.
        </p>
        <BaseRateSummary baseRate={view.baseRate} id={hintId} />
        <ActionForm action={submitForecast.bind(null, view.ideaId)} submitLabel="Leg mijn voorspelling vast" pendingLabel="Vastleggen…">
          <input type="hidden" name="moment" value={m} />
          <ProbabilityField initial={baseRateStart(view.baseRate)} describedBy={hintId} />
          <label className="field-label" htmlFor={`rationale-${compact ? "c" : "f"}`}>Waarom? (één zin)</label>
          <input className="field" id={`rationale-${compact ? "c" : "f"}`} name="rationale" maxLength={300} required minLength={10} placeholder="Bijv. Weinig gedragsbewijs, dus dicht bij het basispercentage." />
          <p className="field-hint" role="note">
            {view.canWrite
              ? "Je ziet de andere voorspellingen nadat je de jouwe hebt gegeven. Een gegeven voorspelling kun je niet meer wijzigen."
              : "U ziet de andere voorspellingen nadat u de uwe hebt gegeven, zodat niemand op een ander ankert. Een gegeven voorspelling kan niet meer worden gewijzigd."}
          </p>
        </ActionForm>
      </>
    );
  } else {
    body = (
      <>
        <p className="sub"><strong>{MOMENT_LABELS[m].label}.</strong> Alle zichtbare voorspellingen voor dit moment.</p>
        <ForecastList rows={rows} />
        {view.aiAvailable && view.aiPending.length > 0 && (
          <ActionForm
            action={requestAiForecast.bind(null, view.ideaId)}
            submitLabel={view.aiPending.length > 1 ? `${view.aiPending.length} AI-voorspellingen toevoegen` : "AI-voorspelling toevoegen"}
            submitClass="btn white"
            pendingLabel="AI denkt na…"
          >
            <p className="tiny mt-12">
              {view.aiPending.length > 1
                ? `${view.aiPending.map((p) => PROVIDER_LABELS[p].name).join(", ")} voorspellen elk los van elkaar, met de uitkomstdefinitie, het basispercentage en een samenvatting van het dossier. Je ziet daarna elk getal en het gemiddelde.`
                : `${PROVIDER_LABELS[view.aiPending[0]].name} krijgt de uitkomstdefinitie, het basispercentage en een samenvatting van het dossier.`}{" "}
              De AI telt als één stem (het gemiddelde van de modellen), nooit als bewijs.
            </p>
          </ActionForm>
        )}
      </>
    );
  }

  return (
    <div className="card" id="voorspelling" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>{compact ? "Jouw voorspelling" : "Voorspellingen"}</h3>
        <span className="pill blue">{m ? MOMENT_LABELS[m].label : "Geen moment open"}</span>
      </div>
      {body}
      {!compact && history.length > 0 && (
        <details className="mt-12">
          <summary className="text-link">Eerdere momenten ({history.length})</summary>
          {history.map((h: ForecastMoment) => (
            <div key={h} className="mt-12">
              <strong style={{ fontSize: 13 }}>{MOMENT_LABELS[h].label}</strong>
              <ForecastList rows={view.forecasts.filter((f) => f.moment === h)} />
            </div>
          ))}
          <p className="tiny mt-8">Je ziet de voorspellingen van anderen alleen voor momenten waarop je zelf hebt voorspeld, of nadat de uitkomst bekend is.</p>
        </details>
      )}
    </div>
  );
}
