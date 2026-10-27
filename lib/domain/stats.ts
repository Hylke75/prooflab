// Statistics for experiment results: honest intervals instead of bare percentages.

export type Interval = { low: number; high: number; point: number };

// Wilson score interval for a binomial proportion (default 95%).
export function wilson(successes: number, n: number, z = 1.959964): Interval {
  if (n <= 0) return { low: 0, high: 1, point: 0 };
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { low: Math.max(0, centre - half), high: Math.min(1, centre + half), point: p };
}

export type VerdictInput = {
  successes: number;
  n: number;
  successThresholdPct: number;
  failThresholdPct: number | null;
  minSample: number;
  endConditionReached: boolean;
};

export type Verdict =
  | { kind: "running"; reason: string; interval: Interval }
  | { kind: "pass" | "fail" | "inconclusive"; reason: string; interval: Interval };

// Pre-registered decision rule. A verdict exists only after the agreed end condition; before
// that the dashboard shows progress without a conclusion, however good early numbers look.
export function verdict(v: VerdictInput): Verdict {
  const interval = wilson(v.successes, v.n);
  const success = v.successThresholdPct / 100;
  const fail = (v.failThresholdPct ?? v.successThresholdPct) / 100;
  if (!v.endConditionReached) {
    return {
      kind: "running",
      reason: `De test loopt. Een uitspraak volgt pas na de afgesproken eindconditie (minimaal ${v.minSample} deelnemers of einde looptijd).`,
      interval,
    };
  }
  if (v.n < v.minSample) {
    return {
      kind: "inconclusive",
      reason: `Te weinig deelnemers: ${v.n} van de minimaal ${v.minSample}. Het resultaat is onbeslist.`,
      interval,
    };
  }
  if (interval.low >= success) {
    return { kind: "pass", reason: "Ook de ondergrens van het 95%-interval ligt boven de succesdrempel.", interval };
  }
  if (interval.high < fail) {
    return { kind: "fail", reason: "Ook de bovengrens van het 95%-interval ligt onder de faaldrempel.", interval };
  }
  return {
    kind: "inconclusive",
    reason: "Het 95%-interval overlapt de drempel: dit resultaat kan nog alle kanten op.",
    interval,
  };
}

// Smallest n for which an observed rate equal to `expectedPct` would put the interval's lower
// bound above `thresholdPct`. Returns null if that is not reachable within 20.000 participants.
export function sampleNeeded(expectedPct: number, thresholdPct: number): number | null {
  if (expectedPct <= thresholdPct) return null;
  for (let n = 5; n <= 20000; n++) {
    const s = Math.round((expectedPct / 100) * n);
    if (wilson(s, n).low >= thresholdPct / 100) return n;
  }
  return null;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
