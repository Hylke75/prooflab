import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { betaBinomial, empiricalPrior, FLAT_PRIOR, verdict, type BayesEstimate, type BetaPrior, type Verdict } from "@/lib/domain/stats";
import { SurveyConfigSchema, type Answers, type SurveyConfig } from "@/lib/domain/survey";
import { surveySplit, type ExportRow, type SurveySplit } from "@/lib/domain/survey-results";

export type LandingConfig = {
  headline: string;
  subline: string;
  offer: string;
  cta_label: string;
  collect_email: boolean;
  reveal_message: string;
  product_name: string;
  researcher: string;
};

export type PricingConfig = LandingConfig & {
  price_points: { label: string; amount: number; period: string }[];
};

export type InterviewConfig = {
  guide: string[];
  screener: string;
  target_n: number;
};

export type ChannelRow = { channel: string; visitors: number; actions: number };
export type VariantRow = { variant: string; label: string; visitors: number; actions: number };

export type ExperimentMetrics = {
  n: number;
  successes: number;
  label: string;
  byChannel: ChannelRow[];
  byVariant: VariantRow[];
  endConditionReached: boolean;
  verdict: Verdict;
  // Bayesian estimate with a prior from earlier tests (research 3.6). Null until the end condition
  // is reached: no peeking, same as the verdict.
  bayes: BayesEstimate | null;
  warnings: string[];
  // Surveys only: the key metric per source (invitation vs open link) and channel. Self-reported answers.
  survey: SurveySplit | null;
};

// The stored survey config, or null when it does not (or no longer) match the schema.
export function surveyConfigOf(config: unknown): SurveyConfig | null {
  const r = SurveyConfigSchema.safeParse(config);
  return r.success ? r.data : null;
}

const RESPONSE_PAGE = 1000;
const MAX_RESPONSES = 20000;

// All responses of one survey, oldest first (paged: a single select is capped by the API).
export async function loadSurveyResponses(expId: string): Promise<{ rows: ExportRow[]; error: boolean }> {
  const supabase = await supabaseServer();
  const rows: ExportRow[] = [];
  for (let from = 0; from < MAX_RESPONSES; from += RESPONSE_PAGE) {
    const { data, error } = await supabase
      .from("survey_responses")
      .select("id, answers, source, channel, duration_ms, created_at")
      .eq("experiment_id", expId)
      .order("created_at")
      .order("id")
      .range(from, from + RESPONSE_PAGE - 1);
    if (error) return { rows, error: true };
    for (const r of data ?? []) {
      rows.push({
        answers: (r.answers && typeof r.answers === "object" && !Array.isArray(r.answers) ? r.answers : {}) as Answers,
        source: r.source === "invitation" ? "invitation" : "open_link",
        channel: r.channel,
        duration_ms: r.duration_ms,
        created_at: r.created_at,
      });
    }
    if ((data ?? []).length < RESPONSE_PAGE) break;
  }
  return { rows, error: false };
}

type Exp = {
  id: string;
  type: string;
  state: string;
  config: unknown;
  ends_at: string | null;
  started_at: string | null;
  idea_id?: string;
  ended_at?: string | null;
};

// Earlier ended tests of the same type in the same organisation, as far as this user can see them
// (row level security): the measured n and successes on their approved Learning Cards.
async function earlierTests(exp: Exp): Promise<{ n: number; successes: number }[]> {
  if (!exp.idea_id) return [];
  const supabase = await supabaseServer();
  const { data: idea } = await supabase.from("ideas").select("org_id").eq("id", exp.idea_id).maybeSingle();
  if (!idea?.org_id) return [];
  const before = exp.ended_at ?? new Date().toISOString();
  const { data } = await supabase
    .from("learning_cards")
    .select("metrics, experiments!inner(id, type, state, ended_at, ideas!inner(org_id))")
    .eq("status", "approved")
    .eq("experiments.type", exp.type)
    .eq("experiments.ideas.org_id", idea.org_id)
    .in("experiments.state", ["ended", "analyzed", "decided"])
    .lt("experiments.ended_at", before)
    .neq("experiment_id", exp.id)
    .limit(500);
  return (data ?? [])
    .map((c) => {
      const m = c.metrics as { n?: unknown; successes?: unknown } | null;
      return { n: Number(m?.n), successes: Number(m?.successes) };
    })
    .filter((t) => Number.isInteger(t.n) && Number.isInteger(t.successes) && t.n > 0);
}

export async function priorFor(exp: Exp): Promise<BetaPrior> {
  try {
    return empiricalPrior(await earlierTests(exp));
  } catch {
    return FLAT_PRIOR;
  }
}
type Hyp = { success_threshold_pct: number; fail_threshold_pct: number | null; min_sample: number; metric_label: string };

