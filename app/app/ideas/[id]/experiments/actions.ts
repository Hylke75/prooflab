"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, requireWritableIdea } from "@/lib/data";
import { checkHypothesis } from "@/lib/domain/hypothesis";
import { checkQuote } from "@/lib/domain/verify";
import { KIND_DEFAULTS } from "@/lib/domain/evidence";
import { CHANNELS } from "@/lib/domain/tracking";
import { experimentMetrics, type LandingConfig, type PricingConfig } from "@/lib/experiment-metrics";
import { pct } from "@/lib/domain/stats";
import { recommend } from "@/lib/domain/recommend";
import { aiConfigured } from "@/lib/env";
import { analyzeInterview } from "@/lib/ai/research";
import { aiErrorMessage, runAi } from "@/lib/ai/guard";
import type { Json } from "@/lib/database.types";
import type { AssumptionCategory, ObservationKind } from "@/lib/domain/labels";

export type ActionState = { error: string | null; ok?: string | null };

const refresh = (id: string) => revalidatePath(`/app/ideas/${id}`, "layout");

const text = (max: number) => z.string().trim().max(max);

const Base = z.object({
  assumption_id: z.string().uuid("Kies de aanname die je toetst."),
  type: z.enum(["landing", "interview", "pricing"]),
  title: text(140).min(3, "Geef het experiment een naam."),
  we_believe: text(600),
  target_group: text(300),
  test_method: text(300).min(3, "Beschrijf hoe je toetst."),
  metric_label: text(200).min(3, "Beschrijf wat je meet."),
  metric_numerator: text(200),
  metric_denominator: text(200),
  success_threshold_pct: z.coerce.number(),
  fail_threshold_pct: z.coerce.number().optional(),
  min_sample: z.coerce.number().int(),
  max_duration_days: z.coerce.number().int(),
  expected_biases: text(600).optional(),
  expected_reach: z.coerce.number().int().min(0).optional(),
  cost_estimate_eur: z.coerce.number().min(0).optional(),
});

export async function createExperiment(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const ws = await getWorkspace();
  const raw = Object.fromEntries(form);
  const p = Base.safeParse(raw);
  if (!p.success) return { error: p.error.issues[0].message };
  const v = p.data;
  const coach = checkHypothesis({
    we_believe: v.we_believe,
    target_group: v.target_group,
    metric_numerator: v.metric_numerator,
    metric_denominator: v.metric_denominator,
    success_threshold_pct: v.success_threshold_pct,
    fail_threshold_pct: v.fail_threshold_pct ?? null,
    min_sample: v.min_sample,
    max_duration_days: v.max_duration_days,
  });
  if (!coach.ok) return { error: coach.issues[0].message };

  const channels = form.getAll("channels").map(String).filter((c) => c in CHANNELS);
  if (channels.length === 0) return { error: "Kies minstens één wervingskanaal. Zonder werving zegt een test niets." };

  let config: Json;
  if (v.type === "interview") {
    const guide = String(raw.guide ?? "").split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 15);
    if (guide.length < 3) return { error: "Een gespreksleidraad heeft minstens drie vragen." };
    config = { guide, screener: String(raw.screener ?? "").trim().slice(0, 600), target_n: v.min_sample };
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
    if (landing.headline.length < 5) return { error: "Schrijf een kop voor de testpagina." };
    if (v.type === "pricing") {
      const points: PricingConfig["price_points"] = [];
      for (let i = 0; i < 3; i++) {
        const label = String(raw[`price_label_${i}`] ?? "").trim();
        const amount = Number(String(raw[`price_amount_${i}`] ?? "").replace(",", "."));
        const period = String(raw[`price_period_${i}`] ?? "").trim() || "eenmalig";
        if (label && Number.isFinite(amount) && amount > 0) points.push({ label: label.slice(0, 60), amount, period: period.slice(0, 30) });
      }
      if (points.length === 0) return { error: "Voeg minstens één prijspunt toe." };
      config = { ...landing, price_points: points } satisfies PricingConfig;
    } else {
      config = landing;
    }
  }

  const supabase = await supabaseServer();
  const { data: h, error: hErr } = await supabase
    .from("hypotheses")
    .insert({
      idea_id: ideaId,
      assumption_id: v.assumption_id,
      we_believe: v.we_believe,
      target_group: v.target_group,
      test_method: v.test_method,
      metric_label: v.metric_label,
      metric_numerator: v.metric_numerator,
      metric_denominator: v.metric_denominator,
      success_threshold_pct: v.success_threshold_pct,
      fail_threshold_pct: v.fail_threshold_pct ?? null,
      min_sample: v.min_sample,
      max_duration_days: v.max_duration_days,
      expected_biases: v.expected_biases || null,
    })
    .select("id")
    .single();
  if (hErr || !h) return { error: "De hypothese kon niet worden opgeslagen." };
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
    })
    .select("id")
    .single();
  if (error || !exp) return { error: "Het experiment kon niet worden opgeslagen." };
  await supabase.from("assumptions").update({ status: "testing" }).eq("id", v.assumption_id).eq("status", "untested");
  refresh(ideaId);
  redirect(`/app/ideas/${ideaId}/experiments/${exp.id}`);
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
  const { data: exp } = await supabase.from("experiments").select("state, type").eq("id", expId).eq("idea_id", ideaId).single();
  if (!exp || !TRANSITIONS[exp.state]?.includes(to)) return { error: "Deze stap is nu niet mogelijk." };
  if (to === "approved") {
    // Explicit human approval with the checks that protect participants and the test itself.
    const required = exp.type === "interview" ? ["check_consent", "check_neutral"] : ["check_reveal", "check_privacy", "check_budget"];
    if (required.some((k) => form.get(k) !== "on")) return { error: "Bevestig alle controlepunten voordat je goedkeurt." };
  }
  const { error } = await supabase.from("experiments").update({ state: to }).eq("id", expId).eq("idea_id", ideaId);
  if (error) return { error: error.message.includes("EXPERIMENT") ? error.message.replace(/^.*?: /, "") : "De status kon niet worden gewijzigd." };
  refresh(ideaId);
  const msg: Record<string, string> = {
    ready_for_review: "Klaar voor review. Controleer de Test Card en keur goed.",
    approved: "Goedgekeurd. De hypothese en drempels zijn nu vergrendeld.",
    live: "De test is live. Metingen lopen; een uitspraak volgt na de eindconditie.",
    paused: "Gepauzeerd. Bezoeken worden nu niet geteld.",
    ended: "Afgerond. Maak nu de Learning Card.",
    draft: "Terug naar concept.",
  };
  return { error: null, ok: msg[to] ?? "Bijgewerkt." };
}

