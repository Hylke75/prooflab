// Businesscase (voorstel docs/ONTWERP_BUSINESSCASE.md): een maandmodel van omzet, kosten, resultaat en kas, voor
// iemand zonder financiële kennis. Puur en deterministisch: geen AI, geen database, geen React. De bestaande formules
// in sizing.ts (marktomvang, simulatie, financiële haalbaarheid) blijven ongewijzigd; dit model staat ernaast en
// gebruikt de haalbare markt alleen als controle.
//
// Eerlijkheid:
// - Elk getal heeft een label: eigen schatting, bevestigd (met herkomst) of voorstel. Een voorstel telt pas mee na
//   overnemen; tot dan is het onbekend.
// - Onbekend is onbekend: een leeg veld is geen 0, en de uitkomst zegt welke gegevens ontbreken.
// - Conservatief en optimistisch zijn zichtbare, aanpasbare afwijkingen van het realistische scenario.

import { SCENARIO_LABELS, type ScenarioKind } from "./sizing";

export const BUSINESS_CASE_VERSION = 1;
export const MAX_AMOUNT = 1_000_000_000;
export const MAX_LIST = 20;

export type ValueLabel = "estimate" | "confirmed" | "proposal";
export type BcValue = { v: number | null; label: ValueLabel; source?: string | null };

export type StreamKind = "subscription" | "unit_sale" | "service" | "rental" | "funding" | "other";
export type FundingCertainty = "certain" | "applied" | "idea";
export type Ramp = "direct" | "fast" | "medium" | "slow";
export type Goal = "profitable" | "capital" | "breakeven" | "coverage";
export type StepKey = "idea" | "earn" | "sales" | "growth" | "unit_costs" | "fixed" | "invest" | "goal";

export type Stream = {
  id: string;
  kind: StreamKind;
  name: string;
  // Abonnement: klanten op vol niveau. Verkoop/dienst: aantal per maand op vol niveau. Verhuur: aantal ruimtes of plekken.
  volume: BcValue;
  // Abonnement: per klant per maand. Verkoop/dienst: per stuk of uur. Verhuur: per dagdeel. Subsidie: bedrag per jaar.
  // Overig: bedrag per maand op vol niveau.
  price: BcValue;
  // Kosten per verkoop (abonnement: per klant per maand; verhuur: per verhuurd dagdeel).
  unitCost: BcValue;
  slotsPerWeek?: BcValue; // verhuur: beschikbare dagdelen per ruimte per week
  occupancyPct?: BcValue; // verhuur: verwachte bezetting
  churnPct?: BcValue; // abonnement: deel van de klanten dat per jaar stopt
  cac?: BcValue; // abonnement: kosten om één nieuwe klant te werven
  certainty?: FundingCertainty; // subsidie, fonds of donaties
};

export type CostItem = { id: string; name: string; perMonth: BcValue };
export type Investment = { id: string; name: string; amount: BcValue; years: number };
export type ScenarioAdjust = { volumePct: number; pricePct: number; costPct: number; delayMonths: number };

export type BusinessCaseInputs = {
  version: number;
  description: string;
  question: string;
  goal: Goal | null;
  streams: Stream[];
  ramp: Ramp | null;
  growthPctPerYear: number;
  fixedCosts: CostItem[];
  investments: Investment[];
  horizonMonths: number; // 36 (standaard) of 60
  scenarios: { conservative: ScenarioAdjust; optimistic: ScenarioAdjust };
  answered: StepKey[];
};

export const STEPS: { key: StepKey; title: string; short: string }[] = [
  { key: "idea", title: "Welk idee wil je onderzoeken?", short: "Je idee" },
  { key: "earn", title: "Hoe verdien je geld?", short: "Verdienen" },
  { key: "sales", title: "Hoeveel verwacht je te verkopen, en voor welke prijs?", short: "Verkoop en prijs" },
  { key: "growth", title: "Hoe snel kom je op dat niveau?", short: "Groei" },
  { key: "unit_costs", title: "Wat kost het om te leveren?", short: "Kosten per verkoop" },
  { key: "fixed", title: "Welke vaste kosten heb je per maand?", short: "Vaste kosten" },
  { key: "invest", title: "Hoeveel geld moet je vooraf investeren?", short: "Investeringen" },
  { key: "goal", title: "Wat wil je precies weten?", short: "Je vraag" },
];

export const STREAM_KINDS: Record<StreamKind, { label: string; example: string; defaultName: string }> = {
  subscription: { label: "Abonnement", example: "Klanten betalen elke maand, bijv. software of een lidmaatschap", defaultName: "Abonnementen" },
  unit_sale: { label: "Verkoop per stuk", example: "Producten, kaartjes, of eten en drinken per bezoeker", defaultName: "Verkoop" },
  service: { label: "Per dienst of uur", example: "Advies, trainingen, workshops, opdrachten", defaultName: "Diensten" },
  rental: { label: "Verhuur van ruimte of plekken", example: "Zalen, werkplekken, standplaatsen per dagdeel", defaultName: "Verhuur" },
  funding: { label: "Subsidie, fonds of donaties", example: "Gemeente, fondsen, sponsors, giften", defaultName: "Subsidies en fondsen" },
  other: { label: "Iets anders", example: "Een vast bedrag per maand, bijv. commissie of sponsoring", defaultName: "Overige inkomsten" },
};

