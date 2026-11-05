"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { checkQuote } from "@/lib/domain/verify";
import { KIND_DEFAULTS, testEvidenceLevel } from "@/lib/domain/evidence";
import { CHANNELS } from "@/lib/domain/tracking";
import { RECRUITMENT_KEYS } from "@/lib/domain/recruitment";
import { interviewIntake } from "@/lib/domain/interview-intake";
import { canDesignatePrimary } from "@/lib/domain/primary-test";
import { earlierTestsOfType, experimentMetrics, loadSurveyResponses, surveyConfigOf, type LandingConfig, type PricingConfig } from "@/lib/experiment-metrics";
import { errorSummary, sampleBand, sampleBelowRequired, validateTestCard } from "@/lib/domain/test-card";
import { fieldErrorsFrom, savedNothing } from "@/lib/domain/form-errors";
import { empiricalPrior, pct } from "@/lib/domain/stats";
import { ideaMethodVersion } from "@/lib/method-data";
import { METHODS } from "@/lib/domain/method";
import { recommend } from "@/lib/domain/recommend";
import { aiConfigured } from "@/lib/env";
import { analyzeInterview, suggestCopyVariants } from "@/lib/ai/research";
import { ideaContext } from "@/lib/idea-context";
import { honestyWarnings, prepareVariants, type PreparedVariant } from "@/lib/domain/copy-honesty";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import { SurveyConfigSchema } from "@/lib/domain/survey";
import { metricFromKey, parseSurveyJson, surveyErrors } from "@/lib/domain/survey-editor";
import type { DraftResult } from "@/lib/domain/survey-draft";
import { openAnswers } from "@/lib/domain/survey-results";
import { contentHash } from "@/lib/claims";
import { dedupeFragments } from "@/lib/signals/import";
import type { Database, Json } from "@/lib/database.types";

type ObservationInsert = Database["public"]["Tables"]["observations"]["Insert"];
import type { AssumptionCategory, ObservationKind } from "@/lib/domain/labels";
import { assumptionKind, metricFitsAssumption } from "@/lib/domain/assumption-kind";
import { checkEnd, goRuleBlock, selfApproval, thresholdBlock } from "@/lib/domain/experiment-gates";
import { loadDecisionRule } from "@/lib/decision-rule-data";
import { excludedCriticalCheck, GO_RULE_NOTE, proposeGoRule } from "@/lib/domain/decision-rule-proposal";
import { acceptAiLearning, ruleBasedLearning, type LearningInput } from "@/lib/domain/learning-proposal";
import { proposeLearning } from "@/lib/ai/learning";
import { fictionSignals, fictionWarning } from "@/lib/domain/practice";
import { coachSurveyDraft } from "@/lib/survey-coach";
import { approvalChecks, decisive, isExploratory, studyFormatOf } from "@/lib/domain/customer-research";
import { defaultedTestCardFields } from "@/lib/defaulted-test-card";
import { withDefaultedFallback, withFields } from "@/lib/defaulted-fields";
import { cleanDefaultedFields } from "@/lib/view-mode";
import { privacyBlock, type TestPrivacy } from "@/lib/domain/test-privacy";
import { EMPTY_COUNTS, systemObservationKind, systemObservationSummary } from "@/lib/domain/action-counts";
import { asSuccessMetric } from "@/lib/domain/test-page-generator";
import { loadActionCounts, schemaMissing } from "@/lib/action-counts-data";
import { depositAvailability } from "@/lib/integrations/mollie-server";

export type ActionState = { error: string | null; ok?: string | null; warning?: string | null; fieldErrors?: Record<string, string> };

const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

const text = (max: number) => z.string().trim().max(max);

const Base = z.object({
  assumption_id: z.string().uuid("Kies de aanname die je toetst."),
  type: z.enum(["landing", "interview", "pricing", "survey"]),
  title: text(140),
  we_believe: text(600),
  target_group: text(300),
  test_method: text(300),
  metric_label: text(200),
  metric_numerator: text(200),
  metric_denominator: text(200),
  success_threshold_pct: z.coerce.number().optional(),
  fail_threshold_pct: z.coerce.number().optional(),
  min_sample: z.coerce.number().int().optional(),
  max_duration_days: z.coerce.number().int().optional(),
  expected_biases: text(600).optional(),
  expected_reach: z.coerce.number().int().min(0).optional(),
  // Methode 2026-11-b: beslisregel en de aannames voor het vooraf berekende aantal deelnemers.
  decision_rule: z.enum(["absolute", "probability"]).optional(),
  success_count: z.coerce.number().int().optional(),
  available_per_week: z.coerce.number().int().min(0).optional(),
  cost_estimate_eur: z.coerce.number().min(0).optional(),
  // Wervingsgroep (golf A, punt 13): verplicht bij enquête-, landing- en prijstests.
  recruitment_group: z.enum(RECRUITMENT_KEYS).optional(),
});

