// Fase B3: de intake in drie vragen. Uit de drie antwoorden (idee en voor wie; beslissing met inzet en datum;
// grootste onzekerheid) komt een voorstel voor alle velden die de rest van de app leest. Het voorstel komt van de
// AI (lib/ai/intake.ts) of, zonder AI of bij een fout, uit deze regels. Wat letterlijk in de tekst staat (bedragen,
// datums, de prijs) wint altijd van de AI. Het blijft een voorstel tot de consultant op "Klopt" drukt.
//
// Puur (geen database, geen AI), zodat de extractie met unittests vastligt.

import { PROJECT_TYPES, SECTOR_TEMPLATES, type ProjectType, type SectorTemplate } from "@/lib/domain/labels";
import { STAKE_KINDS, type StakeKind } from "@/lib/domain/decision-quality";
import { SPRINT_LENGTHS } from "@/lib/domain/sprint";
import { AUDIENCE_SHORT_MAX, priceFromIntake, shortAudience } from "@/lib/research-questions";

export type IntakeAnswers = { idea: string; decision: string; uncertainty: string };

// De brede doelgroepcategorie (ideas.target_audience) en de regio (ideas.region), zoals de oude intake ze opsloeg.
export const AUDIENCE_CATEGORIES = ["Zakelijke klanten (B2B)", "Consumenten (B2C)", "Publieke organisaties of verenigingen", "Interne gebruikers"] as const;
export type AudienceCategory = (typeof AUDIENCE_CATEGORIES)[number];
export const REGION_OPTIONS = ["Nederland", "Benelux", "Europa", "Wereldwijd"] as const;
export type RegionOption = (typeof REGION_OPTIONS)[number];
export const SECTOR_KEYS = Object.keys(SECTOR_TEMPLATES) as [SectorTemplate, ...SectorTemplate[]];
export const PROJECT_TYPE_KEYS = Object.keys(PROJECT_TYPES) as [ProjectType, ...ProjectType[]];
export type SprintWeeks = (typeof SPRINT_LENGTHS)[number];
export const DEFAULT_SPRINT_WEEKS: SprintWeeks = 5;

export type IntakeProposal = {
  title: string | null;
  stake_kind: StakeKind | null;
  stake_value: number | null;
  decision_deadline: string | null;
  outcome_metric: string | null;
  outcome_target: number | null;
  // Waarop de voorgestelde doelwaarde rust (bijv. terugverdienen van de inzet), getoond bij het veld.
  target_basis: string | null;
  outcome_min_value_per_customer: number | null;
  outcome_statement: string | null;
  target_audience: AudienceCategory | null;
  audience_detail: string | null;
  // Gebruikerstest D8: de korte doelgroep voor in vragen en kopjes ("amateursportclubs").
  audience_short: string | null;
  region: RegionOption | null;
  region_detail: string | null;
  sector_template: SectorTemplate | null;
  project_type: ProjectType | null;
  offer_price: string | null;
  sprint_weeks: SprintWeeks | null;
};

export type ProposalField = Exclude<keyof IntakeProposal, "target_basis">;
export const PROPOSAL_FIELDS: ProposalField[] = [
  "title", "stake_kind", "stake_value", "decision_deadline", "outcome_metric", "outcome_target", "outcome_min_value_per_customer", "outcome_statement",
  "target_audience", "audience_detail", "audience_short", "region", "region_detail", "sector_template", "project_type", "offer_price", "sprint_weeks",
];

// Herkomst per veld: AI-voorstel, uit de tekst van de consultant (regels), of een standaardwaarde.
export type FieldOrigin = "ai" | "text" | "default";
export type ProposalResult = {
  proposal: IntakeProposal;
  origin: Partial<Record<ProposalField, FieldOrigin>>;
  source: "ai" | "rules";
  // Waarom er geen AI-voorstel is (niet verbonden, budget, fout), voor de consultant.
  note: string | null;
};

export const EMPTY_PROPOSAL: IntakeProposal = {
  title: null, stake_kind: null, stake_value: null, decision_deadline: null, outcome_metric: null, outcome_target: null, target_basis: null,
  outcome_min_value_per_customer: null, outcome_statement: null, target_audience: null, audience_detail: null, audience_short: null, region: null, region_detail: null,
  sector_template: null, project_type: null, offer_price: null, sprint_weeks: null,
};

const squash = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const capFirst = (s: string) => (s ? s[0].toLocaleUpperCase("nl-NL") + s.slice(1) : s);
const nl = (n: number) => n.toLocaleString("nl-NL", { maximumFractionDigits: 2 });

