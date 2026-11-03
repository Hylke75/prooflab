"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { getIdea, getUser, requireWritableIdea } from "@/lib/data";
import { loadProgress } from "@/lib/progress";
import { env, aiConfigured } from "@/lib/env";
import { runAi, aiErrorMessage } from "@/lib/ai/guard";
import { forecastOutcome } from "@/lib/ai/forecast";
import { proposeReference } from "@/lib/ai/reference";
import { PROPOSAL_REFERENCE_PREFIX } from "@/lib/domain/reference-proposal";
import { providersFor } from "@/lib/ai/settings";
import { PROVIDER_LABELS, providerOfModel } from "@/lib/ai/providers/config";
import { ensembleMean } from "@/lib/ai/providers/select";
import { dossierSummaryForAi, loadDossier } from "@/lib/dossier";
import { ideaContext } from "@/lib/idea-context";
import { todayInNL } from "@/lib/domain/sprint";
import { OutcomeDefinitionSchema, optionalAmount as number, outcomeValueProblem } from "@/lib/forecast-schemas";
import {
  FORECAST_MOMENTS,
  NO_REFERENCE,
  OWN_BASE_RATE_MIN,
  OWN_REFERENCE_PREFIX,
  PROBABILITY_MAX,
  PROBABILITY_MIN,
  followUp,
  measureWindowProblem,
  openMomentFor,
  pct,
} from "@/lib/domain/forecast";

export type ActionState = { error: string | null; ok?: string | null };
const refresh = (id: string) => {
  revalidatePath(`/app/ideas/${id}`, "layout");
  revalidatePath("/app");
  revalidatePath("/app/forecasts");
};

export async function saveOutcomeDefinition(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = OutcomeDefinitionSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const valueProblem = outcomeValueProblem(p.data);
  if (valueProblem) return { error: valueProblem };
  // De meetdatum ligt na de beslisdatum en binnen zes maanden daarna. Is het besluit al genomen, dan telt die
  // datum; anders de geplande beslisdatum, en zonder beslisdatum vandaag.
  const decisionDate = idea.outcome_clock_start ?? idea.decision_deadline ?? todayInNL();
  const windowProblem = p.data.outcome_measure_date ? measureWindowProblem(p.data.outcome_measure_date, decisionDate) : null;
  if (windowProblem) return { error: windowProblem };
  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("ideas")
    .update({
      outcome_statement: p.data.outcome_statement,
      outcome_metric: p.data.outcome_metric,
      outcome_target: p.data.outcome_target,
      outcome_min_value_per_customer: p.data.outcome_min_value_per_customer ?? null,
      outcome_revenue_target: p.data.outcome_revenue_target ?? null,
      outcome_measure_date: p.data.outcome_measure_date ?? null,
    })
    .eq("id", ideaId);
  if (error) {
    if (error.message.includes("OUTCOME_LOCKED")) return { error: "De uitkomstdefinitie ligt vast: er is al een voorspelling gegeven. Zo kan niemand achteraf het doel verschuiven." };
    return { error: "De uitkomstdefinitie kon niet worden opgeslagen." };
  }
  refresh(ideaId);
  return { error: null, ok: "Uitkomstdefinitie opgeslagen." };
}

// ---------------------------------------------------------------------------
// Base rate
// ---------------------------------------------------------------------------

const BaseRateSchema = z.object({
  reference: z.string().trim().min(1, "Kies een referentieklasse of 'geen goede referentie'."),
  base_rate_note: z.string().trim().max(600).optional(),
});