export const RAMPS: Record<Ramp, { label: string; months: number; explain: string }> = {
  direct: { label: "Meteen", months: 1, explain: "Vanaf de eerste maand op het verwachte niveau" },
  fast: { label: "Snel", months: 6, explain: "Binnen een half jaar op niveau" },
  medium: { label: "Gemiddeld", months: 12, explain: "Binnen een jaar op niveau (gebruikelijk)" },
  slow: { label: "Rustig", months: 24, explain: "Pas na twee jaar op niveau" },
};

export const FUNDING_CERTAINTY: Record<FundingCertainty, string> = {
  certain: "Toegezegd",
  applied: "Aangevraagd",
  idea: "Nog een idee",
};

export const GOALS: Record<Goal, { label: string; explain: string }> = {
  profitable: { label: "Is het rendabel?", explain: "Houd je na een paar jaar geld over?" },
  capital: { label: "Hoeveel startgeld heb ik nodig?", explain: "Investeringen plus de verliezen tot je quitte speelt" },
  breakeven: { label: "Wanneer speel ik quitte?", explain: "Vanaf welke maand verdien je meer dan je uitgeeft?" },
  coverage: { label: "Zijn de kosten gedekt?", explain: "Voor een stichting of project: hoeveel dekking mis je nog?" },
};

export const DEFAULT_SCENARIOS: BusinessCaseInputs["scenarios"] = {
  conservative: { volumePct: -25, pricePct: 0, costPct: 10, delayMonths: 6 },
  optimistic: { volumePct: 15, pricePct: 0, costPct: -5, delayMonths: 0 },
};
export const DEFAULT_DEPRECIATION_YEARS = 5;

export const empty = (label: ValueLabel = "estimate"): BcValue => ({ v: null, label });

export function emptyInputs(): BusinessCaseInputs {
  return {
    version: BUSINESS_CASE_VERSION,
    description: "",
    question: "",
    goal: null,
    streams: [],
    ramp: null,
    growthPctPerYear: 0,
    fixedCosts: [],
    investments: [],
    horizonMonths: 36,
    scenarios: structuredClone(DEFAULT_SCENARIOS),
    answered: [],
  };
}

// Een waarde telt mee als hij bekend is en geen open voorstel.
export const counted = (x: BcValue | undefined): number | null =>
  x && x.label !== "proposal" && x.v != null && Number.isFinite(x.v) ? x.v : null;

// Welke vragen bij een inkomstenbron horen (conditioneel).
export function streamNeeds(kind: StreamKind): { volume: boolean; unitCost: boolean; rental: boolean; churn: boolean } {
  return {
    volume: kind !== "funding" && kind !== "other",
    unitCost: kind === "subscription" || kind === "unit_sale" || kind === "service" || kind === "rental",
    rental: kind === "rental",
    churn: kind === "subscription",
  };
}

export const VOLUME_LABEL: Record<StreamKind, string> = {
  subscription: "Hoeveel betalende klanten heb je als het loopt?",
  unit_sale: "Hoeveel verkoop je per maand als het loopt?",
  service: "Hoeveel uren of opdrachten per maand als het loopt?",
  rental: "Hoeveel ruimtes of plekken verhuur je?",
  funding: "",
  other: "",
};
export const PRICE_LABEL: Record<StreamKind, string> = {
  subscription: "Wat betaalt een klant per maand?",
  unit_sale: "Wat betaalt een klant per stuk?",
  service: "Wat vraag je per uur of opdracht?",
  rental: "Wat kost één dagdeel huur?",
  funding: "Hoeveel geld per jaar?",
  other: "Hoeveel per maand als het loopt?",
};
export const UNIT_COST_LABEL: Record<StreamKind, string> = {
  subscription: "Wat kost één klant jou per maand?",
  unit_sale: "Wat kost één verkocht stuk jou aan inkoop of materiaal?",
  service: "Wat kost één uur of opdracht jou aan materiaal of inhuur?",
  rental: "Wat kost één verhuurd dagdeel jou (schoonmaak, energie, inzet)?",
  funding: "",
  other: "",
};

// ---------------------------------------------------------------------------
// Rekenen
// ---------------------------------------------------------------------------

export type MonthRow = {
  month: number; // 0 = eerste maand
  revenue: number;
  variableCosts: number;
  acquisitionCosts: number;
  fixedCosts: number;
  depreciation: number;
  investment: number;
  operating: number; // omzet − variabele, werving en vaste kosten
  result: number; // operating − afschrijving (winst of verlies)
  cash: number; // operating − investering
  cumulativeCash: number;
};

export type YearRow = { year: number; revenue: number; costs: number; depreciation: number; result: number; cash: number };

export type ScenarioResult = {
  kind: ScenarioKind;
  months: MonthRow[];
  years: YearRow[];
  breakEvenMonth: number | null; // eerste maand vanaf wanneer je elke maand meer verdient dan je uitgeeft
  startCapital: number; // laagste kasstand (investeringen + verliezen tot quitte)
  paybackMonth: number | null; // maand waarin alle uitgaven terugverdiend zijn; 0 als er niets terug te verdienen valt
  totalResult: number;
  monthlyAtLevel: number; // resultaat per maand aan het eind van de periode, vóór afschrijving
};