// ---------------------------------------------------------------------------
// Bedragen
// ---------------------------------------------------------------------------

const MULTIPLIER: Record<string, number> = { k: 1_000, duizend: 1_000, mln: 1_000_000, miljoen: 1_000_000, m: 1_000_000 };

// "40.000", "40 000", "1,5", "25" → getal (Nederlandse notatie).
export function parseAmount(raw: string): number | null {
  const s = raw.replace(/\s/g, "");
  let n: number;
  if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) n = Number(s.replace(/\./g, "").replace(",", "."));
  else if (/^\d+(,\d+)?$/.test(s)) n = Number(s.replace(",", "."));
  else if (/^\d+\.\d{1,2}$/.test(s)) n = Number(s);
  else return null;
  return Number.isFinite(n) ? n : null;
}

const NUM = "(\\d{1,3}(?:[.\\s]\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?)";
const MULT = "(?:\\s*(k|duizend|mln|miljoen|m)\\b)?";
const PER = "(?:\\s*(?:per|\\/|p\\/?)\\s*(maand|mnd|jaar|jr|kwartaal|week|gebruiker|kantoor|licentie|klant|stuk))?";
const EURO_BEFORE = new RegExp(`(?:€|\\beur\\b|\\beuro\\b)\\s?${NUM}${MULT}(?:\\s*,-)?(?:\\s*euro)?${PER}`, "gi");
const EURO_AFTER = new RegExp(`${NUM}${MULT}\\s?(?:euro|eur)\\b${PER}`, "gi");

export type EuroAmount = { value: number; period: string | null; index: number };

// Alle eurobedragen in een tekst, in volgorde, met een eventuele periode ("per maand").
export function euroAmounts(text: string): EuroAmount[] {
  const out: EuroAmount[] = [];
  for (const re of [EURO_BEFORE, EURO_AFTER]) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const base = parseAmount(m[1]);
      if (base === null) continue;
      const mult = m[2] ? MULTIPLIER[m[2].toLowerCase()] : 1;
      const period = m[3] ? ({ mnd: "maand", jr: "jaar" } as Record<string, string>)[m[3].toLowerCase()] ?? m[3].toLowerCase() : null;
      const index = m.index ?? 0;
      if (out.some((a) => Math.abs(a.index - index) < 4)) continue;
      out.push({ value: base * mult, period, index });
    }
  }
  return out.sort((a, b) => a.index - b.index);
}

