import { ActionForm, Field } from "@/components/ui/ActionForm";
import { DirectionField } from "@/components/ui/DirectionField";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { Detail } from "@/components/shell/ViewMode";
import { Term } from "@/components/ui/Term";
import { CHANNELS } from "@/lib/domain/tracking";
import {
  channelLabel,
  FUNNEL_SOURCES,
  FUNNEL_STEPS,
  manualStepsFor,
  stepLabel,
  type ChannelFunnel,
  type StepCount,
} from "@/lib/domain/recruitment-funnel";
import { NOT_MIGRATED, type RecruitmentView } from "@/lib/recruitment-data";
import { todayInNL } from "@/lib/domain/sprint";
import {
  addRecruitmentEntry,
  linkRecruitmentCampaign,
  recordResponseFinding,
  reverseRecruitmentEntry,
  unlinkRecruitmentCampaign,
} from "@/app/app/ideas/[id]/experiments/[expId]/recruitment-actions";
import "./recruitment.css";

// Fase 2 · punt 5: de wervingstrechter op de testpagina (alleen het onderzoeksteam). Per kanaal benaderd → gereageerd →
// afspraak → gesprek gehouden, met de herkomst van elk getal, de respons met 95%-interval en "Leg vast als bevinding".
// Snel: de trechter, de respons als percentage en het registreren. Grondig: ook het interval en de registratie zelf.

const wholePct = (x: number) => `${Math.round(x * 100)}%`;

function Count({ s }: { s: StepCount }) {
  if (s.total === 0 && s.parts.length === 0) return <span className="recruit-empty">—</span>;
  return (
    <>
      <strong className="num">{s.total}</strong>
      <span className="recruit-origin">{s.parts.map((p) => (s.parts.length > 1 ? `${FUNNEL_SOURCES[p.source]} ${p.count}` : FUNNEL_SOURCES[p.source])).join(" · ")}</span>
    </>
  );
}

function Response({ c }: { c: ChannelFunnel }) {
  if (!c.response) return <span className="recruit-empty">—</span>;
  return (
    <>
      <strong className="num">{wholePct(c.response.rate)}</strong>
      <Detail hint={false}>
        <span className="recruit-origin num">
          {wholePct(c.response.interval.low)}–{wholePct(c.response.interval.high)}
        </span>
      </Detail>
    </>
  );
}