const ZERO: ScenarioAdjust = { volumePct: 0, pricePct: 0, costPct: 0, delayMonths: 0 };

export function adjustFor(inputs: BusinessCaseInputs, kind: ScenarioKind): ScenarioAdjust {
  return kind === "realistic" ? ZERO : inputs.scenarios[kind];
}

function rampLevel(ramp: Ramp | null, m: number): number {
  if (m < 0) return 0;
  const months = RAMPS[ramp ?? "medium"].months;
  return Math.min(1, (m + 1) / months);
}

function fundingCounts(c: FundingCertainty | undefined, kind: ScenarioKind): boolean {
  const certainty = c ?? "idea";
  if (kind === "conservative") return certainty === "certain";
  if (kind === "realistic") return certainty !== "idea";
  return true;
}

export function computeScenario(inputs: BusinessCaseInputs, kind: ScenarioKind): ScenarioResult {
  const a = adjustFor(inputs, kind);
  const vf = 1 + a.volumePct / 100;
  const pf = 1 + a.pricePct / 100;
  const cf = 1 + a.costPct / 100;
  const horizon = Math.max(12, Math.min(120, Math.round(inputs.horizonMonths || 36)));
  const g = Math.max(-0.9, (inputs.growthPctPerYear || 0) / 100);
  const fixed = inputs.fixedCosts.reduce((s, c) => s + (counted(c.perMonth) ?? 0), 0) * cf;
  const invs = inputs.investments.map((i) => ({ amount: (counted(i.amount) ?? 0) * cf, months: Math.max(1, Math.round((i.years || DEFAULT_DEPRECIATION_YEARS) * 12)) }));
  const prevActive = new Map<string, number>();
  const months: MonthRow[] = [];
  let cumulative = 0;
  for (let m = 0; m < horizon; m++) {
    const level = rampLevel(inputs.ramp, m - Math.max(0, Math.round(a.delayMonths)));
    const growth = Math.pow(1 + g, Math.floor(m / 12));
    let revenue = 0;
    let variable = 0;
    let acquisition = 0;
    for (const s of inputs.streams) {
      const price = counted(s.price);
      if (price == null) continue;
      const uc = counted(s.unitCost) ?? 0;
      if (s.kind === "funding") {
        if (fundingCounts(s.certainty, kind)) revenue += (price / 12) * pf;
        continue;
      }
      if (s.kind === "other") {
        revenue += price * pf * vf * level * growth;
        continue;
      }
      const volume = counted(s.volume);
      if (volume == null) continue;
      if (s.kind === "rental") {
        const slots = counted(s.slotsPerWeek) ?? 0;
        const occ = Math.min(1, ((counted(s.occupancyPct) ?? 0) / 100) * vf);
        const qty = ((volume * slots * occ * 52) / 12) * level * growth;
        revenue += qty * price * pf;
        variable += qty * uc * cf;
        continue;
      }
      const qty = volume * vf * level * growth;
      revenue += qty * price * pf;
      variable += qty * uc * cf;
      if (s.kind === "subscription") {
        const before = prevActive.get(s.id) ?? 0;
        const churn = (counted(s.churnPct) ?? 0) / 100 / 12;
        const newCustomers = Math.max(0, qty - before) + before * churn;
        acquisition += newCustomers * (counted(s.cac) ?? 0) * cf;
        prevActive.set(s.id, qty);
      }
    }
    const depreciation = invs.reduce((sum, i) => sum + (m < i.months ? i.amount / i.months : 0), 0);
    const investment = m === 0 ? invs.reduce((sum, i) => sum + i.amount, 0) : 0;
    const operating = revenue - variable - acquisition - fixed;
    const cash = operating - investment;
    cumulative += cash;
    months.push({
      month: m,
      revenue,
      variableCosts: variable,
      acquisitionCosts: acquisition,
      fixedCosts: fixed,
      depreciation,
      investment,
      operating,
      result: operating - depreciation,
      cash,
      cumulativeCash: cumulative,
    });
  }

  const years: YearRow[] = [];
  for (let y = 0; y * 12 < months.length; y++) {
    const ms = months.slice(y * 12, y * 12 + 12);
    const sum = (f: (r: MonthRow) => number) => ms.reduce((s, r) => s + f(r), 0);
    years.push({
      year: y + 1,
      revenue: sum((r) => r.revenue),
      costs: sum((r) => r.variableCosts + r.acquisitionCosts + r.fixedCosts),
      depreciation: sum((r) => r.depreciation),
      result: sum((r) => r.result),
      cash: sum((r) => r.cash),
    });
  }

  // Quitte: vanaf deze maand is elke volgende maand niet negatief (en er is omzet).
  let breakEvenMonth: number | null = null;
  for (let m = months.length - 1; m >= 0; m--) {
    if (months[m].operating >= 0 && months[m].revenue > 0) breakEvenMonth = m;
    else break;
  }
  let minCum = 0;
  let minAt = -1;
  months.forEach((r, i) => {
    if (r.cumulativeCash < minCum) {
      minCum = r.cumulativeCash;
      minAt = i;
    }
  });
  const startCapital = -minCum;
  let paybackMonth: number | null = startCapital === 0 ? 0 : null;
  if (minAt >= 0) {
    for (let m = minAt + 1; m < months.length; m++) {
      if (months[m].cumulativeCash >= 0) {
        paybackMonth = m;
        break;
      }
    }
  }
  return {
    kind,
    months,
    years,
    breakEvenMonth,
    startCapital,
    paybackMonth,
    totalResult: months.reduce((s, r) => s + r.result, 0),
    monthlyAtLevel: months.length ? months[months.length - 1].operating : 0,
  };
}

