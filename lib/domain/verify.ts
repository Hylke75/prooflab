// Deterministic verification of research claims. No LLM is involved: a claim is only as
// strong as the literal, checkable quotes behind it.

import type { ClaimStatus, EvidenceType, SourceType } from "./labels";

export function normalizeText(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/­/g, "") // soft hyphen
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[–—−]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Numbers as written in Dutch or English text, normalised to a canonical decimal string.
// "1.200" (nl thousands) → "1200", "1,5" → "1.5", "12,5%" → "12.5", "€ 3.400,00" → "3400".
// Thousands groups may use "." "," or a (narrow) no-break space; a regular space separates
// numbers, so "2026 41.230" stays two numbers.
const NUMBER = String.raw`\d{1,3}(?:[.,\u00a0\u202f]\d{3})+(?:[.,]\d+)?|\d+(?:[.,]\d+)?`;

export function extractNumbers(s: string): string[] {
  return [...s.matchAll(new RegExp(NUMBER, "g"))].map((m) => canonicalNumber(m[0].replace(/[\u00a0\u202f]/g, "")));
}

export function canonicalNumber(raw: string): string {
  const v = numberCandidates(raw)[0];
  return Number.isFinite(v) ? String(v) : raw;
}

// Every value a written number can stand for. "1.234" is Dutch thousands (1234) but could be an
// English decimal (1.234); both are kept so a quote and a statement only need one reading in common.
function numberCandidates(raw: string): number[] {
  const r = raw.replace(/[\u00a0\u202f]/g, "");
  const dots = (r.match(/\./g) ?? []).length;
  const commas = (r.match(/,/g) ?? []).length;
  const plain = (x: string) => Number(x);
  if (dots && commas) {
    // Whichever separator comes last is the decimal separator.
    return [plain(r.lastIndexOf(",") > r.lastIndexOf(".") ? r.replace(/\./g, "").replace(",", ".") : r.replace(/,/g, ""))];
  }
  const sep = commas ? "," : dots ? "." : null;
  if (!sep) return [plain(r)];
  const count = commas || dots;
  const [intPart, frac] = r.split(sep);
  if (count > 1) return [plain(r.split(sep).join(""))];
  const asDecimal = plain(`${intPart}.${frac}`);
  const asThousands = plain(intPart + frac);
  // "0,125" or "12,5": only a decimal reading makes sense.
  if (frac.length !== 3 || /^0+$/.test(intPart)) return [asDecimal];
  return [asThousands, asDecimal];
}

const SCALES: [RegExp, number][] = [
  [/^(miljard|mld\.?|billion|bn)$/i, 1e9],
  [/^(miljoen|mln\.?|million|mn)$/i, 1e6],
  [/^(duizend|thousand|k)$/i, 1e3],
];

export type Quantity = { values: number[]; percent: boolean; raw: string };

// Numbers with their scale word and percent sign: "30 miljoen" is 30,000,000 and "45%" is not 45 euro.
export function extractQuantities(s: string): Quantity[] {
  const re = new RegExp(`(${NUMBER})(?:\\s*(%|procent\\b|percent\\b|miljard\\b|mld\\.?|billion\\b|bn\\b|miljoen\\b|mln\\.?|million\\b|mn\\b|duizend\\b|thousand\\b|k\\b))?`, "gi");
  const out: Quantity[] = [];
  for (const m of s.matchAll(re)) {
    const unit = (m[2] ?? "").trim();
    const percent = /^(%|procent|percent)$/i.test(unit);
    const scale = SCALES.find(([pattern]) => pattern.test(unit))?.[1] ?? 1;
    out.push({ values: numberCandidates(m[1]).map((v) => v * scale), percent, raw: m[0] });
  }
  return out;
}

function sameQuantity(a: Quantity, b: Quantity): boolean {
  if (a.percent !== b.percent) return false;
  return a.values.some((x) => b.values.some((y) => Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x))));
}

// A year in a statement is context ("in 2026"), not the claimed figure.
function isYear(q: Quantity): boolean {
  return !q.percent && q.values.length === 1 && Number.isInteger(q.values[0]) && q.values[0] >= 1900 && q.values[0] <= 2100 && /^\d{4}$/.test(q.raw.trim());
}

export type QuoteCheck = "exact" | "not_found" | "numbers_mismatch";