export function RecruitmentFunnel({
  ideaId,
  expId,
  testType,
  state,
  view,
  assumptions,
}: {
  ideaId: string;
  expId: string;
  testType: string;
  state: string;
  view: RecruitmentView;
  // Aannames om de bevinding aan te koppelen; kanaal-aannames eerst.
  assumptions: { id: string; statement: string; channel: boolean }[];
}) {
  const { funnel } = view;
  const open = !["draft", "ready_for_review"].includes(state);
  const steps = funnel.steps;
  const recordable = funnel.channels.filter((c) => c.response && c.period);
  const sortedAssumptions = [...assumptions].sort((a, b) => Number(b.channel) - Number(a.channel));
  const entryLabel = (e: RecruitmentView["entries"][number]) =>
    `${e.entry_date} · ${channelLabel(e.channel)} · ${FUNNEL_STEPS[e.step as keyof typeof FUNNEL_STEPS]?.label ?? e.step} · ${e.quantity > 0 ? "+" : ""}${e.quantity}`;
  const reversed = new Set(view.entries.map((e) => e.corrects_id).filter(Boolean));

  return (
    <div className="card mt-18" id="werving">
      <div className="section-title">
        <h2 className="as-h3">Werving</h2>
        <span className="pill gray">{funnel.held} {testType === "interview" ? "gehouden" : "deelgenomen"}{funnel.planned ? ` · ${funnel.planned} gepland` : ""}</span>
      </div>
      <p className="sub">
        Van benaderd tot {testType === "interview" ? "gesprek" : "deelname"}, per kanaal. Onder elk getal staat waar het vandaan komt.{" "}
        {stepLabel("held", testType)} telt ProofLab zelf uit de {testType === "interview" ? "echte gesprekken met toestemming" : "meting"} van deze test.
      </p>
      {!view.available && <div className="note" role="status">{NOT_MIGRATED} De trechter toont tot dan alleen wat de test zelf meet.</div>}

      {funnel.channels.length === 0 ? (
        <p className="tiny mt-12">Nog niets geregistreerd. Leg hieronder vast hoeveel mensen je per kanaal benaderde en hoeveel er reageerden.</p>
      ) : (
        <div className="recruit-scroll mt-12">
          <table className="table recruit-table">
            <thead>
              <tr>
                <th scope="col">Kanaal</th>
                {steps.map((s) => (
                  <th scope="col" key={s}>{stepLabel(s, testType)}</th>
                ))}
                <th scope="col">Respons<Detail hint={false}> (<Term k="interval-95">95%-interval</Term>)</Detail></th>
              </tr>
            </thead>
            <tbody>
              {funnel.channels.map((c) => (
                <tr key={c.channel}>
                  <th scope="row">{c.label}</th>
                  {steps.map((s) => (
                    <td key={s}><Count s={c.steps[s]} /></td>
                  ))}
                  <td><Response c={c} /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row">Totaal</th>
                {steps.map((s) => (
                  <td key={s}><Count s={funnel.totals[s]} /></td>
                ))}
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      {funnel.channels.flatMap((c) => c.warnings.map((w) => <div className="note" key={`${c.channel}-${w}`}>{c.label}: {w}</div>))}
      {funnel.planned > 0 && (
        <p className="tiny mt-8">
          Gepland: afspraken die nog niet als gesprek zijn ingevoerd (handmatige afspraken en agenda-afspraken min de gehouden gesprekken; toekomstige
          agenda-afspraken altijd).
        </p>
      )}

      {open && view.available && (
        <div className="recruit-actions mt-12">
          <details>
            <summary className="text-link">+ Werving registreren</summary>
            <ActionForm action={addRecruitmentEntry.bind(null, ideaId, expId)} submitLabel="Vastleggen" submitClass="btn primary sm" resetOnSuccess noValidate>
              <div className="double-field mt-8">
                <Field name="entry_date" id="rec-date" label="Datum" required>
                  <input className="field" type="date" defaultValue={todayInNL()} max={todayInNL()} />
                </Field>
                <Field name="channel" id="rec-channel" label="Kanaal" required>
                  <select className="field" defaultValue="linkedin">
                    {Object.entries(CHANNELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </Field>
              </div>
              <div className="double-field">
                <Field name="step" id="rec-step" label="Stap" required>
                  <select className="field" defaultValue="approached">
                    {manualStepsFor(testType).map((s) => <option key={s} value={s}>{FUNNEL_STEPS[s].label}</option>)}
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
            <p className="field-hint">Een regel wordt nooit gewijzigd of verwijderd. Een vergissing herstel je met een correctie; beide blijven zichtbaar in het auditspoor.</p>
          </details>

          <details>
            <summary className="text-link">Expandi-campagne koppelen</summary>
            <div className="mt-8">
              {view.campaigns.length > 0 && (
                <ul className="recruit-list">
                  {view.campaigns.map((c) => (
                    <li key={c.id}>
                      <span>{c.campaign}</span>
                      <form action={unlinkRecruitmentCampaign.bind(null, ideaId, expId, c.id)}>
                        <button className="text-link">Ontkoppelen</button>
                        <FormPendingOverlay />
                      </form>
                    </li>
                  ))}
                </ul>
              )}
              {view.campaignOptions.length > 0 ? (
                <ActionForm action={linkRecruitmentCampaign.bind(null, ideaId, expId)} submitLabel="Koppel campagne" submitClass="btn white sm">
                  <Field name="campaign" id="rec-campaign" label="Campagne uit de ontvangen Expandi-gebeurtenissen" required>
                    <select className="field">
                      {view.campaignOptions.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </Field>
                </ActionForm>
              ) : (
                <p className="tiny">
                  {view.campaigns.length ? "Geen andere campagnes beschikbaar." : "Nog geen Expandi-gebeurtenissen met een campagnenaam in dit dossier."} Koppel de webhook via{" "}
                  <a className="text-link" href={`/app/ideas/${ideaId}/integrations`}>Bronnen &amp; koppelingen</a>.
                </p>
              )}
              <p className="field-hint">Benaderd en gereageerd tellen dan automatisch mee als unieke contacten onder {channelLabel("outreach")}. Een campagne hoort bij één test.</p>
            </div>
          </details>
        </div>
      )}

      {view.available && recordable.length > 0 && (
        <div className="mt-12">
          <div className="eyebrow">Respons per kanaal vastleggen</div>
          {recordable.map((c) => (
            <details key={c.channel} className="mt-8">
              <summary className="text-link">Leg vast als bevinding: {c.label} ({wholePct(c.response!.rate)}, n = {c.response!.approached})</summary>
              <ActionForm action={recordResponseFinding.bind(null, ideaId, expId)} submitLabel="Leg vast als bevinding" submitClass="btn primary sm">
                <input type="hidden" name="channel" value={c.channel} />
                <p className="tiny">
                  Wordt een bevinding met als bron &ldquo;Eigen wervingsregistratie&rdquo; (een eigen meting, geen officiële of primaire bron). Het fragment is
                  de telling zelf, zodat de citaatcontrole exact is.
                </p>
                {sortedAssumptions.length > 0 && (
                  <>
                    <Field name="assumption_id" id={`rec-a-${c.channel}`} label="Koppel aan een aanname (optioneel)">
                      <select className="field" defaultValue="">
                        <option value="">Niet koppelen</option>
                        {sortedAssumptions.map((a) => <option key={a.id} value={a.id}>{a.channel ? "Kanaal · " : ""}{a.statement.slice(0, 110)}</option>)}
                      </select>
                    </Field>
                    <DirectionField kind="finding" id={`rec-rel-${c.channel}`} name="relation" />
                  </>
                )}
              </ActionForm>
            </details>
          ))}
        </div>
      )}

      {view.entries.length > 0 && (
        <Detail>
          <details className="mt-12">
            <summary className="text-link">Registratie ({view.entries.length} {view.entries.length === 1 ? "regel" : "regels"})</summary>
            <ul className="recruit-list mt-8">
              {[...view.entries].reverse().map((e) => (
                <li key={e.id}>
                  <span>
                    <span className="num">{entryLabel(e)}</span>
                    {e.corrects_id && <span className="pill gray">tegenboeking</span>}
                    {e.quantity < 0 && !e.corrects_id && <span className="pill gray">correctie</span>}
                    {e.note && <span className="recruit-origin">{e.note}</span>}
                  </span>
                  {e.quantity > 0 && !reversed.has(e.id) && view.available && (
                    <details>
                      <summary className="text-link">Tegenboeken</summary>
                      <ActionForm action={reverseRecruitmentEntry.bind(null, ideaId, expId, e.id)} submitLabel="Tegenboeken" submitClass="btn white sm">
                        <Field name="note" id={`rev-${e.id}`} label="Reden" required>
                          <input className="field" minLength={5} maxLength={500} />
                        </Field>
                      </ActionForm>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </details>
        </Detail>
      )}
    </div>
  );
}