// ---------------------------------------------------------------------------
// Wat weten we, wat ontbreekt, hoe haalbaar, hoe zeker
// ---------------------------------------------------------------------------

export type Missing = { step: StepKey; text: string };

export function missingInputs(inputs: BusinessCaseInputs): Missing[] {
  const out: Missing[] = [];
  const answered = new Set(inputs.answered);
  if (!inputs.description.trim()) out.push({ step: "idea", text: "Een korte omschrijving van je idee" });
  if (inputs.streams.length === 0) out.push({ step: "earn", text: "Hoe je geld verdient" });
  for (const s of inputs.streams) {
    const need = streamNeeds(s.kind);
    if (counted(s.price) == null) out.push({ step: "sales", text: `${s.name}: ${s.kind === "funding" ? "het bedrag per jaar" : "de prijs"}` });
    if (need.volume && counted(s.volume) == null) out.push({ step: "sales", text: `${s.name}: ${s.kind === "rental" ? "het aantal ruimtes" : "hoeveel je verkoopt"}` });
    if (need.rental && counted(s.slotsPerWeek) == null) out.push({ step: "sales", text: `${s.name}: beschikbare dagdelen per week` });
    if (need.rental && counted(s.occupancyPct) == null) out.push({ step: "sales", text: `${s.name}: de verwachte bezetting` });
    if (need.unitCost && counted(s.unitCost) == null) out.push({ step: "unit_costs", text: `${s.name}: de kosten per verkoop` });
    if (need.churn && counted(s.churnPct) == null) out.push({ step: "unit_costs", text: `${s.name}: hoeveel klanten per jaar stoppen` });
  }
  if (!answered.has("growth") && inputs.ramp == null && inputs.streams.some((s) => s.kind !== "funding")) out.push({ step: "growth", text: "Hoe snel je op niveau komt (nu: gemiddeld, binnen een jaar)" });
  if (!answered.has("fixed")) out.push({ step: "fixed", text: "Je vaste kosten per maand" });
  if (!answered.has("invest")) out.push({ step: "invest", text: "Wat je vooraf moet investeren" });
  for (const c of inputs.fixedCosts) if (counted(c.perMonth) == null) out.push({ step: "fixed", text: `${c.name}: het bedrag per maand` });
  for (const i of inputs.investments) if (counted(i.amount) == null) out.push({ step: "invest", text: `${i.name}: het bedrag` });
  return out;
}

export type Verdict = "unknown" | "revenue_only" | "not_yet" | "tight" | "looks_feasible";

export const VERDICTS: Record<Verdict, { label: string; tone: "gray" | "blue" | "coral" | "orange" | "green" }> = {
  unknown: { label: "Te weinig gegevens", tone: "gray" },
  revenue_only: { label: "Alleen de omzet is bekend", tone: "blue" },
  not_yet: { label: "Nog niet haalbaar", tone: "coral" },
  tight: { label: "Krap", tone: "orange" },
  looks_feasible: { label: "Lijkt haalbaar", tone: "green" },
};

export type Reliability = { confirmed: number; estimate: number; proposal: number; total: number; level: "low" | "medium" | "high" };

export function allValues(inputs: BusinessCaseInputs): { name: string; value: BcValue }[] {
  const out: { name: string; value: BcValue }[] = [];
  for (const s of inputs.streams) {
    const need = streamNeeds(s.kind);
    out.push({ name: `${s.name}: ${s.kind === "funding" ? "bedrag per jaar" : "prijs"}`, value: s.price });
    if (need.volume) out.push({ name: `${s.name}: ${s.kind === "rental" ? "aantal ruimtes" : "aantal"}`, value: s.volume });
    if (need.rental && s.slotsPerWeek) out.push({ name: `${s.name}: dagdelen per week`, value: s.slotsPerWeek });
    if (need.rental && s.occupancyPct) out.push({ name: `${s.name}: bezetting`, value: s.occupancyPct });
    if (need.unitCost) out.push({ name: `${s.name}: kosten per verkoop`, value: s.unitCost });
    if (need.churn && s.churnPct) out.push({ name: `${s.name}: klantverloop`, value: s.churnPct });
    if (need.churn && s.cac && s.cac.v != null) out.push({ name: `${s.name}: wervingskosten`, value: s.cac });
  }
  for (const c of inputs.fixedCosts) out.push({ name: c.name, value: c.perMonth });
  for (const i of inputs.investments) out.push({ name: i.name, value: i.amount });
  return out.filter((x) => x.value.v != null);
}

