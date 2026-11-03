import { chanceOfLuck } from "@/lib/domain/primary-test";
import { DECISION_RULES, FAIL_PROBABILITY, PASS_PROBABILITY, pct, type DecisionRule, type Interval, type VerdictLabel } from "@/lib/domain/stats";

// Uitkomst van een test volgens de vooraf vastgelegde beslisregel: de regel, de kans of het aantal, het
// 95%-interval ter informatie en het label. Gebruikt op de experimentpagina en op de Learning Card.
export type RuleOutcome = {
  rule: DecisionRule | "interval";
  label: VerdictLabel | string;
  probability: number | null;
  probabilityFail?: number | null;
  successCount: number | null;
  successes: number;
  n: number;
  interval: Interval | null;
  thresholdPct: number;
  failThresholdPct?: number | null;
};

export const LABEL_PILL: Record<string, string> = {
  "sterk bewezen": "green",
  geslaagd: "green",
  "niet geslaagd": "coral",
  onbeslist: "orange",
  "loopt nog": "gray",
};

export function ruleName(rule: string): string {
  return rule === "absolute" || rule === "probability" ? DECISION_RULES[rule].label : "Intervalregel (95%-interval, methode 2026-11-a)";
}

export function ruleLine(o: RuleOutcome): string {
  if (o.rule === "absolute") return `Vast aantal: ${o.successes} van minimaal ${o.successCount ?? "?"} gehaald (bij ${o.n} deelnemers).`;
  if (o.rule === "probability" && o.probability != null) {
    const fail = o.failThresholdPct ?? o.thresholdPct;
    return `Kans dat het echte percentage boven ${o.thresholdPct}% ligt: ${pct(o.probability, 0)} (geslaagd vanaf ${pct(PASS_PROBABILITY, 0)}; niet geslaagd als de kans boven ${fail}% hoogstens ${pct(FAIL_PROBABILITY, 0)} is${o.probabilityFail != null ? `, nu ${pct(o.probabilityFail, 0)}` : ""}).`;
  }
  return "Geslaagd als ook de ondergrens van het 95%-interval boven de succesdrempel ligt.";
}

export function RuleSummary({ o, compact = false }: { o: RuleOutcome; compact?: boolean }) {
  return (
    <div className={compact ? "" : "mt-8"}>
      <div className="data-row">
        <span>Beslisregel</span>
        <strong style={{ textAlign: "right" }}>{ruleName(o.rule)}</strong>
      </div>
      <div className="data-row">
        <span>{o.rule === "absolute" ? "Aantal" : o.rule === "probability" ? "Kans" : "Regel"}</span>
        <strong style={{ textAlign: "right" }}>{ruleLine(o)}</strong>
      </div>
      {chanceOfLuck(o) != null && (
        <div className="data-row">
          <span>Kans op toeval</span>
          <strong style={{ textAlign: "right" }}>
            {pct(chanceOfLuck(o)!, 0)} <span className="tiny">(1 − {pct(o.probability!, 0)}: de kans dat het echte percentage toch niet boven de drempel ligt)</span>
          </strong>
        </div>
      )}
      {o.interval && (
        <div className="data-row">
          <span>95%-interval (ter informatie)</span>
          <strong className="num">{pct(o.interval.low)} – {pct(o.interval.high)}</strong>
        </div>
      )}
      <div className="data-row">
        <span>Label</span>
        <strong><span className={`pill ${LABEL_PILL[o.label] ?? "gray"}`}>{o.label}</span></strong>
      </div>
    </div>
  );
}

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);

// De uitkomst zoals die op een Learning Card staat (learning_cards.metrics). Kaarten van vóór methode
// 2026-11-b hebben geen beslisregel: die tonen de intervalregel met het label van hun oordeel.
export function outcomeFromCard(
  metrics: unknown,
  verdict: string,
  h: { success_threshold_pct: number; fail_threshold_pct: number | null } | null,
): RuleOutcome {
  const m = (metrics && typeof metrics === "object" && !Array.isArray(metrics) ? metrics : {}) as Record<string, unknown>;
  const rule = m.decision_rule === "absolute" || m.decision_rule === "probability" ? m.decision_rule : "interval";
  const iv = m.interval as Interval | undefined;
  const fallbackLabel = verdict === "pass" ? "geslaagd" : verdict === "fail" ? "niet geslaagd" : "onbeslist";
  return {
    rule,
    label: typeof m.label === "string" ? m.label : fallbackLabel,
    probability: num(m.probability),
    probabilityFail: num(m.probability_fail),
    successCount: num(m.success_count),
    successes: num(m.successes) ?? 0,
    n: num(m.n) ?? 0,
    interval: iv && typeof iv.low === "number" && typeof iv.high === "number" ? iv : null,
    thresholdPct: num(m.success_threshold_pct) ?? Number(h?.success_threshold_pct ?? 0),
    failThresholdPct: num(m.fail_threshold_pct) ?? (h?.fail_threshold_pct == null ? null : Number(h.fail_threshold_pct)),
  };
}
