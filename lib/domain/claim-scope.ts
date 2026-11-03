// Populatie, regio en peildatum per bevinding (verbeterplan golf C, punt 7). Een letterlijk citaat zegt nog niet
// dat een cijfer over déze doelgroep, déze regio en een recent genoeg moment gaat. Elke bevinding draagt daarom drie
// velden, elk ingevuld of expliciet "onbekend", en wordt vergeleken met de intake (doelgroep, regio, beslisdatum).
// Wijkt een veld af, dan volgt een waarschuwing en telt de bevinding als "indirect".
//
// Puur en deterministisch: geen database, geen AI. De weging (indirect telt half) zit in relevanceWeight(); die
// wordt pas gebruikt in een nieuwe methodeversie. Bestaande methodeversies rekenen ongewijzigd.

import { FRESHNESS_MONTHS, normalizeText, type FreshnessKind } from "./verify";

export const UNKNOWN = "onbekend";
export type Relevance = "direct" | "indirect";

export type ClaimScope = { population: string | null; region: string | null; referenceDate: string | null; freshness?: FreshnessKind };
export type IntakeScope = { audience: string; region: string; decisionDate: string | null };

export type ScopeCheck = {
  relevance: Relevance;
  // Eén zin per afwijkend veld, voor de waarschuwing bij de bevinding.
  warnings: string[];
  // Velden die "onbekend" zijn: geen afwijking vastgesteld, maar ook niet bevestigd.
  unknown: ("population" | "region" | "referenceDate")[];
};

const UNKNOWN_WORDS = new Set(["", "onbekend", "unknown", "n.v.t.", "nvt", "niet bekend", "-", "?"]);

export function isUnknown(v: string | null | undefined): boolean {
  return v == null || UNKNOWN_WORDS.has(normalizeText(v));
}

// Een leeg of onbruikbaar veld wordt expliciet "onbekend"; anders de ingekorte tekst.
export function scopeValue(v: string | null | undefined, max = 120): string {
  return isUnknown(v) ? UNKNOWN : v!.trim().replace(/\s+/g, " ").slice(0, max);
}

// ---------------------------------------------------------------------------
// Peildatum: "JJJJ", "JJJJ-MM", "JJJJ-MM-DD" of "onbekend"
// ---------------------------------------------------------------------------

const DATE_RE = /^(\d{4})(?:-(0[1-9]|1[0-2])(?:-(0[1-9]|[12]\d|3[01]))?)?$/;

// Maakt van vrije tekst een peildatum. Een exacte datum of maand blijft staan; anders telt het laatste jaartal in
// de tekst ("2019-2023" → "2023", "Q3 2024" → "2024"). Zonder jaartal: "onbekend".
export function normalizeReferenceDate(v: string | null | undefined): string {
  if (isUnknown(v)) return UNKNOWN;
  const s = v!.trim();
  if (DATE_RE.test(s)) return s;
  const years = [...s.matchAll(/(?<!\d)(19[5-9]\d|20\d\d|2100)(?!\d)/g)].map((m) => Number(m[1]));
  return years.length ? String(Math.max(...years)) : UNKNOWN;
}

export function isReferenceDate(v: string): boolean {
  return v === UNKNOWN || DATE_RE.test(v);
}

// Het laatste moment dat de peildatum dekt (een jaartal geldt tot en met 31 december).
function periodEnd(ref: string): Date {
  const m = DATE_RE.exec(ref)!;
  const y = Number(m[1]);
  if (m[3]) return new Date(Date.UTC(y, Number(m[2]) - 1, Number(m[3])));
  if (m[2]) return new Date(Date.UTC(y, Number(m[2]), 0));
  return new Date(Date.UTC(y, 11, 31));
}

// Leeftijd van het cijfer in hele maanden op de beslisdatum (of vandaag als die ontbreekt).
export function ageInMonths(ref: string, decisionDate: string | null, today: Date = new Date()): number | null {
  if (!DATE_RE.test(ref)) return null;
  const end = periodEnd(ref);
  const at = decisionDate && !Number.isNaN(new Date(decisionDate).getTime()) ? new Date(decisionDate) : today;
  return (at.getUTCFullYear() - end.getUTCFullYear()) * 12 + (at.getUTCMonth() - end.getUTCMonth());
}

// ---------------------------------------------------------------------------
// Regio
// ---------------------------------------------------------------------------