export async function createExperiment(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const ws = await getWorkspace();
  const raw = Object.fromEntries(form);
  // Lege getalvelden betekenen "niet ingevuld", niet 0.
  for (const k of ["fail_threshold_pct", "success_count", "available_per_week", "expected_reach", "recruitment_group", "success_threshold_pct", "min_sample", "max_duration_days", "cost_estimate_eur"]) {
    if (raw[k] === "") delete raw[k];
  }
  const p = Base.safeParse(raw);
  if (!p.success) {
    const issue = p.error.issues[0];
    const field = String(issue.path[0] ?? "");
    return { error: "De Test Card is nog niet opgeslagen: controleer het gemarkeerde veld.", fieldErrors: { [field || "title"]: issue.message } };
  }
  const v = p.data;
  const fieldErrors: Record<string, string> = {};
  let survey: z.infer<typeof SurveyConfigSchema> | null = null;
  if (v.type === "survey") {
    // The key question and its success options are the pre-registered metric: the Test Card follows them.
    const json = parseSurveyJson(raw.survey_config);
    const errors = surveyErrors(json);
    if (errors.length) fieldErrors.survey = `Enquête: ${errors[0]}`;
    else {
      survey = SurveyConfigSchema.parse(json);
      const m = metricFromKey(survey);
      v.metric_numerator = m.metric_numerator;
      v.metric_denominator = m.metric_denominator;
    }
  }
  // Beslisregel: de aantalregel alleen voor sterke handelingen; in de code zijn dat de aanbetalingen en
  // herhaalaankopen die in interviews worden vastgelegd. Landing-, prijs- en enquêtetests meten een percentage.
  // Dossiers met methode 2026-11-a houden de intervalregel: daar wordt geen beslisregel vastgelegd.
  const rule = METHODS[await ideaMethodVersion(ideaId)].usesRules ? (v.decision_rule ?? "probability") : null;
  if (rule === "absolute" && v.min_sample && v.success_count) {
    // De percentagedrempel volgt uit het aantal: nodig voor het 95%-interval en het label "sterk bewezen".
    v.success_threshold_pct = Math.min(100, Math.round((v.success_count / v.min_sample) * 1000) / 10);
    v.fail_threshold_pct = undefined;
  }
  const channels = form.getAll("channels").map(String).filter((c) => c in CHANNELS);
  const pricePoints: PricingConfig["price_points"] = [];
  for (let i = 0; i < 3; i++) {
    const label = String(raw[`price_label_${i}`] ?? "").trim();
    const amount = Number(String(raw[`price_amount_${i}`] ?? "").replace(",", "."));
    const period = String(raw[`price_period_${i}`] ?? "").trim() || "eenmalig";
    if (label && Number.isFinite(amount) && amount > 0) pricePoints.push({ label: label.slice(0, 60), amount, period: period.slice(0, 30) });
  }
  const guideLines = String(raw.guide ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 15);
  // Fase B1b: het benodigde aantal volgt uit de vastgelegde drempels en eerdere tests van dit type, niet uit een
  // verwachting van de gebruiker. Het middenscenario wordt bewaard als expected_pct en required_n. Gebruikerstest C3:
  // vóór de controle berekend, zodat een steekproef onder het berekende aantal een motivering vraagt (zelfde regel als
  // op het scherm, validateTestCard).
  let band: ReturnType<typeof sampleBand> | null = null;
  if (rule && v.success_threshold_pct != null && v.max_duration_days != null) {
    band = sampleBand({
      rule,
      thresholdPct: v.success_threshold_pct,
      successCount: v.success_count ?? null,
      prior: empiricalPrior(await earlierTestsOfType(ideaId, v.type).catch(() => [])),
      availablePerWeek: v.available_per_week ?? null,
      maxDurationDays: v.max_duration_days,
    });
  }
  const requiredN = rule && rule !== "absolute" ? (band?.requiredN ?? null) : null;
  const sampleReason = String(raw.sample_below_reason ?? "").trim().slice(0, 300);
  Object.assign(
    fieldErrors,
    validateTestCard({
      type: v.type,
      title: v.title,
      we_believe: v.we_believe,
      target_group: v.target_group,
      test_method: v.test_method,
      metric_label: v.metric_label,
      metric_numerator: v.metric_numerator,
      metric_denominator: v.metric_denominator,
      success_threshold_pct: v.success_threshold_pct ?? null,
      fail_threshold_pct: v.fail_threshold_pct ?? null,
      min_sample: v.min_sample ?? null,
      max_duration_days: v.max_duration_days ?? null,
      rule,
      success_count: v.success_count ?? null,
      thresholds_locked: raw.thresholds_locked === "1",
      recruitment_group: String(v.recruitment_group ?? ""),
      channels,
      headline: String(raw.headline ?? ""),
      price_points: pricePoints.length,
      guide_questions: guideLines.length,
      required_n: requiredN,
      sample_below_reason: sampleReason,
      ...(v.type === "landing" || v.type === "pricing"
        ? { privacy_controller: String(raw.privacy_controller ?? ""), privacy_contact: String(raw.privacy_contact ?? "") }
        : {}),
    }),
  );
  if (Object.keys(fieldErrors).length) return { error: errorSummary(fieldErrors), fieldErrors };
  // Alle verplichte getallen zijn hierboven gecontroleerd.
  const minSample = v.min_sample as number;
  const maxDays = v.max_duration_days as number;
  const successPct = v.success_threshold_pct as number;

  const thresholdChange = String(raw.threshold_change_reason ?? "").trim().slice(0, 600);
  // Gebruikerstest C3: wijzigingen ten opzichte van het berekende of eerst vastgelegde, samen in de motivering (max. 600).
  const belowSample = sampleBelowRequired({ rule, min_sample: minSample, required_n: requiredN });
  const changeReason = [
    thresholdChange ? `Drempels gewijzigd na vastleggen: ${thresholdChange}` : null,
    belowSample ? `Steekproef onder berekend aantal (${minSample} in plaats van ${requiredN}): ${sampleReason}` : null,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 600);

  let config: Json;
  if (survey) {
    config = survey as unknown as Json;
  } else if (v.type === "interview") {
    config = { guide: guideLines, screener: String(raw.screener ?? "").trim().slice(0, 600), target_n: minSample };
  } else {
    const landing: LandingConfig = {
      headline: String(raw.headline ?? "").trim().slice(0, 140),
      subline: String(raw.subline ?? "").trim().slice(0, 300),
      offer: String(raw.offer ?? "").trim().slice(0, 600),
      cta_label: String(raw.cta_label ?? "").trim().slice(0, 40) || "Meer informatie",
      collect_email: raw.collect_email === "on",
      reveal_message: String(raw.reveal_message ?? "").trim().slice(0, 600),
      product_name: String(raw.product_name ?? "").trim().slice(0, 80) || v.title,
      researcher: ws.org?.name ?? "de onderzoeker",
    };
    // Fase 2 · punt 4: de verwerkingsverantwoordelijke voor de AVG-tekst; de database laat de test zonder niet live gaan.
    const privacy: TestPrivacy = {
      controller_name: String(raw.privacy_controller ?? "").trim().slice(0, 120),
      controller_contact: String(raw.privacy_contact ?? "").trim().slice(0, 200),
    };
    landing.privacy = privacy;
    // Fase 2 · punt 4: optionele betaalstap, alleen als Mollie voor deze werkruimte is ingesteld (de server controleert het zelf).
    if (raw.deposit_enabled === "on") {
      const amount = Math.round(Number(String(raw.deposit_amount ?? "").replace(",", ".")) * 100) / 100;
      if (!(amount >= 1 && amount <= 500)) return { error: "De Test Card is nog niet opgeslagen: kies een aanbetaling tussen € 1 en € 500." };
      const availability = await depositAvailability(ws.org?.id);
      if (!availability.available) return { error: availability.reason ?? "Mollie niet ingesteld: de betaalstap is niet beschikbaar." };
      landing.deposit = { enabled: true, amount_eur: amount };
    }
    if (v.type === "pricing") {
      config = { ...landing, price_points: pricePoints } satisfies PricingConfig;
    } else {
      config = landing;
    }
  }

  // Fase 1 · punt 1: welke velden nog precies de standaardwaarde van ProofLab hebben (in Snel ingeklapt onder Details).
  // Herkomst voor het auditspoor en de Test Card; de waarden zelf en de berekening veranderen er niet door.
  const defaulted = cleanDefaultedFields(
    "hypotheses",
    defaultedTestCardFields({
      type: v.type,
      rule,
      values: { ...v, fail_threshold_pct: v.fail_threshold_pct ?? null, expected_biases: v.expected_biases ?? null, success_threshold_pct: successPct, min_sample: minSample, max_duration_days: maxDays },
      channels,
      recruitmentGroup: v.recruitment_group ?? null,
      requiredN,
    }),
  );
  const supabase = await supabaseServer();
  const hypothesis = {
      idea_id: ideaId,
      assumption_id: v.assumption_id,
      we_believe: v.we_believe,
      target_group: v.target_group,
      test_method: v.test_method,
      metric_label: v.metric_label,
      metric_numerator: v.metric_numerator,
      metric_denominator: v.metric_denominator,
      success_threshold_pct: successPct,
      fail_threshold_pct: v.fail_threshold_pct ?? null,
      min_sample: minSample,
      max_duration_days: maxDays,
      expected_biases: v.expected_biases || null,
      // Drempels die na het vastleggen (stap 1) toch zijn gewijzigd: de motivering blijft bij deze versie bewaard.
      change_reason: changeReason || null,
      // Vastgelegd met de drempels en na goedkeuring vergrendeld (guard_hypothesis_lock).
      decision_rule: rule,
      success_count: rule === "absolute" ? (v.success_count ?? null) : null,
      expected_pct: band ? band.expectedPct : null,
      available_per_week: rule ? (v.available_per_week ?? null) : null,
      required_n: band ? band.requiredN : null,
  };
  const { data: h, error: hErr } = await withDefaultedFallback((w) => supabase.from("hypotheses").insert(withFields(hypothesis, defaulted, w)).select("id").single());
  if (hErr || !h) return { error: `De Test Card kon niet worden opgeslagen (hypothese: ${hErr?.message ?? "onbekende fout"}). Probeer het opnieuw.` };
  const { data: exp, error } = await supabase
    .from("experiments")
    .insert({
      idea_id: ideaId,
      hypothesis_id: h.id,
      type: v.type,
      title: v.title,
      config,
      channels: channels.map((c) => ({ channel: c, expected_reach: v.expected_reach ? Math.round(v.expected_reach / channels.length) : null })),
      cost_estimate_eur: v.cost_estimate_eur ?? 0,
      recruitment_group: v.recruitment_group ?? null,
      // Het AI-origineel van de enquête (de database controleert dat het bij dit dossier hoort).
      ai_draft_id: v.type === "survey" && typeof raw.survey_ai_draft_id === "string" && /^[0-9a-f-]{36}$/i.test(raw.survey_ai_draft_id) ? raw.survey_ai_draft_id : null,
    })
    .select("id")
    .single();
  if (error || !exp) return { error: `De Test Card kon niet worden opgeslagen (experiment: ${error?.message ?? "onbekende fout"}). Probeer het opnieuw.` };
  await supabase.from("assumptions").update({ status: "testing" }).eq("id", v.assumption_id).eq("idea_id", ideaId).eq("status", "untested");
  // Hoofdtest (golf A, punt 11): vooraf aanwijzen. Kan het niet (de huidige hoofdtest ligt al vast), dan blijft
  // deze test verkennend; de testpagina laat zien waarom.
  if (form.get("is_primary") === "on") {
    await supabase.from("assumptions").update({ primary_experiment_id: exp.id }).eq("id", v.assumption_id).eq("idea_id", ideaId);
  }
  refresh(ideaId);
  // Terug naar het bord, met een bevestiging en het nieuwe concept gemarkeerd.
  redirect(`/app/ideas/${ideaId}/experiments?opgeslagen=${exp.id}#bord`);
}

