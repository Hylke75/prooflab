import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, type IdeaAccess } from "@/lib/data";
import { aiConfigured, configuredProviders } from "@/lib/env";
import { aiSettingsForOrg } from "@/lib/ai/settings";
import { PROVIDER_LABELS, providerOfModel, type ProviderId } from "@/lib/ai/providers/config";
import { ensembleProviders } from "@/lib/ai/providers/select";
import type { IdeaProgress } from "@/lib/domain/coach";
import { PROJECT_TYPES, type ProjectType } from "@/lib/domain/labels";
import { PROPOSAL_REFERENCE_PREFIX } from "@/lib/domain/reference-proposal";
import {
  CHECKIN_AFTER_MONTHS,
  FORECAST_MOMENTS,
  NO_REFERENCE,
  OUTCOME_HORIZON_MONTHS,
  addMonths,
  OWN_BASE_RATE_MIN,
  OWN_REFERENCE_PREFIX,
  followUp,
  openMomentFor,
  type Achieved,
  type FollowUp,
  type ForecastMoment,
  type ForecasterKind,
  type OnTrack,
} from "@/lib/domain/forecast";

// Een referentieklasse uit de vaste lijst, of een door AI voorgesteld en door ProofLab nagelopen voorstel voor dit
// dossier (id "proposal:<uuid>", met het letterlijke citaat). Elke referentie heeft een bron.
export type ReferenceClass = { id: string; label: string; low: number; high: number; sourceTitle: string; sourceUrl: string; caveat: string; quote?: string };

export type BaseRateView =
  | { kind: "class"; label: string; low: number; high: number; sourceTitle: string; sourceUrl: string | null; caveat: string; note: string | null }
  | { kind: "own"; label: string; low: number; high: number; note: string | null }
  | { kind: "none"; note: string | null };

export type OwnBaseRate = { resolved: number; achieved: number; projectTypeLabel: string };

export type ForecastRow = {
  id: string;
  moment: ForecastMoment;
  kind: ForecasterKind;
  name: string;
  mine: boolean;
  probability: number;
  rationale: string;
  model: string | null;
  createdAt: string;
};

export type OutcomeRow = { achieved: Achieved; actualValue: number | null; evidence: string; resolvedAt: string };
export type CheckinRow = { id: string; onTrack: OnTrack; currentValue: number | null; note: string; createdAt: string };

export type ForecastView = {
  ideaId: string;
  canWrite: boolean;
  outcome: {
    statement: string | null;
    metric: string | null;
    target: number | null;
    due: string | null;
    minValuePerCustomer: number | null;
    revenueTarget: number | null;
    measureDate: string | null;
  };
  // Beslisdatum (gepland of genomen), voor het venster van de meetdatum.
  decisionDate: string | null;
  baseRate: BaseRateView | null;
  referenceClasses: ReferenceClass[];
  ownBaseRate: OwnBaseRate | null;
  forecasts: ForecastRow[];
  openMoment: ForecastMoment | null;
  ownMoments: ForecastMoment[];
  // Best effort: forecasts of others stay hidden until you forecast, so the database has the final say.
  definitionLocked: boolean;
  resolved: OutcomeRow | null;
  checkins: CheckinRow[];
  followUp: FollowUp;
  today: string;
  aiAvailable: boolean;
  // Connected providers that have not yet forecast at the open moment (one AI forecast per provider).
  aiPending: ProviderId[];
  // Starting calibration (lib/domain/calibration.ts): resolved dossiers of the organisation (null = unknown)
  // and whether a behaviour test (landing or pricing) of this idea has ended.
  orgResolved: number | null;
  behaviourTestEnded: boolean;
};

const isMoment = (m: string): m is ForecastMoment => (FORECAST_MOMENTS as readonly string[]).includes(m);