export async function saveBaseRate(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = BaseRateSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  const supabase = await supabaseServer();
  // The database locks the base rate too; this gives the reason up front (also for forecasts not yet visible).
  const { data: exists } = await supabase.rpc("forecasts_exist", { p_idea: ideaId });
  if (exists === true) return { error: "Het basispercentage ligt vast zodra er voorspellingen zijn: iedereen moet vanaf hetzelfde vertrekpunt hebben voorspeld." };
  const note = p.data.base_rate_note || null;
  let update: { reference_class: string; base_rate_low: number | null; base_rate_high: number | null; base_rate_note: string | null };
  if (p.data.reference === NO_REFERENCE) {
    if (!note || note.length < 10) return { error: "Leg kort uit waarom er geen goede referentie is (minstens één zin)." };
    update = { reference_class: NO_REFERENCE, base_rate_low: null, base_rate_high: null, base_rate_note: note };
  } else if (p.data.reference === "own") {
    const { data } = await supabase.rpc("own_base_rate", { p_org: idea.org_id, p_project_type: idea.project_type, p_min: OWN_BASE_RATE_MIN });
    const row = data?.[0];
    if (!row) return { error: `Er zijn nog geen ${OWN_BASE_RATE_MIN} afgeronde dossiers van dit projecttype. Kies een externe referentie.` };
    const rate = Number(row.achieved);
    const source = `Eigen basispercentage: ${pct(rate)} van ${Number(row.resolved)} afgeronde dossiers van dit projecttype haalde het doel (peildatum ${todayInNL()}).`;
    update = { reference_class: `${OWN_REFERENCE_PREFIX}${idea.project_type}`, base_rate_low: rate, base_rate_high: rate, base_rate_note: note ? `${source} ${note}`.slice(0, 600) : source };
  } else if (p.data.reference.startsWith(PROPOSAL_REFERENCE_PREFIX)) {
    // Een door AI voorgestelde referentie die ProofLab letterlijk op de bronpagina terugvond.
    const proposalId = p.data.reference.slice(PROPOSAL_REFERENCE_PREFIX.length);
    const { data: r } = /^[0-9a-f-]{36}$/i.test(proposalId)
      ? await supabase.from("reference_proposals").select("id, rate, label, source_url").eq("id", proposalId).eq("idea_id", ideaId).maybeSingle()
      : { data: null };
    if (!r) return { error: "Dit referentievoorstel bestaat niet (meer). Ververs de pagina." };
    const rate = Number(r.rate);
    const source = `${r.label}: ${pct(rate)} volgens ${r.source_url} (door AI voorgesteld, citaat door ProofLab letterlijk teruggevonden).`;
    update = { reference_class: `${PROPOSAL_REFERENCE_PREFIX}${r.id}`, base_rate_low: rate, base_rate_high: rate, base_rate_note: note ? `${source} ${note}`.slice(0, 600) : source.slice(0, 600) };
  } else {
    const { data: c } = await supabase.from("reference_classes").select("id, low, high").eq("id", p.data.reference).maybeSingle();
    if (!c) return { error: "Deze referentieklasse bestaat niet (meer). Ververs de pagina." };
    update = { reference_class: c.id, base_rate_low: Number(c.low), base_rate_high: Number(c.high), base_rate_note: note };
  }
  const { error } = await supabase.from("ideas").update(update).eq("id", ideaId);
  if (error) return { error: "Het basispercentage kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: "Basispercentage vastgelegd." };
}

// "Laat AI een referentie met bron voorstellen": het model zoekt, ProofLab haalt de pagina zelf op en bewaart een
// voorstel alleen als het citaat met het percentage er letterlijk op staat. Kiezen blijft een menselijke stap.
export async function proposeReferenceWithSource(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  if (!aiConfigured()) return { error: "AI is niet verbonden in deze omgeving. Kies een referentie met bron of 'geen goede referentie'." };
  if (!idea.outcome_statement) return { error: "Leg eerst vast wanneer dit idee geslaagd is; daar zoekt de referentie een vergelijking voor." };
  const supabase = await supabaseServer();
  const { data: exists } = await supabase.rpc("forecasts_exist", { p_idea: ideaId });
  if (exists === true) return { error: "Het basispercentage ligt vast zodra er voorspellingen zijn." };
  let result;
  try {
    result = await runAi(ideaId, "reference_proposal", (provider) =>
      proposeReference({ idea: ideaContext(idea), outcome: `${idea.outcome_statement} (gemeten uiterlijk zes maanden na het besluit)` }, provider),
    );
  } catch (e) {
    return { error: aiErrorMessage(e, "Het zoeken naar een referentie is niet gelukt. Probeer het later opnieuw.") };
  }
  let stored = 0;
  for (const r of result.accepted) {
    const { error } = await supabase.rpc("record_reference_proposal", {
      p_key: env.ingestSecret,
      p_idea: ideaId,
      p_label: r.label,
      p_rate: r.rate,
      p_url: r.url,
      p_title: r.title,
      p_quote: r.quote,
      p_passage: r.passage,
      p_model: result.model,
    });
    if (!error) stored++;
  }
  const dropped = result.rejected.length ? ` ${result.rejected.length} voorstel${result.rejected.length === 1 ? "" : "len"} afgewezen: ${result.rejected[0].reason}` : "";
  if (stored === 0) return { error: `Geen referentie gevonden waarvan ProofLab het citaat met percentage letterlijk op de bronpagina terugvond.${dropped} Kies een bestaande referentie of 'geen goede referentie'.` };
  refresh(ideaId);
  return { error: null, ok: `${stored} referentie${stored === 1 ? "" : "s"} met teruggevonden bron toegevoegd aan de keuzelijst. Controleer of de vergelijkingsgroep past voordat je kiest.${dropped}` };
}

// ---------------------------------------------------------------------------
// Forecasts
// ---------------------------------------------------------------------------

const ForecastSchema = z.object({
  moment: z.enum(FORECAST_MOMENTS),
  probability: z.coerce
    .number({ message: "Geef een kans tussen 5 en 95%." })
    .min(PROBABILITY_MIN * 100, "Geef een kans van minstens 5%.")
    .max(PROBABILITY_MAX * 100, "Geef een kans van hooguit 95%."),
  rationale: z.string().trim().min(10, "Schrijf in één zin waarom.").max(300, "Houd het bij één zin (hooguit 300 tekens)."),
});

export async function submitForecast(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea, canWrite } = await getIdea(ideaId);
  const user = await getUser();
  if (!user) return { error: "Log opnieuw in." };
  const p = ForecastSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!idea.outcome_statement) return { error: "Leg eerst vast wanneer dit idee geslaagd is." };
  if (!idea.reference_class) return { error: "Kies eerst een basispercentage (of 'geen goede referentie'). Elke voorspelling start daar." };
  const progress = await loadProgress(ideaId);
  const open = openMomentFor(progress);
  if (open !== p.data.moment) return { error: open ? "Het voorspelmoment is intussen verschoven. Ververs de pagina." : "Er is nu geen voorspelmoment open." };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("forecasts").insert({
    idea_id: ideaId,
    moment: p.data.moment,
    forecaster_kind: canWrite ? "consultant" : "client",
    forecaster_id: user.id,
    probability: Math.round(p.data.probability) / 100,
    rationale: p.data.rationale,
  });
  if (error) {
    if (error.code === "23505") return { error: "Je hebt op dit moment al een voorspelling gegeven. Een nieuwe mening geef je bij het volgende moment." };
    if (error.message.includes("FORECAST_CLOSED")) return { error: "De uitkomst is al vastgelegd; voorspellen kan niet meer." };
    return { error: "Je voorspelling kon niet worden opgeslagen." };
  }
  refresh(ideaId);
  return { error: null, ok: "Voorspelling vastgelegd. Je ziet nu ook de andere voorspellingen voor dit moment." };
}