const TRANSITIONS: Record<string, string[]> = {
  draft: ["ready_for_review"],
  ready_for_review: ["draft", "approved"],
  approved: ["live", "draft"],
  live: ["paused", "ended"],
  paused: ["live", "ended"],
};

export async function transitionExperiment(ideaId: string, expId: string, to: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase
    .from("experiments")
    .select("*, hypotheses(*, assumptions(kind, statement, category))")
    .eq("id", expId)
    .eq("idea_id", ideaId)
    .single();
  if (!exp || !TRANSITIONS[exp.state]?.includes(to)) return { error: "Deze stap is nu niet mogelijk." };
  if (to === "approved" || to === "ready_for_review") {
    // B0 punt 3: een Test Card waarvan de maatstaf niet bij de aanname past, kan niet worden goedgekeurd.
    const h = exp.hypotheses;
    if (h?.assumptions) {
      const fit = metricFitsAssumption(assumptionKind(h.assumptions), { type: exp.type, metric_label: h.metric_label, metric_numerator: h.metric_numerator, decision_rule: h.decision_rule });
      if (!fit.ok) return { error: fit.reason ?? "De maatstaf past niet bij de aanname." };
    }
    // B0 punt 6: meldt ProofLab "drempel niet haalbaar", dan kan de test niet worden goedgekeurd.
    const blocked = h ? thresholdBlock(h) : null;
    if (blocked) return { error: blocked };
  }
  // B5: een hoofdtest start pas als de go-regel van het dossier is vastgelegd (zelfde regel als op het scherm).
  if (to === "live" && exp.state === "approved") {
    // Verkennend klantonderzoek (zonder aanname) is nooit een hoofdtest: de go-regel blokkeert het niet.
    const assumptionId = exp.hypotheses?.assumption_id ?? null;
    const { data: a } = assumptionId
      ? await supabase.from("assumptions").select("primary_experiment_id").eq("id", assumptionId).maybeSingle()
      : { data: null };
    const rule = await loadDecisionRule(ideaId);
    const blocked = goRuleBlock({ isPrimary: a?.primary_experiment_id === expId, rule: rule === undefined ? "unknown" : rule ? "saved" : "missing" });
    if (blocked) return { error: blocked };
    // Fase 2 · punt 4: een nieuwe testpagina gaat pas live met naam en contact van de verwerkingsverantwoordelijke.
    const privacy = privacyBlock(exp.config, exp.type);
    if (privacy) return { error: privacy };
  }
  // B0 punt 6: afronden onder de minimale steekproef vraagt een reden en een bevestiging. Het aantal deelnemers
  // wordt hier opnieuw bepaald uit de ruwe metingen, niet uit wat het formulier meestuurt.
  let endReason: string | null = null;
  if (to === "ended") {
    if (!exp.hypotheses) return { error: "Experiment niet gevonden." };
    // Verkennend klantonderzoek telt nergens mee: het streefaantal is planning, afronden eronder vraagt geen reden.
    const h = decisive(exp.hypotheses);
    if (h) {
      const m = await experimentMetrics(exp, h);
      const end = checkEnd({ n: m.n, minSample: h.min_sample, reason: String(form.get("end_reason") ?? ""), confirmed: form.get("confirm_below_sample") === "on" });
      if (!end.ok) return { error: end.error };
      endReason = end.endReason;
    }
  }
  if (to === "approved") {
    // Explicit human approval with the checks that protect participants and the test itself.
    // Voor tests uit stap 3 ongewijzigd; verkennend klantonderzoek vraagt geen pretest (lib/domain/customer-research.ts).
    const required = approvalChecks(exp.type, isExploratory(exp.hypotheses), studyFormatOf(exp.config as { format?: string } | null));
    if (required.some((k) => form.get(k) !== "on")) return { error: "Bevestig alle controlepunten voordat je goedkeurt." };
    // Gebruikerstest B4: wie zijn eigen test goedkeurt, bevestigt dat expliciet (submitted_by bestaat pas na de migratie).
    const ws = await getWorkspace();
    const self = selfApproval({ ownerId: exp.owner_id, submittedBy: exp.submitted_by ?? null, approverId: ws.user.id });
    if (self.self && form.get("confirm_self_approval") !== "on") return { error: "Je keurt je eigen test goed. Bevestig dat met het vinkje bij de melding." };
  }
  const { error } = await supabase
    .from("experiments")
    .update(endReason ? { state: to, end_reason: endReason } : { state: to })
    .eq("id", expId)
    .eq("idea_id", ideaId);
  if (error) {
    const known = /EXPERIMENT|PRIVACY_CONTROLLER|DEPOSIT_NOT_CONFIGURED/.test(error.message);
    const msg = error.message.replace(/^.*?: /, "");
    return { error: known ? msg.charAt(0).toUpperCase() + msg.slice(1) : "De status kon niet worden gewijzigd." };
  }
  // Gebruikerstest A10: alleen deze testpagina en het testbord opnieuw opbouwen; de stappenbalk staat op de pagina zelf.
  revalidatePath(`/app/ideas/${ideaId}/experiments/${expId}`);
  revalidatePath(`/app/ideas/${ideaId}/experiments`);
  const msg: Record<string, string> = {
    ready_for_review: "Klaar voor review. Controleer de Test Card en keur goed.",
    approved: "Goedgekeurd. De hypothese en drempels zijn nu vergrendeld, net als de beslisregel van het dossier (als die er is).",
    live: "De test is live. Metingen lopen; een uitspraak volgt na de eindconditie.",
    paused: "Gepauzeerd. Bezoeken worden nu niet geteld.",
    ended: endReason
      ? "Afgerond onder de minimale steekproef. De reden is vastgelegd; de uitkomst telt niet mee in kans en rangorde."
      : "Afgerond. Maak nu de Learning Card.",
    draft: "Terug naar concept.",
  };
  return { error: null, ok: msg[to] ?? "Bijgewerkt." };
}

