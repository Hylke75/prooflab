import { ActionForm } from "@/components/ui/ActionForm";
import { calendarDate } from "@/components/sprint/SprintCard";
import { excludeFromCalibration, includeInCalibration, resolveOutcome, resolveStopReview, saveCheckin } from "@/app/app/ideas/[id]/outcome/actions";
import { effortSummary, insufficientReason } from "@/lib/domain/effort";
import type { ForecastView } from "@/lib/forecast-data";
import { ACHIEVED_LABELS, aiAsOneVote, FORECAST_MOMENTS, JUSTIFIED_LABELS, ON_TRACK_LABELS, STOP_REVIEW_QUESTION, brier, explainBrier, MOMENT_LABELS, pct, type Achieved, type Justified, type OnTrack } from "@/lib/domain/forecast";

const long = (d: string) => calendarDate(d, { day: "numeric", month: "long", year: "numeric" });
const fmt = (n: number) => n.toLocaleString("nl-NL");

function Choice({ name, value, label, id }: { name: string; value: string; label: string; id: string }) {
  return (
    <label className="choice" htmlFor={id} style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, cursor: "pointer" }}>
      <input type="radio" id={id} name={name} value={value} required /> {label}
    </label>
  );
}

// Interim check-in from three months after the decision, the final outcome from the outcome date. Na een stop of
// pauze vervalt de uitkomstvraag en volgt na zes maanden "Was stoppen achteraf terecht?".
export function OutcomeFollowUp({ view }: { view: ForecastView }) {
  if (view.question === "stop_review") return <StopReviewFollowUp view={view} />;
  const fu = view.followUp;
  const o = view.outcome;
  const early = !!fu.outcomeDate && view.today < fu.outcomeDate;
  const checkinOpen = !!fu.checkinDate && view.today >= fu.checkinDate && !view.resolved;

  return (
    <>
      <div className="card" id="tussenstand" style={{ scrollMarginTop: 100 }}>
        <div className="section-title">
          <h3>Tussenstand na drie maanden</h3>
          {view.checkins.length > 0 ? (
            <span className="pill green">Gegeven</span>
          ) : fu.checkinDue ? (
            <span className="pill orange">Nu te geven</span>
          ) : (
            <span className="pill gray">{fu.checkinDate ? `Vanaf ${long(fu.checkinDate)}` : "Na het besluit"}</span>
          )}
        </div>
        {!fu.outcomeDate && <p className="sub">De klok start bij het besluit: na drie maanden een tussenstand, na zes maanden de uitkomst.</p>}
        {view.checkins.map((c) => (
          <div className="evidence-event" key={c.id}>
            <div className="icon-circle">{c.onTrack === "yes" ? "✓" : c.onTrack === "no" ? "!" : "?"}</div>
            <div>
              <strong>{ON_TRACK_LABELS[c.onTrack as OnTrack]}{c.currentValue != null ? ` · nu ${fmt(c.currentValue)}${o.metric ? ` ${o.metric}` : ""}` : ""}</strong>
              <p>{c.note}</p>
              <p className="tiny">{new Date(c.createdAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</p>
            </div>
          </div>
        ))}
        {view.canWrite && checkinOpen && (
          <ActionForm action={saveCheckin.bind(null, view.ideaId)} submitLabel="Tussenstand vastleggen" resetOnSuccess>
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">Ligt het doel op koers?</legend>
              <div className="choice-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                {(Object.keys(ON_TRACK_LABELS) as OnTrack[]).map((k) => (
                  <Choice key={k} name="on_track" value={k} label={ON_TRACK_LABELS[k]} id={`ci-${k}`} />
                ))}
              </div>
            </fieldset>
            <label className="field-label" htmlFor="ci-value">Huidige waarde{o.metric ? ` (${o.metric})` : ""} (optioneel)</label>
            <input className="field" id="ci-value" name="current_value" inputMode="decimal" placeholder={o.target != null ? `Doel: ${fmt(o.target)}` : undefined} />
            <label className="field-label" htmlFor="ci-note">Toelichting</label>
            <textarea className="field" id="ci-note" name="note" rows={2} style={{ minHeight: 70 }} maxLength={1000} required minLength={10} placeholder="Wat is er sinds het besluit gebeurd?" />
          </ActionForm>
        )}
      </div>

      <div className="card" id="uitkomst" style={{ scrollMarginTop: 100 }}>
        <div className="section-title">
          <h3>Uitkomst na zes maanden</h3>
          {view.resolved ? (
            <span className={`pill ${view.resolved.achieved === "yes" ? "green" : view.resolved.achieved === "partial" ? "orange" : "coral"}`}>{ACHIEVED_LABELS[view.resolved.achieved]}</span>
          ) : fu.outcomeDue ? (
            <span className="pill orange">Nu vast te leggen</span>
          ) : (
            <span className="pill gray">{fu.outcomeDate ? `Op ${long(fu.outcomeDate)}` : "Zes maanden na het besluit"}</span>
          )}
        </div>
        {view.resolved ? (
          <>
            {view.resolved.actualValue != null && (
              <div className="data-row">
                <span>Werkelijke waarde</span>
                <strong className="num">{fmt(view.resolved.actualValue)}{o.target != null ? ` (doel ${fmt(o.target)})` : ""}</strong>
              </div>
            )}
            <div className="data-row"><span>Vastgelegd op</span><strong>{new Date(view.resolved.resolvedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</strong></div>
            <div className="data-row"><span>Inzet</span><strong>{effortSummary(view.resolved.effort)}</strong></div>
            <p className="sub">Bewijs: {view.resolved.evidence}</p>
          </>
        ) : !fu.outcomeDate ? (
          <p className="sub">De uitkomstdatum wordt bij het besluit vastgezet op zes maanden later.</p>
        ) : view.canWrite ? (
          <ActionForm action={resolveOutcome.bind(null, view.ideaId)} submitLabel="Uitkomst vastleggen">
            {early && (
              <p className="sub">
                De uitkomstdatum is {long(fu.outcomeDate)}. Leg de uitkomst alleen eerder vast als die al zeker is, bijvoorbeeld omdat het idee is gestopt of het
                doel al ruim is gehaald.
              </p>
            )}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">Is het doel gehaald?</legend>
              <div className="choice-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                {(Object.keys(ACHIEVED_LABELS) as Achieved[]).map((k) => (
                  <Choice key={k} name="achieved" value={k} label={ACHIEVED_LABELS[k]} id={`oc-${k}`} />
                ))}
              </div>
            </fieldset>
            <label className="field-label" htmlFor="oc-value">Werkelijke waarde{o.metric ? ` (${o.metric})` : ""} (optioneel)</label>
            <input className="field" id="oc-value" name="actual_value" inputMode="decimal" placeholder={o.target != null ? `Doel: ${fmt(o.target)}` : undefined} />
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">Is het besluit uitgevoerd?</legend>
              <div className="choice-grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }}>
                <Choice name="started" value="yes" label="Ja, er is gestart" id="oc-started-yes" />
                <Choice name="started" value="no" label="Nee, niet gestart" id="oc-started-no" />
              </div>
            </fieldset>
            <div className="double-field">
              <div>
                <label className="field-label" htmlFor="oc-hours">Bestede uren (optioneel)</label>
                <input
                  className="field"
                  id="oc-hours"
                  name="effort_hours"
                  inputMode="decimal"
                  placeholder={view.plannedStake.kind === "time" && view.plannedStake.value != null ? `Gepland: ${fmt(view.plannedStake.value)} uur` : "Bijv. 120"}
                />
              </div>
              <div>
                <label className="field-label" htmlFor="oc-budget">Budget t.o.v. plan in % (optioneel)</label>
                <input className="field" id="oc-budget" name="budget_pct_of_plan" inputMode="decimal" placeholder="100 = volgens plan" />
              </div>
            </div>
            <p className="field-hint">
              De uitkomst meet ook uitvoering. Is er niet gestart, of minder dan de helft van het plan uitgevoerd, dan markeert ProofLab het dossier en kan een
              consultant het met reden uit de kalibratie halen.
            </p>
            <label className="field-label" htmlFor="oc-evidence">Bewijs</label>
            <textarea className="field" id="oc-evidence" name="evidence" rows={3} style={{ minHeight: 90 }} maxLength={2000} required minLength={10} placeholder="Waar blijkt de uitkomst uit? Bijv. export uit het boekhoudsysteem met 12 betalende klanten op 3 mei." />
            {early && (
              <label className="check-row mt-12">
                <input type="checkbox" name="confirm_early" required /> De uitkomst staat nu al vast; ik leg haar vóór de uitkomstdatum vast.
              </label>
            )}
            <p className="field-hint">Een uitkomst is een vast feit: na opslaan kan ze niet meer worden gewijzigd, en voorspellen sluit.</p>
          </ActionForm>
        ) : (
          <p className="sub">Het onderzoeksteam legt de uitkomst vast op {long(fu.outcomeDate)}.</p>
        )}
      </div>

      {view.resolved && view.resolved.insufficient && <ExecutionCard view={view} />}
      {view.resolved && <ForecastScores view={view} achieved={view.resolved.achieved} />}
    </>
  );
}

