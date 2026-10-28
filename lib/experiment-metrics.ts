import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { verdict, type Verdict } from "@/lib/domain/stats";

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
  warnings: string[];
};

type Exp = {
  id: string;
  type: string;
  state: string;
  config: unknown;
  ends_at: string | null;
  started_at: string | null;
};
type Hyp = { success_threshold_pct: number; fail_threshold_pct: number | null; min_sample: number; metric_label: string };

// Computes the pre-registered metric from raw, deduplicated events (or coded interviews).
export async function experimentMetrics(exp: Exp, h: Hyp): Promise<ExperimentMetrics> {
  const supabase = await supabaseServer();
  const warnings: string[] = [];
  let n = 0;
  let successes = 0;
  let byChannel: ChannelRow[] = [];
  let byVariant: VariantRow[] = [];

  if (exp.type === "interview") {
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
    const { data: events } = await supabase.from("test_events").select("visitor_hash, event_type, variant, channel").eq("experiment_id", exp.id);
    const actionEvent = exp.type === "landing" && (exp.config as LandingConfig).collect_email ? "submit" : "cta_click";
    const viewers = new Map<string, { channel: string; variant: string }>();
    const actors = new Set<string>();
    for (const e of events ?? []) {
      if (e.event_type === "view" && !viewers.has(e.visitor_hash)) viewers.set(e.visitor_hash, { channel: e.channel, variant: e.variant });
      if (e.event_type === actionEvent || (actionEvent === "submit" && e.event_type === "submit")) actors.add(e.visitor_hash);
    }
    // Only actions by visitors who were also counted as viewers enter the ratio.
    n = viewers.size;
    successes = [...actors].filter((v) => viewers.has(v)).length;
    const ch = new Map<string, ChannelRow>();
    const va = new Map<string, VariantRow>();
    const prices = exp.type === "pricing" ? (exp.config as PricingConfig).price_points : [];
    for (const [hash, v] of viewers) {
      const c = ch.get(v.channel) ?? { channel: v.channel, visitors: 0, actions: 0 };
      c.visitors++;
      if (actors.has(hash)) c.actions++;
      ch.set(v.channel, c);
      const idx = Number(v.variant);
      const label = prices[idx] ? `${prices[idx].label} (€ ${prices[idx].amount.toLocaleString("nl-NL")} ${prices[idx].period})` : `Variant ${v.variant}`;
      const r = va.get(v.variant) ?? { variant: v.variant, label, visitors: 0, actions: 0 };
      r.visitors++;
      if (actors.has(hash)) r.actions++;
      va.set(v.variant, r);
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
  return { n, successes, label: h.metric_label, byChannel, byVariant, endConditionReached, verdict: v, warnings };
}