// Wijs deze test aan als hoofdtest van zijn aanname (golf A, punt 11). Alleen vóór de goedkeuring, en alleen als de
// huidige hoofdtest ook nog niet is goedgekeurd; de database controleert hetzelfde en legt de wijziging vast.
export async function setPrimaryTest(ideaId: string, expId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("id, state, hypotheses(assumption_id)").eq("id", expId).eq("idea_id", ideaId).maybeSingle();
  const assumptionId = exp?.hypotheses?.assumption_id;
  if (!exp || !assumptionId) return { error: "Test niet gevonden." };
  const { data: a } = await supabase.from("assumptions").select("primary_experiment_id").eq("id", assumptionId).maybeSingle();
  const { data: current } = a?.primary_experiment_id
    ? await supabase.from("experiments").select("state").eq("id", a.primary_experiment_id).maybeSingle()
    : { data: null };
  const check = canDesignatePrimary(exp, current);
  if (!check.ok) return { error: check.reason };
  const { error } = await supabase.from("assumptions").update({ primary_experiment_id: expId }).eq("id", assumptionId).eq("idea_id", ideaId);
  if (error) return { error: error.message.includes("PRIMARY_TEST") ? error.message.replace(/^.*?: /, "") : "De hoofdtest kon niet worden aangewezen." };
  refresh(ideaId);
  return { error: null, ok: "Dit is nu de hoofdtest van de aanname. De andere tests van deze aanname zijn verkennend." };
}

// Fase B5: het voorgestelde go-regel met één klik vastleggen. De server stelt het voorstel opnieuw op uit de database
// (niet uit het formulier) en legt het vast via save_decision_rule, dat ook de vergrendeling bewaakt.
export async function adoptProposedGoRule(ideaId: string, expId: string, _: ActionState, form?: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const [{ data: exp }, rule, { data: all }] = await Promise.all([
    supabase.from("experiments").select("id, title, hypotheses(assumption_id, assumptions(id, statement, primary_experiment_id))").eq("id", expId).eq("idea_id", ideaId).maybeSingle(),
    loadDecisionRule(ideaId),
    // select("*"): selected_for_test bestaat pas na de B4-migratie.
    supabase.from("assumptions").select("*").eq("idea_id", ideaId),
  ]);
  const a = exp?.hypotheses?.assumptions;
  if (!exp || !a) return { error: "Test niet gevonden." };
  if (rule === undefined) return { error: "De beslisregel kan nog niet worden vastgelegd: werk het databaseschema bij." };
  if (rule) return { error: null, ok: "Het dossier heeft al een go-regel." };
  const proposal = proposeGoRule({
    rule,
    assumption: a,
    experiment: exp,
    isPrimary: a.primary_experiment_id === expId,
    assumptions: (all ?? []).map((x) => ({ id: x.id, statement: x.statement, importance: x.importance, selectedForTest: x.selected_for_test === true })),
  });
  if (!proposal) return { error: "Alleen bij een hoofdtest stelt ProofLab de go-regel voor. Wijs deze test eerst aan als hoofdtest." };
  // Gebruikerstest B1: het voorstel wordt op de server opnieuw opgesteld; uit het formulier komt alleen welke kritieke
  // aannames zijn uitgevinkt (met motivering). De aanname van de hoofdtest blijft altijd in de regel. Een oud formulier
  // zonder vinkjes neemt het hele voorstel over.
  const hasChoices = !!form && proposal.conditions.some((c) => form.has(`cond_${c.assumptionId}`));
  const chosen = proposal.conditions.filter((c) => c.main || !hasChoices || form?.get(`cond_${c.assumptionId}`) === "on");
  const check = excludedCriticalCheck({
    critical: proposal.conditions.filter((c) => !c.main).map((c) => ({ id: c.assumptionId, statement: c.statement })),
    chosenIds: chosen.map((c) => c.assumptionId),
    reasons: Object.fromEntries(proposal.conditions.map((c) => [c.assumptionId, form ? String(form.get(`reason_${c.assumptionId}`) ?? "") : ""])),
    baseNote: GO_RULE_NOTE,
  });
  if (check.error !== null) return { error: check.error };
  const { data, error } = await supabase.rpc("save_decision_rule", {
    p_idea: ideaId,
    p_primary: proposal.experimentId,
    p_note: check.note,
    p_conditions: chosen.map((c) => ({ assumption_id: c.assumptionId, min_probability: c.minProbability })) as unknown as Json,
  });
  if (error) {
    if (error.message.includes("DECISION_RULE_LOCKED")) return { error: "De beslisregel ligt al vast." };
    return { error: "De go-regel kon niet worden vastgelegd. Probeer het opnieuw of leg hem vast op de aannamepagina." };
  }
  refresh(ideaId);
  if (data === "locked_late") return { error: null, ok: "Go-regel vastgelegd. Er was al een test goedgekeurd: de regel ligt meteen vast en staat als 'achteraf vastgelegd' in het rapport." };
  return { error: null, ok: "Go-regel vastgelegd. Hij ligt vast zodra de eerste test is goedgekeurd; tot dan pas je hem aan op de aannamepagina." };
}