// Golf B, punt 2: onvoldoende uitvoering. Een consultant beslist of het dossier uit de kalibratie gaat (met reden, geaudit).
function ExecutionCard({ view }: { view: ForecastView }) {
  const r = view.resolved!;
  const reason = insufficientReason(r.effort, view.plannedStake);
  return (
    <div className="card" id="uitvoering" style={{ scrollMarginTop: 100 }}>
      <div className="section-title">
        <h3>Onvoldoende uitgevoerd</h3>
        <span className={`pill ${r.exclusion ? "gray" : "orange"}`}>{r.exclusion ? "Telt niet mee in de kalibratie" : "Telt mee in de kalibratie"}</span>
      </div>
      <p className="sub">
        {reason} Dan zegt de uitkomst vooral iets over de uitvoering, niet over de voorspelling. Een consultant kan het dossier daarom met een reden uit de kalibratie
        halen; dat staat in het auditspoor.
      </p>
      {r.exclusion ? (
        <>
          <p className="sub mt-8">
            Uitgesloten op {new Date(r.exclusion.excludedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}. Reden: {r.exclusion.reason}
          </p>
          {view.canWrite && (
            <ActionForm action={includeInCalibration.bind(null, view.ideaId)} submitLabel="Laat weer meetellen" submitClass="btn white sm">
              <span />
            </ActionForm>
          )}
        </>
      ) : view.canWrite ? (
        <ActionForm action={excludeFromCalibration.bind(null, view.ideaId)} submitLabel="Haal uit de kalibratie" submitClass="btn white sm">
          <label className="field-label" htmlFor="ex-reason">Reden</label>
          <textarea className="field" id="ex-reason" name="reason" rows={2} style={{ minHeight: 70 }} maxLength={600} required minLength={10} placeholder="Bijv. de opdrachtgever heeft het budget na twee maanden naar een ander project verschoven." />
        </ActionForm>
      ) : (
        <p className="tiny mt-8">Het onderzoeksteam beslist of dit dossier meetelt in de kalibratie.</p>
      )}
    </div>
  );
}

// After resolution: every forecast with its Brier contribution and a short, honest explanation.
function ForecastScores({ view, achieved }: { view: ForecastView; achieved: Achieved }) {
  // Golf B, punt 15: per moment telt de AI als één stem (het gemiddelde van de modellen), net als in de kalibratie.
  const rows = FORECAST_MOMENTS.flatMap((m) =>
    aiAsOneVote(view.forecasts.filter((f) => f.moment === m)).map((v) => ({
      id: v.kind === "ai" ? `ai-${m}` : v.rows[0].id,
      moment: m,
      kind: v.kind,
      name: v.kind === "ai" ? (v.models > 1 ? `AI (gemiddelde van ${v.models} modellen)` : "AI") : v.rows[0].name,
      probability: v.probability,
    })),
  );
  return (
    <div className="card" style={{ gridColumn: "1 / -1" }}>
      <div className="section-title">
        <h3>Hoe goed waren de voorspellingen?</h3>
        <span className="pill gray">Brier-score: 0 is perfect, 0,25 is gokken</span>
      </div>
      {rows.length === 0 ? (
        <p className="sub">Voor dit dossier zijn geen voorspellingen gegeven.</p>
      ) : (
        <table className="table">
          <caption className="sr-only">Voorspellingen met hun Brier-score</caption>
          <thead>
            <tr>
              <th scope="col">Moment</th>
              <th scope="col">Voorspeller</th>
              <th scope="col">Kans</th>
              <th scope="col">Brier</th>
              <th scope="col">Uitleg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{MOMENT_LABELS[r.moment].label}</td>
                <td>{r.name}</td>
                <td className="num">{pct(r.probability)}</td>
                <td className="num">{brier(r.probability, achieved).toFixed(2).replace(".", ",")}</td>
                <td>{explainBrier(r.probability, achieved)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div className="note">De uitkomst telt als 1 (gehaald), 0,5 (deels) of 0 (niet gehaald). De score is het kwadraat van het verschil met de gegeven kans. Eén dossier zegt weinig: of iemand goed gekalibreerd is, blijkt pas over veel afgeronde dossiers.</div>
    </div>
  );
}

// Golf B, punt 1: de stopvraag. Voorspellingen bij dit dossier worden niet gescoord als slagingskans.
function StopReviewFollowUp({ view }: { view: ForecastView }) {
  const fu = view.followUp;
  const r = view.stopReview;
  const early = !!fu.outcomeDate && view.today < fu.outcomeDate;
  return (
    <>
      <div className="card" id="uitkomst" style={{ scrollMarginTop: 100 }}>
        <div className="section-title">
          <h3>{STOP_REVIEW_QUESTION}</h3>
          {r ? (
            <span className={`pill ${r.justified === "yes" ? "green" : r.justified === "no" ? "coral" : "gray"}`}>{JUSTIFIED_LABELS[r.justified]}</span>
          ) : fu.outcomeDue ? (
            <span className="pill orange">Nu vast te leggen</span>
          ) : (
            <span className="pill gray">{fu.outcomeDate ? `Op ${long(fu.outcomeDate)}` : "Zes maanden na het besluit"}</span>
          )}
        </div>
        <p className="sub">
          Dit dossier is gestopt of gepauzeerd. De oorspronkelijke uitkomstvraag is daarmee vervallen: of het doel gehaald wordt, valt niet meer te meten.
          Zes maanden na het besluit kijken we terug: was stoppen achteraf terecht?
        </p>
        {r ? (
          <>
            <div className="data-row"><span>Vastgelegd op</span><strong>{new Date(r.reviewedAt).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}</strong></div>
            <p className="sub">Bewijs: {r.evidence}</p>
          </>
        ) : !fu.outcomeDate ? null : view.canWrite ? (
          <ActionForm action={resolveStopReview.bind(null, view.ideaId)} submitLabel="Antwoord vastleggen">
            {early && <p className="sub">De vraag staat open vanaf {long(fu.outcomeDate)}. Leg het antwoord alleen eerder vast als het al zeker is.</p>}
            <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="field-label">{STOP_REVIEW_QUESTION}</legend>
              <div className="choice-grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
                {(Object.keys(JUSTIFIED_LABELS) as Justified[]).map((k) => (
                  <Choice key={k} name="justified" value={k} label={JUSTIFIED_LABELS[k]} id={`sr-${k}`} />
                ))}
              </div>
            </fieldset>
            <label className="field-label" htmlFor="sr-evidence">Bewijs</label>
            <textarea className="field" id="sr-evidence" name="evidence" rows={3} style={{ minHeight: 90 }} maxLength={2000} required minLength={10} placeholder="Bijv. een concurrent lanceerde hetzelfde aanbod en haalde in zes maanden twee klanten; het budget ging naar een idee dat wel liep." />
            {early && (
              <label className="check-row mt-12">
                <input type="checkbox" name="confirm_early" required /> Het antwoord staat nu al vast; ik leg het vóór de datum vast.
              </label>
            )}
            <p className="field-hint">Een vastgelegd antwoord is een vast feit. Het telt mee bij de terechte stops op de pagina Voorspelkwaliteit.</p>
          </ActionForm>
        ) : (
          <p className="sub">Het onderzoeksteam legt het antwoord vast op {long(fu.outcomeDate)}.</p>
        )}
      </div>
      <div className="card">
        <div className="section-title">
          <h3>Voorspellingen</h3>
          <span className="pill gray">Niet gescoord</span>
        </div>
        <p className="sub">
          De voorspellingen bij dit dossier gingen over de kans dat het doel gehaald zou worden. Na de stop is die uitkomst niet meer te meten, dus ze worden
          niet gescoord als slagingskans en tellen niet mee in de kalibratie of de eigen basisrate.
        </p>
      </div>
    </>
  );
}
