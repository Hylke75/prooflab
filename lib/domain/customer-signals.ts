// Customer signals from reviews, forums and outreach replies (research chapter 7.3). The AI groups
// stored excerpts into jobs, pains, gains and objections; ProofLab keeps only quotes that literally
// appear in their excerpt and counts those. Qualitative signals, never behaviour.

import { checkQuote, normalizeText } from "./verify";
import type { SourceType } from "./labels";

export type SignalKind = "job" | "pain" | "gain" | "objection";

export const SIGNAL_KINDS: Record<SignalKind, { label: string; pill: string }> = {
  job: { label: "Wil bereiken", pill: "blue" },
  pain: { label: "Pijnpunt", pill: "coral" },
  gain: { label: "Gewenste winst", pill: "green" },
  objection: { label: "Bezwaar", pill: "orange" },
};

// Review sites, forums and outreach replies are always signal sources. Blogs, news and "other" only when
// a consultant added them on purpose: automatically found research pages are not customer voices.
export const SIGNAL_SOURCE_TYPES: SourceType[] = ["review_site", "forum", "outreach", "blog", "news", "other"];
const ALWAYS: SourceType[] = ["review_site", "forum", "outreach"];

export function isSignalSource(s: { source_type: string; origin: string }): boolean {
  if (ALWAYS.includes(s.source_type as SourceType)) return true;
  return SIGNAL_SOURCE_TYPES.includes(s.source_type as SourceType) && s.origin === "manual";
}

export type SignalQuote = { text: string; excerpt_id: string; source_id: string; source_title: string };
export type SignalExcerpt = { ref: string; id: string; source_id: string; source_title: string; text: string };
export type ProposedGroup = { kind: SignalKind; label: string; quotes: { excerpt_ref: string; quote: string }[] };
export type VerifiedGroup = { kind: SignalKind; label: string; mentions: number; quotes: SignalQuote[] };

// Keeps only literal quotes (checkQuote against the cited excerpt), drops duplicates and groups that
// end up without a quote. The count is the number of verified quotes, not what the model claims.
export function verifySignalGroups(groups: ProposedGroup[], excerpts: SignalExcerpt[]): { kept: VerifiedGroup[]; droppedQuotes: number; droppedGroups: number } {
  const byRef = new Map(excerpts.map((e) => [e.ref, e]));
  let droppedQuotes = 0;
  let droppedGroups = 0;
  const kept: VerifiedGroup[] = [];
  for (const g of groups) {
    const seen = new Set<string>();
    const quotes: SignalQuote[] = [];
    for (const q of g.quotes) {
      const ex = byRef.get(q.excerpt_ref);
      const key = normalizeText(q.quote);
      if (!ex || checkQuote(q.quote, ex.text) !== "exact" || seen.has(key)) {
        droppedQuotes++;
        continue;
      }
      seen.add(key);
      quotes.push({ text: q.quote.trim().slice(0, 1000), excerpt_id: ex.id, source_id: ex.source_id, source_title: ex.source_title });
    }
    const label = g.label.trim().slice(0, 300);
    if (quotes.length === 0 || label.length < 3) {
      droppedGroups++;
      continue;
    }
    kept.push({ kind: g.kind, label, mentions: quotes.length, quotes: quotes.slice(0, 20) });
  }
  return { kept, droppedQuotes, droppedGroups };
}

// The most mentioned pains, as candidate assumptions to test.
export function topPains<T extends { kind: string; mentions: number }>(signals: T[], n = 3): T[] {
  return signals.filter((s) => s.kind === "pain").sort((a, b) => b.mentions - a.mentions).slice(0, n);
}

export function painAsAssumption(label: string, audience: string): string {
  const l = label.trim().replace(/[.!?]+$/, "");
  return `${audience ? `${audience}: ` : ""}${l.charAt(0).toUpperCase()}${l.slice(1)} is een probleem waar ze nu tijd of geld aan kwijt zijn.`.slice(0, 400);
}

export function parseSignalQuotes(raw: unknown): SignalQuote[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q) =>
    q && typeof q === "object" && typeof (q as SignalQuote).text === "string"
      ? [{ text: (q as SignalQuote).text, excerpt_id: String((q as SignalQuote).excerpt_id ?? ""), source_id: String((q as SignalQuote).source_id ?? ""), source_title: String((q as SignalQuote).source_title ?? "") }]
      : [],
  );
}
