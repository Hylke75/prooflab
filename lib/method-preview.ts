import "server-only";
import { supabaseServer } from "@/lib/supabase/server";
import { computeAssumptions, loadAssumptionInputs } from "@/lib/progress";
import { experimentMetrics } from "@/lib/experiment-metrics";
import { METHODS, type MethodVersion } from "@/lib/domain/method";
import type { RuledVerdict, VerdictInput } from "@/lib/domain/stats";

export type PreviewAssumption = { id: string; statement: string; from: number; to: number; capReason: string | null; merged: { label: string; signals: number }[] };
export type PreviewTest = { id: string; title: string; state: string; n: number; successes: number; from: RuledVerdict; to: RuledVerdict; approvedCard: boolean };
export type MethodPreview = { from: MethodVersion; to: MethodVersion; assumptions: PreviewAssumption[]; tests: PreviewTest[] };

type Hyp = { success_threshold_pct: number; fail_threshold_pct: number | null; min_sample: number; decision_rule?: string | null; success_count?: number | null };

export function verdictInput(h: Hyp, n: number, successes: number, endConditionReached: boolean): VerdictInput {
  return {
    successes,
    n,
    successThresholdPct: Number(h.success_threshold_pct),
    failThresholdPct: h.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct),
    minSample: h.min_sample,
    endConditionReached,
  };
}

// Wat verandert er als een dossier overstapt: per aanname de kans oud/nieuw en per test de uitkomst oud/nieuw.
// Alles wordt opnieuw uit de ruwe gegevens berekend; er wordt niets opgeslagen.
export async function methodPreview(ideaId: string, from: MethodVersion, to: MethodVersion): Promise<MethodPreview> {
  const supabase = await supabaseServer();
  const inputs = await loadAssumptionInputs(ideaId);
  const before = computeAssumptions(inputs, from);
  const after = computeAssumptions(inputs, to);
  const assumptions = before.map((a) => {
    const b = after.find((x) => x.id === a.id)!;
    return {
      id: a.id,
      statement: a.statement,
      from: a.probability.probability,
      to: b.probability.probability,
      capReason: b.probability.cap?.active ? b.probability.cap.reason : null,
      merged: (b.probability.merged ?? []).map((m) => ({ label: m.label, signals: m.signals })),
    };
  });

  const [{ data: experiments }, { data: cards }] = await Promise.all([
    supabase.from("experiments").select("*, hypotheses(*)").eq("idea_id", ideaId).order("created_at"),
    supabase.from("learning_cards").select("experiment_id").eq("idea_id", ideaId).eq("status", "approved"),
  ]);
  const tests: PreviewTest[] = [];
  for (const e of experiments ?? []) {
    if (!e.hypotheses || ["draft", "ready_for_review", "approved"].includes(e.state)) continue;
    const m = await experimentMetrics(e, e.hypotheses, from);
    const input = verdictInput(e.hypotheses, m.n, m.successes, m.endConditionReached);
    tests.push({
      id: e.id,
      title: e.title,
      state: e.state,
      n: m.n,
      successes: m.successes,
      from: m.verdict,
      to: METHODS[to].verdict(e.hypotheses, input),
      approvedCard: (cards ?? []).some((c) => c.experiment_id === e.id),
    });
  }
  return { from, to, assumptions, tests };
}

// Compact overzicht voor het auditspoor.
export function previewForAudit(p: MethodPreview) {
  const r = (x: number) => Math.round(x * 1000) / 1000;
  return {
    assumptions: p.assumptions.map((a) => ({ id: a.id, from: r(a.from), to: r(a.to) })),
    tests: p.tests.map((t) => ({ id: t.id, from: t.from.label, to: t.to.label })),
  };
}