// A quote passes when it appears literally (after normalisation) in the stored excerpt and
// every figure in the claim statement appears in the quote with the same scale and unit.
export function checkQuote(quote: string, excerpt: string, statement?: string): QuoteCheck {
  const q = normalizeText(quote);
  if (q.length < 8 || !normalizeText(excerpt).includes(q)) return "not_found";
  if (statement) {
    const inQuote = extractQuantities(quote);
    const needed = extractQuantities(statement).filter((n) => !isYear(n));
    if (needed.some((n) => !inQuote.some((x) => sameQuantity(n, x)))) return "numbers_mismatch";
  }
  return "exact";
}

// Registrable domain approximation, good enough to tell independent publishers apart.
export function registrableDomain(urlOrHost: string | null | undefined): string | null {
  if (!urlOrHost) return null;
  let host = urlOrHost;
  try {
    host = new URL(urlOrHost.includes("://") ? urlOrHost : `https://${urlOrHost}`).hostname;
  } catch {
    return null;
  }
  host = host.toLowerCase().replace(/^www\./, "");
  const parts = host.split(".");
  const twoLevel = ["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "co.nz", "co.za", "com.br"];
  const lastTwo = parts.slice(-2).join(".");
  if (twoLevel.includes(lastTwo) && parts.length >= 3) return parts.slice(-3).join(".");
  return parts.length >= 2 ? lastTwo : host;
}

export type EvidenceForStatus = {
  sourceType: SourceType;
  publisher?: string | null;
  isPrimary: boolean;
  domain: string | null;
  publishedOn: string | null; // ISO date
  contentHash: string | null;
  quoteCheck: QuoteCheck | "unchecked";
  stance: "supports" | "contradicts";
};

export type FreshnessKind = "statistic" | "price" | "regulation" | "product" | "general";

// Maximum age in months before a source must be re-checked for this kind of data.
export const FRESHNESS_MONTHS: Record<FreshnessKind, number> = {
  price: 12,
  product: 12,
  regulation: 18,
  statistic: 36,
  general: 36,
};

function monthsBetween(fromIso: string, to: Date): number {
  const d = new Date(fromIso);
  return (to.getUTCFullYear() - d.getUTCFullYear()) * 12 + (to.getUTCMonth() - d.getUTCMonth());
}

// A publication date in the future is a typo or a trick; it never makes a source fresh.
function isFutureDate(iso: string, now: Date): boolean {
  const t = new Date(iso).getTime();
  return !Number.isFinite(t) || t > now.getTime() + 86_400_000;
}

const NO_EVIDENCE_TYPES: EvidenceType[] = ["ai_inference", "internal_assumption", "synthetic_simulation"];

export type StatusResult = { status: ClaimStatus; reason: string };

export function computeClaimStatus(
  claim: { evidenceType: EvidenceType; freshness: FreshnessKind },
  evidence: EvidenceForStatus[],
  now: Date = new Date(),
): StatusResult {
  if (claim.evidenceType === "synthetic_simulation") {
    return { status: "insufficient", reason: "Synthetische simulatie telt nooit als marktbewijs." };
  }
  const passing = evidence.filter((e) => e.quoteCheck === "exact");
  const supporting = passing.filter((e) => e.stance === "supports");
  const contradicting = passing.filter((e) => e.stance === "contradicts");

  if (supporting.length === 0 && contradicting.length > 0) {
    return { status: "contested", reason: `${contradicting.length} gecontroleerde bron(nen) spreken dit tegen; geen bron ondersteunt het.` };
  }
  if (supporting.length === 0) {
    const failed = evidence.filter((e) => e.quoteCheck === "not_found" || e.quoteCheck === "numbers_mismatch");
    if (failed.length) {
      return {
        status: "insufficient",
        reason: failed.some((e) => e.quoteCheck === "numbers_mismatch")
          ? "Het citaat bevat niet de getallen uit de bewering."
          : "Het citaat is niet letterlijk teruggevonden in de opgeslagen bron.",
      };
    }
    return {
      status: "insufficient",
      reason: NO_EVIDENCE_TYPES.includes(claim.evidenceType)
        ? "Dit is een aanname of afleiding zonder controleerbare bron."
        : "Er is nog geen controleerbaar citaat gekoppeld.",
    };
  }

  if (contradicting.length > 0) {
    return { status: "contested", reason: `${contradicting.length} gecontroleerde bron(nen) spreken dit tegen.` };
  }

  const maxAge = FRESHNESS_MONTHS[claim.freshness];
  const dated = supporting.filter((e) => !e.publishedOn || !isFutureDate(e.publishedOn, now));
  if (dated.length === 0) {
    return { status: "insufficient", reason: "De publicatiedatum ligt in de toekomst; controleer de datum van de bron." };
  }
  const fresh = dated.filter((e) => !e.publishedOn || monthsBetween(e.publishedOn, now) <= maxAge);
  if (fresh.length === 0) {
    return { status: "outdated", reason: `Alle bronnen zijn ouder dan ${maxAge} maanden voor dit soort gegevens.` };
  }

  const strong = fresh.filter((e) => e.sourceType === "official_statistic" || (e.isPrimary && e.sourceType === "primary_document"));
  const independent = independentCount(fresh);
  if (NO_EVIDENCE_TYPES.includes(claim.evidenceType)) {
    return { status: "estimate", reason: "Bronnen ondersteunen dit deels, maar het blijft een afleiding." };
  }
  if (strong.length > 0) {
    return { status: "verified", reason: "Letterlijk teruggevonden in een officiële of primaire bron." };
  }
  if (independent >= 2) {
    return { status: "verified", reason: `Bevestigd door ${independent} onafhankelijke bronnen.` };
  }
  const undated = fresh.every((e) => !e.publishedOn);
  return {
    status: "estimate",
    reason: undated
      ? "Eén secundaire bron zonder publicatiedatum; actualiteit niet vast te stellen."
      : "Eén secundaire bron; nog niet onafhankelijk bevestigd.",
  };
}

// Two copies of the same press release are one source: count distinct publishers and contents.
// Sources without a domain fall back to their publisher; sources with neither count once together.
export function independentCount(evidence: EvidenceForStatus[]): number {
  const seenOrigins = new Set<string>();
  const seenHashes = new Set<string>();
  let n = 0;
  for (const e of evidence) {
    const origin = e.domain ? `d:${e.domain}` : e.publisher?.trim() ? `p:${normalizeText(e.publisher)}` : "unknown";
    const hash = e.contentHash ?? "";
    if (seenOrigins.has(origin) || (hash && seenHashes.has(hash))) continue;
    seenOrigins.add(origin);
    if (hash) seenHashes.add(hash);
    n++;
  }
  return n;
}

// True when every figure in `text` (with its scale and unit) also appears in `quote`; used to accept
// a competitor price only when the full amount is literally in the cited passage.
export function figuresAppearIn(text: string, quote: string): boolean {
  const needed = extractQuantities(text);
  if (needed.length === 0) return false;
  const inQuote = extractQuantities(quote);
  return needed.every((n) => inQuote.some((x) => sameQuantity(n, x)));
}

// Official statistics and government publishers, decided in code. A model may describe a source,
// but it can never promote one to "official" or "primary": that would turn a blog into evidence.
const OFFICIAL_DOMAINS = /(^|\.)(cbs\.nl|europa\.eu|overheid\.nl|rijksoverheid\.nl|kvk\.nl|statline\.cbs\.nl|ocw\.nl|rvo\.nl|dnb\.nl|cpb\.nl|scp\.nl|eurostat\.ec\.europa\.eu|oecd\.org|statbel\.fgov\.be)$/;

export function sourceTypeForDomain(domain: string | null): SourceType {
  return domain && OFFICIAL_DOMAINS.test(domain) ? "official_statistic" : "other";
}

const AI_DESCRIBABLE: SourceType[] = ["research_report", "news", "review_site", "blog", "company_page", "other"];

// The AI's description of an automatically found source, limited to types that never count as strong.
export function aiSourceType(domain: string | null, suggested: string): SourceType {
  const fixed = sourceTypeForDomain(domain);
  if (fixed === "official_statistic") return fixed;
  return AI_DESCRIBABLE.includes(suggested as SourceType) ? (suggested as SourceType) : "other";
}

// Parses a figure typed by a user ("1,5 miljoen", "0.25", "41.230") with the same rules as quotes.
// Returns null for empty, unreadable or multiple figures.
export function numericFromInput(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  const found = extractQuantities(raw);
  if (found.length !== 1) return null;
  const v = found[0].values[0];
  return Number.isFinite(v) ? v : null;
}

// True when `value` is one of the figures in the quote (any reading of it).
export function valueInQuote(value: number, quote: string): boolean {
  return extractQuantities(quote).some((q) => q.values.some((x) => Math.abs(x - value) <= 1e-9 * Math.max(1, Math.abs(value))));
}