export async function deleteDraft(ideaId: string, expId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, hypothesis_id").eq("id", expId).eq("idea_id", ideaId).single();
  if (!exp || !["draft", "ready_for_review"].includes(exp.state)) return;
  await supabase.from("experiments").delete().eq("id", expId).eq("idea_id", ideaId);
  await supabase.from("hypotheses").delete().eq("id", exp.hypothesis_id).is("locked_at", null);
  refresh(ideaId);
  redirect(`/app/ideas/${ideaId}/experiments`);
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

const InterviewSchema = z.object({
  participant_label: text(80).min(2, "Gebruik een pseudoniem, bijv. 'Deelnemer A'."),
  dmu_role: z.enum(["user", "buyer", "payer", "decider", "influencer", "other"]),
  segment: text(160).optional(),
  recruited_via: z.enum(Object.keys(CHANNELS) as [string, ...string[]]),
  held_on: z.string().date("Vul de datum van het gesprek in."),
  record_type: z.enum(["transcript", "notes"]),
  transcript: text(60000).min(50, "Plak het transcript of je notities (minimaal 50 tekens)."),
  // Gebruikerstest C8: één veld; leeg = afleiden uit het wervingskanaal. Een bekende is eigen netwerk (is_acquaintance).
  recruitment_group: z.union([z.enum(RECRUITMENT_KEYS), z.literal("")]).optional(),
  // B0: verplicht, zonder voorkeuze. Alleen een echt gesprek telt als bewijs.
  is_practice: z.enum(["real", "practice"], { error: "Geef aan of dit een echt gesprek of een oefening is." }).transform((v) => v === "practice"),
});

// Eigen teksten voor velden waarvan zod alleen een technische melding geeft.
const INTERVIEW_MESSAGES: Partial<Record<string, string>> = {
  dmu_role: "Kies de rol in het koopproces.",
  recruited_via: "Kies via welk kanaal de deelnemer is geworven.",
  record_type: "Kies het soort verslag.",
  recruitment_group: "Kies een wervingsgroep.",
};

const PAYER_SCHEMA_MISSING = "De rol Betaler vraagt een database-update (migratie 20261115090000_interviews_import). Kies tot die tijd Inkoper.";

export async function addInterview(ideaId: string, expId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = InterviewSchema.safeParse(Object.fromEntries(form));
  // B1: alle ontbrekende velden tegelijk, elk bij het eigen veld, plus een samenvatting bij de knop.
  const fieldErrors: Record<string, string> = p.success ? {} : fieldErrorsFrom(p.error.issues, INTERVIEW_MESSAGES);
  if (p.success && /@|\b\d{9,}\b|\b06[\s-]?\d{8}\b/.test(p.data.participant_label)) fieldErrors.participant_label = "Gebruik een pseudoniem, geen e-mailadres of telefoonnummer.";
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, type, recruitment_group").eq("id", expId).eq("idea_id", ideaId).single();
  // Gebruikerstest C8: toestemming is alleen verplicht bij een echt gesprek; consent_recorded is de werkelijke waarde.
  // Bekende = wervingsgroep eigen netwerk; zonder keuze volgt de groep uit het wervingskanaal.
  const intake = interviewIntake({
    isPractice: p.success ? p.data.is_practice : form.get("is_practice") === "practice",
    consent: form.get("consent_recorded") === "on",
    recruitmentGroup: p.success ? p.data.recruitment_group : null,
    recruitedVia: p.success ? p.data.recruited_via : String(form.get("recruited_via") ?? ""),
    testGroup: exp?.recruitment_group ?? null,
  });
  // Is nog niet gekozen of het een echt gesprek is, dan is de toestemming ook nog niet aan de orde.
  if (intake.error && form.get("is_practice") === "real") fieldErrors.consent_recorded = intake.error;
  if (!p.success || Object.keys(fieldErrors).length) return { error: savedNothing("Het interview", fieldErrors), fieldErrors };
  if (!exp || exp.type !== "interview" || !["live", "paused"].includes(exp.state)) return { error: "Interviews voeg je toe terwijl het experiment loopt." };
  const interview = {
    ...p.data,
    segment: p.data.segment || null,
    experiment_id: expId,
    idea_id: ideaId,
    recruitment_group: intake.recruitment_group,
    is_acquaintance: intake.is_acquaintance,
    consent_recorded: intake.consent_recorded,
  };
  // Fase 1 · punt 1: zonder eigen keuze is de wervingsgroep afgeleid uit het kanaal (een standaardwaarde, in het auditspoor).
  const defaulted = p.data.recruitment_group ? [] : ["recruitment_group"];
  const { error } = await withDefaultedFallback((w) => supabase.from("interviews").insert(withFields(interview, defaulted, w)));
  // Fase 1 · punt 3: de rol "Betaler" bestaat pas na migratie 20261115090000_interviews_import.
  if (error && p.data.dmu_role === "payer" && /dmu_role/.test(error.message ?? "")) return { error: PAYER_SCHEMA_MISSING, fieldErrors: { dmu_role: PAYER_SCHEMA_MISSING } };
  if (error) return { error: "Het interview is niet opgeslagen. Probeer het opnieuw." };
  refresh(ideaId);
  // B0: een als echt aangegeven gesprek met woorden als "fictief" of "test": opgeslagen, maar controleer de keuze.
  const warning = p.data.is_practice ? null : fictionWarning(fictionSignals(`${p.data.participant_label}\n${p.data.transcript}`));
  return {
    error: null,
    ok: p.data.is_practice ? "Oefengesprek opgeslagen. Het telt niet als bewijs." : "Interview opgeslagen. Codeer nu de uitspraken.",
    warning,
  };
}

// B0: een interview alsnog aangeven als echt gesprek of oefening. Naar "echt" kan alleen vanuit nog niet
// aangegeven (achteraf oefendata tot bewijs maken kan niet); naar "oefening" kan altijd, want dat telt alleen minder.
export async function setInterviewPractice(ideaId: string, interviewId: string, isPractice: boolean) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  let q = supabase.from("interviews").update({ is_practice: isPractice }).eq("id", interviewId).eq("idea_id", ideaId);
  if (!isPractice) q = q.is("is_practice", null);
  await q;
  refresh(ideaId);
}

export async function deleteInterview(ideaId: string, interviewId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("interviews").delete().eq("id", interviewId).eq("idea_id", ideaId);
  refresh(ideaId);
}

const ObservationSchema = z.object({
  kind: z.enum(["problem_confirmed", "problem_absent", "current_behaviour", "current_spend", "counter_example", "objection", "opinion", "other"]),
  summary: text(400).min(5, "Vat de observatie kort samen."),
  quote: text(1500).min(8, "Neem een letterlijk citaat uit het transcript over."),
  relation: z.enum(["supports", "contradicts", "neutral"]),
});

async function storeObservation(ideaId: string, expId: string, interviewId: string, o: z.infer<typeof ObservationSchema>, origin: "manual" | "ai") {
  const supabase = await supabaseServer();
  const { data: iv } = await supabase.from("interviews").select("transcript").eq("id", interviewId).eq("idea_id", ideaId).single();
  if (!iv) return { ok: false, reason: "Interview niet gevonden." };
  const check = checkQuote(o.quote, iv.transcript);
  if (check !== "exact") return { ok: false, reason: "Het citaat staat niet letterlijk in het transcript." };
  const dims = KIND_DEFAULTS[o.kind as ObservationKind];
  const { data: obs, error } = await supabase
    .from("observations")
    .insert({
      idea_id: ideaId,
      experiment_id: expId,
      interview_id: interviewId,
      kind: o.kind,
      summary: o.summary,
      quote: o.quote,
      quote_check: check,
      is_fact: dims.isFact,
      is_behaviour: dims.isBehaviour,
      is_real_context: dims.isRealContext,
      is_costly: dims.isCostly,
      origin,
    })
    .select("id")
    .single();
  // The same AI-coded quote is stored once per interview (unique index), so re-running adds nothing.
  if (error?.code === "23505") return { ok: false, reason: "duplicate" };
  if (error || !obs) return { ok: false, reason: "De observatie kon niet worden opgeslagen." };
  if (o.relation !== "neutral") {
    const { data: exp } = await supabase.from("experiments").select("hypotheses(assumption_id)").eq("id", expId).single();
    const assumptionId = exp?.hypotheses?.assumption_id;
    if (assumptionId) await supabase.from("assumption_observations").insert({ assumption_id: assumptionId, observation_id: obs.id, idea_id: ideaId, relation: o.relation });
  }
  return { ok: true, reason: "" };
}

