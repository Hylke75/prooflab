// Does a literal quote actually carry the claim? (research chapter 7.1). The literal quote check
// catches invented quotes and wrong figures; the support check catches a quote that is literally
// right but says something else. A quote judged "not supported" counts like a failed quote check.
// A quote that is no longer on the live page (competitor recheck, 7.2) makes the finding outdated.

import { computeClaimStatus, normalizeText, type EvidenceForStatus, type FreshnessKind, type StatusResult } from "./verify";
import type { EvidenceType } from "./labels";

export type SupportCheck = "supports" | "partial" | "not_supported" | "unchecked";
export type SupportVerdict = Exclude<SupportCheck, "unchecked">;

export const SUPPORT_LABEL: Record<SupportCheck, { label: string; pill: string; explain: string }> = {
  supports: { label: "Draagt de bewering", pill: "green", explain: "Het citaat zegt inhoudelijk wat de bewering stelt." },
  partial: { label: "Draagt de bewering deels", pill: "orange", explain: "Het citaat ondersteunt een deel van de bewering; lees de bewering kritisch." },
  not_supported: { label: "Draagt de bewering niet", pill: "coral", explain: "Het citaat staat er letterlijk, maar zegt iets anders. Telt niet als bewijs." },
  unchecked: { label: "Inhoud nog niet gecontroleerd", pill: "gray", explain: "Alleen de letterlijke citaatcontrole is gedaan." },
};

export function isSupportCheck(v: unknown): v is SupportCheck {
  return v === "supports" || v === "partial" || v === "not_supported" || v === "unchecked";
}

// The research runner keeps AI-found claims unless the support check says the quote does not carry them.
export function keepAfterSupportCheck(v: SupportCheck): boolean {
  return v !== "not_supported";
}

export type EvidenceWithSupport = EvidenceForStatus & { support: SupportCheck; liveMissing?: boolean };

const SUPPORTABLE = new Set(["verified", "estimate", "outdated"]);

// Claim status with the support rule and the live-page rule applied on top of computeClaimStatus.
export function claimStatusWithSupport(
  claim: { evidenceType: EvidenceType; freshness: FreshnessKind },
  evidence: EvidenceWithSupport[],
  now: Date = new Date(),
): StatusResult {
  const mapped: EvidenceForStatus[] = evidence.map((e) => ({
    sourceType: e.sourceType,
    publisher: e.publisher,
    isPrimary: e.isPrimary,
    domain: e.domain,
    publishedOn: e.publishedOn,
    contentHash: e.contentHash,
    stance: e.stance,
    quoteCheck: e.support === "not_supported" && e.quoteCheck === "exact" ? "not_found" : e.quoteCheck,
  }));
  const live = mapped.filter((_, i) => !evidence[i].liveMissing);
  const result = computeClaimStatus(claim, live, now);
  const withMissing = live.length === mapped.length ? result : computeClaimStatus(claim, mapped, now);

  // Literal quotes that the support check rejected are the reason, not a missing quote.
  const rejected = evidence.filter((e) => e.support === "not_supported" && e.quoteCheck === "exact" && !e.liveMissing);
  const literalFailures = evidence.filter((e) => e.quoteCheck === "not_found" || e.quoteCheck === "numbers_mismatch");
  if (result.status === "insufficient" && rejected.length > 0 && literalFailures.length === 0 && withMissing === result) {
    return { status: "insufficient", reason: "Het citaat staat er letterlijk, maar draagt de bewering inhoudelijk niet (steuncontrole)." };
  }
  if (withMissing !== result && result.status === "insufficient" && SUPPORTABLE.has(withMissing.status)) {
    return { status: "outdated", reason: "Het citaat staat niet meer op de live pagina (hercontrole). Zoek een actuele bron." };
  }
  const partial = evidence.some((e) => e.support === "partial" && e.quoteCheck === "exact" && e.stance === "supports" && !e.liveMissing);
  const full = evidence.some((e) => e.support === "supports" && e.quoteCheck === "exact" && e.stance === "supports" && !e.liveMissing);
  if (partial && !full && SUPPORTABLE.has(result.status)) {
    return { ...result, reason: `${result.reason} Het citaat draagt de bewering maar deels.` };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Consultant overrides: the AI's verdict is kept in the note so agreement can be measured (7.9).
// ---------------------------------------------------------------------------

const AI_PREFIX = /^\[ai:(supports|partial|not_supported)\]\s?/;

export function encodeOverrideNote(aiVerdict: SupportCheck | null, note: string): string {
  const clean = note.replace(AI_PREFIX, "").trim();
  const prefix = aiVerdict && aiVerdict !== "unchecked" ? `[ai:${aiVerdict}] ` : "";
  return `${prefix}${clean}`.slice(0, 600);
}

export function parseOverrideNote(note: string | null | undefined): { aiVerdict: SupportVerdict | null; note: string } {
  if (!note) return { aiVerdict: null, note: "" };
  const m = note.match(AI_PREFIX);
  return { aiVerdict: m ? (m[1] as SupportVerdict) : null, note: note.replace(AI_PREFIX, "").trim() };
}

// ---------------------------------------------------------------------------
// Live-page recheck markers on a source (7.2). A short hash per quote that was no longer found.
// ---------------------------------------------------------------------------

// FNV-1a over the normalised quote: short, stable, and usable in client components too.
export function quoteKey(quote: string): string {
  let h = 0x811c9dc5;
  for (const ch of normalizeText(quote)) {
    h ^= ch.codePointAt(0)!;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const RECHECK = /^Hercontrole (\d{4}-\d{2}-\d{2}): (.*)$/;

export type RecheckMark = { date: string; missing: string[]; text: string };

export function recheckNote(date: string, total: number, missingQuotes: string[]): string {
  const keys = missingQuotes.map(quoteKey);
  const text =
    missingQuotes.length === 0
      ? `alle ${total} citaten teruggevonden op de live pagina.`
      : `${missingQuotes.length} van ${total} citaten niet meer gevonden op de pagina [${keys.join(",")}].`;
  return `Hercontrole ${date}: ${text}`;
}

// The recheck line goes first; an earlier recheck line is replaced, the original note is kept.
export function withRecheckNote(previous: string | null | undefined, line: string): string {
  const rest = (previous ?? "").split("\n").filter((l) => l.trim() && !RECHECK.test(l)).join("\n");
  return (rest ? `${line}\n${rest}` : line).slice(0, 600);
}

export function parseRecheckNote(note: string | null | undefined): RecheckMark | null {
  const m = note?.split("\n")[0].match(RECHECK);
  if (!m) return null;
  const keys = m[2].match(/\[([0-9a-f,]+)\]/)?.[1];
  return { date: m[1], missing: keys ? keys.split(",") : [], text: m[2].replace(/\s*\[[0-9a-f,]+\]/, "") };
}

export function isLiveMissing(note: string | null | undefined, quote: string): boolean {
  const mark = parseRecheckNote(note);
  return !!mark && mark.missing.includes(quoteKey(quote));
}