// Computes the pre-registered metric from raw, deduplicated events (or coded interviews).
export async function experimentMetrics(exp: Exp, h: Hyp): Promise<ExperimentMetrics> {
  const supabase = await supabaseServer();
  const warnings: string[] = [];
  let n = 0;
  let successes = 0;
  let byChannel: ChannelRow[] = [];
  let byVariant: VariantRow[] = [];
  let survey: SurveySplit | null = null;

  if (exp.type === "survey") {
    // The verdict uses every believable response (all sources), as pre-registered; the split per source shows
    // how much of it comes from known, invited people.
    const config = surveyConfigOf(exp.config);
    const { rows, error } = await loadSurveyResponses(exp.id);
    if (error) warnings.push("De antwoorden konden niet worden opgehaald; de cijfers hieronder zijn onvolledig.");
    if (!config) {
      warnings.push("De opzet van deze enquête is ongeldig; er kan geen kernvraag worden geteld.");
    } else {
      survey = surveySplit(config, rows, h.min_sample);
      n = survey.all.n;
      successes = survey.all.successes;
      byChannel = survey.byChannel.map((c) => ({ channel: c.channel, visitors: c.n, actions: c.successes }));
      warnings.push(...survey.warnings);
    }
  } else if (exp.type === "interview") {
    const [{ data: interviews }, { data: obs }] = await Promise.all([
      supabase.from("interviews").select("id, consent_recorded, is_acquaintance, dmu_role, recruited_via").eq("experiment_id", exp.id),
      supabase.from("observations").select("interview_id, kind").eq("experiment_id", exp.id).eq("is_synthetic", false),
    ]);
    const valid = (interviews ?? []).filter((i) => i.consent_recorded);
    n = valid.length;
    successes = valid.filter((i) => (obs ?? []).some((o) => o.interview_id === i.id && o.kind === "problem_confirmed")).length;
    const channels = new Map<string, ChannelRow>();
    for (const i of valid) {
      const row = channels.get(i.recruited_via) ?? { channel: i.recruited_via, visitors: 0, actions: 0 };
      row.visitors++;
      if ((obs ?? []).some((o) => o.interview_id === i.id && o.kind === "problem_confirmed")) row.actions++;
      channels.set(i.recruited_via, row);
    }
    byChannel = [...channels.values()];
    const excluded = (interviews ?? []).length - valid.length;
    if (excluded) warnings.push(`${excluded} interview(s) zonder vastgelegde toestemming tellen niet mee.`);
    if (valid.length && valid.filter((i) => i.is_acquaintance).length / valid.length > 0.5) warnings.push("Meer dan de helft van de geïnterviewden zijn bekenden.");
  } else {
    // Distinct visitors are counted in the database: a page of rows would silently cap large tests.
    const { data: rows, error } = await supabase.rpc("experiment_event_counts", { p_experiment: exp.id });
    if (error) warnings.push("De meetgegevens konden niet worden opgehaald; de cijfers hieronder zijn onvolledig.");
    const useSubmit = exp.type === "landing" && (exp.config as LandingConfig).collect_email;
    const ch = new Map<string, ChannelRow>();
    const va = new Map<string, VariantRow>();
    const prices = exp.type === "pricing" ? (exp.config as PricingConfig).price_points : [];
    for (const r of rows ?? []) {
      const viewers = Number(r.viewers);
      // Only actions by visitors who were also counted as viewers enter the ratio.
      const actions = Number(useSubmit ? r.submitters : r.clickers);
      n += viewers;
      successes += actions;
      const c = ch.get(r.channel) ?? { channel: r.channel, visitors: 0, actions: 0 };
      c.visitors += viewers;
      c.actions += actions;
      ch.set(r.channel, c);
      const idx = Number(r.variant);
      const label = prices[idx] ? `${prices[idx].label} (€ ${prices[idx].amount.toLocaleString("nl-NL")} ${prices[idx].period})` : `Variant ${r.variant}`;
      const v = va.get(r.variant) ?? { variant: r.variant, label, visitors: 0, actions: 0 };
      v.visitors += viewers;
      v.actions += actions;
      va.set(r.variant, v);
    }
    byChannel = [...ch.values()].sort((a, b) => b.visitors - a.visitors);
    byVariant = exp.type === "pricing" ? [...va.values()].sort((a, b) => a.variant.localeCompare(b.variant)) : [];
    if (byChannel.length === 1 && byChannel[0].channel === "network") warnings.push("Alle bezoekers komen uit het eigen netwerk; dat is warm verkeer.");
    if (byChannel.some((c) => c.channel === "direct") && n > 0 && (byChannel.find((c) => c.channel === "direct")!.visitors / n) > 0.5) {
      warnings.push("Meer dan de helft van de bezoekers heeft geen herkomst. Gebruik de kanaallinks zodat je weet wie er reageert.");
    }
  }

  const timeUp = exp.ends_at ? Date.now() >= new Date(exp.ends_at).getTime() : false;
  // No verdict while the test runs, however good early numbers look (no peeking): only after the
  // experiment has been ended or its pre-registered duration is over.
  const endConditionReached = ["ended", "analyzed", "decided"].includes(exp.state) || timeUp;
  if (n > 0 && n < h.min_sample) warnings.push(`Nog ${h.min_sample - n} deelnemers nodig voor de afgesproken steekproef.`);
  const v = verdict({
    successes,
    n,
    successThresholdPct: Number(h.success_threshold_pct),
    failThresholdPct: h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct),
    minSample: h.min_sample,
    endConditionReached,
  });
  const bayes = endConditionReached ? betaBinomial(await priorFor(exp), successes, n, Number(h.success_threshold_pct)) : null;
  return { n, successes, label: h.metric_label, byChannel, byVariant, endConditionReached, verdict: v, bayes, warnings, survey };
}
