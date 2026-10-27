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
export function extractNumbers(s: string): string[] {
  const out: string[] = [];
  const re = /\d[\d.,\s]*\d|\d/g;
  for (const m of s.matchAll(re)) {
    const raw = m[0].replace(/\s/g, "");
    out.push(canonicalNumber(raw));
  }
  return out;
}

function canonicalNumber(raw: string): string {
  const dots = (raw.match(/\./g) ?? []).length;
  const commas = (raw.match(/,/g) ?? []).length;
  let n = raw;
  if (dots && commas) {
    // Whichever separator comes last is the decimal separator.
    n = raw.lastIndexOf(",") > raw.lastIndexOf(".") ? raw.replace(/\./g, "").replace(",", ".") : raw.replace(/,/g, "");
  } else if (commas) {
    n = commas === 1 && /,\d{1,2}$/.test(raw) ? raw.replace(",", ".") : raw.replace(/,/g, "");
  } else if (dots) {
    n = dots === 1 && /\.\d{1,2}$/.test(raw) ? raw : raw.replace(/\./g, "");
  }
  const v = Number(n);
  if (!Number.isFinite(v)) return raw;
  return String(v);
}

export type QuoteCheck = "exact" | "not_found" | "numbers_mismatch";

// A quote passes when it appears literally (after normalisation) in the stored excerpt and
// every number used in the claim statement also appears in the quote.
export function checkQuote(quote: string, excerpt: string, statement?: string): QuoteCheck {
  const q = normalizeText(quote);
  if (q.length < 8 || !normalizeText(excerpt).includes(q)) return "not_found";
  if (statement) {
    const inQuote = new Set(extractNumbers(quote));
    const needed = extractNumbers(statement).filter((n) => !isTrivialNumber(n));
    if (needed.some((n) => !inQuote.has(n))) return "numbers_mismatch";
  }
  return "exact";
}

// Years and list numbering in a statement are context, not the claimed figure.
function isTrivialNumber(n: string): boolean {
  const v = Number(n);
  return (Number.isInteger(v) && v >= 1900 && v <= 2100) || v === 1 || v === 2 || v === 3;
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
  return (to.getFullYear() - d.getFullYear()) * 12 + (to.getMonth() - d.getMonth());
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
  const fresh = supporting.filter((e) => !e.publishedOn || monthsBetween(e.publishedOn, now) <= maxAge);
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
export function independentCount(evidence: EvidenceForStatus[]): number {
  const seenDomains = new Set<string>();
  const seenHashes = new Set<string>();
  let n = 0;
  for (const e of evidence) {
    const dom = e.domain ?? "";
    const hash = e.contentHash ?? "";
    if ((dom && seenDomains.has(dom)) || (hash && seenHashes.has(hash))) continue;
    if (dom) seenDomains.add(dom);
    if (hash) seenHashes.add(hash);
    n++;
  }
  return n;
}
