// Bottom-up market sizing and unit economics. Pure, deterministic arithmetic: recalculating a
// scenario never needs an LLM call, and every factor keeps its provenance.

import type { ClaimStatus } from "./labels";

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
  label: string;
};

const fmtInt = (n: number) => Math.round(n).toLocaleString("nl-NL");
const fmtEur = (n: number) => `€ ${Math.round(n).toLocaleString("nl-NL")}`;
const fmtPct = (n: number) => `${n.toLocaleString("nl-NL", { maximumFractionDigits: 2 })}%`;

export function computeSizing(model: SizingModel, factors: Factor[]): SizingResult {
  const get = (k: string) => factors.find((f) => f.key === k)?.value ?? 0;
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
      ? `${get("frequency").toLocaleString("nl-NL")} × ${fmtEur(get("ticket"))}`
      : fmtEur(perCustomer);

  const defs = MODEL_FACTORS[model];
  const sourced = defs.filter((d) => factorSourced(factors.find((f) => f.key === d.key))).length;
  const established = factorSourced(factors.find((f) => f.key === "base_count"));

  return {
    tamCount,
    samCount,
    somCount,
    tamRevenue: tamCount * perCustomer,
    samRevenue: samCount * perCustomer,
    somRevenue: somCount * perCustomer,
    formula: `${fmtInt(base)} × ${fmtPct(get("fit_pct"))} × ${fmtPct(get("reach_pct"))} × ${fmtPct(get("winnable_pct"))} × ${revenueFormula}`,
    provenance: { sourced, assumed: defs.length - sourced, total: defs.length },
    established,
    label: established
      ? sourced === defs.length
        ? "Onderbouwd scenario"
        : "Scenario met deels aangenomen factoren"
      : "Verkennend scenario; marktomvang niet vastgesteld",
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
