import Link from "next/link";
import { ActionForm, Field } from "@/components/ui/ActionForm";
import { CopyButton } from "@/components/survey/CopyButton";
import { ChannelLinkBuilder } from "@/components/experiments/ChannelLinkBuilder";
import { CHANNELS } from "@/lib/domain/tracking";
import {
  AI_EVIDENCE_NOTE,
  AI_INTERVIEW_SCHEMA_MISSING,
  AI_NOT_CONNECTED,
  checkGuide,
  conversationCode,
  END_REASONS,
  LIMITS,
  roleLabel,
  SCREENER_KINDS,
  screenerOptionsText,
  sessionDisplay,
  sponsorLabel,
  type EndReason,
  type ScreenerQuestion,
} from "@/lib/domain/ai-interview";
import type { AiInterviewSetup } from "@/lib/ai-interview-data";
import { screenerOf, settingsOf } from "@/lib/domain/ai-interview";
import { approveAiInterview, deleteAiInterview, excludeAiInterview, includeAiInterview, revokeAiInterview, saveAiInterviewConfig, setAiInterviewPaused } from "@/app/app/ideas/[id]/experiments/ai-interview-actions";

const DEFAULT_INTRO =
  "Bedankt dat je mee wilt doen aan dit korte onderzoek. We willen graag begrijpen hoe het nu bij jou gaat, in je eigen woorden. Er zijn geen goede of foute antwoorden.";

type Props = {
  ideaId: string;
  expId: string;
  expState: string;
  guide: string[];
  productNames: string[];
  setup: AiInterviewSetup;
  aiConnected: boolean;
  publicBase: string;
  channels: { key: string; label: string }[];
};

