// Hypothesis coach: checks the three quality criteria of a testable hypothesis before it can be
// locked: testable (measurable), precise (who, what, when) and discrete (one thing at a time).

export type HypothesisDraft = {
  we_believe: string;
  target_group: string;
  metric_numerator: string;
  metric_denominator: string;
  success_threshold_pct: number | null;
  fail_threshold_pct: number | null;
  min_sample: number | null;
  max_duration_days: number | null;
};

export type HypothesisCheck = { ok: boolean; issues: { field: keyof HypothesisDraft | "general"; message: string }[] };

const VAGUE = ["interessant", "leuk", "zinvol", "goed idee", "behoefte aan", "willen graag", "misschien", "waarschijnlijk"];

export function checkHypothesis(h: HypothesisDraft): HypothesisCheck {
  const issues: HypothesisCheck["issues"] = [];
  const text = h.we_believe.trim();
  if (text.length < 20) issues.push({ field: "we_believe", message: "Beschrijf concreet welk gedrag je verwacht (minimaal één volledige zin)." });
  if (/\b(en|én|and)\b.*\b(en|én|and)\b/i.test(text) || /;/.test(text)) {
    issues.push({ field: "we_believe", message: "Toets één ding tegelijk: splits deze hypothese in afzonderlijke beweringen." });
  }
  const lower = text.toLowerCase();
  const vague = VAGUE.find((w) => lower.includes(w));
  if (vague) issues.push({ field: "we_believe", message: `"${vague}" is niet meetbaar. Beschrijf wat mensen doen, niet wat ze vinden.` });
  if (h.target_group.trim().length < 5) issues.push({ field: "target_group", message: "Wie precies? Noem segment, rol en regio." });
  if (h.metric_numerator.trim().length < 3 || h.metric_denominator.trim().length < 3) {
    issues.push({ field: "metric_numerator", message: "Leg teller én noemer vast, bijv. 'unieke aanvragen / unieke relevante bezoekers'." });
  }
  if (h.success_threshold_pct == null || h.success_threshold_pct <= 0) {
    issues.push({ field: "success_threshold_pct", message: "Leg vooraf een succesdrempel vast." });
  }
  if (h.fail_threshold_pct != null && h.success_threshold_pct != null && h.fail_threshold_pct > h.success_threshold_pct) {
    issues.push({ field: "fail_threshold_pct", message: "De faaldrempel kan niet boven de succesdrempel liggen." });
  }
  if (h.min_sample == null || h.min_sample < 5) issues.push({ field: "min_sample", message: "Kies een minimale steekproef van minstens 5." });
  if (h.max_duration_days == null || h.max_duration_days < 1) issues.push({ field: "max_duration_days", message: "Kies een maximale looptijd." });
  return { ok: issues.length === 0, issues };
}