export async function deleteDraft(ideaId: string, expId: string) {
  await requireWritableIdea(ideaId);
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, hypothesis_id").eq("id", expId).eq("idea_id", ideaId).single();
  if (!exp || !["draft", "ready_for_review"].includes(exp.state)) return;
  await supabase.from("experiments").delete().eq("id", expId);
  await supabase.from("hypotheses").delete().eq("id", exp.hypothesis_id).is("locked_at", null);
  refresh(ideaId);
  redirect(`/app/ideas/${ideaId}/experiments`);
}

// ---------------------------------------------------------------------------
// Interviews
// ---------------------------------------------------------------------------

const InterviewSchema = z.object({
  participant_label: text(80).min(2, "Gebruik een pseudoniem, bijv. 'Eventmanager A'."),
  dmu_role: z.enum(["user", "buyer", "decider", "influencer", "other"]),
  segment: text(160).optional(),
  recruited_via: z.enum(Object.keys(CHANNELS) as [string, ...string[]]),
  held_on: z.string().date("Vul de datum van het gesprek in."),
  record_type: z.enum(["transcript", "notes"]),
  transcript: text(60000).min(50, "Plak het transcript of je notities (minimaal 50 tekens)."),
});

export async function addInterview(ideaId: string, expId: string, _: ActionState, form: FormData): Promise<ActionState> {
  await requireWritableIdea(ideaId);
  const p = InterviewSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (form.get("consent_recorded") !== "on") return { error: "Zonder vastgelegde toestemming mag het gesprek niet worden verwerkt." };
  if (/@|\b\d{9,}\b|\b06[\s-]?\d{8}\b/.test(p.data.participant_label)) return { error: "Gebruik een pseudoniem, geen e-mailadres of telefoonnummer." };
  const supabase = await supabaseServer();
  const { data: exp } = await supabase.from("experiments").select("state, type").eq("id", expId).eq("idea_id", ideaId).single();
  if (!exp || exp.type !== "interview" || !["live", "paused"].includes(exp.state)) return { error: "Interviews voeg je toe terwijl het experiment loopt." };
  const { error } = await supabase.from("interviews").insert({
    ...p.data,
    segment: p.data.segment || null,
    experiment_id: expId,
    idea_id: ideaId,
    is_acquaintance: form.get("is_acquaintance") === "on",
    consent_recorded: true,
  });
  if (error) return { error: "Opslaan mislukt." };
  refresh(ideaId);
  return { error: null, ok: "Interview opgeslagen. Codeer nu de uitspraken." };
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
    supabase.from("interviews").select("transcript").eq("id", interviewId).eq("idea_id", ideaId).single(),
    supabase.from("experiments").select("hypotheses(we_believe)").eq("id", expId).single(),
  ]);
  if (!iv) return { error: "Interview niet gevonden." };
  try {
    const res = await runAi(ideaId, "interview_analysis", () => analyzeInterview(exp?.hypotheses?.we_believe ?? "", iv.transcript));
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
    return {
      error: null,
      ok: `${kept} observaties met letterlijk citaat vastgelegd${known ? `; ${known} waren al vastgelegd` : ""}${rejected ? `; ${rejected} afgewezen omdat het citaat niet in het transcript stond` : ""}. Controleer ze.`,
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
  const h = exp.hypotheses;
  const m = await experimentMetrics(exp, h);
  const v = m.verdict;
  const verdictKind = v.kind === "running" ? "inconclusive" : v.kind;
  const channels = m.byChannel.length;
  const reliability = m.n >= h.min_sample && channels >= 2 && !exp.ended_early ? "high" : m.n >= h.min_sample ? "medium" : "low";
  const rec = recommend({ category: (h.assumptions?.category ?? "desirability") as AssumptionCategory, evidence: 0.3, hasDiscoveryEvidence: true });
  const follow = rec.options.find((o) => o.type === exp.type)?.followUp ?? "";

  const { data: cards } = await supabase.from("learning_cards").select("id, status").eq("experiment_id", expId);
  if ((cards ?? []).some((c) => c.status === "approved")) return { error: "Dit experiment heeft al een goedgekeurde Learning Card." };
  const draft = (cards ?? []).find((c) => c.status === "draft");

  if (exp.type !== "interview") {
    // One system observation summarises the measured behaviour; raw events stay untouched. Generating
    // the card again reuses it, so the evidence for the assumption is never counted twice.
    const kind: ObservationKind = exp.type === "pricing" ? "quote_request" : (exp.config as LandingConfig).collect_email ? "demo_request" : "waitlist_signup";
    const dims = KIND_DEFAULTS[kind];
    const { data: existing } = await supabase.from("observations").select("id").eq("experiment_id", expId).eq("origin", "system").maybeSingle();
    const { data: obs } = existing
      ? { data: existing }
      : await supabase
      .from("observations")
      .insert({
        idea_id: ideaId,
        experiment_id: expId,
        kind,
        summary: `${m.successes} van ${m.n} unieke relevante bezoekers: ${h.metric_label.toLowerCase()} (${pct(v.interval.point)}, 95%-interval ${pct(v.interval.low)}–${pct(v.interval.high)}).`,
        is_fact: dims.isFact,
        is_behaviour: dims.isBehaviour,
        is_real_context: dims.isRealContext,
        is_costly: dims.isCostly,
        origin: "system",
      })
      .select("id")
      .single();
    if (obs && !existing && verdictKind !== "inconclusive") {
      await supabase.from("assumption_observations").insert({ assumption_id: h.assumption_id, observation_id: obs.id, idea_id: ideaId, relation: verdictKind === "pass" ? "supports" : "contradicts" });
    }
  }

  const card = {
    we_believed: `${h.we_believe} Het klopt als ${h.success_threshold_pct}% of meer (${h.metric_numerator} / ${h.metric_denominator}), bij minimaal ${h.min_sample} deelnemers.`,
    we_observed: `${m.successes} van ${m.n} (${pct(v.interval.point)}; 95%-interval ${pct(v.interval.low)} tot ${pct(v.interval.high)}).${m.warnings.length ? ` Let op: ${m.warnings.join(" ")}` : ""}`,
    we_learned: v.reason,
    therefore: follow,
    verdict: verdictKind,
    data_reliability: reliability,
    metrics: { n: m.n, successes: m.successes, interval: v.interval, byChannel: m.byChannel, byVariant: m.byVariant, warnings: m.warnings, ended_early: exp.ended_early } as unknown as Json,
  };
  // One concept card per experiment. Measured numbers on a card cannot be edited (database guard), so
  // generating again replaces the concept with a fresh one computed from the raw data.
  if (draft) await supabase.from("learning_cards").delete().eq("id", draft.id).eq("status", "draft");
  const { error } = await supabase.from("learning_cards").insert({ ...card, experiment_id: expId, idea_id: ideaId, version: 1 });
  if (error) return { error: "De Learning Card kon niet worden gemaakt." };
  refresh(ideaId);
  redirect(`/app/ideas/${ideaId}/evidence`);
}