export async function addObservation(ideaId: string, expId: string, interviewId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = ObservationSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const r = await storeObservation(ideaId, expId, interviewId, p.data, "manual");
  if (!r.ok) return { error: r.reason };
  refresh(ideaId);
  return { error: null, ok: "Observatie vastgelegd." };
}

export async function deleteObservation(ideaId: string, observationId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  await supabase.from("observations").delete().eq("id", observationId).eq("idea_id", ideaId);
  refresh(ideaId);
}

export async function analyzeInterviewWithAi(ideaId: string, expId: string, interviewId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden; codeer het interview handmatig." };
  const supabase = await supabaseServer();
  const [{ data: iv }, { data: exp }] = await Promise.all([
    supabase.from("interviews").select("*").eq("id", interviewId).eq("idea_id", ideaId).single(),
    supabase.from("experiments").select("hypotheses(we_believe)").eq("id", expId).eq("idea_id", ideaId).single(),
  ]);
  if (!iv) return { error: "Interview niet gevonden." };
  // Keuze product owner (5 nov): de AI ziet alleen gepseudonimiseerde tekst. Zonder pseudonimisering (zelf geplakt,
  // of de import-migratie staat nog niet live) gaat het transcript niet naar de AI.
  if (!(iv as { pseudonymized_at?: string | null }).pseudonymized_at) {
    return { error: "AI-markering kan alleen bij een gepseudonimiseerd transcript. Importeer het transcript via \"Transcript importeren\" zodat namen eerst vervangen worden." };
  }
  try {
    const res = await runAi(ideaId, "interview_analysis", (p) => analyzeInterview(exp?.hypotheses?.we_believe ?? "", iv.transcript, p));
    let kept = 0;
    let rejected = 0;
    let known = 0;
    for (const o of res.data.observations) {
      const r = await storeObservation(ideaId, expId, interviewId, { ...o, summary: o.summary.slice(0, 400), quote: o.quote.slice(0, 1500) }, "ai");
      if (r.ok) kept++;
      else if (r.reason === "duplicate") known++;
      else rejected++;
    }
    refresh(ideaId);
    // B0: lijkt het transcript fictief (volgens de AI of door woorden als "fictief" of "test")? Bij een als echt
    // aangegeven gesprek: controleer de keuze.
    const real = iv.is_practice === false;
    const signals = real ? fictionSignals(`${iv.participant_label ?? ""}\n${iv.transcript ?? ""}`) : [];
    const aiNote = res.data.looks_fictional ? `De AI vindt dat dit transcript fictief lijkt${res.data.reason ? `: ${res.data.reason}` : ""}.` : null;
    const warning = [aiNote, fictionWarning(signals), aiNote && real && !signals.length ? "Controleer de keuze echt gesprek." : null].filter(Boolean).join(" ") || null;
    return {
      error: null,
      ok: `${kept} observaties met letterlijk citaat vastgelegd${known ? `; ${known} waren al vastgelegd` : ""}${rejected ? `; ${rejected} afgewezen omdat het citaat niet in het transcript stond` : ""}. Controleer ze.`,
      warning,
    };
  } catch (e) {
    return { error: aiErrorMessage(e, "De analyse is mislukt. Codeer het interview handmatig.") };
  }
}

// ---------------------------------------------------------------------------
// Analysis → Learning Card (draft)
// ---------------------------------------------------------------------------

