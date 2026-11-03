import { interviewRecruitment, RECRUITMENT_GROUPS, RECRUITMENT_KEYS, recruitmentLabel } from "@/lib/domain/recruitment";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { ActionForm } from "@/components/ui/ActionForm";
import { RuleSummary, ruleName } from "@/components/experiments/RuleSummary";
import { ResultMeter } from "@/components/experiments/ResultMeter";
import { GuideAuditList, TranscriptAuditList } from "@/components/experiments/InterviewAudit";
import { AiQualityCard } from "@/components/research/AiQualityCard";
import { SurveyResults } from "@/components/survey/SurveyResults";
import { Distribution } from "@/components/survey/Distribution";
import { PerPostResults } from "@/components/survey/PerPostResults";
import { getIdea, getWorkspace } from "@/lib/data";
import { loadAiQuality } from "@/lib/ai-quality";
import { auditGuide, auditTranscript, guideSummary } from "@/lib/domain/interview-audit";
import { codingIsProposalOnly } from "@/lib/domain/ai-quality";
import { supabaseServer } from "@/lib/supabase/server";
import { experimentMetrics, surveyConfigOf, type InterviewConfig, type LandingConfig, type PricingConfig } from "@/lib/experiment-metrics";
import { describeDraftEdit, draftEdit, surveyDraftText } from "@/lib/domain/ai-draft";
import { aiConfigured, env, trackingConfigured } from "@/lib/env";
import { pct } from "@/lib/domain/stats";
import { CHANNELS } from "@/lib/domain/tracking";
import { DMU_ROLES, EXPERIMENT_STATES, EXPERIMENT_TYPES, OBSERVATION_KINDS, type ExperimentState, type ExperimentType } from "@/lib/domain/labels";
import { addInterview, addObservation, analyzeInterviewWithAi, createLearningCard, deleteDraft, deleteInterview, deleteObservation, reviewObservation, setInterviewPractice, setPrimaryTest, transitionExperiment } from "../actions";
import { fictionSignals, fictionWarning, PRACTICE_LABELS, practiceStatus } from "@/lib/domain/practice";
import { PracticeChoice } from "@/components/experiments/PracticeChoice";
import { canDesignatePrimary, TEST_ROLES, testRole } from "@/lib/domain/primary-test";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";

export const metadata: Metadata = { title: "Experiment" };

