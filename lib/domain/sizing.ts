// Bottom-up market sizing and unit economics. Pure, deterministic arithmetic: recalculating a
// scenario never needs an LLM call, and every factor keeps its provenance.

import type { ClaimStatus } from "./labels";
import { regionMatches } from "./claim-scope";

export type SizingModel = "b2b_accounts" | "b2c_people" | "transactions";
export type ScenarioKind = "conservative" | "realistic" | "optimistic";
export type FactorUnit = "count" | "percent" | "eur" | "per_year";

export type FactorDef = { key: string; label: string; unit: FactorUnit; hint: string };

export const MODEL_FACTORS: Record<SizingModel, FactorDef[]> = {
  b2b_accounts: [
    { key: "base_count", label: "Relevante organisaties in het gebied", unit: "count", hint: "Bijv. CBS-vestigingen in de juiste SBI-codes en grootteklasse." },
    { key: "fit_pct", label: "Deel met het probleem en budget", unit: "percent", hint: "Welk deel heeft het probleem echt en een budgethouder?" },
    { key: "reach_pct", label: "Bereikbaar via onze kanalen", unit: "percent", hint: "Geografisch en operationeel te bedienen." },
    { key: "winnable_pct", label: "Realistisch te winnen aandeel", unit: "percent", hint: "Binnen 3 jaar, gegeven concurrentie en verkoopcapaciteit." },
    { key: "revenue_per_customer", label: "Jaaromzet per klant", unit: "eur", hint: "Gebaseerd op prijsonderzoek, niet op wensdenken." },
  ],
  b2c_people: [
    { key: "base_count", label: "Personen of huishoudens in het gebied", unit: "count", hint: "Bijv. CBS-bevolking in de relevante leeftijdsgroep." },
    { key: "fit_pct", label: "Deel met het probleem", unit: "percent", hint: "Uit klantonderzoek of een betrouwbare bron." },
    { key: "reach_pct", label: "Bereikbaar via onze kanalen", unit: "percent", hint: "Wie bereiken we realistisch?" },
    { key: "winnable_pct", label: "Realistisch te winnen aandeel", unit: "percent", hint: "Binnen 3 jaar." },
    { key: "revenue_per_customer", label: "Jaaromzet per klant", unit: "eur", hint: "Prijs × aantal aankopen per jaar." },
  ],
  transactions: [
    { key: "base_count", label: "Potentiële kopers in het gebied", unit: "count", hint: "Personen of organisaties die deze aankoop doen." },
    { key: "fit_pct", label: "Deel dat deze aankoop doet", unit: "percent", hint: "Welk deel koopt dit soort product überhaupt?" },
    { key: "reach_pct", label: "Bereikbaar via onze kanalen", unit: "percent", hint: "Wie bereiken we realistisch?" },
    { key: "winnable_pct", label: "Realistisch te winnen aandeel", unit: "percent", hint: "Binnen 3 jaar." },
    { key: "frequency", label: "Aankopen per koper per jaar", unit: "per_year", hint: "Uit gedrag, niet uit een enquêtewens." },
    { key: "ticket", label: "Gemiddelde besteding per aankoop", unit: "eur", hint: "Publieke prijspunten of eigen data." },
  ],
};

export const SCENARIO_LABELS: Record<ScenarioKind, { label: string; meaning: string }> = {
  conservative: { label: "Conservatief", meaning: "Ondergrens voor planning" },
  realistic: { label: "Realistisch", meaning: "Werkhypothese" },
  optimistic: { label: "Optimistisch", meaning: "Gunstige, maar toetsbare bovengrens" },
};

export type Factor = {
  key: string;
  value: number;
  claimStatus?: ClaimStatus | null; // status of the linked claim, if any
  claimValue?: number | null; // the figure in that claim; the factor only counts as sourced when it matches
};

// A factor is backed by a source only when the linked claim is usable and its figure is the figure used.
export function factorSourced(f: Factor | undefined): boolean {
  if (!f || (f.claimStatus !== "verified" && f.claimStatus !== "estimate")) return false;
  if (f.claimValue == null || !Number.isFinite(f.claimValue)) return false;
  return Math.abs(f.value - f.claimValue) <= 1e-6 * Math.max(1, Math.abs(f.claimValue));
}

