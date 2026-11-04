import { interviewRecruitment, recruitmentLabel } from "@/lib/domain/recruitment";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PageFrame } from "@/components/shell/PageFrame";
import { Term } from "@/components/ui/Term";
import { ActionForm, Field } from "@/components/ui/ActionForm";
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
import { InterviewIntakeFields } from "@/components/experiments/PracticeChoice";
import { DirectionField } from "@/components/ui/DirectionField";
import { truncateWords } from "@/lib/domain/truncate";
import { canDesignatePrimary, TEST_ROLES, testRole } from "@/lib/domain/primary-test";
import { isStarted } from "@/lib/domain/test-counts";
import { loadTestExclusions } from "@/lib/progress";
import { FormPendingOverlay } from "@/components/ui/SavingOverlay";
import { assumptionKind, assumptionKindLabel, metricFitsAssumption } from "@/lib/domain/assumption-kind";
import { belowMinSample, END_BELOW_SAMPLE_CONFIRM, END_REASON_MAX, END_REASON_MIN, goRuleBlock, SELF_APPROVAL_CONFIRM, selfApproval, selfApprovalText, thresholdBlock } from "@/lib/domain/experiment-gates";
import { loadDecisionRule } from "@/lib/decision-rule-data";
import { proposeGoRule } from "@/lib/domain/decision-rule-proposal";
import { describeRule } from "@/lib/domain/decision-rule";
import { GoRuleProposalCard } from "@/components/experiments/GoRuleProposal";
import { TestCardStatus } from "@/components/experiments/TestCardStatus";
import { deadlineFromDays, isoDay } from "@/lib/domain/test-card";
import { decisive, isExploratory } from "@/lib/domain/customer-research";
import { StudyView } from "./StudyView";

export const metadata: Metadata = { title: "Experiment" };

const TITLE_MAX = 90;