export async function createLearningCard(ideaId: string, expId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("*, hypotheses(*, assumptions(category, statement))").eq("id", expId).eq("idea_id", ideaId).single();
  if (!exp || !exp.hypotheses) return { error: "Experiment niet gevonden." };
  if (exp.state !== "ended") return { error: "Rond het experiment eerst af." };
  // Verkennend klantonderzoek heeft geen drempel en dus geen uitspraak: geen Learning Card. De open antwoorden gaan
  // als klantsignaal naar Markt.
  const h = decisive(exp.hypotheses);
  if (!h) return { error: "Een verkennend onderzoek beslist niets en krijgt geen Learning Card. Neem de open antwoorden op als klantsignalen." };
  const m = await experimentMetrics(exp, h);
  const v = m.verdict;
  // B0 punt 6: afgerond onder de minimale steekproef (met reden): de uitkomst telt niet mee in kans en rangorde.
  // De kaart is onbeslist, dus er wordt geen systeemwaarneming als steun of tegenbewijs aan de aanname gekoppeld.
  const belowSample = !!exp.end_reason;
  const verdictKind = belowSample || v.kind === "running" ? "inconclusive" : v.kind;
  const channels = m.byChannel.length;
  // A survey is only as reliable as the share of answers from known, invited people.
  const reliability = belowSample
    ? "low"
    : exp.type === "survey"
      ? m.survey && m.survey.invitation.n >= h.min_sample && (m.survey.openLinkShare ?? 0) <= 0.5 && !exp.ended_early
        ? "high"
        : m.n >= h.min_sample
          ? "medium"
          : "low"
      : m.n >= h.min_sample && channels >= 2 && !exp.ended_early
        ? "high"
        : m.n >= h.min_sample
          ? "medium"
          : "low";
  const rec = recommend({ category: (h.assumptions?.category ?? "desirability") as AssumptionCategory, evidence: 0.3, hasDiscoveryEvidence: true });
  const follow = rec.options.find((o) => o.type === exp.type)?.followUp ?? "";

  const { data: cards } = await supabase.from("learning_cards").select("id, status").eq("experiment_id", expId);
  if ((cards ?? []).some((c) => c.status === "approved")) return { error: "Dit experiment heeft al een goedgekeurde Learning Card." };
  const draft = (cards ?? []).find((c) => c.status === "draft");

  const s = m.survey;
  // Fase 2 · punt 4: de telling per persoon (bezoekers, klikkers, aanmelders, betalers, toezeggers, bookers).
  const perPerson = exp.type === "landing" || exp.type === "pricing" ? await loadActionCounts(expId) : { counts: EMPTY_COUNTS, available: false };
  if (exp.type !== "interview") {
    // One system observation summarises the measured behaviour (or, for a survey, the self-reported answers);
    // raw events stay untouched. Generating the card again reuses it, so the evidence for the assumption is
    // never counted twice. A survey answer is never behaviour (KIND_DEFAULTS.survey_answer).
    // Fase 2 · punt 4: de waarneming zegt expliciet welk soort bewijs het is (Waargenomen handeling, Geverifieerde
    // betaling of toezegging) en hoeveel personen er per stap zijn geteld. Een betaling telt alleen live en betaald.
    const metric = asSuccessMetric((h as { success_metric?: string | null }).success_metric);
    const collectEmail = !!(exp.config as LandingConfig).collect_email;
    const { kind, evidenceType } = systemObservationKind(exp.type, metric, collectEmail);
    const dims = KIND_DEFAULTS[kind];
    const interval = `${pct(v.interval.point)}, 95%-interval ${pct(v.interval.low)}–${pct(v.interval.high)}`;
    const { data: existing } = await supabase.from("observations").select("id").eq("experiment_id", expId).eq("origin", "system").maybeSingle();
    const observation = {
      idea_id: ideaId,
      experiment_id: expId,
      kind,
      summary: (s
        ? `Enquête (zelfrapportage, geen waargenomen gedrag): ${m.successes} van ${m.n} respondenten: ${h.metric_numerator} (${interval}); uitgenodigd ${s.invitation.successes}/${s.invitation.n}, open link ${s.openLink.successes}/${s.openLink.n}.`
        : perPerson.available
          ? systemObservationSummary({ type: exp.type, metric, counts: perPerson.counts, successes: m.successes, n: m.n, metricLabel: h.metric_label, interval })
          : `${m.successes} van ${m.n} unieke relevante bezoekers: ${h.metric_label.toLowerCase()} (${interval}).`
      ).slice(0, 400),
      is_fact: dims.isFact,
      is_behaviour: dims.isBehaviour,
      is_real_context: dims.isRealContext,
      is_costly: dims.isCostly,
      origin: "system",
    };
    let obs: { id: string } | null = existing;
    if (!existing) {
      // Zonder de migratie bestaat evidence_type nog niet: dan zonder (zelfde waarneming, zonder het label).
      const row: ObservationInsert = { ...observation, ...(evidenceType && perPerson.available ? { evidence_type: evidenceType } : {}) };
      const first = await supabase.from("observations").insert(row).select("id").single();
      obs = first.data ?? (schemaMissing(first.error) ? (await supabase.from("observations").insert(observation).select("id").single()).data : null);
    }
    if (obs && !existing && verdictKind !== "inconclusive") {
      await supabase.from("assumption_observations").insert({ assumption_id: h.assumption_id, observation_id: obs.id, idea_id: ideaId, relation: verdictKind === "pass" ? "supports" : "contradicts" });
    }
  }

  // Fase B5: "Daaruit leren we" en "Daarom gaan we" als voorstel: met AI als die verbonden is, anders (of als de AI
  // faalt of de berekende uitspraak tegenspreekt) regelgebaseerd uit de uitkomst en de drempels.
  const { data: primaryOf } = await supabase.from("assumptions").select("primary_experiment_id").eq("id", h.assumption_id).maybeSingle();
  const learningInput: LearningInput = {
    assumption: h.assumptions?.statement ?? h.we_believe,
    verdict: verdictKind,
    rule: v.rule,
    n: m.n,
    successes: m.successes,
    minSample: h.min_sample,
    successThresholdPct: Number(h.success_threshold_pct),
    failThresholdPct: h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct),
    successCount: v.successCount ?? null,
    probability: v.probability ?? null,
    belowSample,
    endReason: exp.end_reason ?? null,
    isPrimary: primaryOf?.primary_experiment_id === expId,
    metricNumerator: h.metric_numerator,
    followUp: follow,
  };
  let proposal = ruleBasedLearning(learningInput);
  if (aiConfigured()) {
    try {
      const ai = await runAi(ideaId, "learning_card", (provider) => proposeLearning(learningInput, provider));
      proposal = acceptAiLearning(ai.data, learningInput);
    } catch {
      // Terugval: de regelgebaseerde tekst. De mislukte AI-stap staat in het AI-logboek (runAi).
    }
  }

  const card = {
    we_believed:
      h.decision_rule === "absolute"
        ? `${h.we_believe} Het klopt als minstens ${h.success_count} van minimaal ${h.min_sample} deelnemers dit doen (${h.metric_numerator}).`
        : `${h.we_believe} Het klopt als ${h.success_threshold_pct}% of meer (${h.metric_numerator} / ${h.metric_denominator}), bij minimaal ${h.min_sample} deelnemers.`,
    we_observed: `${m.successes} van ${m.n} (${pct(v.interval.point)}; 95%-interval ${pct(v.interval.low)} tot ${pct(v.interval.high)}).${
      s ? ` Zelfrapportage, geen waargenomen gedrag. Uitgenodigde respondenten: ${s.invitation.successes} van ${s.invitation.n}; open link: ${s.openLink.successes} van ${s.openLink.n}.` : ""
    }${m.warnings.length ? ` Let op: ${m.warnings.join(" ")}` : ""}`,
    we_learned: proposal.we_learned,
    therefore: proposal.therefore,
    verdict: verdictKind,
    data_reliability: reliability,
    metrics: {
      n: m.n,
      successes: m.successes,
      interval: v.interval,
      // Methodeversie, beslisregel en uitkomst zoals berekend; een goedgekeurde kaart verandert hierna nooit meer.
      method_version: await ideaMethodVersion(ideaId),
      decision_rule: v.rule,
      probability: v.probability,
      probability_fail: v.probabilityFail,
      success_count: v.successCount,
      strong_proof: v.strongProof,
      label: v.label,
      success_threshold_pct: Number(h.success_threshold_pct),
      fail_threshold_pct: h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct),
      required_n: h.required_n ?? null,
      // Bewijsniveau van wat deze test meet (golf A, punt 14): "Geslaagd · niveau: mening".
      evidence_level: testEvidenceLevel(exp.type, { decisionRule: h.decision_rule }),
      byChannel: m.byChannel,
      byVariant: m.byVariant,
      warnings: m.warnings,
      // Fase 2 · punt 4: wat als succes telde en de telling per persoon op het moment van analyseren.
      ...(perPerson.available ? { success_metric: asSuccessMetric((h as { success_metric?: string | null }).success_metric), per_person: perPerson.counts } : {}),
      ended_early: exp.ended_early,
      ended_below_sample: belowSample,
      end_reason: exp.end_reason ?? null,
      // B5: het voorstel zoals ProofLab het maakte; de metrics liggen vast, de tekstvelden past de consultant aan.
      proposal: { ...proposal, verdict_reason: v.reason },
      ...(s
        ? {
            self_reported: true,
            by_source: {
              invitation: { n: s.invitation.n, successes: s.invitation.successes },
              open_link: { n: s.openLink.n, successes: s.openLink.successes },
            },
            too_fast: s.all.tooFast,
            screened_out: s.all.screenedOut,
            failed_attention: s.all.failedAttention,
            straightlining: s.all.straightlining,
          }
        : {}),
    } as unknown as Json,
  };
  // One concept card per experiment. Measured numbers on a card cannot be edited (database guard), so
  // generating again replaces the concept with a fresh one computed from the raw data.
  if (draft) await supabase.from("learning_cards").delete().eq("id", draft.id).eq("status", "draft");
  const { error } = await supabase.from("learning_cards").insert({ ...card, experiment_id: expId, idea_id: ideaId, version: 1 });
  if (error) return { error: "De Learning Card kon niet worden gemaakt." };
  refresh(ideaId);
  redirect(`/app/ideas/${ideaId}/evidence`);
}

// ---------------------------------------------------------------------------
// Review of AI-coded observations (research 7.4): accept or reject, once
// ---------------------------------------------------------------------------