export function reliability(inputs: BusinessCaseInputs): Reliability {
  const vals = allValues(inputs);
  const confirmed = vals.filter((x) => x.value.label === "confirmed").length;
  const proposal = vals.filter((x) => x.value.label === "proposal").length;
  const estimate = vals.length - confirmed - proposal;
  const usable = confirmed + estimate;
  const share = usable ? confirmed / usable : 0;
  return { confirmed, estimate, proposal, total: vals.length, level: share >= 0.6 ? "high" : share >= 0.25 ? "medium" : "low" };
}

export function revenueKnown(inputs: BusinessCaseInputs): boolean {
  return inputs.streams.some((s) => {
    if (counted(s.price) == null) return false;
    if (!streamNeeds(s.kind).volume) return true;
    if (counted(s.volume) == null) return false;
    return s.kind !== "rental" || (counted(s.slotsPerWeek) != null && counted(s.occupancyPct) != null);
  });
}

export function verdictFor(inputs: BusinessCaseInputs, realistic: ScenarioResult, conservative: ScenarioResult): Verdict {
  if (!revenueKnown(inputs)) return "unknown";
  if (!inputs.answered.includes("fixed") && inputs.fixedCosts.length === 0) return "revenue_only";
  const lastReal = realistic.years[realistic.years.length - 1];
  if (realistic.breakEvenMonth == null || !lastReal || lastReal.result <= 0) return "not_yet";
  const lastCons = conservative.years[conservative.years.length - 1];
  if (conservative.breakEvenMonth == null || !lastCons || lastCons.result <= 0) return "tight";
  return "looks_feasible";
}

// ---------------------------------------------------------------------------
// Wat weegt het zwaarst: één aanname tegelijk 20% lager en hoger, de rest gelijk (realistisch scenario).
// ---------------------------------------------------------------------------

export const SENSITIVITY_STEP = 0.2;
export type Driver = { name: string; label: ValueLabel; swing: number; lowEffect: number; highEffect: number };

export function sensitivity(inputs: BusinessCaseInputs, top = 3): Driver[] {
  const base = computeScenario(inputs, "realistic").totalResult;
  const targets: { name: string; get: (i: BusinessCaseInputs) => BcValue | undefined }[] = [];
  inputs.streams.forEach((s, si) => {
    const need = streamNeeds(s.kind);
    targets.push({ name: `${s.name}: ${s.kind === "funding" ? "bedrag" : "prijs"}`, get: (i) => i.streams[si].price });
    if (need.volume) targets.push({ name: `${s.name}: ${s.kind === "rental" ? "aantal ruimtes" : "aantal"}`, get: (i) => i.streams[si].volume });
    if (need.rental) targets.push({ name: `${s.name}: bezetting`, get: (i) => i.streams[si].occupancyPct });
    if (need.unitCost) targets.push({ name: `${s.name}: kosten per verkoop`, get: (i) => i.streams[si].unitCost });
  });
  inputs.fixedCosts.forEach((c, ci) => targets.push({ name: c.name, get: (i) => i.fixedCosts[ci].perMonth }));
  inputs.investments.forEach((v, vi) => targets.push({ name: v.name, get: (i) => i.investments[vi].amount }));
  const drivers: Driver[] = [];
  for (const t of targets) {
    const orig = t.get(inputs);
    const v = counted(orig);
    if (v == null || v === 0 || !orig) continue;
    const at = (f: number) => {
      const copy = structuredClone(inputs);
      const target = t.get(copy)!;
      target.v = v * f;
      return computeScenario(copy, "realistic").totalResult - base;
    };
    const lowEffect = at(1 - SENSITIVITY_STEP);
    const highEffect = at(1 + SENSITIVITY_STEP);
    drivers.push({ name: t.name, label: orig.label, swing: Math.abs(highEffect - lowEffect), lowEffect, highEffect });
  }
  return drivers.filter((d) => d.swing > 0.5).sort((a, b) => b.swing - a.swing || a.name.localeCompare(b.name)).slice(0, top);
}

// ---------------------------------------------------------------------------
// Controles: ontbrekende posten, onrealistische of tegenstrijdige waarden. Vaste regels met de reden erbij.
// ---------------------------------------------------------------------------

export type Check = { level: "warning" | "info"; step: StepKey; text: string };
export type MarketContext = { somCount: number | null; somRevenue: number | null; intakePricePerYear: number | null };

const nl = (n: number) => Math.round(n).toLocaleString("nl-NL");