// Bekende gebieden van de intake, met de woorden waarmee bronnen ze noemen.
const REGIONS: { key: string; label: string; words: string[] }[] = [
  { key: "nl", label: "Nederland", words: ["nederland", "nederlandse", "netherlands", "dutch", "holland", "nl"] },
  { key: "be", label: "België", words: ["belgie", "belgië", "belgische", "belgium", "vlaanderen", "wallonie", "wallonië"] },
  { key: "lu", label: "Luxemburg", words: ["luxemburg", "luxembourg"] },
  { key: "benelux", label: "Benelux", words: ["benelux"] },
  { key: "eu", label: "Europa", words: ["europa", "europe", "europese", "european", "eu", "eu27", "eu-27", "eurozone"] },
  { key: "world", label: "Wereldwijd", words: ["wereldwijd", "wereld", "worldwide", "global", "globaal", "mondiaal", "internationaal"] },
];

function words(s: string): string[] {
  return normalizeText(s)
    .split(/[^a-z0-9à-ÿ']+/)
    .filter(Boolean);
}

function regionKeys(s: string): Set<string> {
  const w = new Set(words(s));
  return new Set(REGIONS.filter((r) => r.words.some((x) => w.has(x))).map((r) => r.key));
}

// Dekt de regio van de bevinding de regio van de intake? Gelijk gebied: ja. Een ander of breder gebied (een
// Europees cijfer voor een Nederlandse markt) of een kleiner gebied (een stad voor heel Nederland): nee.
export function regionMatches(claimRegion: string, intakeRegion: string): boolean {
  const intake = regionKeys(intakeRegion);
  const claim = regionKeys(claimRegion);
  if (intake.size === 0) {
    // Een vrije regio in de intake (bijvoorbeeld "Utrecht"): het woord moet in de regio van de bevinding staan.
    const cw = new Set(words(claimRegion));
    return words(intakeRegion).some((w) => w.length >= 3 && cw.has(w));
  }
  if (claim.size === 0) return false;
  // Een bevinding die een ander gebied noemt dan de intake (ook naast het juiste) gaat niet alleen over de intake.
  if ([...claim].some((k) => !intake.has(k))) return false;
  // Alleen een land- of gebiedsnaam telt; "Amsterdam (Nederland)" noemt Nederland maar gaat over één stad.
  const extra = words(claimRegion).filter((w) => !REGIONS.some((r) => r.words.includes(w)) && !/^\d+$/.test(w) && !FILLER_WORDS.has(w));
  return extra.length === 0;
}

const FILLER_WORDS = new Set(["in", "en", "de", "het", "heel", "geheel", "totaal", "landelijk", "nationaal", "and", "the", "whole", "all", "van", "of"]);

// ---------------------------------------------------------------------------
// Populatie
// ---------------------------------------------------------------------------

export type AudienceKind = "b2b" | "b2c" | "public" | "internal";

const AUDIENCE_WORDS: Record<AudienceKind, string[]> = {
  b2b: [
    "bedrijf", "bedrijven", "onderneming", "ondernemingen", "ondernemer", "ondernemers", "mkb", "zzp", "zzp'ers", "zzpers",
    "werkgever", "werkgevers", "vestiging", "vestigingen", "organisatie", "organisaties", "b2b", "kantoren", "bureaus",
    "bureau", "retailers", "winkels", "leveranciers", "companies", "businesses", "firms", "smes", "sme", "enterprises",
  ],
  b2c: [
    "consument", "consumenten", "huishouden", "huishoudens", "personen", "inwoners", "burgers", "nederlanders", "mensen",
    "jongeren", "ouderen", "volwassenen", "ouders", "studenten", "kopers", "b2c", "consumers", "households", "people",
    "adults", "individuals", "particulieren", "gezinnen",
  ],
  public: ["gemeente", "gemeenten", "overheid", "overheden", "provincie", "provincies", "vereniging", "verenigingen", "scholen", "ziekenhuizen", "zorginstellingen", "stichtingen", "public"],
  // "werknemers" ontbreekt bewust: dat woord beschrijft meestal de grootte van een bedrijf ("10-50 werknemers").
  internal: ["medewerkers", "collega's", "collegas", "employees", "staff"],
};

// Het soort doelgroep van de intake ("Zakelijke klanten (B2B)" en zo verder) of van een populatie in een bron.
export function audienceKind(s: string): AudienceKind | null {
  const n = normalizeText(s);
  if (/\bb2b\b|zakelijk/.test(n)) return "b2b";
  if (/\bb2c\b|consument/.test(n)) return "b2c";
  if (/publieke organisaties|verenigingen/.test(n)) return "public";
  if (/interne gebruikers/.test(n)) return "internal";
  const w = new Set(words(s));
  const hits = (Object.keys(AUDIENCE_WORDS) as AudienceKind[]).filter((k) => AUDIENCE_WORDS[k].some((x) => w.has(x)));
  return hits.length === 1 ? hits[0] : null;
}

// Gaat de populatie van de bevinding over dezelfde soort doelgroep als de intake? Alleen een vastgesteld verschil
// (bijvoorbeeld huishoudens bij een B2B-idee) telt als afwijking; is één van beide niet te plaatsen, dan niet.
export function populationMatches(population: string, audience: string): boolean {
  const a = audienceKind(audience);
  const p = audienceKind(population);
  return a == null || p == null || a === p;
}

// ---------------------------------------------------------------------------
// Vergelijking met de intake
// ---------------------------------------------------------------------------

export function compareWithIntake(claim: ClaimScope, intake: IntakeScope, today: Date = new Date()): ScopeCheck {
  const warnings: string[] = [];
  const unknown: ScopeCheck["unknown"] = [];
  if (isUnknown(claim.population)) unknown.push("population");
  else if (!populationMatches(claim.population!, intake.audience)) {
    warnings.push(`De populatie (${claim.population!.trim()}) is een andere doelgroep dan in de intake (${intake.audience}).`);
  }
  if (isUnknown(claim.region)) unknown.push("region");
  else if (!regionMatches(claim.region!, intake.region)) {
    warnings.push(`De regio (${claim.region!.trim()}) is niet de regio van de intake (${intake.region}).`);
  }
  const ref = normalizeReferenceDate(claim.referenceDate);
  if (ref === UNKNOWN) unknown.push("referenceDate");
  else {
    const age = ageInMonths(ref, intake.decisionDate, today);
    const max = FRESHNESS_MONTHS[claim.freshness ?? "statistic"];
    if (age != null && age > max) {
      const years = Math.floor(age / 12);
      warnings.push(
        `De peildatum (${ref}) ligt ${years >= 1 ? `ruim ${years} jaar` : `${age} maanden`} vóór ${intake.decisionDate ? "de beslisdatum" : "vandaag"}; voor dit soort gegevens is dat ouder dan ${Math.round(max / 12) >= 1 && max % 12 === 0 ? `${max / 12} jaar` : `${max} maanden`}.`,
      );
    }
  }
  return { relevance: warnings.length ? "indirect" : "direct", warnings, unknown };
}

// De intakevelden van een idee als vergelijkingsbasis.
export function intakeScope(idea: {
  target_audience: string;
  audience_detail: string | null;
  region: string;
  region_detail: string | null;
  decision_deadline: string | null;
}): IntakeScope {
  return {
    audience: [idea.target_audience, idea.audience_detail].filter(Boolean).join(" — "),
    region: idea.region,
    decisionDate: idea.decision_deadline,
  };
}

// De weging in de bewijsberekening. Alleen voor een nieuwe methodeversie: 2026-11-a en 2026-11-b gebruiken deze
// functie niet en rekenen ongewijzigd. Een indirecte bevinding telt daar met halve sterkte.
export const INDIRECT_WEIGHT = 0.5;
export function relevanceWeight(relevance: Relevance | string | null | undefined): number {
  return relevance === "indirect" ? INDIRECT_WEIGHT : 1;
}

// ---------------------------------------------------------------------------
// AI-extractie: een veld telt alleen als het uit het citaat of fragment blijkt
// ---------------------------------------------------------------------------

const STOP = new Set(["de", "het", "een", "en", "of", "van", "in", "op", "met", "voor", "naar", "die", "dat", "the", "and", "of", "for", "with", "per", "alle", "jaar"]);

// Een door het model ingevulde populatie of regio blijft alleen staan als een betekenisvol woord ervan letterlijk in
// het citaat of fragment staat; anders wordt het "onbekend". Een peildatum alleen als het jaartal erin staat.
export function groundedScope(field: "population" | "region" | "referenceDate", value: string | null | undefined, text: string): string {
  if (isUnknown(value)) return UNKNOWN;
  const hay = normalizeText(text);
  if (field === "referenceDate") {
    const ref = normalizeReferenceDate(value);
    return ref !== UNKNOWN && hay.includes(ref.slice(0, 4)) ? ref : UNKNOWN;
  }
  const hayWords = new Set(words(text));
  const significant = words(value!).filter((w) => w.length >= 3 && !STOP.has(w) && !/^\d+$/.test(w));
  // Een woord telt ook als de tekst het als begin van een langer woord bevat ("bedrijven" in "bedrijventelling").
  const found = significant.some((w) => hayWords.has(w) || hay.includes(w));
  return found ? scopeValue(value, field === "population" ? 200 : 120) : UNKNOWN;
}

// Toelichting bij een aanname (methode 2026-11-c): hoeveel meetellende bevindingen half tellen omdat ze indirect zijn.
export function explainIndirect(n: number): string {
  return `Telt half: indirect bewijs (${n} ${n === 1 ? "bevinding gaat" : "bevindingen gaan"} over een andere populatie, een andere regio of een te oude peildatum dan de intake).`;
}
