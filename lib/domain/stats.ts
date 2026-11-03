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

// ---------------------------------------------------------------------------
// Bayesian estimate with prior knowledge (research 3.6). A Beta-binomial posterior whose prior comes
// from earlier ended tests of the same type in the same organisation, so a lucky result on a small
// sample is pulled towards what earlier tests showed (winner's curse). Shown next to the Wilson
// interval and only after the end condition; the pre-registered verdict above stays the only rule.
// ---------------------------------------------------------------------------

export type BetaPrior = {
  alpha: number;
  beta: number;
  strength: number; // alpha + beta: how many pseudo-observations the prior is worth
  mean: number;
  tests: number; // earlier tests used
  source: "flat" | "empirical";
};

export const PRIOR_MIN_TESTS = 3;
export const PRIOR_MAX_STRENGTH = 20;
const PRIOR_MIN_STRENGTH = 2;

export const FLAT_PRIOR: BetaPrior = { alpha: 1, beta: 1, strength: 2, mean: 0.5, tests: 0, source: "flat" };

// Empirical prior by the method of moments: mean of the earlier rates (each test counts once), and a
// strength that follows how much the true rates differ between tests (sampling noise removed).
// Capped at 20 pseudo-observations, so a new test of 20+ participants always weighs at least as much.
export function empiricalPrior(earlier: { n: number; successes: number }[]): BetaPrior {
  const tests = earlier.filter((t) => t.n > 0 && t.successes >= 0 && t.successes <= t.n);
  if (tests.length < PRIOR_MIN_TESTS) return { ...FLAT_PRIOR, tests: tests.length };
  const rates = tests.map((t) => t.successes / t.n);
  const m = Math.min(0.99, Math.max(0.01, rates.reduce((s, r) => s + r, 0) / rates.length));
  const variance = rates.reduce((s, r) => s + (r - m) ** 2, 0) / (rates.length - 1);
  const noise = tests.reduce((s, t) => s + (m * (1 - m)) / t.n, 0) / tests.length;
  const between = variance - noise;
  const raw = between > 0 ? (m * (1 - m)) / between - 1 : PRIOR_MAX_STRENGTH;
  const strength = Math.min(PRIOR_MAX_STRENGTH, Math.max(PRIOR_MIN_STRENGTH, raw));
  return { alpha: m * strength, beta: (1 - m) * strength, strength, mean: m, tests: tests.length, source: "empirical" };
}

export type BayesEstimate = {
  mean: number;
  low: number; // 90% credible interval
  high: number;
  pAboveThreshold: number; // P(true rate ≥ success threshold)
  prior: BetaPrior;
};

export function betaBinomial(prior: BetaPrior, successes: number, n: number, successThresholdPct: number): BayesEstimate {
  const a = prior.alpha + Math.max(0, successes);
  const b = prior.beta + Math.max(0, n - successes);
  const t = Math.min(1, Math.max(0, successThresholdPct / 100));
  return {
    mean: a / (a + b),
    low: betaQuantile(0.05, a, b),
    high: betaQuantile(0.95, a, b),
    pAboveThreshold: 1 - regIncBeta(t, a, b),
    prior,
  };
}

// ln Γ(x), Lanczos approximation (g = 7, n = 9); accurate to ~1e-13 for x > 0.
const LANCZOS = [
  0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
  12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
];
export function lnGamma(x: number): number {
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lnGamma(1 - x);
  const z = x - 1;
  let s = LANCZOS[0];
  for (let i = 1; i < 9; i++) s += LANCZOS[i] / (z + i);
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(s);
}

// Continued fraction for the incomplete beta function (modified Lentz).
function betacf(x: number, a: number, b: number): number {
  const TINY = 1e-300;
  let c = 1;
  let d = 1 - ((a + b) * x) / (a + 1);
  if (Math.abs(d) < TINY) d = TINY;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 300; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((a + m2 - 1) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (a + b + m) * x) / ((a + m2) * (a + m2 + 1));
    d = 1 + aa * d;
    if (Math.abs(d) < TINY) d = TINY;
    c = 1 + aa / c;
    if (Math.abs(c) < TINY) c = TINY;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-14) break;
  }
  return h;
}

// Regularized incomplete beta I_x(a, b) = P(X ≤ x) for X ~ Beta(a, b).
export function regIncBeta(x: number, a: number, b: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lnFront = lnGamma(a + b) - lnGamma(a) - lnGamma(b) + a * Math.log(x) + b * Math.log(1 - x);
  if (x < (a + 1) / (a + b + 2)) return (Math.exp(lnFront) * betacf(x, a, b)) / a;
  return 1 - (Math.exp(lnFront) * betacf(1 - x, b, a)) / b;
}

// Quantile of Beta(a, b) by bisection on the CDF (monotone, so always converges).
export function betaQuantile(q: number, a: number, b: number): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (regIncBeta(mid, a, b) < q) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toLocaleString("nl-NL", { minimumFractionDigits: digits, maximumFractionDigits: digits })}%`;
}