export function checks(inputs: BusinessCaseInputs, realistic: ScenarioResult, market: MarketContext = { somCount: null, somRevenue: null, intakePricePerYear: null }): Check[] {
  const out: Check[] = [];
  const answered = new Set(inputs.answered);
  for (const s of inputs.streams) {
    const price = counted(s.price);
    const uc = counted(s.unitCost);
    if (price != null && uc != null && streamNeeds(s.kind).unitCost && uc >= price && price > 0) {
      out.push({ level: "warning", step: "unit_costs", text: `${s.name}: de kosten per verkoop (€ ${nl(uc)}) zijn even hoog of hoger dan de prijs (€ ${nl(price)}). Op elke verkoop verlies je dan geld.` });
    }
    if (s.kind === "rental") {
      const occ = counted(s.occupancyPct);
      if (occ != null && occ > 85) out.push({ level: "info", step: "sales", text: `${s.name}: ${nl(occ)}% bezetting is uitzonderlijk hoog. Veel locaties zitten tussen 40 en 70%; reken in het conservatieve scenario met minder.` });
    }
    if (s.kind === "subscription") {
      const churn = counted(s.churnPct);
      if (churn === 0) out.push({ level: "warning", step: "unit_costs", text: `${s.name}: 0% klantverloop is onrealistisch; vrijwel elk abonnement verliest klanten.` });
      const vol = counted(s.volume);
      if (vol != null && market.somCount != null && market.somCount > 0 && vol > market.somCount) {
        out.push({ level: "warning", step: "sales", text: `${s.name}: je rekent met ${nl(vol)} klanten, terwijl de haalbare markt in Marktpotentieel ${nl(market.somCount)} klanten is.` });
      }
      if (price != null && market.intakePricePerYear != null && market.intakePricePerYear > 0) {
        const diff = Math.abs(price * 12 - market.intakePricePerYear) / market.intakePricePerYear;
        if (diff > 0.2) out.push({ level: "info", step: "sales", text: `${s.name}: de prijs (€ ${nl(price * 12)} per jaar) wijkt af van de prijs uit de intake (€ ${nl(market.intakePricePerYear)} per jaar). Welke klopt?` });
      }
    }
    if (s.kind === "funding" && (s.certainty ?? "idea") === "idea" && price != null) {
      out.push({ level: "info", step: "sales", text: `${s.name}: dit geld is nog een idee. Het telt alleen mee in het optimistische scenario.` });
    }
  }
  if (market.somRevenue != null && market.somRevenue > 0) {
    const y2 = realistic.years[1]?.revenue ?? realistic.years[0]?.revenue ?? 0;
    const paid = inputs.streams.some((s) => s.kind !== "funding");
    if (paid && y2 > market.somRevenue * 1.05) {
      out.push({ level: "warning", step: "sales", text: `Je omzet in jaar 2 (€ ${nl(y2)}) is hoger dan het haalbare omzetpotentieel in Marktpotentieel (€ ${nl(market.somRevenue)}).` });
    }
  }
  if (answered.has("fixed")) {
    const total = inputs.fixedCosts.reduce((s, c) => s + (counted(c.perMonth) ?? 0), 0);
    if (inputs.fixedCosts.length === 0 || total === 0) out.push({ level: "warning", step: "fixed", text: "Je hebt geen vaste kosten ingevuld. Bijna elke onderneming heeft die: denk aan huur, personeel, verzekeringen, software of boekhouding." });
    const names = inputs.fixedCosts.map((c) => c.name.toLowerCase()).join(" ");
    if (inputs.streams.some((s) => s.kind === "rental") && !/huur|pacht|hypotheek/.test(names)) {
      out.push({ level: "info", step: "fixed", text: "Je verhuurt ruimte, maar er staat geen huur of hypotheek bij de vaste kosten. Is het pand al van jou?" });
    }
    if (inputs.streams.some((s) => s.kind === "service" || s.kind === "rental") && !/personeel|salaris|loon|medewerker|inhuur|fte|eigen inkomen/.test(names)) {
      out.push({ level: "info", step: "fixed", text: "Er staan geen personeelskosten of een eigen inkomen bij de vaste kosten. Wie doet het werk, en wat kost dat?" });
    }
  }
  if (inputs.growthPctPerYear > 100) out.push({ level: "warning", step: "growth", text: `${nl(inputs.growthPctPerYear)}% groei per jaar, jaar na jaar, is zeer uitzonderlijk.` });
  return out;
}

// ---------------------------------------------------------------------------
// Alles in één keer, voor scherm en rapport.
// ---------------------------------------------------------------------------

export type BusinessCaseResult = {
  scenarios: Record<ScenarioKind, ScenarioResult>;
  verdict: Verdict;
  missing: Missing[];
  reliability: Reliability;
  drivers: Driver[];
  checks: Check[];
  revenueKnown: boolean;
};

export function computeBusinessCase(inputs: BusinessCaseInputs, market?: MarketContext): BusinessCaseResult {
  const scenarios = {
    conservative: computeScenario(inputs, "conservative"),
    realistic: computeScenario(inputs, "realistic"),
    optimistic: computeScenario(inputs, "optimistic"),
  };
  return {
    scenarios,
    verdict: verdictFor(inputs, scenarios.realistic, scenarios.conservative),
    missing: missingInputs(inputs),
    reliability: reliability(inputs),
    drivers: sensitivity(inputs),
    checks: checks(inputs, scenarios.realistic, market),
    revenueKnown: revenueKnown(inputs),
  };
}

export const SCENARIO_ORDER: ScenarioKind[] = ["conservative", "realistic", "optimistic"];
export { SCENARIO_LABELS };