export async function requestAiForecast(ideaId: string, _: ActionState): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const user = await getUser();
  if (!user) return { error: "Log opnieuw in." };
  if (!aiConfigured()) return { error: "AI is niet verbonden in deze omgeving." };
  if (!idea.outcome_statement) return { error: "Leg eerst vast wanneer dit idee geslaagd is." };
  if (!idea.reference_class) return { error: "Kies eerst een basispercentage." };
  const progress = await loadProgress(ideaId);
  const moment = openMomentFor(progress);
  if (!moment) return { error: "Er is nu geen voorspelmoment open." };
  if (!progress.forecast?.ownMoments.includes(moment)) return { error: "Geef eerst je eigen voorspelling. Daarna kun je de AI-voorspelling ernaast zetten." };
  const supabase = await supabaseServer();
  // One AI forecast per provider (an ensemble when several are connected); providers that already forecast for this
  // moment are skipped.
  let providers;
  try {
    providers = await providersFor(ideaId, "forecast");
  } catch (e) {
    return { error: aiErrorMessage(e, "AI is niet verbonden in deze omgeving.") };
  }
  const { data: existing } = await supabase.from("forecasts").select("model").eq("idea_id", ideaId).eq("moment", moment).eq("forecaster_kind", "ai");
  const done = new Set((existing ?? []).map((f) => providerOfModel(f.model)));
  const todo = providers.filter((p) => !done.has(p));
  if (todo.length === 0) return { error: existing?.length && existing.length > 1 ? "Er zijn al AI-voorspellingen voor dit moment." : "Er is al een AI-voorspelling voor dit moment." };
  const classLabel =
    idea.reference_class === NO_REFERENCE
      ? "Geen goede referentie gevonden"
      : idea.reference_class.startsWith(OWN_REFERENCE_PREFIX)
        ? "Eigen afgeronde dossiers van dit projecttype"
        : idea.reference_class.startsWith(PROPOSAL_REFERENCE_PREFIX)
          ? ((await supabase.from("reference_proposals").select("label").eq("id", idea.reference_class.slice(PROPOSAL_REFERENCE_PREFIX.length)).maybeSingle()).data?.label ??
            "Door AI voorgestelde referentie met bron")
          : ((await supabase.from("reference_classes").select("label").eq("id", idea.reference_class).maybeSingle()).data?.label ?? idea.reference_class);
  const dossier = await loadDossier(idea);
  // Every provider gets the same fenced dossier prompt and forecasts independently (in parallel, blind to the others).
  const input = {
    idea: ideaContext(idea),
    moment,
    outcome: { statement: idea.outcome_statement!, metric: idea.outcome_metric, target: idea.outcome_target == null ? null : Number(idea.outcome_target) },
    baseRate: {
      label: classLabel,
      low: idea.base_rate_low == null ? null : Number(idea.base_rate_low),
      high: idea.base_rate_high == null ? null : Number(idea.base_rate_high),
      note: idea.base_rate_note,
    },
    dossierSummary: dossierSummaryForAi(dossier),
  };
  const settled = await Promise.allSettled(todo.map((provider) => runAi(ideaId, "forecast", (p) => forecastOutcome(input, p), { provider })));
  const stored: { name: string; probability: number }[] = [];
  const failed: string[] = [];
  let firstError: unknown = null;
  let closed = false;
  for (const [i, r] of settled.entries()) {
    const name = PROVIDER_LABELS[todo[i]].name;
    if (r.status === "rejected") {
      failed.push(name);
      firstError ??= r.reason;
      continue;
    }
    // Recorded by the app server only (guarded by the ingest secret), so nobody can type in an "AI" forecast.
    const { data: ok, error } = await supabase.rpc("record_ai_forecast", {
      p_key: env.ingestSecret,
      p_idea: ideaId,
      p_moment: moment,
      p_probability: r.value.data.probability,
      p_rationale: r.value.data.rationale,
      p_model: r.value.model,
    });
    if (error?.message.includes("FORECAST_MOMENT")) closed = true;
    if (error || !ok) failed.push(name);
    else stored.push({ name, probability: r.value.data.probability });
  }
  if (closed && stored.length === 0) return { error: "Dit voorspelmoment is niet meer open." };
  if (stored.length === 0) return { error: aiErrorMessage(firstError, "De AI-voorspelling is niet gelukt. Probeer het later opnieuw.") };
  refresh(ideaId);
  const list = stored.map((x) => `${x.name} ${pct(x.probability)}`).join(", ");
  const mean = ensembleMean(stored.map((x) => x.probability));
  const fail = failed.length ? ` Niet gelukt: ${failed.join(", ")}.` : "";
  return {
    error: null,
    ok:
      stored.length === 1
        ? `AI-voorspelling toegevoegd (${list}). Die telt als aparte voorspeller, nooit als bewijs.${fail}`
        : `${stored.length} AI-voorspellingen toegevoegd (${list}; gemiddeld ${pct(mean!)}). Ze tellen als aparte voorspellers, nooit als bewijs.${fail}`,
  };
}

