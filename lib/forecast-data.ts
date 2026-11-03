import "server-only";
import { cache } from "react";
import { supabaseServer } from "@/lib/supabase/server";
import { getWorkspace, type IdeaAccess } from "@/lib/data";
import { aiConfigured } from "@/lib/env";
import type { IdeaProgress } from "@/lib/domain/coach";
import { PROJECT_TYPES, type ProjectType } from "@/lib/domain/labels";
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

export type ReferenceClass = { id: string; label: string; low: number; high: number; sourceTitle: string; sourceUrl: string; caveat: string };

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
  outcome: { statement: string | null; metric: string | null; target: number | null; due: string | null };
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
  const [classes, forecasts, outcome, checkins, own, anyForecast] = await Promise.all([
    supabase.from("reference_classes").select("*").order("position"),
    supabase.from("forecasts").select("*").eq("idea_id", idea.id).order("created_at"),
    supabase.from("idea_outcomes").select("*").eq("idea_id", idea.id).maybeSingle(),
    supabase.from("outcome_checkins").select("*").eq("idea_id", idea.id).order("created_at", { ascending: false }),
    canWrite ? supabase.rpc("own_base_rate", { p_org: idea.org_id, p_project_type: idea.project_type, p_min: OWN_BASE_RATE_MIN }) : Promise.resolve({ data: [], error: null }),
    // Also counts forecasts this user may not see yet (blind rule), so the lock is shown correctly.
    supabase.rpc("forecasts_exist", { p_idea: idea.id }),
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

  const rows = forecasts.data ?? [];
  const ids = [...new Set(rows.map((f) => f.forecaster_id).filter((x): x is string => !!x))];
  const { data: profiles } = ids.length ? await supabase.from("profiles").select("user_id, full_name, email").in("user_id", ids) : { data: [] };
  const nameOf = (id: string | null, kind: ForecasterKind) => {
    if (kind === "ai") return "AI";
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

  return {
    ideaId: idea.id,
    canWrite,
    outcome: { statement: idea.outcome_statement, metric: idea.outcome_metric, target: idea.outcome_target == null ? null : Number(idea.outcome_target), due: idea.outcome_due },
    baseRate,
    referenceClasses,
    ownBaseRate: ownRow ? { resolved: Number(ownRow.resolved), achieved: Number(ownRow.achieved), projectTypeLabel: PROJECT_TYPES[idea.project_type as ProjectType]?.label ?? idea.project_type } : null,
    forecasts: rows
      .filter((f) => isMoment(f.moment))
      .map((f) => ({
        id: f.id,
        moment: f.moment as ForecastMoment,
        kind: f.forecaster_kind as ForecasterKind,
        name: nameOf(f.forecaster_id, f.forecaster_kind as ForecasterKind),
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