export default async function ExperimentPage({ params }: PageProps<"/app/ideas/[id]/experiments/[expId]">) {
  const { id, expId } = await params;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("*, hypotheses(*, assumptions(statement, category))").eq("id", expId).eq("idea_id", id).maybeSingle();
  if (!exp || !exp.hypotheses) notFound();
  const h = exp.hypotheses;
  const type = exp.type as ExperimentType;
  const state = exp.state as ExperimentState;
  const m = await experimentMetrics(exp, h);
  const { data: cards } = await supabase.from("learning_cards").select("id").eq("experiment_id", expId);
  // Hoofdtest of verkennend (golf A, punt 11).
  const { data: primaryOf } = await supabase.from("assumptions").select("id, primary_experiment_id").eq("id", h.assumption_id).maybeSingle();
  const role = testRole(exp.id, h.assumption_id, primaryOf ? [primaryOf] : []);
  const { data: currentPrimary } =
    primaryOf?.primary_experiment_id && role !== "primary"
      ? await supabase.from("experiments").select("state").eq("id", primaryOf.primary_experiment_id).maybeSingle()
      : { data: null };
  const designate = canDesignatePrimary(exp, currentPrimary);
  // AI-opzet van de enquête (golf A, punt 17): wat heeft de mens eraan veranderd?
  const surveyDraft = await (async () => {
    if (type !== "survey" || !exp.ai_draft_id) return null;
    const { data: d } = await supabase.from("ai_drafts").select("content").eq("id", exp.ai_draft_id).maybeSingle();
    const original = d ? surveyConfigOf(d.content) : null;
    const current = surveyConfigOf(exp.config);
    return original && current ? draftEdit(surveyDraftText(original), surveyDraftText(current)) : null;
  })();
  const interviews =
    type === "interview" && canWrite
      ? (await supabase.from("interviews").select("*, observations(*)").eq("experiment_id", expId).order("held_on")).data ?? []
      : [];
  const quality = canWrite ? await loadAiQuality() : null;
  const guideLines = type === "interview" ? ((exp.config as InterviewConfig).guide ?? []) : [];
  const productNames = [idea.title, (exp.config as LandingConfig).product_name ?? ""];
  const guideAudit = auditGuide(guideLines, { productNames });
  let interviewerNames: string[] = [];
  if (type === "interview" && canWrite) {
    const ws = await getWorkspace();
    const { data: me } = await supabase.from("profiles").select("full_name").eq("user_id", ws.user.id).maybeSingle();
    const full = me?.full_name?.trim();
    interviewerNames = full ? [full, full.split(/\s+/)[0]] : [];
  }
  const channels = (exp.channels as { channel: string; expected_reach: number | null }[]) ?? [];
  const publicUrl = exp.public_slug ? `${env.appUrl}/t/${exp.public_slug}` : null;
  const running = state === "live" || state === "paused";
  const v = m.verdict;

  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Experimenten", exp.title]} coach="experiments" ideaId={id}>
      <div className="section-row">
        <div>
          <div className="eyebrow">{EXPERIMENT_TYPES[type].label} · {EXPERIMENT_TYPES[type].phase}</div>
          <h1>{exp.title}</h1>
          <p className="sub">Toetst: {h.assumptions?.statement}</p>
        </div>
        <span className={`pill ${EXPERIMENT_STATES[state].pill}`}>{EXPERIMENT_STATES[state].label}</span>
      </div>

      {running && (
        <div className="insight-banner">
          <div>
            <span className="pill green">{state === "live" ? "Meting loopt" : "Gepauzeerd"}</span>
            <h2 className="as-h3" style={{ margin: "10px 0 3px" }}>Een uitspraak volgt pas na de afgesproken eindconditie.</h2>
            <p>
              Gestart {exp.started_at ? new Date(exp.started_at).toLocaleDateString("nl-NL") : "—"} · loopt tot uiterlijk{" "}
              {exp.ends_at ? new Date(exp.ends_at).toLocaleDateString("nl-NL") : "—"}. Tussentijds kijken mag; tussentijds concluderen niet.
            </p>
          </div>
        </div>
      )}

      <div className="grid-3">
        <div className="live-stat">
          <small>{type === "interview" ? "Geïnterviewden (met toestemming)" : type === "survey" ? "Respondenten (geloofwaardig, kernvraag beantwoord)" : "Unieke relevante bezoekers"}</small>
          <strong className="num">{m.n}</strong>
          <span className="tiny">minimaal {h.min_sample} afgesproken</span>
        </div>
        <div className="live-stat">
          <small>{h.metric_label}</small>
          <strong className="num">{m.successes}</strong>
          <span className="tiny">{h.metric_numerator}</span>
        </div>
        <div className="live-stat">
          <small>Ratio</small>
          <strong className="num">{m.n ? pct(m.successes / m.n) : "—"}</strong>
          <span className="tiny">{m.successes} / {m.n} · drempel {h.success_threshold_pct}%</span>
        </div>
      </div>

      {m.n > 0 && (
        <div className={`verdict mt-18 ${v.kind}`}>
          <strong>{v.kind === "running" ? "Nog geen uitspraak" : v.kind === "pass" ? `${v.strongProof ? "Sterk bewezen" : "Geslaagd"} volgens de vooraf vastgelegde regel` : v.kind === "fail" ? "Niet geslaagd" : "Onbeslist"}</strong>
          <p className="sub" style={{ marginTop: 4 }}>{v.reason}</p>
          {v.kind !== "running" && (
            <RuleSummary
              o={{ rule: v.rule, label: v.label, probability: v.probability, probabilityFail: v.probabilityFail, successCount: v.successCount, successes: m.successes, n: m.n, interval: v.interval, thresholdPct: Number(h.success_threshold_pct), failThresholdPct: h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct) }}
            />
          )}
          {v.kind !== "running" && <ResultMeter v={v} success={Number(h.success_threshold_pct)} fail={h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct)} bayes={m.bayes} />}
        </div>
      )}
      {m.warnings.map((w) => <div className="note" key={w}>{w}</div>)}

      <div className="grid-2 mt-18">
        <div className="card">
          <div className="section-title">
            <h2 className="as-h3">Test Card</h2>
            <span className={`pill ${h.locked_at ? "dark" : "gray"}`}>{h.locked_at ? `Vergrendeld ${new Date(h.locked_at).toLocaleDateString("nl-NL")}` : "Concept"}</span>
          </div>
          <div className="data-row">
            <span>Rol</span>
            <strong style={{ textAlign: "right" }}>
              <span className={`pill ${role === "primary" ? "blue" : "gray"}`}>{TEST_ROLES[role].label}</span>{" "}
              <span className="tiny">{TEST_ROLES[role].explain}</span>
            </strong>
          </div>
          {canWrite && role !== "primary" && designate.ok && (
            <ActionForm action={setPrimaryTest.bind(null, id, expId)} submitLabel="Wijs aan als hoofdtest" submitClass="btn white sm" pendingLabel="Bezig…">
              <span className="tiny">Alleen de hoofdtest beslist over de aanname. Na goedkeuring ligt deze keuze vast.</span>
            </ActionForm>
          )}
          <div className="data-row"><span>Wij denken dat</span><strong style={{ textAlign: "right" }}>{h.we_believe}</strong></div>
          <div className="data-row"><span>Bij</span><strong style={{ textAlign: "right" }}>{h.target_group}</strong></div>
          <div className="data-row"><span>Dat toetsen we door</span><strong style={{ textAlign: "right" }}>{h.test_method}</strong></div>
          <div className="data-row"><span>We meten</span><strong style={{ textAlign: "right" }}>{h.metric_numerator} / {h.metric_denominator}</strong></div>
          <div className="data-row"><span>Beslisregel</span><strong style={{ textAlign: "right" }}>{ruleName(h.decision_rule ?? "interval")}</strong></div>
          {h.decision_rule === "absolute" ? (
            <div className="data-row"><span>Het klopt als</span><strong className="num">≥ {h.success_count} van {h.min_sample}</strong></div>
          ) : (
            <>
              <div className="data-row"><span>Het klopt als</span><strong className="num">≥ {h.success_threshold_pct}%</strong></div>
              <div className="data-row"><span>Het klopt niet als</span><strong className="num">{h.fail_threshold_pct != null ? `< ${h.fail_threshold_pct}%` : "—"}</strong></div>
            </>
          )}
          <div className="data-row"><span>Steekproef · looptijd</span><strong className="num">≥ {h.min_sample} · max. {h.max_duration_days} dagen</strong></div>
          {h.decision_rule && (
            <div className="data-row">
              <span>Vooraf berekend</span>
              <strong style={{ textAlign: "right" }}>
                {h.required_n != null ? `ongeveer ${h.required_n} deelnemers nodig` : "drempel niet aantoonbaar haalbaar"}{h.expected_pct != null ? ` (rekenscenario: ${h.expected_pct}%)` : ""}
                {h.available_per_week != null ? ` · ${h.available_per_week} beschikbaar per week` : ""}
              </strong>
            </div>
          )}
          <div className="data-row"><span>Kanalen</span><strong style={{ textAlign: "right" }}>{channels.map((c) => CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel).join(", ")}</strong></div>
          <div className="data-row">
            <span>Wervingsgroep</span>
            <strong style={{ textAlign: "right" }}>
              {exp.type === "interview"
                ? `Per gesprek vastgelegd${exp.recruitment_group ? `; standaard ${recruitmentLabel(exp.recruitment_group).toLowerCase()}` : ""}`
                : exp.recruitment_group
                  ? recruitmentLabel(exp.recruitment_group)
                  : "Niet vastgelegd (telt als onbekend)"}
            </strong>
          </div>
          {surveyDraft && (
            <div className="data-row">
              <span>Enquête</span>
              <strong style={{ textAlign: "right" }}>AI-concept · {describeDraftEdit(surveyDraft)}</strong>
            </div>
          )}
          {h.expected_biases && <div className="note">Verwachte vertekeningen: {h.expected_biases}</div>}
        </div>

        <div className="card">
          <div className="section-title"><h2 className="as-h3">Volgende stap</h2></div>
          {!canWrite && <p className="sub">Je kijkt mee. Het onderzoeksteam beheert dit experiment.</p>}
          {canWrite && state === "draft" && (
            <>
              <p className="sub">Controleer de Test Card. Daarna bied je het experiment aan voor review.</p>
              <ActionForm action={transitionExperiment.bind(null, id, expId, "ready_for_review")} submitLabel="Ter review aanbieden" footer={<button formAction={deleteDraft.bind(null, id, expId)} className="text-link" style={{ color: "var(--color-risk-text)" }}>Concept verwijderen</button>}>
                <span />
              </ActionForm>
            </>
          )}
          {canWrite && state === "ready_for_review" && (
            <ActionForm action={transitionExperiment.bind(null, id, expId, "approved")} submitLabel="Akkoord: keur goed en vergrendel">
              <p className="sub">Goedkeuren vergrendelt de hypothese en drempels. Bevestig:</p>
              {type === "survey" ? (
                <>
                  <label className="check-row"><input type="checkbox" name="check_honest" /> De enquête zegt eerlijk wie de vragen stelt en waarvoor; er wordt niets verkocht.</label>
                  <label className="check-row"><input type="checkbox" name="check_privacy" /> Er wordt niet om naam of e-mailadres gevraagd in de vragen; uitnodigingen gaan alleen naar mensen met een bestaande relatie en vervallen na 180 dagen.</label>
                  <label className="check-row"><input type="checkbox" name="check_pretest" /> De vragen zijn voorgelegd aan 3–5 echte mensen uit de doelgroep en waar nodig aangepast.</label>
                </>
              ) : type === "interview" ? (
                <>
                  <label className="check-row"><input type="checkbox" name="check_consent" /> Deelnemers krijgen vooraf uitleg over doel, opname en bewaartermijn, en geven toestemming.</label>
                  <label className="check-row"><input type="checkbox" name="check_neutral" /> De leidraad bevat geen pitch of sturende vragen.</label>
                </>
              ) : (
                <>
                  <label className="check-row"><input type="checkbox" name="check_reveal" /> De pagina belooft niets wat niet waar is; na de klik volgt altijd de eerlijke uitleg.</label>
                  <label className="check-row"><input type="checkbox" name="check_privacy" /> Er worden geen cookies geplaatst; e-mailadressen alleen met toestemming en bewaartermijn van 180 dagen.</label>
                  <label className="check-row"><input type="checkbox" name="check_budget" /> Advertentie-uitgaven (indien van toepassing) zijn goedgekeurd en vastgelegd.</label>
                </>
              )}
            </ActionForm>
          )}
          {canWrite && state === "approved" && (
            <>
              {type !== "interview" && !trackingConfigured() && <div className="form-error">Meting is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken). De test kan nog niet live.</div>}
              {publicUrl && type !== "survey" && <p className="sub">Bekijk eerst het <a className="text-link" href={`/t/${exp.public_slug}`} target="_blank">voorbeeld</a> (metingen staan nog uit).</p>}
              <ActionForm action={transitionExperiment.bind(null, id, expId, "live")} submitLabel={type === "interview" ? "Start de interviewronde" : "Publiceer en start de meting"}>
                <span />
              </ActionForm>
            </>
          )}
          {canWrite && running && (
            <div className="row">
              <ActionForm action={transitionExperiment.bind(null, id, expId, state === "live" ? "paused" : "live")} submitLabel={state === "live" ? "Pauzeer" : "Hervat"} submitClass="btn white sm"><span /></ActionForm>
              <ActionForm action={transitionExperiment.bind(null, id, expId, "ended")} submitLabel="Rond af" submitClass="btn dark sm"><span /></ActionForm>
            </div>
          )}
          {canWrite && state === "ended" && (cards ?? []).length === 0 && (
            <ActionForm action={createLearningCard.bind(null, id, expId)} submitLabel="Analyseer en maak de Learning Card" pendingLabel="Analyseren…">
              <p className="sub">ProofLab berekent het resultaat uit de ruwe, ontdubbelde metingen en maakt een concept-Learning Card.</p>
            </ActionForm>
          )}
          {(cards ?? []).length > 0 && <Link className="btn primary" href={`/app/ideas/${id}/evidence`}>Naar bewijs & besluit →</Link>}

          {publicUrl && running && type !== "interview" && type !== "survey" && (
            <div className="mt-18">
              <div className="eyebrow">Deel per kanaal</div>
              {channels.map((c) => (
                <div key={c.channel} className="form-line">
                  <label htmlFor={`link-${c.channel}`}>{CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel}</label>
                  <input className="field mono" id={`link-${c.channel}`} readOnly value={`${publicUrl}?utm_source=${c.channel}`} />
                </div>
              ))}
              <p className="field-hint">Elke link meet zijn eigen kanaal. Zet advertenties zelf live in Ads Manager en gebruik daar de juiste link.</p>
            </div>
          )}
        </div>
      </div>

      {(m.byChannel.length > 0 || m.byVariant.length > 0) && (
        <div className="grid-2 mt-18">
          {m.byChannel.length > 0 && (
            <div className="card">
              <h2 className="as-h3">Per kanaal</h2>
              <table className="table mt-12">
                <thead><tr><th>Kanaal</th><th>Deelnemers</th><th>{h.metric_label}</th><th>Ratio</th></tr></thead>
                <tbody>
                  {m.byChannel.map((c) => (
                    <tr key={c.channel}><td>{CHANNELS[c.channel as keyof typeof CHANNELS] ?? c.channel}</td><td className="num">{c.visitors}</td><td className="num">{c.actions}</td><td className="num">{c.visitors ? pct(c.actions / c.visitors) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {m.byVariant.length > 0 && (
            <div className="card">
              <h2 className="as-h3">Per prijspunt</h2>
              <table className="table mt-12">
                <thead><tr><th>Aanbod</th><th>Bezoekers</th><th>Gekozen</th><th>Ratio</th></tr></thead>
                <tbody>
                  {m.byVariant.map((r) => (
                    <tr key={r.variant}><td>{r.label}</td><td className="num">{r.visitors}</td><td className="num">{r.actions}</td><td className="num">{r.visitors ? pct(r.actions / r.visitors) : "—"}</td></tr>
                  ))}
                </tbody>
              </table>
              <p className="tiny mt-8">Bezoekers zien steeds één prijspunt (vast per bezoeker per dag). Kleine verschillen tussen prijspunten zijn vaak toeval.</p>
            </div>
          )}
        </div>
      )}

      {canWrite && type !== "interview" && <PerPostResults expId={expId} type={type} rows={m.byContent} metricLabel={h.metric_label} />}

      <Distribution ideaId={id} exp={exp} canWrite={canWrite} plan={h} />

      {type === "interview" && canWrite && (
        <>
          <div className="section-title mt-24"><h2>Interviews</h2><span className="pill gray">{interviews.length} gesprekken</span></div>
          <div className="card">
            <div className="eyebrow">Gespreksleidraad</div>
            <ol style={{ margin: "6px 0 0 18px", fontSize: 13, lineHeight: 1.8 }}>
              {(exp.config as InterviewConfig).guide?.map((q) => <li key={q}>{q}</li>)}
            </ol>
            {(exp.config as InterviewConfig).screener && <p className="tiny mt-8">Selectie: {(exp.config as InterviewConfig).screener}</p>}
            {guideSummary(guideAudit).flagged > 0 ? (
              <div className="note">
                <strong>Leidraadcontrole: {guideSummary(guideAudit).flagged} van {guideAudit.length} vragen verdienen aandacht.</strong> Waarschuwing, geen blokkade.
                <GuideAuditList audit={guideAudit} />
              </div>
            ) : (
              <p className="tiny mt-8">Leidraadcontrole: geen hypothetische, sturende of verkopende vragen gevonden.</p>
            )}
          </div>
          {quality && (
            <div className="mt-18">
              <AiQualityCard measures={[{ title: "AI-codering van interviews: geaccepteerd", measure: quality.coding }]} />
            </div>
          )}
          {interviews.map((iv) => {
            // B0: echt gesprek, oefening of nog niet aangegeven. Alleen een echt gesprek telt als bewijs.
            const practice = practiceStatus(iv.is_practice);
            const practiceLabel = PRACTICE_LABELS[practice];
            const fiction = practice === "real" ? fictionWarning(fictionSignals(iv.transcript)) : null;
            return (
              <div className="card mt-18" key={iv.id}>
                <div className="section-title">
                  <div>
                    <h3>{iv.participant_label}</h3>
                    <p className="tiny">{DMU_ROLES[iv.dmu_role as keyof typeof DMU_ROLES]} · {iv.segment ?? "segment onbekend"} · via {CHANNELS[iv.recruited_via as keyof typeof CHANNELS] ?? iv.recruited_via} · {new Date(iv.held_on).toLocaleDateString("nl-NL")}{iv.is_acquaintance ? " · bekende" : ""} · wervingsgroep {recruitmentLabel(interviewRecruitment(iv.is_acquaintance, iv.recruitment_group, exp.recruitment_group)).toLowerCase()}</p>
                  </div>
                  <div className="row" style={{ gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className={`pill ${practiceLabel.pill}`}>{practiceLabel.label}</span>
                    <span className="pill gray">{iv.record_type === "transcript" ? "Transcript" : "Notities (minder herleidbaar)"}</span>
                  </div>
                </div>
                {practice === "unknown" && (
                  <div className="note" style={{ marginTop: 0 }}>
                    Bij dit gesprek is nog niet aangegeven of het echt was of een oefening. Tot dat gebeurt telt het niet als bewijs.
                    <div className="row mt-8" style={{ gap: 8, flexWrap: "wrap" }}>
                      <form action={setInterviewPractice.bind(null, id, iv.id, false)}><button className="btn white sm">Echt gesprek</button><FormPendingOverlay /></form>
                      <form action={setInterviewPractice.bind(null, id, iv.id, true)}><button className="btn white sm">Oefening of fictief</button><FormPendingOverlay /></form>
                    </div>
                  </div>
                )}
                {fiction && (
                  <div className="note" role="note" style={{ marginTop: 0 }}>
                    <strong>Let op:</strong> {fiction}{" "}
                    <form action={setInterviewPractice.bind(null, id, iv.id, true)} style={{ display: "inline" }}><button className="text-link">Toch markeren als oefening</button><FormPendingOverlay /></form>
                  </div>
                )}
                <details>
                  <summary className="text-link">Transcript tonen</summary>
                  <div className="quote" style={{ whiteSpace: "pre-wrap", maxHeight: 280, overflow: "auto" }}>{iv.transcript}</div>
                </details>
                <TranscriptAuditList turns={auditTranscript(iv.transcript, { productNames, interviewerNames })} />
                {(iv.observations ?? []).map((o) => (
                  <div className="evidence-event" key={o.id}>
                    <div className="icon-circle">{o.kind === "problem_confirmed" ? "✓" : o.kind === "problem_absent" || o.kind === "counter_example" ? "✕" : "•"}</div>
                    <div style={{ flex: 1 }}>
                      <strong>{OBSERVATION_KINDS[o.kind as keyof typeof OBSERVATION_KINDS]}: {o.summary}</strong>
                      {practice !== "real" && <> <span className={`pill ${practiceLabel.pill}`}>{practiceLabel.label}</span></>}
                      {o.quote && <blockquote className="quote">“{o.quote}”</blockquote>}
                      <p>
                        {o.origin !== "ai"
                          ? "Handmatig gecodeerd"
                          : o.review_status === "accepted"
                            ? `AI-codering, geaccepteerd door consultant${o.reviewed_at ? ` op ${new Date(o.reviewed_at).toLocaleDateString("nl-NL")}` : ""}`
                            : o.review_status === "rejected"
                              ? `AI-codering, afgewezen door consultant${o.reviewed_at ? ` op ${new Date(o.reviewed_at).toLocaleDateString("nl-NL")}` : ""}; telt niet mee`
                              : `AI-voorstel, citaat letterlijk gecontroleerd; nog niet beoordeeld${quality && codingIsProposalOnly(quality.coding) ? " (AI-codering blijft een voorstel)" : ""}`}
                      </p>
                      {o.origin === "ai" && !o.review_status && (
                        <div className="row mt-8">
                          <form action={reviewObservation.bind(null, id, o.id, "accepted")}><button className="btn white sm">Accepteer codering</button><FormPendingOverlay /></form>
                          <form action={reviewObservation.bind(null, id, o.id, "rejected")}><button className="btn white sm">Wijs af</button><FormPendingOverlay /></form>
                        </div>
                      )}
                    </div>
                    {state !== "decided" && o.origin === "manual" && <form action={deleteObservation.bind(null, id, o.id)}><button className="text-link">Verwijder</button><FormPendingOverlay /></form>}
                  </div>
                ))}
                {running && (
                  <div className="grid-2 mt-12">
                    <details>
                      <summary className="text-link">+ Observatie coderen</summary>
                      <ActionForm action={addObservation.bind(null, id, expId, iv.id)} submitLabel="Vastleggen" submitClass="btn white sm" resetOnSuccess>
                        <select className="field mt-8" name="kind" aria-label="Soort observatie" defaultValue="problem_confirmed">
                          {Object.entries(OBSERVATION_KINDS).filter(([k]) => ["problem_confirmed", "problem_absent", "current_behaviour", "current_spend", "counter_example", "objection", "opinion", "other"].includes(k)).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </select>
                        <input className="field mt-8" name="summary" placeholder="Korte samenvatting" aria-label="Samenvatting" />
                        <textarea className="field mt-8" name="quote" rows={3} placeholder="Letterlijk citaat uit het transcript" aria-label="Citaat" />
                        <select className="field mt-8" name="relation" aria-label="Relatie tot de aanname" defaultValue="supports">
                          <option value="supports">Ondersteunt de aanname</option>
                          <option value="contradicts">Spreekt de aanname tegen</option>
                          <option value="neutral">Neutraal</option>
                        </select>
                      </ActionForm>
                    </details>
                    <div className="row" style={{ alignItems: "flex-start", justifyContent: "flex-end" }}>
                      {aiConfigured() && (
                        <ActionForm action={analyzeInterviewWithAi.bind(null, id, expId, iv.id)} submitLabel="Laat AI uitspraken markeren" submitClass="btn ai sm" pendingLabel="Analyseren…"><span /></ActionForm>
                      )}
                      <form action={deleteInterview.bind(null, id, iv.id)}><button className="text-link" style={{ color: "var(--color-risk-text)", marginTop: 12 }}>Interview verwijderen</button><FormPendingOverlay /></form>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
          {running && (
            <div className="card mt-18">
              <h3>Interview toevoegen</h3>
              <ActionForm action={addInterview.bind(null, id, expId)} submitLabel="Interview opslaan" resetOnSuccess>
                <div className="double-field mt-12">
                  <div className="form-line"><label htmlFor="iv-l">Pseudoniem</label><input className="field" id="iv-l" name="participant_label" placeholder="Bijv. Eventmanager A" /></div>
                  <div className="form-line"><label htmlFor="iv-d">Datum gesprek</label><input className="field" id="iv-d" name="held_on" type="date" /></div>
                </div>
                <div className="double-field">
                  <div className="form-line">
                    <label htmlFor="iv-r">Rol in het koopproces</label>
                    <select className="field" id="iv-r" name="dmu_role" defaultValue="user">{Object.entries(DMU_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </div>
                  <div className="form-line">
                    <label htmlFor="iv-c">Geworven via</label>
                    <select className="field" id="iv-c" name="recruited_via" defaultValue="network">{Object.entries(CHANNELS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </div>
                </div>
                <div className="double-field">
                  <div className="form-line"><label htmlFor="iv-s">Segment</label><input className="field" id="iv-s" name="segment" /></div>
                  <div className="form-line">
                    <label htmlFor="iv-t">Soort verslag</label>
                    <select className="field" id="iv-t" name="record_type" defaultValue="transcript"><option value="transcript">Transcript (bijv. uit Teams, Zoom of Fathom)</option><option value="notes">Eigen notities</option></select>
                  </div>
                </div>
                <PracticeChoice />
                <div className="form-line"><label htmlFor="iv-x">Transcript of notities</label><textarea className="field" id="iv-x" name="transcript" rows={8} /></div>
                <div className="form-line">
                  <label htmlFor="iv-g">Wervingsgroep</label>
                  <select className="field" id="iv-g" name="recruitment_group" defaultValue={exp.recruitment_group ?? "unknown"} aria-describedby="iv-g-hint">
                    {RECRUITMENT_KEYS.filter((k) => k !== "own_network").map((k) => <option key={k} value={k}>{RECRUITMENT_GROUPS[k].label}</option>)}
                  </select>
                  <p className="field-hint" id="iv-g-hint">Is het een bekende? Vink dat hieronder aan: dan telt het gesprek als eigen netwerk. Gesprekken uit dezelfde groep tellen afnemend mee.</p>
                </div>
                <label className="check-row"><input type="checkbox" name="is_acquaintance" /> Deze persoon is een bekende (vriend, collega, bestaande klant): wervingsgroep eigen netwerk</label>
                <label className="check-row"><input type="checkbox" name="consent_recorded" /> Toestemming voor verwerking is gegeven en vastgelegd (bewaartermijn 12 maanden)</label>
              </ActionForm>
            </div>
          )}
        </>
      )}

      {type === "survey" && <SurveyResults ideaId={id} exp={exp} h={h} m={m} canWrite={canWrite} />}

      {type !== "interview" && type !== "survey" && (
        <div className="card mt-18">
          <h2 className="as-h3">Testpagina</h2>
          <p className="sub mt-8">
            {(exp.config as LandingConfig).headline} — {(exp.config as LandingConfig).cta_label}
            {type === "pricing" && ` · ${(exp.config as PricingConfig).price_points.map((p) => `${p.label} € ${p.amount} ${p.period}`).join(" · ")}`}
          </p>
          {publicUrl ? <p className="tiny mt-8">Adres: <span className="mono">{publicUrl}</span></p> : <p className="tiny mt-8">Het publieke adres ontstaat bij goedkeuring.</p>}
        </div>
      )}
    </PageFrame>
  );
}