// ---------------------------------------------------------------------------
// Interim check-in (from three months after the decision) and the final outcome (from the due date)
// ---------------------------------------------------------------------------

const CheckinSchema = z.object({
  on_track: z.enum(["yes", "unsure", "no"], { message: "Kies of het doel op koers ligt." }),
  current_value: number("De huidige waarde moet een getal van 0 of hoger zijn.").optional(),
  note: z.string().trim().min(10, "Licht de tussenstand toe in minstens één zin.").max(1000),
});

export async function saveCheckin(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = CheckinSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!idea.outcome_due) return { error: "De tussenstand volgt drie maanden na het besluit. Er is nog geen besluit met een uitkomstdatum." };
  const fu = followUp({ outcomeDue: idea.outcome_due, clockStart: idea.outcome_clock_start, checkins: 0, resolved: false, today: todayInNL() });
  if (fu.checkinDate && todayInNL() < fu.checkinDate) return { error: `De tussenstand kan vanaf ${fu.checkinDate}, drie maanden na het besluit.` };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("outcome_checkins").insert({ idea_id: ideaId, on_track: p.data.on_track, current_value: p.data.current_value ?? null, note: p.data.note });
  if (error) return { error: "De tussenstand kon niet worden opgeslagen." };
  refresh(ideaId);
  return { error: null, ok: "Tussenstand vastgelegd." };
}