// Eén zin bij het oordeel, in gewone taal.
export function verdictSentence(r: BusinessCaseResult, horizonMonths: number): string {
  const real = r.scenarios.realistic;
  const years = Math.round(horizonMonths / 12);
  switch (r.verdict) {
    case "unknown":
      return "Vul in hoe je geld verdient, hoeveel je verkoopt en voor welke prijs. Dan zie je meteen een eerste omzet.";
    case "revenue_only":
      return `Je verwachte omzet is bekend. Vul je vaste kosten in om te zien of je er geld aan overhoudt.`;
    case "not_yet":
      return `Met deze aannames verdien je binnen ${years} jaar nog niet meer dan je uitgeeft. Kijk hieronder welke aanname het zwaarst weegt.`;
    case "tight":
      return `In het realistische scenario speel je quitte${real.breakEvenMonth != null ? ` vanaf maand ${real.breakEvenMonth + 1}` : ""}, maar als het tegenvalt niet. Er is weinig ruimte voor tegenvallers.`;
    case "looks_feasible":
      return `Ook als het tegenvalt speel je binnen ${years} jaar quitte. In het realistische scenario vanaf maand ${(real.breakEvenMonth ?? 0) + 1}.`;
  }
}

// ---------------------------------------------------------------------------
// Startwaarden en koppeling met Financiële haalbaarheid (unit_economics)
// ---------------------------------------------------------------------------

export type UnitEconomicsRow = {
  price_per_customer_year: number | null;
  gross_margin_pct: number | null;
  cac_eur: number | null;
  annual_churn_pct: number | null;
  fixed_costs_year: number | null;
  upfront_investment: number | null;
};

export function initialInputs(p: { description: string | null; question: string | null; ue: Partial<UnitEconomicsRow> | null }): BusinessCaseInputs {
  const x = emptyInputs();
  x.description = (p.description ?? "").slice(0, 2000);
  x.question = (p.question ?? "").slice(0, 600);
  const fixed = p.ue?.fixed_costs_year;
  if (fixed != null && Number.isFinite(fixed) && fixed > 0) {
    x.fixedCosts.push({ id: "ue-fixed", name: "Vaste kosten (uit Financiële haalbaarheid)", perMonth: { v: Math.round((fixed / 12) * 100) / 100, label: "estimate", source: "Overgenomen uit Financiële haalbaarheid" } });
    x.answered.push("fixed");
  }
  const inv = p.ue?.upfront_investment;
  if (inv != null && Number.isFinite(inv) && inv > 0) {
    x.investments.push({ id: "ue-invest", name: "Investering (uit Financiële haalbaarheid)", amount: { v: inv, label: "estimate", source: "Overgenomen uit Financiële haalbaarheid" }, years: DEFAULT_DEPRECIATION_YEARS });
    x.answered.push("invest");
  }
  return x;
}