// De inzet uit de beslissing: het eerste bedrag zonder periode, of uren of fte.
export function stakeFromText(decision: string): { kind: StakeKind; value: number } | null {
  const amount = euroAmounts(decision).find((a) => a.period === null && a.value > 0);
  if (amount) return { kind: "amount", value: amount.value };
  const hours = /(\d{1,3}(?:\.\d{3})*|\d+)(?:,\d+)?\s*(?:uur|uren)\b/i.exec(decision);
  if (hours) {
    const v = parseAmount(hours[0].replace(/\s*(?:uur|uren)$/i, ""));
    if (v && v > 0) return { kind: "time", value: v };
  }
  const fte = /(\d+(?:,\d+)?)\s*fte\b/i.exec(decision);
  if (fte) {
    const v = parseAmount(fte[1]);
    if (v && v > 0) return { kind: "capacity", value: v };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Datums
// ---------------------------------------------------------------------------

const MONTHS: Record<string, number> = {
  januari: 1, jan: 1, februari: 2, feb: 2, maart: 3, mrt: 3, april: 4, apr: 4, mei: 5, juni: 6, jun: 6, juli: 7, jul: 7,
  augustus: 8, aug: 8, september: 9, sep: 9, sept: 9, oktober: 10, okt: 10, november: 11, nov: 11, december: 12, dec: 12,
};
const MONTH_RE = "(januari|februari|maart|april|mei|juni|juli|augustus|september|oktober|november|december|jan|feb|mrt|apr|jun|jul|aug|sept|sep|okt|nov|dec)\\.?";

const pad = (n: number) => String(n).padStart(2, "0");
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
function validDate(y: number, m: number, d: number): boolean {
  return m >= 1 && m <= 12 && d >= 1 && d <= lastDay(y, m);
}
function addDays(today: string, days: number): string {
  const t = new Date(`${today}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
}

// Zonder jaartal: de eerstvolgende keer dat de datum valt (vandaag telt mee).
function withYear(m: number, d: number | "last", year: number | null, today: string): string | null {
  const ty = Number(today.slice(0, 4));
  const pick = (y: number) => {
    const day = d === "last" ? lastDay(y, m) : d;
    return validDate(y, m, day) ? iso(y, m, day) : null;
  };
  if (year !== null) return pick(year);
  const first = pick(ty);
  if (first && first >= today) return first;
  return pick(ty + 1);
}

const fullYear = (y: string | undefined) => (y ? (y.length === 2 ? 2000 + Number(y) : Number(y)) : null);

// De beslisdatum uit een Nederlandse tekst: "vóór 1 maart 2027", "uiterlijk 15-12-2026", "eind januari",
// "in Q2", "binnen 6 weken". Alleen een datum vanaf vandaag; anders null (de consultant vult hem in).
export function deadlineFromText(text: string, today: string): string | null {
  const t = text.toLowerCase();
  const candidates: { index: number; date: string | null }[] = [];
  const push = (index: number, date: string | null) => candidates.push({ index, date });

  for (const m of t.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
    push(m.index ?? 0, validDate(y, mo, d) ? iso(y, mo, d) : null);
  }
  for (const m of t.matchAll(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{4}|\d{2})\b/g)) {
    const [d, mo, y] = [Number(m[1]), Number(m[2]), fullYear(m[3])!];
    push(m.index ?? 0, validDate(y, mo, d) ? iso(y, mo, d) : null);
  }
  for (const m of t.matchAll(new RegExp(`\\b(\\d{1,2})\\s+${MONTH_RE}(?:\\s+(\\d{4}))?`, "g"))) {
    push(m.index ?? 0, withYear(MONTHS[m[2]], Number(m[1]), fullYear(m[3]), today));
  }
  for (const m of t.matchAll(new RegExp(`\\b(eind|einde|uiterlijk eind|eind van|medio|half|begin|start)\\s+${MONTH_RE}(?:\\s+(\\d{4}))?`, "g"))) {
    const day: number | "last" = /eind/.test(m[1]) ? "last" : /medio|half/.test(m[1]) ? 15 : 1;
    push(m.index ?? 0, withYear(MONTHS[m[2]], day, fullYear(m[3]), today));
  }
  const QUARTER: Record<string, number> = { eerste: 1, tweede: 2, derde: 3, vierde: 4 };
  for (const m of t.matchAll(/\b(?:q([1-4])|(eerste|tweede|derde|vierde)\s+kwartaal)(?:\s+(?:van\s+)?(\d{4}))?/g)) {
    const q = m[1] ? Number(m[1]) : QUARTER[m[2]];
    push(m.index ?? 0, withYear(q * 3, "last", fullYear(m[3]), today));
  }
  for (const m of t.matchAll(/\bbinnen\s+(\d{1,3}|een|twee|drie|vier|vijf|zes|acht|tien|twaalf)\s+(dagen|dag|weken|week|maanden|maand)\b/g)) {
    const words: Record<string, number> = { een: 1, twee: 2, drie: 3, vier: 4, vijf: 5, zes: 6, acht: 8, tien: 10, twaalf: 12 };
    const n = /\d/.test(m[1]) ? Number(m[1]) : words[m[1]];
    const days = /dag/.test(m[2]) ? n : /week|weken/.test(m[2]) ? n * 7 : n * 30;
    push(m.index ?? 0, addDays(today, days));
  }
  for (const m of t.matchAll(/\b(?:eind|einde|het einde van)\s+(?:van\s+)?(?:dit|het)\s+jaar\b/g)) {
    push(m.index ?? 0, iso(Number(today.slice(0, 4)), 12, 31));
  }
  // Een datum direct na "vóór", "uiterlijk", "beslissen", "deadline" of "binnen" is de beslisdatum; die wint van een
  // eerder genoemde periode ("bouwen we in Q1 …, beslissen vóór 1 maart" → 1 maart, niet eind Q1). Anders de eerste.
  const cued = (index: number) => /(?:v[oó]{2}r|voor|uiterlijk|beslis\w*|deadline|uiterste datum|ten laatste|binnen)\s*(?:op\s+|het\s+|de\s+)?$/.test(t.slice(Math.max(0, index - 30), index)) || /^binnen\b/.test(t.slice(index));
  candidates.sort((a, b) => Number(cued(b.index)) - Number(cued(a.index)) || a.index - b.index);
  return candidates.find((c) => c.date !== null && c.date >= today)?.date ?? null;
}

// ---------------------------------------------------------------------------
// Doelgroep, regio, branche, type project, naam
// ---------------------------------------------------------------------------

// Zelfstandige naamwoorden die als "klant" te tellen zijn (ook als laatste deel: "NVM-kantoren", "makelaarskantoren").
const CUSTOMER_NOUN = /(klanten|clubs|verenigingen|stichtingen|kantoren|abonnees|gebruikers|bedrijven|bureaus|deelnemers|leden|scholen|gemeenten|makelaars|accounts|licenties|kopers|huishoudens|organisaties|winkels|praktijken|hotels|locaties|restaurants|venues|ondernemers|zzp'ers|zelfstandigen|ouders|studenten|consumenten|webshops|bureau's|instellingen|teams|afdelingen)$/i;

// De specifieke doelgroep na "voor" in de idee-omschrijving, tot aan een bijzin of leesteken.
export function audienceFromText(idea: string): string | null {
  const text = squash(idea);
  const tail = /^(.+?)(?=\s+(?:die|dat|om|zodat|waarmee|waardoor|zodra|voor)\b|[,;:!?]|\.(?:\s|$)|$)/i;
  // Elke "voor" apart: na "voor € 5 per maand" kan nog "voor ouders van …" komen.
  for (const v of text.matchAll(/\bvoor\s+/gi)) {
    const m = tail.exec(text.slice((v.index ?? 0) + v[0].length));
    if (!m) continue;
    const cand = m[1].trim();
    if (/^(?:€|\d|eur\b|euro\b|een prijs|een bedrag|het |de manier|zich|hen|hun|ons|mij|jou)/i.test(cand)) continue;
    if (cand.split(" ").length > 16) continue;
    return cand.slice(0, 200);
  }
  return null;
}

// Het kernwoord van de doelgroep ("NVM-kantoren" uit "zelfstandige NVM-kantoren met 2–15 medewerkers").
export function audienceNoun(detail: string | null): string | null {
  if (!detail) return null;
  const words = squash(detail).split(" ").map((w) => w.replace(/[^\p{L}\p{N}'’-]/gu, ""));
  return words.find((w) => CUSTOMER_NOUN.test(w)) ?? null;
}

export function audienceCategory(text: string): AudienceCategory | null {
  const t = text.toLowerCase();
  if (/\b(intern|interne|binnen (onze|de) organisatie|eigen medewerkers|onze medewerkers|collega'?s)\b/.test(t)) return "Interne gebruikers";
  if (/\b(gemeente|gemeenten|overheid|provincie|ministerie|vereniging|verenigingen|stichting|stichtingen|sportclub|sportclubs|amateurclub|voetbalclub|tennisclub|hockeyclub|school|scholen|ziekenhuis|zorginstelling|onderwijsinstelling|publieke)\w*/.test(t)) return "Publieke organisaties of verenigingen";
  if (/\b(consument|consumenten|particulier|particulieren|huishouden|huishoudens|ouders|studenten|b2c|thuis|gezinnen|senioren)\b/.test(t)) return "Consumenten (B2C)";
  if (/(\bb2b\b|bedrijf|bedrijven|kantoor|kantoren|\bmkb\b|ondernemer|zzp|zelfstandige|bureau|makelaar|winkel|praktijk|hotel|webshop|organisaties|klanten van|\bnvm\b)/.test(t)) return "Zakelijke klanten (B2B)";
  return null;
}

const DUTCH_PLACES = ["Randstad", "Amsterdam", "Rotterdam", "Den Haag", "Utrecht", "Eindhoven", "Groningen", "Brabant", "Noord-Brabant", "Limburg", "Gelderland", "Overijssel", "Friesland", "Drenthe", "Zeeland", "Flevoland", "Noord-Holland", "Zuid-Holland"];

export function regionFromText(text: string): { region: RegionOption | null; detail: string | null } {
  const t = text.toLowerCase();
  const place = DUTCH_PLACES.find((p) => new RegExp(`\\b${p.toLowerCase()}\\b`).test(t)) ?? null;
  if (/\b(wereldwijd|internationaal|global)\b/.test(t)) return { region: "Wereldwijd", detail: null };
  if (/\b(europa|europese|\beu\b)/.test(t)) return { region: "Europa", detail: null };
  if (/\b(benelux|belgi[eë]|vlaanderen|luxemburg)/.test(t)) return { region: "Benelux", detail: place };
  if (place || /\b(nederland|nederlandse|\bnl\b|nvm|kvk|landelijk)/.test(t)) return { region: "Nederland", detail: place };
  return { region: null, detail: null };
}

export function sectorFromText(text: string): SectorTemplate | null {
  const t = text.toLowerCase();
  if (/(event|evenement|congres|beurs|venue|mice|vergaderlocatie|feestlocatie)/.test(t)) return "events";
  if (/(media|cultuur|theater|museum|podium|festival|uitgever|omroep|publiek bereik|bioscoop)/.test(t)) return "media_culture";
  // Gebruikerstest D7: verenigingen, sport en maatschappelijke organisaties (vóór MKB: "vrijwilligers" en "leden").
  if (/(vereniging|sportclub|\bclubs?\b|voetbal|hockey|tennis|korfbal|scouting|stichting|vrijwilliger|ledenadministratie|contributie|buurthuis|maatschappelijke organisatie|welzijn)/.test(t)) return "associations";
  if (/(\bmkb\b|kantoor|kantoren|ondernemer|zzp|zelfstandig|winkel|makelaar|praktijk|webshop|medewerkers|kleine bedrijven)/.test(t)) return "smb";
  return null;
}

export function projectTypeFromText(text: string): ProjectType | null {
  const t = text.toLowerCase();
  if (/(intern|binnen (onze|de) organisatie|eigen medewerkers|onze afdeling)/.test(t)) return "internal_innovation";
  if (/(verdienmodel|prijsmodel|abonnementsmodel|andere prijs|prijsstrategie)/.test(t)) return "revenue_model";
  if (/(uitbreiden|uitbreiding|nieuwe markt|ander land|internationaal|expansie|nieuwe regio)/.test(t)) return "expansion";
  if (/(nieuw bedrijf|startup|start-up|onderneming starten|bedrijf beginnen|eigen bedrijf)/.test(t)) return "new_business";
  if (/(product|dienst|assistent|app|platform|tool|software|abonnement|service)/.test(t)) return "new_product";
  return null;
}

// Een korte werknaam: het kernwoord van het idee plus de doelgroep ("AI-assistent voor NVM-kantoren").
export function titleFromText(idea: string, noun: string | null): string | null {
  let s = squash(idea).replace(/^(?:ik wil|wij willen|we willen|het idee is|idee:)\s+/i, "");
  s = s.replace(/^(?:een|de|het)\s+/i, "");
  const head = s.split(/\s+(?:voor|die|dat|om|waarmee|zodat|met)\s+|[,.;:!?]/i)[0]?.trim() ?? "";
  if (head.length < 2) return null;
  const words = head.split(" ").slice(0, 6).join(" ");
  const title = noun && !words.toLowerCase().includes(noun.toLowerCase()) ? `${words} voor ${noun}` : words;
  return capFirst(title).slice(0, 80);
}

// Gebruikerstest D6: de huidige werkwijze als de intake die noemt ("Clubs communiceren nu via WhatsApp en e-mail."):
// de eerste zin met "nu", "momenteel", "op dit moment", "tegenwoordig" of "nog steeds". Null als er geen is.
export function currentPracticeFromText(...texts: (string | null | undefined)[]): string | null {
  for (const text of texts) {
    for (const raw of squash(text).split(/(?<=[.!?])\s+/)) {
      const sentence = raw.replace(/[.!?]+$/, "").trim();
      if (sentence.length < 12 || sentence.length > 220) continue;
      if (/\?/.test(raw)) continue;
      if (/\b(nu|momenteel|op dit moment|tegenwoordig|nog steeds|doen het nu|werken nu)\b/i.test(sentence)) return sentence;
    }
  }
  return null;
}

// De regel "Niets doen" voor de concurrentiekaart, uit de intake (D6).
export function statusQuoPositioning(short: string | null | undefined, practice: string | null | undefined): string {
  const who = capFirst(squash(short) || "De doelgroep");
  const how = squash(practice);
  return `${who} houden vast aan hoe het nu gaat: ${how ? how.charAt(0).toLocaleLowerCase("nl-NL") + how.slice(1) : "nog te onderzoeken"}.`;
}

// ---------------------------------------------------------------------------
// Succesdefinitie
// ---------------------------------------------------------------------------

// Een genoemd aantal klanten ("minstens 20 kantoren", "15 betalende klanten").
export function targetFromText(text: string): { target: number; noun: string } | null {
  const re = /\b(\d{1,6})\s+(?:betalende\s+|nieuwe\s+|vaste\s+)?([\p{L}'’-]+)/gu;
  for (const m of text.matchAll(re)) {
    const before = text.slice(Math.max(0, (m.index ?? 0) - 2), m.index ?? 0);
    if (/[–-]\s*$/.test(before)) continue; // "2–15 medewerkers": een bandbreedte, geen doel
    if (CUSTOMER_NOUN.test(m[2])) return { target: Number(m[1]), noun: m[2] };
  }
  return null;
}

export const priceNumber = (price: string | null) => {
  if (!price) return null;
  const a = euroAmounts(price)[0];
  return a ? a.value : parseAmount(price.replace(/[^\d.,\s]/g, "").trim());
};

export const pricePeriod = (price: string | null) => (price ? (/per\s+(maand|jaar|kwartaal|week)/i.exec(price)?.[1]?.toLowerCase() ?? null) : null);

const PER_YEAR: Record<string, number> = { maand: 12, kwartaal: 4, week: 52, jaar: 1 };

// Gebruikerstest D5: de jaaromzet per klant uit de prijs in de intake ("€ 79 per maand" → 948). Alleen met een
// periode (maand ×12, kwartaal ×4, week ×52, jaar ×1); zonder periode of bedrag: null. Het blijft een aanname: de
// toelichting zegt dat, en er hoort geen bevinding (claim) bij.
export function annualPriceFromOffer(text: string | null | undefined): { value: number; note: string } | null {
  const price = squash(text);
  if (!price) return null;
  const n = priceNumber(price);
  const period = pricePeriod(price);
  if (n == null || !Number.isFinite(n) || n <= 0 || !period) return null;
  const factor = PER_YEAR[period];
  const value = Math.round(n * factor * 100) / 100;
  const amount = `€ ${nl(n)} per ${period}`;
  return { value, note: `Aanname uit intake: ${factor === 1 ? amount : `${amount} × ${factor}`}, niet getoetst` };
}

// De zin "Geslaagd als…" uit maatstaf, doelwaarde en prijs, zes maanden na het besluit.
export function composeStatement(p: Pick<IntakeProposal, "outcome_metric" | "outcome_target" | "outcome_min_value_per_customer" | "offer_price">): string | null {
  const metric = squash(p.outcome_metric);
  if (!metric || p.outcome_target === null || !Number.isFinite(p.outcome_target)) return null;
  const n = nl(p.outcome_target);
  const noun = metric.replace(/^betalende\s+/i, "");
  if (p.offer_price && /^betalende\s+/i.test(metric)) return `Zes maanden na het besluit betalen minstens ${n} ${noun} ${squash(p.offer_price)}.`;
  const min = p.outcome_min_value_per_customer;
  const value = min && min > 0 ? `, elk voor minimaal € ${nl(min)}` : "";
  return `Zes maanden na het besluit: minstens ${n} ${metric}${value}.`;
}

// Een doelwaarde als er geen genoemd is: de inzet terugverdienen binnen een jaar bij de genoemde prijs.
export function breakEvenTarget(stake: { kind: StakeKind; value: number } | null, price: string | null): { target: number; basis: string } | null {
  if (!stake || stake.kind !== "amount") return null;
  const p = priceNumber(price);
  if (!p || p <= 0) return null;
  const period = pricePeriod(price);
  const perYear = period === "maand" ? p * 12 : period === "kwartaal" ? p * 4 : period === "week" ? p * 52 : p;
  const target = Math.ceil(stake.value / perYear);
  if (!Number.isFinite(target) || target < 1) return null;
  const within = period ? "binnen een jaar " : "";
  return { target, basis: `Genoeg om de inzet van € ${nl(stake.value)} ${within}terug te verdienen bij ${squash(price)}.` };
}

export function sprintWeeksFor(text: string, deadline: string | null, today: string): { weeks: SprintWeeks; fromText: boolean } {
  const m = /sprint\s+(?:van\s+)?(\d{1,2})\s+weken|(\d{1,2})\s+weken\s+(?:sprint|valideren|testen|onderzoek)/i.exec(text);
  const n = m ? Number(m[1] ?? m[2]) : null;
  if (n !== null && (SPRINT_LENGTHS as readonly number[]).includes(n)) return { weeks: n as SprintWeeks, fromText: true };
  if (deadline) {
    const weeks = Math.floor(daysBetween(today, deadline) / 7);
    if (weeks < DEFAULT_SPRINT_WEEKS) return { weeks: SPRINT_LENGTHS[0], fromText: true };
  }
  return { weeks: DEFAULT_SPRINT_WEEKS, fromText: false };
}

// ---------------------------------------------------------------------------
// Het regelvoorstel en het samenvoegen met de AI
// ---------------------------------------------------------------------------

export function ruleProposal(a: IntakeAnswers, today: string): ProposalResult {
  const idea = squash(a.idea);
  const decision = squash(a.decision);
  const uncertainty = squash(a.uncertainty);
  const all = `${idea} ${decision} ${uncertainty}`;
  const origin: ProposalResult["origin"] = {};
  const p: IntakeProposal = { ...EMPTY_PROPOSAL };
  const set = <K extends ProposalField>(k: K, v: IntakeProposal[K] | null, o: FieldOrigin = "text") => {
    if (v === null || v === undefined || v === "") return;
    p[k] = v as IntakeProposal[K];
    origin[k] = o;
  };

  const detail = audienceFromText(idea);
  set("audience_detail", detail);
  set("audience_short", shortAudience(detail));
  const noun = audienceNoun(detail);
  const category = audienceCategory(`${detail ?? ""} ${idea}`);
  set("target_audience", category);
  // UX-review 14: zonder regio in de tekst is Nederland de standaard (zichtbaar als "Standaard", aan te passen).
  const region = regionFromText(all);
  set("region", region.region ?? "Nederland", region.region ? "text" : "default");
  set("region_detail", region.detail);
  // Gebruikerstest D7: geen MKB-branche bij een publieke doelgroep of consumenten.
  const sector = sectorFromText(`${detail ?? ""} ${idea}`);
  set("sector_template", sector === "smb" && category && category !== "Zakelijke klanten (B2B)" ? null : sector);
  set("project_type", projectTypeFromText(`${idea} ${decision}`));
  // UX-review 14: zonder herkenbaar kernwoord ("NVM-kantoren") de korte doelgroep, zodat de naam niet alleen
  // "Abonnementsdienst" wordt maar "Abonnementsdienst voor hondenbezitters".
  set("title", titleFromText(idea, noun ?? shortAudience(detail)));

  const stake = stakeFromText(decision);
  if (stake) {
    set("stake_kind", stake.kind);
    set("stake_value", stake.value);
  }
  set("decision_deadline", deadlineFromText(decision, today) ?? deadlineFromText(`${uncertainty} ${idea}`, today));

  // De prijs: eerst uit de onzekerheid, dan uit het idee (alleen met periode); het bedrag in de beslissing is de inzet.
  const price = priceFromIntake({ key_uncertainty: uncertainty, description: idea, outcome_min_value_per_customer: null }) ?? priceFromIntake({ key_uncertainty: null, description: decision, outcome_min_value_per_customer: null });
  set("offer_price", price);
  const pn = priceNumber(price);
  if (pn && pn > 0) set("outcome_min_value_per_customer", pn);

  const named = targetFromText(`${decision} ${uncertainty} ${idea}`);
  const metricNoun = named?.noun ?? noun ?? (price ? "klanten" : null);
  if (metricNoun) set("outcome_metric", price ? `betalende ${metricNoun}` : metricNoun);
  if (named) set("outcome_target", named.target);
  else {
    const be = breakEvenTarget(stake, price);
    if (be) {
      set("outcome_target", be.target);
      p.target_basis = be.basis;
    }
  }
  set("outcome_statement", composeStatement(p));

  const sprint = sprintWeeksFor(all, p.decision_deadline, today);
  set("sprint_weeks", sprint.weeks, sprint.fromText ? "text" : "default");
  return { proposal: p, origin, source: "rules", note: null };
}

// Een AI-voorstel controleren: alleen geldige waarden, binnen de grenzen van de formuliervelden.
export function sanitizeAiProposal(raw: Partial<Record<keyof IntakeProposal, unknown>>, today: string): IntakeProposal {
  const str = (v: unknown, max: number, min = 1) => {
    const s = typeof v === "string" ? squash(v) : "";
    return s.length >= min ? s.slice(0, max) : null;
  };
  const num = (v: unknown, positive = false) => (typeof v === "number" && Number.isFinite(v) && v >= 0 && (!positive || v > 0) && v < 1e12 ? v : null);
  const oneOf = <T extends string>(v: unknown, list: readonly T[]) => (typeof v === "string" && (list as readonly string[]).includes(v) ? (v as T) : null);
  const date = typeof raw.decision_deadline === "string" && /^\d{4}-\d{2}-\d{2}$/.test(raw.decision_deadline) && raw.decision_deadline >= today && !Number.isNaN(Date.parse(raw.decision_deadline)) ? raw.decision_deadline : null;
  const weeks = typeof raw.sprint_weeks === "number" && (SPRINT_LENGTHS as readonly number[]).includes(raw.sprint_weeks) ? (raw.sprint_weeks as SprintWeeks) : null;
  return {
    title: str(raw.title, 140, 2),
    stake_kind: oneOf(raw.stake_kind, STAKE_KINDS),
    stake_value: num(raw.stake_value, true),
    decision_deadline: date,
    outcome_metric: str(raw.outcome_metric, 160, 2),
    outcome_target: num(raw.outcome_target),
    target_basis: str(raw.target_basis, 300),
    outcome_min_value_per_customer: num(raw.outcome_min_value_per_customer),
    outcome_statement: str(raw.outcome_statement, 400, 10),
    target_audience: oneOf(raw.target_audience, AUDIENCE_CATEGORIES),
    audience_detail: str(raw.audience_detail, 200, 2),
    audience_short: str(raw.audience_short, AUDIENCE_SHORT_MAX, 2),
    region: oneOf(raw.region, REGION_OPTIONS),
    region_detail: str(raw.region_detail, 120, 2),
    sector_template: oneOf(raw.sector_template, SECTOR_KEYS),
    project_type: oneOf(raw.project_type, PROJECT_TYPE_KEYS),
    offer_price: str(raw.offer_price, 120, 2),
    sprint_weeks: weeks,
  };
}

// Velden die letterlijk in de tekst staan: daar wint de tekst van de AI (geen verzonnen of verschoven bedragen).
const TEXT_WINS: ProposalField[] = ["stake_kind", "stake_value", "decision_deadline", "offer_price"];

export function mergeProposals(rules: ProposalResult, ai: IntakeProposal): ProposalResult {
  const proposal: IntakeProposal = { ...rules.proposal };
  const origin: ProposalResult["origin"] = { ...rules.origin };
  for (const k of PROPOSAL_FIELDS) {
    const aiValue = ai[k];
    if (aiValue === null || aiValue === undefined) continue;
    if (TEXT_WINS.includes(k) && origin[k] === "text") continue;
    (proposal as Record<string, unknown>)[k] = aiValue;
    origin[k] = "ai";
  }
  // Inzet als paar: soort en waarde komen van dezelfde kant.
  if (origin.stake_kind !== origin.stake_value && rules.proposal.stake_kind && rules.proposal.stake_value) {
    proposal.stake_kind = rules.proposal.stake_kind;
    proposal.stake_value = rules.proposal.stake_value;
    origin.stake_kind = origin.stake_value = "text";
  }
  if (origin.outcome_target === "ai") proposal.target_basis = ai.target_basis;
  // Gebruikerstest D7: ook een AI-voorstel krijgt geen MKB-branche bij een publieke doelgroep of consumenten.
  if (proposal.sector_template === "smb" && proposal.target_audience && proposal.target_audience !== "Zakelijke klanten (B2B)") {
    proposal.sector_template = rules.proposal.sector_template === "smb" ? null : rules.proposal.sector_template;
    if (proposal.sector_template) origin.sector_template = rules.origin.sector_template;
    else delete origin.sector_template;
  }
  // D8: een korte doelgroep hoort bij de toelichting; past de AI de toelichting aan zonder korte vorm, leid hem af.
  if (origin.audience_detail === "ai" && origin.audience_short !== "ai") {
    proposal.audience_short = shortAudience(proposal.audience_detail);
    if (proposal.audience_short) origin.audience_short = "text";
  }
  if (!proposal.outcome_statement) {
    const s = composeStatement(proposal);
    if (s) {
      proposal.outcome_statement = s;
      origin.outcome_statement = origin.outcome_target === "ai" || origin.outcome_metric === "ai" ? "ai" : "text";
    }
  }
  return { proposal, origin, source: "ai", note: null };
}

// ---------------------------------------------------------------------------
// Telling (rapport fase B3)
// ---------------------------------------------------------------------------

// Welke velden de consultant bij de bevestiging veranderde ten opzichte van het voorstel (voor intake_proposal).
export function changedFields(proposal: IntakeProposal, confirmed: Partial<Record<ProposalField, string | number | null>>): ProposalField[] {
  const norm = (v: unknown) => (v === null || v === undefined ? "" : typeof v === "number" ? String(v) : squash(String(v)));
  return PROPOSAL_FIELDS.filter((k) => k in confirmed && norm(proposal[k]) !== norm(confirmed[k]));
}