const OutcomeSchema = z.object({
  achieved: z.enum(["yes", "partial", "no"], { message: "Kies of het doel is gehaald." }),
  actual_value: number("De werkelijke waarde moet een getal van 0 of hoger zijn.").optional(),
  evidence: z.string().trim().min(10, "Beschrijf het bewijs: waar blijkt de uitkomst uit?").max(2000),
  confirm_early: z.string().optional(),
});

export async function resolveOutcome(ideaId: string, _: ActionState, form: FormData): Promise<ActionState> {
  const { idea } = await requireWritableIdea(ideaId);
  const p = OutcomeSchema.safeParse(Object.fromEntries(form));
  if (!p.success) return { error: p.error.issues[0].message };
  if (!idea.outcome_statement) return { error: "Leg eerst vast wanneer dit idee geslaagd is." };
  if (!idea.outcome_due) return { error: "De uitkomst wordt gemeten zes maanden na het besluit. Neem eerst het besluit." };
  if (todayInNL() < idea.outcome_due && p.data.confirm_early !== "on")
    return { error: `De uitkomstdatum is ${idea.outcome_due}. Eerder vastleggen kan alleen als de uitkomst al zeker is; vink dat dan expliciet aan.` };
  const supabase = await supabaseServer();
  const { error } = await supabase.from("idea_outcomes").insert({ idea_id: ideaId, achieved: p.data.achieved, actual_value: p.data.actual_value ?? null, evidence: p.data.evidence });
  if (error) {
    if (error.code === "23505") return { error: "De uitkomst is al vastgelegd. Een uitkomst is een vast feit en wordt niet herschreven." };
    if (error.message.includes("OUTCOME_UNDEFINED")) return { error: "Leg eerst vast wanneer dit idee geslaagd is." };
    return { error: "De uitkomst kon niet worden opgeslagen." };
  }
  refresh(ideaId);
  return { error: null, ok: "Uitkomst vastgelegd. De voorspellingen zijn nu gescoord." };
}