export async function reviewObservation(ideaId: string, observationId: string, status: "accepted" | "rejected") {
  await requireWritableIdea(ideaId);
  if (status !== "accepted" && status !== "rejected") return;
  const supabase = await supabaseServer();
  // The database stamps reviewer and time and forbids any other change to the observation.
  const { data } = await supabase
    .from("observations")
    .update({ review_status: status })
    .eq("id", observationId)
    .eq("idea_id", ideaId)
    .eq("origin", "ai")
    .is("review_status", null)
    .select("id");
  // A rejected AI coding no longer counts for or against the assumption; the observation itself stays on record.
  if (status === "rejected" && data?.length) {
    await supabase.from("assumption_observations").delete().eq("observation_id", observationId).eq("idea_id", ideaId);
  }
  refresh(ideaId);
}

// ---------------------------------------------------------------------------
// AI copy variants for landing and pricing tests (research 7.6), proposals only
// ---------------------------------------------------------------------------

export type VariantsResult = { error: string | null; variants: PreparedVariant[]; draftNotes: string[]; draftWarnings: string[] };

const VariantInput = z.object({
  assumption_id: z.string().uuid(),
  type: z.enum(["landing", "pricing"]),
  headline: text(200),
  subline: text(400),
  offer: text(800),
});

export async function proposeCopyVariants(ideaId: string, input: z.input<typeof VariantInput>): Promise<VariantsResult> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = VariantInput.safeParse(input);
  if (!p.success) return { error: "Kies eerst een aanname en het testtype.", variants: [], draftNotes: [], draftWarnings: [] };
  const draftWarnings = honestyWarnings(p.data.headline, p.data.subline, p.data.offer);
  if (!aiConfigured()) return { error: "AI is niet verbonden. Schrijf de varianten zelf; de eerlijkheidscontrole hieronder werkt wel.", variants: [], draftNotes: [], draftWarnings };
  const supabase = await supabaseServer();
  const { data: a } = await supabase.from("assumptions").select("statement").eq("id", p.data.assumption_id).eq("idea_id", ideaId).single();
  if (!a) return { error: "Aanname niet gevonden.", variants: [], draftNotes: [], draftWarnings };
  try {
    const res = await runAi(ideaId, "copy_variants", (provider) => suggestCopyVariants(ideaContext(idea), { assumption: a.statement, ...p.data }, provider));
    return {
      error: null,
      variants: prepareVariants(res.data.variants),
      draftNotes: res.data.draft_honesty_notes.map((n) => n.slice(0, 300)).slice(0, 5),
      draftWarnings,
    };
  } catch (e) {
    return { error: aiErrorMessage(e, "Er konden geen varianten worden voorgesteld. Schrijf ze zelf."), variants: [], draftNotes: [], draftWarnings };
  }
}

// ---------------------------------------------------------------------------
// Surveys: the AI coach's first draft and open answers as customer signals
// ---------------------------------------------------------------------------

export type SurveyDraftState = { error: string | null; draft: DraftResult | null; draftId?: string | null };

const DraftInput = z.object({ assumption_id: z.string().uuid(), target_group: text(300).optional() });

// "Laat de coach een eerste opzet maken". Without AI (not connected or budget reached) the template is used,
// and the result says so. The draft is a proposal in the editor; nothing is stored until the consultant saves.
export async function draftSurveyWithCoach(ideaId: string, input: z.input<typeof DraftInput>): Promise<SurveyDraftState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = DraftInput.safeParse(input);
  if (!p.success) return { error: "Kies eerst de aanname die je toetst.", draft: null };
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const { data: a } = await supabase.from("assumptions").select("statement").eq("id", p.data.assumption_id).eq("idea_id", ideaId).single();
  if (!a) return { error: "Aanname niet gevonden.", draft: null };
  const audience = p.data.target_group?.trim() || [idea.target_audience, idea.audience_detail].filter(Boolean).join(", ");
  // De opzet zelf (AI of sjabloon) komt uit lib/survey-coach.ts, gedeeld met het klantonderzoek op Markt.
  const res = await coachSurveyDraft(idea, { subject: a.statement, audience, researcher: ws.org?.name ?? "de onderzoeker" });
  return { error: null, draft: res.draft, draftId: res.draftId };
}

// One source of type "survey" with one excerpt per non-empty open answer (deduplicated, also against what
// is already stored), so the customer-signals analysis picks them up. Signals, never behaviour.
export async function importSurveyOpenAnswers(ideaId: string, expId: string, _: ActionState): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("type, title, config").eq("id", expId).eq("idea_id", ideaId).single();
  const config = exp?.type === "survey" ? surveyConfigOf(exp.config) : null;
  if (!exp || !config) return { error: "Enquête niet gevonden." };
  const { rows, error } = await loadSurveyResponses(expId);
  if (error) return { error: "De antwoorden konden niet worden opgehaald." };
  const answers = openAnswers(config, rows);
  if (answers.length === 0) return { error: "Er zijn nog geen open antwoorden." };
  const { data: existingRows } = await supabase.from("source_excerpts").select("text").eq("idea_id", ideaId).order("created_at", { ascending: false }).limit(5000);
  const result = dedupeFragments(
    answers.map((x) => x.text),
    { existing: (existingRows ?? []).map((e) => e.text) },
  );
  if (result.fragments.length === 0) return { error: "Alle open antwoorden staan al als klantsignaal in de bronnen." };
  const invited = answers.filter((x) => x.source === "invitation").length;
  const date = new Date().toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric" });
  const { data: source, error: sErr } = await supabase
    .from("sources")
    .insert({
      idea_id: ideaId,
      url: null,
      domain: null,
      title: `Enquête – ${exp.title} – open antwoorden – ${date}`.slice(0, 300),
      publisher: config.researcher.slice(0, 200),
      published_on: new Date().toISOString().slice(0, 10),
      source_type: "survey",
      is_primary: false,
      access_note:
        `Open antwoorden uit een ProofLab-enquête (${invited} van ${answers.length} via persoonlijke uitnodiging, de rest via een open link zonder controleerbare herkomst). Zelfrapportage, geen waargenomen gedrag. Contactgegevens in antwoorden zijn verwijderd.`.slice(0, 600),
      origin: "manual",
      content_hash: contentHash(result.fragments.join("\n")),
    })
    .select("id")
    .single();
  if (sErr || !source) return { error: "De bron kon niet worden opgeslagen." };
  const byText = new Map(answers.map((x) => [x.text, x]));
  for (let i = 0; i < result.fragments.length; i += 500) {
    const { error: e } = await supabase.from("source_excerpts").insert(
      result.fragments.slice(i, i + 500).map((t, j) => {
        const a = byText.get(t);
        return {
          source_id: source.id,
          idea_id: ideaId,
          text: t,
          location: a ? `vraag ${a.question}, respondent ${a.respondent} (${a.source === "invitation" ? "uitnodiging" : "open link"})` : `antwoord ${i + j + 1}`,
        };
      }),
    );
    if (e) {
      // No half imports: a source without all its answers would be misleading.
      await supabase.from("sources").delete().eq("id", source.id);
      return { error: "De antwoorden konden niet worden opgeslagen. Er is niets opgenomen." };
    }
  }
  refresh(ideaId);
  const n = result.fragments.length;
  return {
    error: null,
    ok: `${n} open ${n === 1 ? "antwoord" : "antwoorden"} opgenomen als klantsignaal (bron van het type enquête)${result.duplicates ? `; ${result.duplicates} dubbele overgeslagen` : ""}. Analyseer ze bij Marktverkenning, onder klantsignalen.`,
  };
}