// De zes velden van Financiële haalbaarheid die uit de businesscase volgen. Alleen wat bekend is; de rest blijft
// zoals het was (undefined = niet overschrijven).
export function unitEconomicsFromCase(inputs: BusinessCaseInputs): Partial<UnitEconomicsRow> {
  const out: Partial<UnitEconomicsRow> = {};
  const subs = inputs.streams.filter((s) => s.kind === "subscription");
  if (subs.length === 1 && inputs.streams.length === 1) {
    const s = subs[0];
    const price = counted(s.price);
    if (price != null) out.price_per_customer_year = round2(price * 12);
    const churn = counted(s.churnPct);
    if (churn != null && churn <= 100) out.annual_churn_pct = churn;
    const cac = counted(s.cac);
    if (cac != null) out.cac_eur = cac;
  }
  const paid = inputs.streams.filter((s) => streamNeeds(s.kind).unitCost);
  if (paid.length && paid.every((s) => counted(s.unitCost) != null)) {
    const real = computeScenario(inputs, "realistic");
    const last = real.months[real.months.length - 1];
    const fundingAndOther = inputs.streams.filter((s) => !streamNeeds(s.kind).unitCost).length;
    if (last && last.revenue > 0 && fundingAndOther === 0) {
      const margin = ((last.revenue - last.variableCosts) / last.revenue) * 100;
      if (margin >= 0 && margin <= 100) out.gross_margin_pct = round2(margin);
    }
  }
  if (inputs.answered.includes("fixed")) out.fixed_costs_year = round2(inputs.fixedCosts.reduce((s, c) => s + (counted(c.perMonth) ?? 0), 0) * 12);
  if (inputs.answered.includes("invest")) out.upfront_investment = round2(inputs.investments.reduce((s, i) => s + (counted(i.amount) ?? 0), 0));
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Suggesties (vaste regels, zonder bedragen: een voorbeeldbedrag is nooit een feit)
// ---------------------------------------------------------------------------

const KIND_HINTS: { kind: StreamKind; re: RegExp; why: string }[] = [
  { kind: "rental", re: /\b(locatie|zaal|zalen|ruimte|evenementen|vergader|werkplek|co-?working|verhuur|standplaats)/i, why: "je noemt een locatie of ruimte" },
  { kind: "unit_sale", re: /\b(horeca|catering|eten|drinken|webshop|product|verkoop|winkel|kaartjes|tickets|bezoekers)/i, why: "je noemt producten, kaartjes of horeca" },
  { kind: "service", re: /\b(workshop|training|cursus|advies|coaching|dienst|opdracht|uurtarief|begeleiding|zorg)/i, why: "je noemt diensten, workshops of advies" },
  { kind: "subscription", re: /\b(abonnement|saas|software|app|platform|lidmaatschap|leden|maandelijks)/i, why: "je noemt een abonnement, app of lidmaatschap" },
  { kind: "funding", re: /\b(stichting|subsidie|fonds|fondsen|donatie|maatschappelijk|vrijwilligers|gemeente|goede doel)/i, why: "je noemt een stichting, subsidie of maatschappelijk doel" },
];

export function suggestStreams(description: string): { kind: StreamKind; why: string }[] {
  return KIND_HINTS.filter((h) => h.re.test(description)).map(({ kind, why }) => ({ kind, why }));
}

const BASE_COSTS = ["Huur", "Personeel of eigen inkomen", "Marketing en reclame", "Verzekeringen", "Software en abonnementen", "Boekhouding en advies"];
const KIND_COSTS: Partial<Record<StreamKind, string[]>> = {
  rental: ["Energie en water", "Schoonmaak", "Onderhoud"],
  unit_sale: ["Opslag en verzending", "Betaalkosten"],
  subscription: ["Hosting en servers", "Klantenservice"],
  service: ["Reiskosten", "Opleiding"],
  funding: ["Projectcoördinatie", "Vrijwilligersvergoedingen"],
};
const BASE_INVEST = ["Inrichting", "Apparatuur", "Website of app", "Startkosten (KvK, notaris, advies)"];
const KIND_INVEST: Partial<Record<StreamKind, string[]>> = {
  rental: ["Verbouwing", "Geluid en licht", "Meubilair"],
  unit_sale: ["Eerste voorraad", "Keuken of productie-apparatuur"],
  subscription: ["Ontwikkeling van de software"],
  service: ["Lesmateriaal"],
};

const uniq = (xs: string[]) => [...new Set(xs)];

export function costSuggestions(kinds: StreamKind[], existing: string[]): string[] {
  const have = new Set(existing.map((e) => e.toLowerCase()));
  return uniq([...kinds.flatMap((k) => KIND_COSTS[k] ?? []), ...BASE_COSTS]).filter((n) => !have.has(n.toLowerCase()));
}

export function investmentSuggestions(kinds: StreamKind[], existing: string[]): string[] {
  const have = new Set(existing.map((e) => e.toLowerCase()));
  return uniq([...kinds.flatMap((k) => KIND_INVEST[k] ?? []), ...BASE_INVEST]).filter((n) => !have.has(n.toLowerCase()));
}

export function newStream(kind: StreamKind, id: string): Stream {
  const need = streamNeeds(kind);
  return {
    id,
    kind,
    name: STREAM_KINDS[kind].defaultName,
    volume: empty(),
    price: empty(),
    unitCost: empty(),
    ...(need.rental ? { slotsPerWeek: empty(), occupancyPct: empty() } : {}),
    ...(need.churn ? { churnPct: empty(), cac: empty() } : {}),
    ...(kind === "funding" ? { certainty: "applied" as FundingCertainty } : {}),
  };
}

// Een voorzichtige standaard voor "weet ik niet" bij klantverloop: zichtbaar als voorstel, telt pas na overnemen.
export const CHURN_PROPOSAL = 25;

// ---------------------------------------------------------------------------
// Samenvatting voor het rapport (vaste momentopname): alleen getallen en teksten, geen invoerstructuur.
// ---------------------------------------------------------------------------

export type BusinessCaseReport = {
  verdict: string;
  sentence: string;
  years: number;
  scenarios: { label: string; revenueYear1: number; resultLastYear: number; breakEven: string; startCapital: number }[];
  reliability: string;
  drivers: string[];
  missing: string[];
  warnings: string[];
  values: { name: string; label: string; source: string | null }[];
};

export function businessCaseReport(inputs: BusinessCaseInputs, market?: MarketContext): BusinessCaseReport | null {
  if (inputs.streams.length === 0) return null;
  const r = computeBusinessCase(inputs, market);
  const years = Math.round(inputs.horizonMonths / 12);
  const rel = r.reliability;
  return {
    verdict: VERDICTS[r.verdict].label,
    sentence: verdictSentence(r, inputs.horizonMonths),
    years,
    scenarios: SCENARIO_ORDER.map((k) => {
      const s = r.scenarios[k];
      return {
        label: SCENARIO_LABELS[k].label,
        revenueYear1: s.years[0]?.revenue ?? 0,
        resultLastYear: s.years[s.years.length - 1]?.result ?? 0,
        breakEven: s.breakEvenMonth == null ? "niet binnen de periode" : `maand ${s.breakEvenMonth + 1}`,
        startCapital: s.startCapital,
      };
    }),
    reliability: `${rel.confirmed} van ${rel.confirmed + rel.estimate} cijfers bevestigd${rel.proposal ? `; ${rel.proposal} voorstel${rel.proposal === 1 ? "" : "len"} niet meegeteld` : ""}`,
    drivers: r.drivers.map((d) => `${d.name}: 20% lager kost € ${nl(Math.abs(d.lowEffect))} over ${years} jaar (${d.label === "confirmed" ? "bevestigd" : "eigen schatting"})`),
    missing: r.missing.map((m) => m.text),
    warnings: r.checks.filter((c) => c.level === "warning").map((c) => c.text),
    values: allValues(inputs).map((v) => ({ name: v.name, label: v.value.label === "confirmed" ? "bevestigd" : v.value.label === "proposal" ? "voorstel (telt niet mee)" : "eigen schatting", source: v.value.source ?? null })),
  };
}