// Everything the forecast panels and the outcome page show for one idea. Null when the prediction schema
// is not in this database yet.
export const loadForecastView = cache(async (access: IdeaAccess, progress: IdeaProgress): Promise<ForecastView | null> => {
  const state = progress.forecast;
  if (!state) return null;
  const { idea, canWrite } = access;
  const ws = await getWorkspace();
  const supabase = await supabaseServer();
  const [classes, forecasts, outcome, checkins, own, anyForecast, orgResolved, behaviour, proposals] = await Promise.all([
    supabase.from("reference_classes").select("*").order("position"),
    supabase.from("forecasts").select("*").eq("idea_id", idea.id).order("created_at"),
    supabase.from("idea_outcomes").select("*").eq("idea_id", idea.id).maybeSingle(),
    supabase.from("outcome_checkins").select("*").eq("idea_id", idea.id).order("created_at", { ascending: false }),
    canWrite ? supabase.rpc("own_base_rate", { p_org: idea.org_id, p_project_type: idea.project_type, p_min: OWN_BASE_RATE_MIN }) : Promise.resolve({ data: [], error: null }),
    // Also counts forecasts this user may not see yet (blind rule), so the lock is shown correctly.
    supabase.rpc("forecasts_exist", { p_idea: idea.id }),
    canWrite ? supabase.rpc("own_base_rate", { p_org: idea.org_id, p_project_type: null, p_min: 0 }) : Promise.resolve({ data: null, error: null }),
    supabase.from("experiments").select("id", { count: "exact", head: true }).eq("idea_id", idea.id).in("type", ["landing", "pricing"]).in("state", ["ended", "analyzed", "decided"]),
    // Ontbreekt de tabel (oudere database), dan zijn er gewoon geen voorstellen.
    supabase.from("reference_proposals").select("id, label, rate, source_url, source_title, quote").eq("idea_id", idea.id).order("created_at", { ascending: false }).limit(10),
  ]);
  if (classes.error || forecasts.error || outcome.error || checkins.error) return null;

  const referenceClasses: ReferenceClass[] = (classes.data ?? []).map((c) => ({
    id: c.id,
    label: c.label,
    low: Number(c.low),
    high: Number(c.high),
    sourceTitle: c.source_title,
    sourceUrl: c.source_url,
    caveat: c.caveat,
  }));
  for (const r of proposals.data ?? []) {
    referenceClasses.push({
      id: `${PROPOSAL_REFERENCE_PREFIX}${r.id}`,
      label: r.label,
      low: Number(r.rate),
      high: Number(r.rate),
      sourceTitle: r.source_title,
      sourceUrl: r.source_url,
      caveat: "Door AI voorgesteld; ProofLab vond het citaat letterlijk op de bronpagina. Controleer of de vergelijkingsgroep en de termijn passen bij dit doel.",
      quote: r.quote,
    });
  }

  const rows = forecasts.data ?? [];
  const ids = [...new Set(rows.map((f) => f.forecaster_id).filter((x): x is string => !!x))];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids) : { data: [] };
  const nameOf = (id: string | null, kind: ForecasterKind, model: string | null) => {
    if (kind === "ai") {
      const p = providerOfModel(model);
      return p ? `AI · ${PROVIDER_LABELS[p].name}` : "AI";
    }
    if (id === ws.user.id) return "Jij";
    const p = (profiles ?? []).find((x) => x.user_id === id);
    return p?.full_name?.trim() || p?.email || (kind === "consultant" ? "Consultant" : "Opdrachtgever");
  };

  const ownRow = own.data?.[0];
  const ref = idea.reference_class;
  let baseRate: BaseRateView | null = null;
  if (ref === NO_REFERENCE) baseRate = { kind: "none", note: idea.base_rate_note };
  else if (ref?.startsWith(OWN_REFERENCE_PREFIX) && idea.base_rate_low != null && idea.base_rate_high != null)
    baseRate = { kind: "own", label: "Eigen afgeronde dossiers", low: Number(idea.base_rate_low), high: Number(idea.base_rate_high), note: idea.base_rate_note };
  else if (ref) {
    const c = referenceClasses.find((x) => x.id === ref);
    if (c && idea.base_rate_low != null && idea.base_rate_high != null)
      baseRate = { kind: "class", label: c.label, low: Number(idea.base_rate_low), high: Number(idea.base_rate_high), sourceTitle: c.sourceTitle, sourceUrl: c.sourceUrl, caveat: c.caveat, note: idea.base_rate_note };
  }

  const open = openMomentFor(progress);
  const settings = canWrite && aiConfigured() ? await aiSettingsForOrg(idea.org_id) : null;
  const aiPending = () => {
    if (!settings || !open) return [];
    const done = new Set(rows.filter((f) => f.moment === open && f.forecaster_kind === "ai").map((f) => providerOfModel(f.model)));
    return ensembleProviders(settings, "forecast", configuredProviders()).filter((p) => !done.has(p));
  };

  return {
    ideaId: idea.id,
    canWrite,
    outcome: {
      statement: idea.outcome_statement,
      metric: idea.outcome_metric,
      target: idea.outcome_target == null ? null : Number(idea.outcome_target),
      due: idea.outcome_due,
      minValuePerCustomer: idea.outcome_min_value_per_customer == null ? null : Number(idea.outcome_min_value_per_customer),
      revenueTarget: idea.outcome_revenue_target == null ? null : Number(idea.outcome_revenue_target),
      measureDate: idea.outcome_measure_date,
    },
    decisionDate: idea.outcome_clock_start ?? idea.decision_deadline,
    baseRate,
    referenceClasses,
    ownBaseRate: ownRow ? { resolved: Number(ownRow.resolved), achieved: Number(ownRow.achieved), projectTypeLabel: PROJECT_TYPES[idea.project_type as ProjectType]?.label ?? idea.project_type } : null,
    forecasts: rows
      .filter((f) => isMoment(f.moment))
      .map((f) => ({
        id: f.id,
        moment: f.moment as ForecastMoment,
        kind: f.forecaster_kind as ForecasterKind,
        name: nameOf(f.forecaster_id, f.forecaster_kind as ForecasterKind, f.model),
        mine: f.forecaster_id === ws.user.id,
        probability: Number(f.probability),
        rationale: f.rationale,
        model: f.model,
        createdAt: f.created_at,
      })),
    openMoment: openMomentFor(progress),
    ownMoments: state.ownMoments,
    definitionLocked: rows.length > 0 || anyForecast.data === true,
    resolved: outcome.data
      ? { achieved: outcome.data.achieved as Achieved, actualValue: outcome.data.actual_value == null ? null : Number(outcome.data.actual_value), evidence: outcome.data.evidence, resolvedAt: outcome.data.resolved_at }
      : null,
    checkins: (checkins.data ?? []).map((c) => ({ id: c.id, onTrack: c.on_track as OnTrack, currentValue: c.current_value == null ? null : Number(c.current_value), note: c.note, createdAt: c.created_at })),
    followUp: followUp(state),
    today: state.today,
    aiAvailable: canWrite && aiConfigured(),
    aiPending: aiPending(),
    orgResolved: orgResolved.error || !orgResolved.data ? null : Number(orgResolved.data[0]?.resolved ?? 0),
    behaviourTestEnded: (behaviour.count ?? 0) > 0,
  };
});