export default async function ExperimentPage({ params, searchParams }: PageProps<"/app/ideas/[id]/experiments/[expId]">) {
  const { id, expId } = await params;
  const sp = await searchParams;
  const { idea, canWrite } = await getIdea(id);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("*, hypotheses(*, assumptions(statement, category, kind))").eq("id", expId).eq("idea_id", id).maybeSingle();
  if (!exp || !exp.hypotheses) notFound();
  // Verkennend klantonderzoek vanuit Markt (geen drempels, geen aanname): een eigen, eenvoudiger weergave zonder
  // oordeel, Learning Card of hoofdtest. Tests uit stap 3 lopen ongewijzigd verder hieronder.
  if (isExploratory(exp.hypotheses)) return <StudyView ideaId={id} idea={idea} canWrite={canWrite} exp={exp} h={exp.hypotheses} isNew={typeof sp.nieuw === "string" ? sp.nieuw : undefined} />;
  const h = decisive(exp.hypotheses);
  if (!h) notFound();
  const type = exp.type as ExperimentType;
  const state = exp.state as ExperimentState;
  // Gebruikerstest A10: alle onafhankelijke ladingen tegelijk in plaats van na elkaar (was een waterval van ~10 stappen).
  const [m, { data: cards }, { data: primaryOf }, surveyDraft, interviews, quality, interviewerNames, exclusions, rule, { data: ideaAssumptions }, me] = await Promise.all([
    experimentMetrics(exp, h),
    supabase.from("learning_cards").select("id").eq("experiment_id", expId),
    // Hoofdtest of verkennend (golf A, punt 11).
    supabase.from("assumptions").select("id, primary_experiment_id").eq("id", h.assumption_id).maybeSingle(),
    // AI-opzet van de enquête (golf A, punt 17): wat heeft de mens eraan veranderd?
    (async () => {
      if (type !== "survey" || !exp.ai_draft_id) return null;
      const { data: d } = await supabase.from("ai_drafts").select("content").eq("id", exp.ai_draft_id).maybeSingle();
      const original = d ? surveyConfigOf(d.content) : null;
      const current = surveyConfigOf(exp.config);
      return original && current ? draftEdit(surveyDraftText(original), surveyDraftText(current)) : null;
    })(),
    type === "interview" && canWrite
      ? supabase.from("interviews").select("*, observations(*)").eq("experiment_id", expId).order("held_on").then((r) => r.data ?? [])
      : Promise.resolve([]),
    canWrite ? loadAiQuality() : Promise.resolve(null),
    (async (): Promise<string[]> => {
      if (type !== "interview" || !canWrite) return [];
      const ws = await getWorkspace();
      const { data: me } = await supabase.from("profiles").select("full_name").eq("user_id", ws.user.id).maybeSingle();
      const full = me?.full_name?.trim();
      return full ? [full, full.split(/\s+/)[0]] : [];
    })(),
    // Fase B0, punt 4: telt deze test mee in kans en rangorde? Zelfde regel en gegevens als de risicokaart.
    isStarted(state) ? loadTestExclusions(id) : Promise.resolve(null),
    // B5: de go-regel van het dossier. Een hoofdtest start pas als die vastligt; zonder regel stelt ProofLab hem voor.
    loadDecisionRule(id),
    // Gebruikerstest B1: de kritieke aannames voor het voorstel van de go-regel (select("*"): selected_for_test bestaat
    // pas na de B4-migratie; zonder kolom is niets gekozen).
    canWrite && ["draft", "ready_for_review", "approved"].includes(state)
      ? supabase.from("assumptions").select("*").eq("idea_id", id)
      : Promise.resolve({ data: [] as { id: string; statement: string; importance: number; selected_for_test?: boolean }[] }),
    // Gebruikerstest B4: wie kijkt er, om zelfgoedkeuring vooraf te tonen.
    canWrite && state === "ready_for_review" ? getWorkspace().then((ws) => ws.user.id) : Promise.resolve(null),
  ]);
  const self = selfApproval({ ownerId: exp.owner_id, submittedBy: exp.submitted_by ?? null, approverId: me });
  const role = testRole(exp.id, h.assumption_id, primaryOf ? [primaryOf] : []);
  const { data: currentPrimary } =
    primaryOf?.primary_experiment_id && role !== "primary"
      ? await supabase.from("experiments").select("state").eq("id", primaryOf.primary_experiment_id).maybeSingle()
      : { data: null };
  const designate = canDesignatePrimary(exp, currentPrimary);
  const guideLines = type === "interview" ? ((exp.config as InterviewConfig).guide ?? []) : [];
  const productNames = [idea.title, (exp.config as LandingConfig).product_name ?? ""];
  const guideAudit = auditGuide(guideLines, { productNames });
  const channels = (exp.channels as { channel: string; expected_reach: number | null }[]) ?? [];
  const publicUrl = exp.public_slug ? `${env.appUrl}/t/${exp.public_slug}` : null;
  const running = state === "live" || state === "paused";
  const v = m.verdict;
  // B0 punt 3: past de maatstaf bij de soort aanname? Zo niet, dan kan de Test Card niet ter review of goedgekeurd.
  const kind = h.assumptions ? assumptionKind(h.assumptions) : null;
  const fit = kind ? metricFitsAssumption(kind, { type, metric_label: h.metric_label, metric_numerator: h.metric_numerator, decision_rule: h.decision_rule }) : { ok: true };
  // B0 punt 6: en meldt ProofLab "drempel niet haalbaar", dan evenmin. De server dwingt beide af.
  const approvalBlocks = [fit.ok ? null : (fit.reason ?? "De maatstaf past niet bij de aanname."), thresholdBlock(h)].filter((x): x is string => !!x);
  const blocked = approvalBlocks.length > 0;
  const blockNote = (prefix: string) =>
    blocked ? (
      <div className="form-error" id="approval-block" role="status">
        <p style={{ margin: 0 }}>{prefix}</p>
        <ul style={{ margin: "6px 0 0 18px", padding: 0, fontWeight: 400 }}>{approvalBlocks.map((b) => <li key={b}>{b}</li>)}</ul>
      </div>
    ) : null;
  // B0 punt 6: afronden onder de minimale steekproef vraagt een reden en een bevestiging.
  const endBelowSample = belowMinSample(m.n, h.min_sample);
  const exclusion = exclusions?.get(expId) ?? null;
  const goBlock = goRuleBlock({ isPrimary: role === "primary", rule: rule === undefined ? "unknown" : rule ? "saved" : "missing" });
  const goProposal =
    canWrite && h.assumptions && ["draft", "ready_for_review", "approved"].includes(state)
      ? proposeGoRule({
          rule,
          assumption: { id: h.assumption_id, statement: h.assumptions.statement },
          experiment: exp,
          isPrimary: role === "primary",
          assumptions: (ideaAssumptions ?? []).map((a) => ({ id: a.id, statement: a.statement, importance: a.importance, selectedForTest: a.selected_for_test === true })),
        })
      : null;
  // B5: de deadline. Vóór de start geldt hij als de test vandaag start; daarna is het de vastgelegde einddatum.
  const deadline = exp.ends_at ? new Date(exp.ends_at) : new Date(`${deadlineFromDays(h.max_duration_days, isoDay(new Date()))}T12:00:00`);

  const shortTitle = truncateWords(exp.title, TITLE_MAX);
  return (
    <PageFrame crumbs={["Werkruimte", idea.title, "Testen", exp.title]} coach="experiments" ideaId={id} section={`/experiments/${expId}`}>
      <div className="section-row">
        <div>
          <div className="eyebrow">{EXPERIMENT_TYPES[type].label} · {EXPERIMENT_TYPES[type].phase}</div>
          {/* B1: een lange titel stopt op een woordgrens met "…"; de volledige titel staat in de tooltip. */}
          <h1 title={shortTitle !== exp.title ? exp.title : undefined}>{shortTitle}</h1>
          <p className="sub">Toetst: {h.assumptions?.statement}</p>
        </div>
        <span className={`pill ${EXPERIMENT_STATES[state].pill}`}>{EXPERIMENT_STATES[state].label}</span>
      </div>
      <TestCardStatus state={state} />

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
          {exclusion && (
            <p className="tiny mt-8">
              <span className="pill orange">{exclusion.text.charAt(0).toUpperCase() + exclusion.text.slice(1)}</span> Deze test verandert de kans en de rangorde van de aanname niet. De waarnemingen blijven zichtbaar.
            </p>
          )}
          {v.kind !== "running" && <ResultMeter v={v} success={Number(h.success_threshold_pct)} fail={h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct)} bayes={m.bayes} />}
        </div>
      )}
      {m.warnings.map((w) => <div className="note" key={w}>{w}</div>)}

      <div className="grid-2 mt-18">
        <div className="card">
          <div className="section-title">
            <h2 className="as-h3"><Term k="test-card">Test Card</Term></h2>
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
          {kind && <div className="data-row"><span>Soort aanname</span><strong style={{ textAlign: "right" }}>{assumptionKindLabel(kind)}</strong></div>}
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
          {role === "primary" && rule !== undefined && (
            <div className="data-row" id="go-rule-row">
              <span>Go-regel van het dossier</span>
              <strong style={{ textAlign: "right" }}>
                {rule
                  ? `${describeRule(rule, rule.primaryExperimentId === expId ? exp.title : null)}${rule.recordedLate ? " (achteraf vastgelegd)" : rule.lockedAt ? " (vergrendeld)" : ""}`
                  : "Nog niet vastgelegd: deze hoofdtest start pas als de go-regel vastligt."}
              </strong>
            </div>
          )}
          <div className="data-row">
            <span>Deadline</span>
            <strong style={{ textAlign: "right" }}>
              {exp.ends_at ? "" : "bij start vandaag: "}
              {deadline.toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" })}
            </strong>
          </div>
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
          {goProposal && <GoRuleProposalCard ideaId={id} proposal={goProposal} />}
          {canWrite && state === "draft" && (
            <div id="ter-review" className="coach-target">
              <p className="sub">Controleer de Test Card. Daarna bied je het experiment aan voor review.</p>
              {blockNote("Ter review aanbieden kan niet: deze Test Card kan zo niet worden goedgekeurd. Maak een nieuwe Test Card.")}
              <ActionForm action={transitionExperiment.bind(null, id, expId, "ready_for_review")} submitLabel="Ter review aanbieden" disabled={blocked} describedBy={blocked ? "approval-block" : undefined} footer={<button formAction={deleteDraft.bind(null, id, expId)} className="text-link" style={{ color: "var(--color-risk-text)" }}>Concept verwijderen</button>}>
                <span />
              </ActionForm>
            </div>
          )}
          {canWrite && state === "ready_for_review" && (
            <div id="goedkeuren" className="coach-target">
            <ActionForm action={transitionExperiment.bind(null, id, expId, "approved")} submitLabel="Akkoord: keur goed en vergrendel" disabled={blocked} describedBy={blocked ? "approval-block" : undefined}>
              {blockNote("Goedkeuren kan niet:")}
              {self.self && (
                <div className="note" role="note" id="zelf-goedkeuren" style={{ marginTop: 0 }}>
                  <strong>{selfApprovalText(self)}</strong> Liefst keurt iemand anders de Test Card goed; kan dat niet, bevestig het dan hieronder. In het rapport
                  staat deze test als &ldquo;zelf goedgekeurd&rdquo;.
                  <label className="check-row mt-8"><input type="checkbox" name="confirm_self_approval" required /> {SELF_APPROVAL_CONFIRM}</label>
                </div>
              )}
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
            </div>
          )}
          {canWrite && state === "approved" && (
            <div id="publiceren" className="coach-target">
              {type !== "interview" && !trackingConfigured() && <div className="form-error">Meting is niet geconfigureerd (INGEST_SECRET en TRACKING_SALT ontbreken). De test kan nog niet live.</div>}
              {publicUrl && type !== "survey" && <p className="sub">Bekijk eerst het <a className="text-link" href={`/t/${exp.public_slug}`} target="_blank">voorbeeld</a> (metingen staan nog uit).</p>}
              {goBlock && (
                <div className="form-error" id="go-rule-block" role="status">
                  <p style={{ margin: 0 }}>{goBlock}</p>
                </div>
              )}
              <ActionForm
                action={transitionExperiment.bind(null, id, expId, "live")}
                submitLabel={type === "interview" ? "Start de interviewronde" : "Publiceer en start de meting"}
                disabled={!!goBlock}
                describedBy={goBlock ? "go-rule-block" : undefined}
              >
                <span />
              </ActionForm>
            </div>
          )}
          {canWrite && running && (
            <div className="row">
              <ActionForm action={transitionExperiment.bind(null, id, expId, state === "live" ? "paused" : "live")} submitLabel={state === "live" ? "Pauzeer" : "Hervat"} submitClass="btn white sm"><span /></ActionForm>
              {!endBelowSample && <ActionForm action={transitionExperiment.bind(null, id, expId, "ended")} submitLabel="Rond af" submitClass="btn dark sm"><span /></ActionForm>}
            </div>
          )}
          {canWrite && running && endBelowSample && (
            <ActionForm action={transitionExperiment.bind(null, id, expId, "ended")} submitLabel="Rond af onder de minimale steekproef" submitClass="btn dark sm" className="mt-12">
              <div className="note" style={{ marginTop: 0 }}>
                Er zijn {m.n} van minimaal {h.min_sample} deelnemers. Afronden kan, maar de uitkomst telt dan niet mee in kans en rangorde.
              </div>
              <div className="form-line">
                <label htmlFor="end-reason">Waarom rond je nu af?</label>
                <textarea className="field" id="end-reason" name="end_reason" rows={3} required minLength={END_REASON_MIN} maxLength={END_REASON_MAX} aria-describedby="end-reason-hint" />
                <p className="field-hint" id="end-reason-hint">Minstens {END_REASON_MIN} tekens. De reden wordt bewaard bij het experiment en komt op de Learning Card.</p>
              </div>
              <label className="check-row"><input type="checkbox" name="confirm_below_sample" required /> {END_BELOW_SAMPLE_CONFIRM}</label>
            </ActionForm>
          )}
          {exp.end_reason && (
            <div className="note" style={{ marginTop: 0 }}>
              <strong>Afgerond onder de minimale steekproef.</strong> De uitkomst telt niet mee in kans en rangorde. Reden: {exp.end_reason}
            </div>
          )}
          {canWrite && state === "ended" && (cards ?? []).length === 0 && (
            <ActionForm action={createLearningCard.bind(null, id, expId)} submitLabel="Analyseer en maak de Learning Card" pendingLabel="Analyseren…">
              <p className="sub">ProofLab berekent het resultaat uit de ruwe, ontdubbelde metingen en maakt een concept-<Term k="learning-card">Learning Card</Term>.</p>
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
            // Ook de naam van de deelnemer telt mee ("TEST Makelaar A (fictief)"), en ook bij nog niet aangegeven gesprekken.
            const fiction = practice !== "practice" ? fictionWarning(fictionSignals(`${iv.participant_label ?? ""}\n${iv.transcript ?? ""}`)) : null;
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
                        <div className="mt-8">
                          <DirectionField kind="statement" id={`obs-rel-${iv.id}`} name="relation" neutral />
                        </div>
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
              <ActionForm action={addInterview.bind(null, id, expId)} submitLabel="Interview opslaan" pendingLabel="Interview opslaan…" resetOnSuccess noValidate>
                <div className="double-field mt-12">
                  <Field name="participant_label" id="iv-l" label="Pseudoniem" required><input className="field" placeholder="Bijv. Eventmanager A" maxLength={80} /></Field>
                  <Field name="held_on" id="iv-d" label="Datum gesprek" required><input className="field" type="date" /></Field>
                </div>
                <div className="double-field">
                  <Field name="dmu_role" id="iv-r" label="Rol in het koopproces" required>
                    <select className="field" defaultValue="user">{Object.entries(DMU_ROLES).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                  </Field>
                  <Field name="segment" id="iv-s" label="Segment (optioneel)"><input className="field" maxLength={160} /></Field>
                </div>
                <Field name="record_type" id="iv-t" label="Soort verslag" required>
                  <select className="field" defaultValue="transcript"><option value="transcript">Transcript (bijv. uit Teams, Zoom of Fathom)</option><option value="notes">Eigen notities</option></select>
                </Field>
                {/* Gebruikerstest C8: wervingskanaal en -groep in één logica, toestemming alleen bij een echt gesprek. */}
                <InterviewIntakeFields testGroup={exp.recruitment_group ?? null} />
                <Field name="transcript" id="iv-x" label="Transcript of notities" required hint="Minimaal 50 tekens.">
                  <textarea className="field" rows={8} />
                </Field>
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
