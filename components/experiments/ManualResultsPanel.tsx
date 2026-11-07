import Link from "next/link";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { ManualPlaybook } from "@/components/experiments/ManualPlaybook";
import { addManualResult, withdrawManualResult } from "@/app/app/ideas/[id]/experiments/[expId]/manual-actions";
import { MANUAL_SCHEMA_MISSING, tallyManual, WITHDRAW_REASON_MIN, type ManualResultRow } from "@/lib/domain/manual-results";
import { catalogMethod, type ManualConfig } from "@/lib/domain/experiment-catalog";
import { OBSERVATION_KINDS } from "@/lib/domain/labels";
import { KIND_LEVEL, LEVEL_SHORT } from "@/lib/domain/evidence";

const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString("nl-NL", { day: "numeric", month: "short", year: "numeric" });

// Experimentencatalogus: draaiboek, invoer en ruwe resultaten van een handmatig sjabloon op de testpagina. Invoeren
// en intrekken alleen terwijl de test loopt (en alleen voor het onderzoeksteam); daarna ligt alles vast.
export function ManualResultsPanel({
  ideaId,
  expId,
  config,
  rows,
  available,
  loadError,
  running,
  canWrite,
  state,
  today,
  startedOn,
  numerator,
  denominator,
}: {
  ideaId: string;
  expId: string;
  config: ManualConfig | null;
  rows: ManualResultRow[];
  available: boolean;
  loadError: boolean;
  running: boolean;
  canWrite: boolean;
  state: string;
  today: string;
  startedOn: string | null;
  numerator: string;
  denominator: string;
}) {
  const t = tallyManual(rows);
  const unit = config?.unit ?? { one: "waarneming", many: "waarnemingen" };
  const method = catalogMethod(config?.catalog_method_id);
  return (
    <section className="mt-24" aria-labelledby="handmatig-titel" id="handmatig">
      <div className="section-title">
        <h2 id="handmatig-titel">Resultaten (handmatig ingevoerd)</h2>
        <span className="pill orange">Handmatig ingevoerd</span>
      </div>
      {!available && <div className="form-error" role="status">{MANUAL_SCHEMA_MISSING}</div>}
      {loadError && <div className="form-error" role="alert">De ingevoerde resultaten konden niet worden opgehaald. Vernieuw de pagina om het opnieuw te proberen.</div>}
      <div className="grid-2">
        <div className="card">
          <div className="section-title" style={{ marginBottom: 8 }}>
            <h3>Draaiboek</h3>
            {method && (
              <Link className="text-link" href={`/app/ideas/${ideaId}/experiments/catalogus?open=${method.id}`}>
                {config?.method_name ?? method.name} in de catalogus
              </Link>
            )}
          </div>
          {config ? (
            <>
              <ManualPlaybook steps={config.checklist} extra={config.extra_steps} compact />
              <p className="tiny mt-8">
                Bewijssoort: {OBSERVATION_KINDS[config.observation_kind].toLowerCase()} (niveau {LEVEL_SHORT[KIND_LEVEL[config.observation_kind]]}). ProofLab heeft deze
                resultaten niet zelf waargenomen; ze staan overal als &ldquo;handmatig ingevoerd&rdquo;.
              </p>
            </>
          ) : (
            <p className="sub">De catalogusmethode van deze test is onbekend. De resultaten tellen als mening.</p>
          )}
        </div>
        <div className="card">
          <h3>Nieuwe waarneming of telling</h3>
          {!canWrite ? (
            <p className="sub">Je kijkt mee. Het onderzoeksteam voert de resultaten in.</p>
          ) : !running ? (
            <p className="sub" id="handmatig-dicht">
              {["draft", "ready_for_review", "approved"].includes(state)
                ? "Invoeren kan zodra de test loopt. Wat vóór de start gebeurde, was niet vooraf vastgelegd en telt niet."
                : "De test is afgerond: alle ingevoerde resultaten liggen vast. Toevoegen of intrekken kan niet meer, zodat niemand na het zien van de uitkomst resultaten bijschuift."}
            </p>
          ) : !available ? (
            <p className="sub">Invoeren kan na de database-update.</p>
          ) : (
            <ActionForm action={addManualResult.bind(null, ideaId, expId)} submitLabel="Vastleggen" submitClass="btn primary sm" pendingLabel="Vastleggen…" resetOnSuccess noValidate>
              <Field name="observed_on" id="mr-date" label="Datum van de waarneming" required hint={startedOn ? `Tussen ${day(startedOn)} (start) en vandaag.` : undefined}>
                <input className="field" type="date" defaultValue={today} min={startedOn ?? undefined} max={today} />
              </Field>
              <div className="double-field">
                <Field name="units" id="mr-units" label={`Aantal ${unit.many}`} required hint={`Noemer: ${denominator}`}>
                  <input className="field num" type="number" inputMode="numeric" min={1} step={1} defaultValue={1} />
                </Field>
                <Field name="successes" id="mr-succ" label="Waarvan meetellend" required hint={`Teller: ${numerator}`}>
                  <input className="field num" type="number" inputMode="numeric" min={0} step={1} defaultValue={0} />
                </Field>
              </div>
              <Field name="note" id="mr-note" label="Notitie" required hint="Wat zag of telde je, en waar? Geen namen, e-mailadressen of telefoonnummers: gebruik een code per persoon.">
                <textarea className="field" rows={3} maxLength={1000} />
              </Field>
              <Field name="evidence" id="mr-file" label="Bewijsbestand (optioneel)" hint="Pdf, png, jpg, webp of csv, tot 4 MB. Alleen het onderzoeksteam kan het openen.">
                <input className="field" type="file" accept="application/pdf,image/png,image/jpeg,image/webp,text/csv,.csv" />
              </Field>
            </ActionForm>
          )}
        </div>
      </div>

      <div className="card mt-18">
        <div className="section-title" style={{ marginBottom: 8 }}>
          <h3>Ingevoerde resultaten</h3>
          <span className="pill gray">
            {t.successes} van {t.n} {unit.many} · {t.entries} {t.entries === 1 ? "regel" : "regels"}
            {t.withdrawn ? ` · ${t.withdrawn} ingetrokken` : ""}
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="sub">Nog niets ingevoerd. Elke waarneming of telling komt hier met datum, aantallen en notitie.</p>
        ) : (
          <ul className="manual-results" aria-label="Ingevoerde resultaten">
            {rows.map((r) => (
              <li key={r.id} className={r.withdrawn_at ? "withdrawn" : undefined}>
                <div className="manual-results-head">
                  <strong className="num">{r.successes} van {r.units}</strong>
                  <span className="tiny">{day(r.observed_on)} · ingevoerd {new Date(r.created_at).toLocaleDateString("nl-NL")}</span>
                  {r.withdrawn_at ? <span className="pill gray">Ingetrokken</span> : <span className="pill orange">Handmatig ingevoerd</span>}
                </div>
                <p>{r.note}</p>
                {r.withdrawn_at && r.withdraw_reason && <p className="tiny">Ingetrokken op {new Date(r.withdrawn_at).toLocaleDateString("nl-NL")}: {r.withdraw_reason}</p>}
                {r.evidence_path && canWrite && (
                  <a className="text-link" href={`/app/ideas/${ideaId}/experiments/${expId}/bewijs/${r.id}`}>Bewijsbestand openen</a>
                )}
                {r.evidence_path && !canWrite && <p className="tiny">Met bewijsbestand (alleen zichtbaar voor het onderzoeksteam).</p>}
                {canWrite && running && !r.withdrawn_at && (
                  <details className="mt-8">
                    <summary className="text-link">Intrekken</summary>
                    <ActionForm action={withdrawManualResult.bind(null, ideaId, expId, r.id)} submitLabel="Trek deze regel in" submitClass="btn white sm" pendingLabel="Bezig…" noValidate>
                      <Field name="withdraw_reason" id={`mr-w-${r.id}`} label="Waarom trek je deze regel in?" required hint={`Minstens ${WITHDRAW_REASON_MIN} tekens. De regel blijft zichtbaar met de reden.`}>
                        <textarea className="field" rows={2} maxLength={600} />
                      </Field>
                    </ActionForm>
                  </details>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
