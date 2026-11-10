// Monthly competitor recheck (research chapter 7.2): re-fetch the pages behind a competitor and run
// the literal quote check against the fresh text. Only checked differences, no AI judgement, and
// nothing is deleted: a quote that disappeared makes the finding outdated and is shown as such.

import { checkQuote, figuresAppearIn } from "./verify";

export const RECHECK_DAYS = 30;

export function recheckDue(lastCheckedAt: string | null | undefined, now: Date = new Date(), days = RECHECK_DAYS): boolean {
  if (!lastCheckedAt) return true;
  const t = new Date(lastCheckedAt).getTime();
  return !Number.isFinite(t) || now.getTime() - t > days * 86_400_000;
}

// Wat een aanbieder of alternatief nodig heeft om de maandelijkse controle zinvol te maken.
export type RecheckSubject = {
  kind: string;
  website: string | null;
  // Een gekoppelde bevinding (met bron-URL's) kan ook opnieuw worden opgehaald.
  hasLinkedSource: boolean;
  last_checked_at: string | null;
  created_at?: string | null;
};

// "Niets doen / huidige werkwijze" en alternatieven zonder website of bron hebben geen pagina om op te halen: geen controle.
export function recheckApplies(c: Pick<RecheckSubject, "kind" | "website" | "hasLinkedSource">): boolean {
  return c.kind !== "status_quo" && (!!c.website?.trim() || c.hasLinkedSource);
}

// Controle aanbevolen: alleen als er iets op te halen is, en langer dan RECHECK_DAYS geleden gecontroleerd. Nooit
// gecontroleerd telt vanaf de aanmaakdatum, zodat een net toegevoegde aanbieder niet meteen "te oud" heet.
export function competitorRecheckDue(c: RecheckSubject, now: Date = new Date(), days = RECHECK_DAYS): boolean {
  return recheckApplies(c) && recheckDue(c.last_checked_at ?? c.created_at ?? null, now, days);
}

export type QuoteRecheck = { id: string; quote: string; found: boolean };

export function recheckQuotes(quotes: { id: string; quote: string }[], pageText: string): QuoteRecheck[] {
  return quotes.map((q) => ({ ...q, found: checkQuote(q.quote, pageText) === "exact" }));
}

export type PageRecheck =
  | { url: string; reachable: false; error: string }
  | { url: string; reachable: true; quotes: QuoteRecheck[] };

export type CompetitorRecheck = {
  name: string;
  pages: PageRecheck[];
  website: { reachable: boolean; priceFound: boolean | null } | null;
};

// Human-readable list of what changed; empty when everything was found again.
export function recheckChanges(r: CompetitorRecheck): string[] {
  const out: string[] = [];
  for (const p of r.pages) {
    if (!p.reachable) {
      out.push(`${p.url}: pagina niet bereikbaar (${p.error}). De bevinding blijft staan; controleer handmatig.`);
      continue;
    }
    for (const q of p.quotes.filter((x) => !x.found)) {
      out.push(`Citaat niet meer gevonden op de pagina: “${q.quote.slice(0, 120)}${q.quote.length > 120 ? "…" : ""}”`);
    }
  }
  if (r.website && !r.website.reachable) out.push("Website niet bereikbaar.");
  if (r.website?.priceFound === false) out.push("De vastgelegde prijs staat niet meer letterlijk op de website. Controleer prijs en peildatum.");
  return out;
}

export function priceOnPage(visiblePrice: string | null, pageText: string): boolean | null {
  if (!visiblePrice) return null;
  return figuresAppearIn(visiblePrice, pageText);
}

// ---------------------------------------------------------------------------
// Automatische maandelijkse controle (voorstel "ProofLab eenvoudiger"): geen knop nodig. Zodra iemand van het team een
// idee opent, controleert ProofLab op de achtergrond de aanbieders waarvan de laatste controle meer dan RECHECK_DAYS
// geleden is, de oudste eerst en hooguit AUTO_RECHECK_MAX per keer. Wat veranderde, komt als "Let op"-tip bij Markt.
// ---------------------------------------------------------------------------

export const AUTO_RECHECK_MAX = 3;
export const RECHECK_NOTE_PREFIX = "recheck:";

export type AutoRecheckCandidate = RecheckSubject & { id: string; origin?: string | null };

// Welke aanbieders nu aan de beurt zijn: geen voorstellen (die hebben nog geen bron), alleen wat iets op te halen
// heeft en over tijd is; de langst niet gecontroleerde eerst.
export function pickDueForRecheck<T extends AutoRecheckCandidate>(list: T[], now: Date = new Date(), max = AUTO_RECHECK_MAX): T[] {
  const since = (c: T) => new Date(c.last_checked_at ?? c.created_at ?? 0).getTime() || 0;
  return list
    .filter((c) => c.origin !== "proposal" && competitorRecheckDue(c, now))
    .sort((a, b) => since(a) - since(b))
    .slice(0, Math.max(0, max));
}

// De tip na een automatische controle met verschillen. De code is per aanbieder en per maand, zodat dezelfde
// wijziging niet elke dag opnieuw een tip wordt; de coach sluit deze tips niet zelf (de gebruiker doet dat).
export function recheckNote(c: { id: string; name: string }, changes: string[], ideaId: string, now: Date = new Date()) {
  const month = now.toISOString().slice(0, 7);
  const body = `${changes.join(" ")} Niets is verwijderd; de betrokken bevindingen zijn opnieuw beoordeeld. Controleer de aanbieder en pas prijs of bron aan waar nodig.`;
  return {
    code: `${RECHECK_NOTE_PREFIX}${c.id.slice(0, 8)}:${month}`,
    kind: "warning" as const,
    title: `Maandelijkse controle: er veranderde iets bij ${c.name}`.slice(0, 160),
    body: body.length > 1200 ? `${body.slice(0, 1197)}…` : body,
    href: `/app/ideas/${ideaId}/research?tab=competitors`,
    audience: "consultant" as const,
  };
}