export type OutcomeReminder = { ideaId: string; title: string; kind: "checkin" | "outcome"; date: string };

// Dashboard reminders for consultants, across all ideas of the organisation (also ones decided long ago):
// a check-in from three months after the decision, the outcome from the outcome date.
export async function loadOutcomeReminders(orgId: string, today: string): Promise<OutcomeReminder[]> {
  const supabase = await supabaseServer();
  const { data: ideas, error } = await supabase
    .from("ideas")
    .select("id, title, outcome_due, outcome_clock_start")
    .eq("org_id", orgId)
    .not("outcome_due", "is", null)
    .lte("outcome_due", addMonths(today, OUTCOME_HORIZON_MONTHS - CHECKIN_AFTER_MONTHS))
    .order("outcome_due");
  if (error || !ideas?.length) return [];
  const ids = ideas.map((i) => i.id);
  const [checkins, outcomes] = await Promise.all([
    supabase.from("outcome_checkins").select("idea_id").in("idea_id", ids),
    supabase.from("idea_outcomes").select("idea_id").in("idea_id", ids),
  ]);
  if (checkins.error || outcomes.error) return [];
  return ideas.flatMap((i): OutcomeReminder[] => {
    const fu = followUp({
      outcomeDue: i.outcome_due,
      clockStart: i.outcome_clock_start,
      checkins: (checkins.data ?? []).filter((c) => c.idea_id === i.id).length,
      resolved: (outcomes.data ?? []).some((o) => o.idea_id === i.id),
      today,
    });
    if (fu.outcomeDue) return [{ ideaId: i.id, title: i.title, kind: "outcome" as const, date: fu.outcomeDate! }];
    if (fu.checkinDue) return [{ ideaId: i.id, title: i.title, kind: "checkin" as const, date: fu.checkinDate! }];
    return [];
  });
}
