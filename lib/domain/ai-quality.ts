// How good is the AI at its own tasks (research chapter 7.9)? Each measure compares AI output with
// what a consultant decided. Below the threshold, or with too few reviews, AI stays a proposal.

import type { SupportCheck } from "./support";

export const SUPPORT_AGREEMENT_THRESHOLD = 0.9;
export const CODING_ACCEPTANCE_THRESHOLD = 0.7;
export const MIN_REVIEWS = 10;

export type QualityLevel = "too_few" | "below" | "meets";

export type QualityMeasure = {
  rate: number | null; // share 0..1, null without reviews
  agreed: number;
  reviewed: number;
  threshold: number;
  level: QualityLevel;
  message: string;
};

function level(rate: number | null, reviewed: number, threshold: number): QualityLevel {
  if (rate === null || reviewed < MIN_REVIEWS) return "too_few";
  return rate >= threshold ? "meets" : "below";
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

// Support check: of the claim sources where a consultant gave a verdict after the AI did, how often
// did they agree? Rows without an AI verdict (manual checks) do not count.
export function supportAgreement(rows: { support_check: SupportCheck | string; support_checked_by: string | null; ai_support_check: string | null }[]): QualityMeasure {
  let agreed = 0;
  let reviewed = 0;
  for (const r of rows) {
    if (r.support_checked_by !== "consultant") continue;
    const aiVerdict = r.ai_support_check;
    if (!aiVerdict) continue;
    reviewed++;
    if (aiVerdict === r.support_check) agreed++;
  }
  const rate = reviewed ? agreed / reviewed : null;
  const lv = level(rate, reviewed, SUPPORT_AGREEMENT_THRESHOLD);
  return {
    rate,
    agreed,
    reviewed,
    threshold: SUPPORT_AGREEMENT_THRESHOLD,
    level: lv,
    message:
      lv === "too_few"
        ? `Nog te weinig steekproeven (${reviewed} van minimaal ${MIN_REVIEWS}). Beoordeel een paar AI-steuncontroles zelf.`
        : lv === "meets"
          ? `Consultant en AI zijn het in ${pct(rate!)} van de gevallen eens (drempel ${pct(SUPPORT_AGREEMENT_THRESHOLD)}).`
          : `Consultant en AI zijn het maar in ${pct(rate!)} eens (drempel ${pct(SUPPORT_AGREEMENT_THRESHOLD)}). Controleer elke AI-steuncontrole zelf.`,
  };
}

// AI coding of interviews: accepted / reviewed. Unreviewed observations do not count.
export function codingAcceptance(rows: { review_status: string | null }[]): QualityMeasure {
  const reviewed = rows.filter((r) => r.review_status === "accepted" || r.review_status === "rejected").length;
  const agreed = rows.filter((r) => r.review_status === "accepted").length;
  const rate = reviewed ? agreed / reviewed : null;
  const lv = level(rate, reviewed, CODING_ACCEPTANCE_THRESHOLD);
  return {
    rate,
    agreed,
    reviewed,
    threshold: CODING_ACCEPTANCE_THRESHOLD,
    level: lv,
    message:
      lv === "meets"
        ? `${pct(rate!)} van de AI-codering is geaccepteerd (${agreed} van ${reviewed}). Blijf steekproefsgewijs controleren.`
        : lv === "below"
          ? `Maar ${pct(rate!)} van de AI-codering is geaccepteerd (${agreed} van ${reviewed}). AI-codering blijft een voorstel.`
          : `Nog te weinig beoordelingen (${reviewed} van minimaal ${MIN_REVIEWS}). AI-codering blijft een voorstel.`,
  };
}

// AI coding may only be shown without a per-quote review once acceptance meets the bar.
export function codingIsProposalOnly(m: QualityMeasure): boolean {
  return m.level !== "meets";
}
