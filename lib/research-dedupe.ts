// Fase B2, punt 7: dubbele bevindingen samenvoegen bij het importeren.
//
// Dezelfde bewering (genormaliseerde tekst), of hetzelfde cijfer met dezelfde eenheid uit dezelfde bron, wordt één
// bevinding met meerdere vindplaatsen (claim_sources), in plaats van een tweede bevinding die het bewijs dubbel
// telt. Dezelfde vindplaats (hetzelfde fragment, of hetzelfde citaat uit dezelfde bron) voegt niets toe.
//
// Puur: geen database, zodat de regels met unittests vastliggen.

import { normalizeText } from "@/lib/domain/verify";

export type KnownLink = { sourceId: string; excerptId: string | null; quote: string; supportCheck?: string | null };
export type KnownFinding = { id: string; statement: string; numericValue: number | null; unit: string | null; links: KnownLink[] };
export type IncomingFinding = { statement: string; numericValue: number | null; unit: string | null; sourceId: string; excerptId: string | null; quote: string };

export type MergeDecision = { action: "new" } | { action: "merge"; into: KnownFinding } | { action: "same_location"; into: KnownFinding };

// De bewering zonder hoofdletters, aanhalingstekens, slotleesteken en dubbele spaties.
export function statementKey(s: string): string {
  return normalizeText(s)
    .replace(/["'`]/g, "")
    .replace(/[.!?;:,\s]+$/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export const quoteKey = (s: string) => statementKey(s);

const unitKey = (u: string | null | undefined) =>
  normalizeText(u ?? "")
    .replace(/[^\p{L}\p{N}%€$]/gu, "")
    .replace(/^euro$/, "€")
    .replace(/^eur$/, "€");

const sameNumber = (a: number | null, b: number | null) => a != null && b != null && Math.abs(a - b) <= Math.max(1e-9, Math.abs(a) * 1e-9);

// Hoort de binnenkomende bevinding bij een bekende bevinding, en zo ja: nieuwe of dezelfde vindplaats?
export function decideMerge(incoming: IncomingFinding, known: KnownFinding[]): MergeDecision {
  const key = statementKey(incoming.statement);
  const match =
    known.find((k) => statementKey(k.statement) === key) ??
    known.find(
      (k) =>
        sameNumber(k.numericValue, incoming.numericValue) &&
        unitKey(k.unit) === unitKey(incoming.unit) &&
        k.links.some((l) => l.sourceId === incoming.sourceId),
    );
  if (!match) return { action: "new" };
  const q = quoteKey(incoming.quote);
  const sameLocation = match.links.some(
    (l) => (incoming.excerptId != null && l.excerptId === incoming.excerptId) || (l.sourceId === incoming.sourceId && quoteKey(l.quote) === q),
  );
  return sameLocation ? { action: "same_location", into: match } : { action: "merge", into: match };
}

// Een eerder oordeel van de steuncontrole over precies dit citaat bij deze bevinding (dan hoeft hij niet opnieuw).
export function knownSupportVerdict(into: KnownFinding, quote: string): string | null {
  const q = quoteKey(quote);
  const hit = into.links.find((l) => quoteKey(l.quote) === q && l.supportCheck && l.supportCheck !== "unchecked");
  return hit?.supportCheck ?? null;
}