export type SizingResult = {
  tamCount: number;
  samCount: number;
  somCount: number;
  tamRevenue: number;
  samRevenue: number;
  somRevenue: number;
  formula: string;
  provenance: { sourced: number; assumed: number; total: number };
  established: boolean; // base count backed by a verified or estimated claim
  // Gebruikerstest D5: factoren die op 0 staan of ontbreken (labels). Dan is de uitkomst niet vastgesteld.
  missing: string[];
  // Of het aantal klanten per laag te berekenen is; anders toont de app "onbekend" in plaats van 0.
  countsKnown: { tam: boolean; sam: boolean; som: boolean };
  label: string;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("nl-NL");
const fmtEur = (n: number) => `€ ${Math.round(n).toLocaleString("nl-NL")}`;
const fmtPct = (n: number) => `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

// Een factor die 0 is of ontbreekt, is onbekend: in de formule staat "onbekend", niet "0" (gebruikerstest D5).
const known = (n: number) => Number.isFinite(n) && n > 0;

export function computeSizing(model: SizingModel, factors: Factor[]): SizingResult {
  const get = (k: string) => factors.find((f) => f.key === k)?.value ?? 0;
  const show = (k: string, fmt: (n: number) => string) => (known(get(k)) ? fmt(get(k)) : "onbekend");
  const base = get("base_count");
  const fit = get("fit_pct") / 100;
  const reach = get("reach_pct") / 100;
  const win = get("winnable_pct") / 100;
  const perCustomer = model === "transactions" ? get("frequency") * get("ticket") : get("revenue_per_customer");

  const tamCount = base;
  const samCount = base * fit * reach;
  const somCount = samCount * win;
  const revenueFormula =
    model === "transactions"
      ? `${show("frequency", (n) => n.toLocaleString("nl-NL"))} × ${show("ticket", fmtEur)}`
      : show("revenue_per_customer", fmtEur);

  const defs = MODEL_FACTORS[model];
  const sourced = defs.filter((d) => factorSourced(factors.find((f) => f.key === d.key))).length;
  const established = factorSourced(factors.find((f) => f.key === "base_count"));
  const missing = defs.filter((d) => !known(get(d.key))).map((d) => d.label);

  return {
    tamCount,
    samCount,
    somCount,
    tamRevenue: tamCount * perCustomer,
    samRevenue: samCount * perCustomer,
    somRevenue: somCount * perCustomer,
    formula: `${show("base_count", fmtInt)} × ${show("fit_pct", fmtPct)} × ${show("reach_pct", fmtPct)} × ${show("winnable_pct", fmtPct)} × ${revenueFormula}`,
    provenance: { sourced, assumed: defs.length - sourced, total: defs.length },
    established,
    missing,
    countsKnown: {
      tam: known(base),
      sam: known(base) && known(get("fit_pct")) && known(get("reach_pct")),
      som: known(base) && known(get("fit_pct")) && known(get("reach_pct")) && known(get("winnable_pct")),
    },
    label: !established
      ? "Verkennend scenario; marktomvang niet vastgesteld"
      : missing.length
        ? `Onvolledig scenario (onbekend: ${missing.map((m) => m.toLowerCase()).join(", ")}); omzet niet vastgesteld`
        : sourced === defs.length
          ? "Onderbouwd scenario"
          : "Scenario met deels aangenomen factoren",
  };
}

// Default factor values per scenario so that a new dossier starts with visible, editable
// assumptions rather than empty fields. They are marked as assumptions until linked to claims.
export function defaultFactors(model: SizingModel, kind: ScenarioKind): Record<string, number> {
  const k = { conservative: 0, realistic: 1, optimistic: 2 }[kind];
  const pick = (a: number, b: number, c: number) => [a, b, c][k];
  const common = { base_count: 0, fit_pct: pick(10, 20, 35), reach_pct: pick(30, 50, 70), winnable_pct: pick(1, 3, 6) };
  if (model === "transactions") return { ...common, frequency: pick(1, 2, 4), ticket: 0 };
  return { ...common, revenue_per_customer: 0 };
}

export type UnitEconomicsInput = {
  pricePerCustomerYear: number | null;
  grossMarginPct: number | null;
  cacEur: number | null;
  annualChurnPct: number | null;
  fixedCostsYear: number | null;
  upfrontInvestment: number | null;
};

export type UnitEconomicsResult = {
  marginPerCustomerYear: number | null;
  paybackMonths: number | null;
  lifetimeValue: number | null;
  ltvToCac: number | null;
  breakEvenCustomers: number | null;
  missing: string[];
  warnings: string[];
};

export function computeUnitEconomics(u: UnitEconomicsInput): UnitEconomicsResult {
  const missing: string[] = [];
  if (u.pricePerCustomerYear == null) missing.push("prijs per klant per jaar");
  if (u.grossMarginPct == null) missing.push("brutomarge");
  if (u.cacEur == null) missing.push("kosten om een klant te werven");
  if (u.annualChurnPct == null) missing.push("jaarlijks klantverloop");
  if (u.fixedCostsYear == null) missing.push("vaste kosten per jaar");

  const margin = u.pricePerCustomerYear != null && u.grossMarginPct != null ? u.pricePerCustomerYear * (u.grossMarginPct / 100) : null;
  const payback = margin && u.cacEur != null && margin > 0 ? u.cacEur / (margin / 12) : null;
  const ltv = margin != null && u.annualChurnPct ? margin / (u.annualChurnPct / 100) : null;
  const ltvToCac = ltv != null && u.cacEur ? ltv / u.cacEur : null;
  const breakEven = margin && u.fixedCostsYear != null && margin > 0 ? Math.ceil(u.fixedCostsYear / margin) : null;

  const warnings: string[] = [];
  if (ltvToCac != null && ltvToCac < 3) warnings.push("Klantwaarde is minder dan 3× de wervingskosten; dat is krap voor een gezond model.");
  if (payback != null && payback > 18) warnings.push("Terugverdientijd per klant is langer dan 18 maanden.");
  if (u.annualChurnPct === 0) warnings.push("0% klantverloop is onrealistisch; klantwaarde is niet te berekenen.");

  return { marginPerCustomerYear: margin, paybackMonths: payback, lifetimeValue: ltv, ltvToCac, breakEvenCustomers: breakEven, missing, warnings };
}

// Annual revenue at which the gross margin covers the fixed costs. Null when either is unknown.
export function breakEvenRevenue(u: Pick<UnitEconomicsInput, "grossMarginPct" | "fixedCostsYear">): number | null {
  if (u.fixedCostsYear == null || u.grossMarginPct == null || u.grossMarginPct <= 0) return null;
  return u.fixedCostsYear / (u.grossMarginPct / 100);
}

// ---------------------------------------------------------------------------
// Monte Carlo market sizing (research 3.8). Per factor an optional 90% range (low/high); factors
// without a range stay fixed at their value, so a scenario without ranges behaves as before.
//
// Distribution per ranged factor:
// - low > 0: log-normal fitted to the range (low and high are the 5th and 95th percentile; the
//   median is their geometric mean). Market factors are positive and skewed, and multiply.
// - low = 0: triangular from low via the value to high (a log-normal cannot start at zero).
// Percentages are capped at 100. 5.000 draws with a seeded PRNG (mulberry32), so the same input
// always gives the same output. The variance driver is a one-at-a-time sensitivity: SOM revenue
// with that factor at its low and at its high, the others at their value.
// ---------------------------------------------------------------------------

export type RangedFactor = { key: string; value: number; low?: number | null; high?: number | null };

export type Percentiles = { p10: number; p50: number; p90: number };

export type SimulationResult = {
  draws: number;
  seed: number;
  rangedFactors: number;
  widen: number; // 1 = bandbreedtes zoals ingevoerd; > 1 = verbreed omdat de factoren niet bij elkaar passen
  somCount: Percentiles;
  somRevenue: Percentiles;
  threshold: number | null;
  pAboveThreshold: number | null;
  drivers: { key: string; swing: number; share: number }[]; // largest swing first
  method: string;
};

export const SIMULATION_DRAWS = 5000;
export const SIMULATION_SEED = 20261103;
const Z90 = 1.6448536269514722;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hasRange(f: RangedFactor): f is RangedFactor & { low: number; high: number } {
  return f.low != null && f.high != null && Number.isFinite(f.low) && Number.isFinite(f.high) && f.high > f.low && f.low >= 0;
}

function somFor(model: SizingModel, v: Record<string, number>): { count: number; revenue: number } {
  const count = (v.base_count ?? 0) * ((v.fit_pct ?? 0) / 100) * ((v.reach_pct ?? 0) / 100) * ((v.winnable_pct ?? 0) / 100);
  const per = model === "transactions" ? (v.frequency ?? 0) * (v.ticket ?? 0) : (v.revenue_per_customer ?? 0);
  return { count, revenue: count * per };
}

// Linear interpolation between order statistics.
export function percentile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

function sampler(f: RangedFactor & { low: number; high: number }, unit: FactorUnit | undefined, rnd: () => number): () => number {
  const cap = (x: number) => (unit === "percent" ? Math.min(100, x) : x);
  if (f.low > 0) {
    const mu = (Math.log(f.low) + Math.log(f.high)) / 2;
    const sigma = (Math.log(f.high) - Math.log(f.low)) / (2 * Z90);
    return () => {
      // Box–Muller; 1 − u keeps the logarithm finite.
      const z = Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd());
      return cap(Math.exp(mu + sigma * z));
    };
  }
  const a = f.low;
  const b = f.high;
  const c = Math.min(b, Math.max(a, f.value));
  const fc = (c - a) / (b - a);
  return () => {
    const u = rnd();
    return cap(u < fc ? a + Math.sqrt(u * (b - a) * (c - a)) : b - Math.sqrt((1 - u) * (b - a) * (b - c)));
  };
}

export function simulateSizing(
  model: SizingModel,
  factors: RangedFactor[],
  opts: { draws?: number; seed?: number; threshold?: number | null; widen?: number } = {},
): SimulationResult | null {
  const widen = opts.widen != null && Number.isFinite(opts.widen) && opts.widen > 1 ? opts.widen : 1;
  const unitOf = Object.fromEntries(MODEL_FACTORS[model].map((d) => [d.key, d.unit]));
  const ranged = factors.filter(hasRange).map((f) => widenRange(f, unitOf[f.key], widen));
  if (ranged.length === 0) return null;
  const draws = opts.draws ?? SIMULATION_DRAWS;
  const seed = opts.seed ?? SIMULATION_SEED;
  const units = unitOf;
  const point: Record<string, number> = Object.fromEntries(factors.map((f) => [f.key, f.value]));
  const rnd = mulberry32(seed);
  // Fixed key order keeps the stream of random numbers per factor stable.
  const samplers = [...ranged].sort((x, y) => x.key.localeCompare(y.key)).map((f) => ({ key: f.key, draw: sampler(f, units[f.key], rnd) }));
  const counts = new Float64Array(draws);
  const revenues = new Float64Array(draws);
  const threshold = opts.threshold ?? null;
  let above = 0;
  for (let i = 0; i < draws; i++) {
    const v = { ...point };
    for (const s of samplers) v[s.key] = s.draw();
    const r = somFor(model, v);
    counts[i] = r.count;
    revenues[i] = r.revenue;
    if (threshold != null && r.revenue >= threshold) above++;
  }
  const sc = Array.from(counts).sort((a, b) => a - b);
  const sr = Array.from(revenues).sort((a, b) => a - b);
  const q = (s: number[]): Percentiles => ({ p10: percentile(s, 0.1), p50: percentile(s, 0.5), p90: percentile(s, 0.9) });
  const swings = ranged.map((f) => ({
    key: f.key,
    swing: Math.abs(somFor(model, { ...point, [f.key]: f.high }).revenue - somFor(model, { ...point, [f.key]: f.low }).revenue),
  }));
  const total = swings.reduce((s, x) => s + x.swing * x.swing, 0);
  const drivers = swings
    .map((s) => ({ ...s, share: total > 0 ? (s.swing * s.swing) / total : 0 }))
    .sort((a, b) => b.swing - a.swing || a.key.localeCompare(b.key));
  return {
    draws,
    seed,
    rangedFactors: ranged.length,
    widen,
    somCount: q(sc),
    somRevenue: q(sr),
    threshold,
    pAboveThreshold: threshold != null ? above / draws : null,
    drivers,
    method: `${draws.toLocaleString("nl-NL")} trekkingen; log-normaal bij een bandbreedte boven 0, driehoek bij een ondergrens van 0${widen > 1 ? `; bandbreedtes ${widen.toLocaleString("nl-NL")}× verbreed omdat de factoren in jaar of regio verschillen` : ""}`,
  };
}

// Verbreedt een 90%-bandbreedte met factor w (golf C, punt 8). Log-normaal (ondergrens > 0): de afstand tot het
// geometrisch midden wordt in log-schaal w keer zo groot, dus de spreiding (sigma) ook. Driehoek (ondergrens 0): de
// ondergrens blijft 0 en de afstand van de waarde tot de bovengrens wordt w keer zo groot. Percentages blijven <= 100.
export function widenRange<T extends RangedFactor & { low: number; high: number }>(f: T, unit: FactorUnit | undefined, w: number): T {
  if (w <= 1) return f;
  const cap = (x: number) => (unit === "percent" ? Math.min(100, x) : x);
  if (f.low > 0) {
    const mid = Math.sqrt(f.low * f.high);
    return { ...f, low: mid * Math.pow(f.low / mid, w), high: cap(mid * Math.pow(f.high / mid, w)) };
  }
  const c = Math.min(f.high, Math.max(f.low, f.value));
  return { ...f, high: cap(c + (f.high - c) * w) };
}

// ---------------------------------------------------------------------------
// Jaar en regio per factor (golf C, punt 8). Factoren die uit verschillende jaren (meer dan 2 jaar uit elkaar) of
// verschillende regio's komen, passen niet zonder meer in één vermenigvuldiging. Dat levert een waarschuwing en een
// bredere onzekerheidsband in de simulatie op: ×1,5 per soort verschil (jaar, regio), dus ×2 bij beide.
// Een onbekend jaar of een onbekende regio is geen verschil, maar wordt wel gemeld.
// ---------------------------------------------------------------------------

export const MAX_YEAR_GAP = 2;
export const WIDEN_PER_MISMATCH = 0.5;

export type FactorOrigin = { key: string; label?: string; year?: number | null; region?: string | null };

export type FactorConsistency = {
  yearGap: number | null; // verschil tussen het oudste en nieuwste bekende jaar
  regions: string[]; // de verschillende regio's (eerste schrijfwijze per gebied)
  yearMismatch: boolean;
  regionMismatch: boolean;
  unknownYear: string[]; // keys zonder jaar
  unknownRegion: string[]; // keys zonder regio
  widen: number; // 1, 1,5 of 2
  warnings: string[];
};

const knownRegion = (r: string | null | undefined): r is string => r != null && r.trim() !== "" && r.trim().toLowerCase() !== "onbekend";
const knownYear = (y: number | null | undefined): y is number => y != null && Number.isFinite(y);

// Twee regio's zijn hetzelfde gebied als ze elkaar over en weer dekken ("Nederland" en "NL").
export function sameRegion(a: string, b: string): boolean {
  return regionMatches(a, b) && regionMatches(b, a);
}

export function factorConsistency(factors: FactorOrigin[]): FactorConsistency {
  const name = (f: FactorOrigin) => f.label ?? f.key;
  const years = factors.filter((f) => knownYear(f.year)) as (FactorOrigin & { year: number })[];
  const yearGap = years.length ? Math.max(...years.map((f) => f.year)) - Math.min(...years.map((f) => f.year)) : null;
  const yearMismatch = yearGap != null && yearGap > MAX_YEAR_GAP;
  const groups: { region: string; factors: FactorOrigin[] }[] = [];
  for (const f of factors) {
    if (!knownRegion(f.region)) continue;
    const region = f.region;
    const g = groups.find((x) => sameRegion(x.region, region));
    if (g) g.factors.push(f);
    else groups.push({ region: region.trim(), factors: [f] });
  }
  const regionMismatch = groups.length > 1;
  const warnings: string[] = [];
  if (yearMismatch) {
    const oldest = years.reduce((a, b) => (b.year < a.year ? b : a));
    const newest = years.reduce((a, b) => (b.year > a.year ? b : a));
    warnings.push(
      `De factoren komen uit jaren die ${yearGap} jaar uit elkaar liggen (${name(oldest)}: ${oldest.year}, ${name(newest)}: ${newest.year}); meer dan ${MAX_YEAR_GAP} jaar verschil maakt de uitkomst onzekerder.`,
    );
  }
  if (regionMismatch) {
    warnings.push(
      `De factoren gaan over verschillende regio's (${groups.map((g) => `${g.region}: ${g.factors.map(name).join(", ")}`).join("; ")}); ze passen niet zonder meer in één berekening.`,
    );
  }
  const widen = 1 + WIDEN_PER_MISMATCH * (Number(yearMismatch) + Number(regionMismatch));
  if (widen > 1) warnings.push(`De simulatie verbreedt daarom elke bandbreedte ${widen.toLocaleString("nl-NL")}×.`);
  return {
    yearGap,
    regions: groups.map((g) => g.region),
    yearMismatch,
    regionMismatch,
    unknownYear: factors.filter((f) => !knownYear(f.year)).map((f) => f.key),
    unknownRegion: factors.filter((f) => !knownRegion(f.region)).map((f) => f.key),
    widen,
    warnings,
  };
}