// De AI-interviewer bij een interviewtest: opzet, expliciete goedkeuring van de leidraad (daarna vergrendeld), de link,
// en de gesprekken met status. Zonder AI-sleutel of met een bereikt budget: "AI niet verbonden" met het handmatige
// alternatief (zelf interviewen en het transcript importeren).
export function AiInterviewPanel(p: Props) {
  const { config, sessions, schemaMissing, budget } = p.setup;
  const check = checkGuide(p.guide, p.productNames);
  const budgetReached = !!budget && budget.spent >= budget.cap;
  const approved = config?.status === "approved";
  const settings = config ? settingsOf(config as unknown as Record<string, unknown>) : null;
  const guideChanged = !!config && JSON.stringify(settings?.guide ?? []) !== JSON.stringify(p.guide);
  const testReady = ["approved", "live", "paused"].includes(p.expState);
  const running = p.expState === "live";
  const url = config ? `${p.publicBase}/i/${config.slug}` : null;
  const counts = {
    total: sessions.length,
    counted: sessions.filter((s) => sessionDisplay(s, p.setup.now).key === "completed").length,
    screened: sessions.filter((s) => s.status === "screened_out").length,
    abandoned: sessions.filter((s) => sessionDisplay(s, p.setup.now).key === "abandoned").length,
    excluded: sessions.filter((s) => s.excluded_at).length,
    active: sessions.filter((s) => sessionDisplay(s, p.setup.now).key === "active").length,
    cost: sessions.reduce((n, s) => n + Number(s.cost_usd ?? 0), 0),
  };
  const statusPill = !config
    ? { label: "Niet ingesteld", pill: "gray" }
    : !approved
      ? { label: "Concept", pill: "orange" }
      : config.paused
        ? { label: "Gepauzeerd", pill: "orange" }
        : running
          ? { label: "Neemt gesprekken af", pill: "green" }
          : { label: "Goedgekeurd", pill: "blue" };

  return (
    <section className="card mt-18" id="ai-interviewer" aria-labelledby="ai-iv-title">
      <div className="section-title">
        <h2 className="as-h3" id="ai-iv-title">AI-interviewer (tekstchat)</h2>
        <span className={`pill ${statusPill.pill}`}>{statusPill.label}</span>
      </div>
      <p className="sub">
        Respondenten voeren via een publieke link een chatgesprek met een AI-interviewer. De AI stelt de goedgekeurde vragen van deze Test Card en vraagt
        hooguit twee keer door per onderwerp; elke doorvraag wordt vóór verzenden gecontroleerd op sturing. {AI_EVIDENCE_NOTE}
      </p>

      {schemaMissing ? (
        <div className="note" role="status">{AI_INTERVIEW_SCHEMA_MISSING}</div>
      ) : (
        <>
          {!p.aiConnected && (
            <div className="form-error" role="status" id="ai-not-connected">
              <p style={{ margin: 0 }}>{AI_NOT_CONNECTED}</p>
              <p style={{ margin: "6px 0 0", fontWeight: 400 }}>
                {running ? <a className="text-link" href="#importeren">Naar Transcript importeren →</a> : "Zodra de interviewronde loopt, staat het importeren hieronder."} De publieke link toont respondenten intussen netjes &ldquo;nu niet beschikbaar&rdquo;.
              </p>
            </div>
          )}
          {p.aiConnected && budgetReached && (
            <div className="form-error" role="status">
              <p style={{ margin: 0 }}>Het AI-maandbudget van deze werkruimte (${budget?.cap.toFixed(0)}) is bereikt. Nieuwe gesprekken starten pas weer als er budget is; de publieke link meldt &ldquo;nu niet beschikbaar&rdquo;.</p>
              <p style={{ margin: "6px 0 0", fontWeight: 400 }}>Alternatief: interview zelf en importeer het transcript.</p>
            </div>
          )}

          <div className="mt-18">
            <div className="eyebrow">Leidraad (de interviewvragen van de Test Card)</div>
            <ol style={{ margin: "6px 0 0 18px", fontSize: 14, lineHeight: 1.8 }}>
              {(settings?.guide.length ? settings.guide : p.guide).map((q, i) => <li key={`${i}-${q}`}>{q}</li>)}
            </ol>
            {check.ok ? (
              <p className="tiny mt-8">Leidraadcontrole voor de AI-interviewer: geslaagd (geen hypothetische, sturende of verkopende vragen, geen bijzondere persoonsgegevens).</p>
            ) : (
              <div className="form-error mt-8" role="status" id="ai-guide-block">
                <p style={{ margin: 0 }}>Leidraadcontrole niet geslaagd: de AI-interviewer kan zo niet worden goedgekeurd. Maak een nieuwe Test Card met aangepaste vragen.</p>
                <ul style={{ margin: "6px 0 0 18px", padding: 0, fontWeight: 400 }}>{check.problems.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            {guideChanged && <div className="note">De interviewvragen van de Test Card zijn veranderd sinds de opzet werd opgeslagen. {approved ? "Het gesprek is daarom niet beschikbaar; trek de goedkeuring in en keur opnieuw goed." : "Sla de opzet opnieuw op."}</div>}
          </div>

          {!approved && <ConfigForm {...p} />}

          {config && !approved && (
            <div className="mt-18" id="ai-goedkeuren">
              <h3>Leidraad goedkeuren</h3>
              {!testReady && <p className="sub" id="ai-test-first">Keur eerst de Test Card goed. Daarna keur je hier de leidraad voor de AI-interviewer goed.</p>}
              <ActionForm
                action={approveAiInterview.bind(null, p.ideaId, p.expId)}
                submitLabel="Keur goed en vergrendel"
                disabled={!check.ok || !testReady}
                describedBy={!check.ok ? "ai-guide-block" : !testReady ? "ai-test-first" : undefined}
              >
                <label className="check-row"><input type="checkbox" name="check_guide" /> Ik heb de leidraad gelezen: de AI mag deze vragen letterlijk stellen en er neutraal op doorvragen.</label>
                <label className="check-row"><input type="checkbox" name="check_disclosure" /> De melding vooraf klopt: een AI voert het gesprek, opdrachtgever ({sponsorLabel(settings!)}), doel, bewaartermijn ({settings!.retentionMonths} mnd) en dat stoppen altijd mag.</label>
              </ActionForm>
            </div>
          )}

          {config && approved && settings && (
            <div className="mt-18">
              <dl className="tiny" style={{ display: "grid", gap: 4, margin: 0 }}>
                <div>Goedgekeurd op {config.approved_at ? new Date(config.approved_at).toLocaleDateString("nl-NL") : "—"}; de opzet ligt vast.</div>
                <div>Grenzen: hooguit {settings.maxTurns} antwoorden, {settings.maxMinutes} minuten, {settings.maxProbes} {settings.maxProbes === 1 ? "doorvraag" : "doorvragen"} per onderwerp. Bewaartermijn {settings.retentionMonths} {settings.retentionMonths === 1 ? "maand" : "maanden"}.</div>
                <div>Opdrachtgever voor de respondent: {sponsorLabel(settings)} · privacycontact: {settings.privacyContact}</div>
                {settings.screener.length > 0 && <div>Screener: {settings.screener.map((q) => `${q.text} (${q.options.filter((o) => o.qualifies).map((o) => o.label).join(", ")})`).join(" · ")}</div>}
              </dl>
              {url && (
                <div className="mt-12">
                  <div className="eyebrow">Publieke link</div>
                  <div className="row" style={{ gap: 8 }}>
                    <input className="field mono" readOnly value={url} aria-label="Publieke link naar het AI-interview" style={{ flex: "1 1 260px" }} />
                    <CopyButton text={url} label="Kopieer link" />
                    <a className="btn white sm" href={`/i/${config.slug}`} target="_blank" rel="noreferrer">{running ? "Open" : "Voorbeeld"}</a>
                  </div>
                  {!running && <p className="tiny mt-8">De link werkt zodra de interviewronde loopt; tot dan toont hij een voorbeeld zonder gesprek.</p>}
                  {(running || p.expState === "paused") && p.channels.length > 0 && <ChannelLinkBuilder publicUrl={url} live={running} channels={p.channels} />}
                </div>
              )}
              <div className="row mt-12" style={{ gap: 8 }}>
                <ActionForm action={setAiInterviewPaused.bind(null, p.ideaId, p.expId, !config.paused)} submitLabel={config.paused ? "Hervat de AI-interviewer" : "Pauzeer de AI-interviewer"} submitClass="btn white sm"><span /></ActionForm>
                {sessions.length === 0 && <ActionForm action={revokeAiInterview.bind(null, p.ideaId, p.expId)} submitLabel="Goedkeuring intrekken" submitClass="btn clear sm"><span /></ActionForm>}
              </div>
            </div>
          )}

          {config && <SessionList {...p} counts={counts} />}
        </>
      )}
    </section>
  );
}

function ConfigForm(p: Props) {
  const c = p.setup.config;
  const s = c ? settingsOf(c as unknown as Record<string, unknown>) : null;
  const screener: (ScreenerQuestion | null)[] = Array.from({ length: LIMITS.screenerQuestions }, (_, i) => (s ? screenerOf(c!.screener)[i] ?? null : null));
  return (
    <details className="mt-18" open={!c}>
      <summary className="text-link">{c ? "Opzet aanpassen" : "AI-interviewer instellen"}</summary>
      <ActionForm action={saveAiInterviewConfig.bind(null, p.ideaId, p.expId)} submitLabel={c ? "Opzet opslaan" : "Opzet opslaan"} pendingLabel="Opslaan…" noValidate className="mt-12">
        <Field name="intro" id="ai-intro" label="Introductie voor de respondent" required hint="Wat het onderzoek is en waarom je hun ervaring wilt horen. Noem het idee of product niet: dat kleurt de antwoorden. De melding dat een AI het gesprek voert, staat er automatisch bij.">
          <textarea className="field" rows={4} maxLength={LIMITS.intro.max} defaultValue={s?.intro ?? DEFAULT_INTRO} />
        </Field>
        <fieldset className="form-line" style={{ border: 0, padding: 0 }}>
          <legend className="field-label" style={{ marginTop: 0 }}>Wie ziet de respondent als opdrachtgever?</legend>
          <label className="check-row"><input type="radio" name="sponsor_mode" value="agency" defaultChecked={(s?.sponsorMode ?? "agency") === "agency"} /> &ldquo;Een onderzoeksbureau&rdquo; (aan te raden als de naam van de opdrachtgever de antwoorden zou kleuren)</label>
          <label className="check-row"><input type="radio" name="sponsor_mode" value="client" defaultChecked={s?.sponsorMode === "client"} /> De opdrachtgever bij naam</label>
        </fieldset>
        <div className="double-field">
          <Field name="sponsor_name" id="ai-sponsor" label="Naam opdrachtgever (alleen bij 'bij naam')"><input className="field" maxLength={LIMITS.sponsor.max} defaultValue={s?.sponsorName ?? ""} /></Field>
          <Field name="privacy_contact" id="ai-contact" label="Contact voor privacyvragen" required hint="E-mailadres, telefoonnummer of webadres van de verwerkingsverantwoordelijke."><input className="field" maxLength={200} defaultValue={s?.privacyContact ?? ""} /></Field>
        </div>
        <div className="double-field">
          <Field name="max_turns" id="ai-turns" label="Maximaal aantal antwoorden" required hint={`${LIMITS.turns.min} tot ${LIMITS.turns.max}.`}><input className="field" type="number" min={LIMITS.turns.min} max={LIMITS.turns.max} defaultValue={s?.maxTurns ?? LIMITS.turns.default} /></Field>
          <Field name="max_minutes" id="ai-minutes" label="Maximale duur (minuten)" required hint={`${LIMITS.minutes.min} tot ${LIMITS.minutes.max}.`}><input className="field" type="number" min={LIMITS.minutes.min} max={LIMITS.minutes.max} defaultValue={s?.maxMinutes ?? LIMITS.minutes.default} /></Field>
        </div>
        <div className="double-field">
          <Field name="max_probes" id="ai-probes" label="Doorvragen per onderwerp" required>
            <select className="field" defaultValue={String(s?.maxProbes ?? LIMITS.probes.default)}>
              <option value="0">Geen (alleen de leidraad)</option>
              <option value="1">Hooguit 1</option>
              <option value="2">Hooguit 2</option>
            </select>
          </Field>
          <Field name="retention_months" id="ai-retention" label="Bewaartermijn (maanden)" required hint="Hooguit 12 maanden, zoals andere interviews."><input className="field" type="number" min={LIMITS.retentionMonths.min} max={LIMITS.retentionMonths.max} defaultValue={s?.retentionMonths ?? LIMITS.retentionMonths.default} /></Field>
        </div>
        <h4 className="mt-18" style={{ fontSize: 15 }}>Screener (optioneel)</h4>
        <p className="tiny">Vooraf, op segment of rol. Wie buiten de doelgroep valt, wordt bedankt en telt niet mee. Eén antwoordoptie per regel; begin met &ldquo;+&rdquo; als de optie bij de doelgroep hoort. Bij een rolvraag de rol tussen haakjes, bijv. &ldquo;+ Penningmeester (betaler)&rdquo; (gebruiker, inkoper, betaler, beslisser, beïnvloeder, anders).</p>
        {screener.map((q, i) => (
          <details key={i} className="mt-8" open={!!q}>
            <summary className="text-link">Screenervraag {i + 1}{q ? `: ${q.text}` : ""}</summary>
            <div className="double-field mt-8">
              <Field name={`screener_${i}_text`} id={`ai-s${i}-text`} label="Vraag"><input className="field" maxLength={200} defaultValue={q?.text ?? ""} placeholder="bijv. Wat is je rol bij de club?" /></Field>
              <Field name={`screener_${i}_kind`} id={`ai-s${i}-kind`} label="Soort">
                <select className="field" defaultValue={q?.kind ?? "other"}>
                  {Object.entries(SCREENER_KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </select>
              </Field>
            </div>
            <Field name={`screener_${i}_options`} id={`ai-s${i}-options`} label="Antwoordopties">
              <textarea className="field" rows={4} defaultValue={q ? screenerOptionsText(q) : ""} placeholder={"+ Bestuurslid (beslisser)\n+ Penningmeester (betaler)\nLid\nAnders"} />
            </Field>
          </details>
        ))}
      </ActionForm>
    </details>
  );
}

function SessionList(p: Props & { counts: { total: number; counted: number; screened: number; abandoned: number; excluded: number; active: number; cost: number } }) {
  const { sessions } = p.setup;
  const c = p.counts;
  return (
    <div className="mt-24">
      <div className="section-title">
        <h3>Gesprekken</h3>
        <span className="pill gray">{c.total}</span>
      </div>
      {c.total === 0 ? (
        <p className="sub">Nog geen gesprekken. {p.expState === "live" ? "Deel de link hierboven via je wervingskanalen." : "Gesprekken starten zodra de interviewronde loopt."}</p>
      ) : (
        <>
          <p className="tiny">
            {c.counted} afgerond en meegeteld · {c.screened} gescreend uit · {c.abandoned} afgebroken · {c.excluded} uitgesloten{c.active ? ` · ${c.active} bezig` : ""} · AI-kosten ${c.cost.toFixed(2)} (in het maandbudget)
          </p>
          <ul className="study-list mt-8">
            {sessions.map((s) => {
              const d = sessionDisplay(s, p.setup.now);
              const code = conversationCode(s.id);
              const canInclude = !s.interview_id && s.answers >= 1 && (d.key === "abandoned" || d.key === "excluded") && ["live", "paused"].includes(p.expState);
              return (
                <li key={s.id} className="card tight" style={{ boxShadow: "none", border: "1px solid var(--color-border)" }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
                    <div>
                      <strong>Gesprek {code}</strong>
                      <p className="tiny" style={{ margin: "2px 0 0" }}>
                        {new Date(s.started_at).toLocaleString("nl-NL", { dateStyle: "medium", timeStyle: "short" })} · {s.answers} {s.answers === 1 ? "antwoord" : "antwoorden"} · {roleLabel(s.dmu_role)}
                        {s.segment ? ` · ${s.segment}` : ""} · via {CHANNELS[s.channel as keyof typeof CHANNELS] ?? s.channel}
                        {s.end_reason ? ` · ${END_REASONS[s.end_reason as EndReason] ?? s.end_reason}` : ""}
                        {s.injections ? ` · ${s.injections}× instructie geweigerd` : ""}
                        {s.fallbacks ? ` · ${s.fallbacks}× doorvraag afgekeurd` : ""}
                      </p>
                      {s.exclusion_reason && <p className="tiny" style={{ margin: "2px 0 0" }}>Reden van uitsluiten: {s.exclusion_reason}</p>}
                    </div>
                    <div className="row" style={{ gap: 6 }}>
                      <span className="pill blue">AI-gemodereerd</span>
                      <span className={`pill ${d.pill}`}>{d.label}</span>
                    </div>
                  </div>
                  {s.status !== "screened_out" && (
                    <div className="row mt-8" style={{ gap: 8 }}>
                      <Link className="btn soft sm" href={`/app/ideas/${p.ideaId}/experiments/${p.expId}/ai-interviews/${s.id}`}>Lees het gesprek</Link>
                      {s.interview_id && <Link className="btn white sm" href={`/app/ideas/${p.ideaId}/experiments/${p.expId}/interviews/${s.interview_id}`}>Markeer citaten</Link>}
                    </div>
                  )}
                  {(s.interview_id || d.key === "abandoned") && !s.excluded_at && p.expState !== "decided" && s.status !== "active" && (
                    <details className="mt-8">
                      <summary className="text-link">Uitsluiten</summary>
                      <ActionForm action={excludeAiInterview.bind(null, p.ideaId, s.id)} submitLabel="Sluit uit" submitClass="btn white sm" noValidate>
                        <Field name="reason" id={`ex-${s.id}`} label="Waarom telt dit gesprek niet mee?" required hint="Bijvoorbeeld: antwoorden lijken gegenereerd, buiten de doelgroep, of geen serieuze antwoorden. De reden komt in het auditspoor.">
                          <textarea className="field" rows={2} maxLength={400} />
                        </Field>
                      </ActionForm>
                    </details>
                  )}
                  {canInclude && (
                    <ActionForm action={includeAiInterview.bind(null, p.ideaId, s.id)} submitLabel="Toch opnemen als interview" submitClass="btn white sm"><span /></ActionForm>
                  )}
                  {s.status !== "active" && (
                    <details className="mt-8">
                      <summary className="text-link" style={{ color: "var(--color-risk-text)" }}>Verwijderen (privacyverzoek)</summary>
                      <ActionForm action={deleteAiInterview.bind(null, p.ideaId, s.id)} submitLabel="Verwijder definitief" submitClass="btn white sm">
                        <p className="tiny">Een respondent kan met de gesprekscode {code} vragen om verwijdering. Dit wist het gesprek, alle beurten en het interview met zijn citaten.</p>
                        <label className="check-row"><input type="checkbox" name="confirm_delete" /> Ik verwijder gesprek {code} definitief.</label>
                      </ActionForm>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
