// Survey results: the pre-registered key metric with its split per source and channel, warnings about the
// origin of the answers, the CSV export and the open answers that become customer signals. Pure functions.
// Survey answers are self-reported: they never count as observed behaviour.

import {
  countResponses,
  isBelievable,
  keyMetricFromCounts,
  minimumDurationMs,
  notBelievable,
  notBelievableText,
  responseStatus,
  STATUS_LABEL,
  type AnswerValue,
  type KeyMetric,
  type QuestionSummary,
  type ResponseRow,
  type SurveyConfig,
  type SurveyCountRow,
} from "./survey";

export const OPEN_LINK_WARNING_SHARE = 0.5;

export type SurveySplit = {
  all: KeyMetric;
  invitation: KeyMetric;
  openLink: KeyMetric;
  byChannel: { channel: string; n: number; successes: number }[];
  // Per post code (utm_content of the open link; null = no code, e.g. invitations or a link without code).
  byContent: { content: string | null; n: number; successes: number }[];
  responses: number; // all stored responses, believable or not
  openLinkShare: number | null; // share of believable key answers that came through the open link
  warnings: string[];
};

// From response rows (tests, CSV) or from the per-source × channel counts of survey_key_counts() (the pages).
export function surveySplit(config: SurveyConfig, rows: ResponseRow[], minSample: number): SurveySplit {
  return surveySplitFromCounts(config, countResponses(config, rows), minSample);
}

export function surveySplitFromCounts(config: SurveyConfig, counts: SurveyCountRow[], minSample: number): SurveySplit {
  const all = keyMetricFromCounts(counts);
  const invitation = keyMetricFromCounts(counts, "invitation");
  const openLink = keyMetricFromCounts(counts, "open_link");
  const channels = new Map<string, { channel: string; n: number; successes: number }>();
  const contents = new Map<string | null, { content: string | null; n: number; successes: number }>();
  for (const r of counts) {
    if (r.n === 0) continue;
    const c = channels.get(r.channel) ?? { channel: r.channel, n: 0, successes: 0 };
    c.n += r.n;
    c.successes += r.successes;
    channels.set(r.channel, c);
    const key = r.content ?? null;
    const p = contents.get(key) ?? { content: key, n: 0, successes: 0 };
    p.n += r.n;
    p.successes += r.successes;
    contents.set(key, p);
  }
  const openLinkShare = all.n ? openLink.n / all.n : null;
  const warnings: string[] = [];
  if (openLinkShare != null && openLinkShare > OPEN_LINK_WARNING_SHARE) {
    warnings.push(
      `Open link: herkomst niet te controleren. ${Math.round(openLinkShare * 100)}% van de antwoorden komt via de open link; AI-agents en mensen buiten de doelgroep vullen open enquêtes overtuigend in. Weeg de uitgenodigde respondenten zwaarder.`,
    );
  }
  if (all.tooFast > 0 && all.tooFast === notBelievable(all)) {
    warnings.push(`${all.tooFast} ${all.tooFast === 1 ? "antwoord is" : "antwoorden zijn"} niet meegeteld: sneller ingevuld dan geloofwaardig (minder dan ${Math.round(minimumDurationMs(config) / 1000)} seconden).`);
  } else if (notBelievable(all) > 0) {
    const x = notBelievable(all);
    warnings.push(`${x} ${x === 1 ? "antwoord is" : "antwoorden zijn"} niet meegeteld omdat ze niet geloofwaardig zijn: ${notBelievableText(all)}.`);
  }
  if (all.screenedOut > 0) {
    warnings.push(`${all.screenedOut} ${all.screenedOut === 1 ? "respondent viel" : "respondenten vielen"} buiten de doelgroep (screeningsvraag) en ${all.screenedOut === 1 ? "telt" : "tellen"} niet mee.`);
  }
  if (all.responses > 0 && invitation.n < minSample) {
    warnings.push(`Pas ${invitation.n} van de minimaal ${minSample} antwoorden komen van persoonlijk uitgenodigde, bekende respondenten.`);
  }
  return {
    all,
    invitation,
    openLink,
    byChannel: [...channels.values()].sort((a, b) => b.n - a.n),
    byContent: [...contents.values()].sort((a, b) => b.n - a.n),
    responses: all.responses,
    openLinkShare,
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Privacy: respondents sometimes type contact details in an open answer
// ---------------------------------------------------------------------------

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+31|0031|\b0)[\s-]?(?:6|[1-9]\d{1,2})(?:[\s-]?\d){7,8}\b/g;

export function redactContact(s: string): string {
  return s.replace(EMAIL, "[e-mailadres verwijderd]").replace(PHONE, "[telefoonnummer verwijderd]");
}

// ---------------------------------------------------------------------------
// CSV export: one row per response, one column per question, no e-mail addresses
// ---------------------------------------------------------------------------

export type ExportRow = ResponseRow & { created_at: string };

const SEP = ";"; // Dutch spreadsheet default

// Quotes every cell and defuses formula injection (a cell starting with = + - @ is read as text).
export function csvCell(v: string): string {
  const safe = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return `"${safe.replace(/"/g, '""')}"`;
}

const SOURCE_LABEL = { invitation: "uitnodiging", open_link: "open link" } as const;

function answerText(config: SurveyConfig, qid: string, v: AnswerValue | undefined): string {
  if (v == null) return "";
  const q = config.questions.find((x) => x.id === qid);
  const label = (id: string) => q?.options?.find((o) => o.id === id)?.label ?? id;
  if (Array.isArray(v)) return v.map(label).join(" | ");
  if (typeof v === "number") return String(v).replace(".", ",");
  if (q?.type === "single") return label(v);
  return redactContact(v);
}

export function surveyCsv(config: SurveyConfig, rows: ExportRow[]): string {
  const header = ["respons", "datum", "bron", "kanaal", "duur_seconden", "meegeteld", ...config.questions.map((q, i) => `${i + 1}. ${q.text}`)];
  const lines = [header.map(csvCell).join(SEP)];
  rows.forEach((r, i) => {
    lines.push(
      [
        String(i + 1),
        r.created_at.slice(0, 10),
        SOURCE_LABEL[r.source],
        r.channel,
        r.duration_ms == null ? "" : String(Math.round(r.duration_ms / 1000)),
        STATUS_LABEL[responseStatus(config, r)],
        ...config.questions.map((q) => answerText(config, q.id, r.answers[q.id])),
      ]
        .map(csvCell)
        .join(SEP),
    );
  });
  // BOM so spreadsheet programs read the file as UTF-8.
  return `﻿${lines.join("\r\n")}\r\n`;
}

export function csvFilename(title: string, date: string): string {
  const slug = title.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `enquete-${slug || "antwoorden"}-${date}.csv`;
}

// ---------------------------------------------------------------------------
// Open answers → customer-signal excerpts
// ---------------------------------------------------------------------------

export type OpenAnswer = { text: string; question: string; source: ResponseRow["source"]; respondent: number };

// Non-empty answers to open questions from believable responses, contact details removed.
export function openAnswers(config: SurveyConfig, rows: ResponseRow[]): OpenAnswer[] {
  const textQs = config.questions.filter((q) => q.type === "text");
  const out: OpenAnswer[] = [];
  rows.forEach((r, i) => {
    if (!isBelievable(config, r)) return;
    for (const q of textQs) {
      const v = r.answers[q.id];
      if (typeof v !== "string") continue;
      const text = redactContact(v.replace(/\s+/g, " ").trim());
      if (text) out.push({ text, question: q.id, source: r.source, respondent: i + 1 });
    }
  });
  return out;
}

// ---------------------------------------------------------------------------
// Sharing per-question summaries with clients
// ---------------------------------------------------------------------------

// The database (survey_shared_summaries) returns nothing for a shared question with fewer believable answers.
export const SHARE_MIN_N = 5;

// Closed questions a consultant can share with clients: choice, scale and number. Never open answers, and not
// attention checks (they say nothing about the topic).
export function shareableQuestions(config: SurveyConfig): SurveyConfig["questions"] {
  return config.questions.filter((q) => q.type !== "text" && !q.attention);
}

// Keeps only ids of shareable questions, in survey order.
export function cleanShare(config: SurveyConfig, ids: unknown[]): string[] {
  const want = new Set(ids.filter((x): x is string => typeof x === "string"));
  return shareableQuestions(config)
    .map((q) => q.id)
    .filter((id) => want.has(id));
}

export type SharedRow = { question_id: string; value: string; answers: number; count: number };

// Rebuilds per-question summaries from the aggregate rows of survey_shared_summaries(). Shared questions without
// rows have too few believable answers to show (hidden).
export function sharedSummaries(config: SurveyConfig, rows: SharedRow[], shared: string[]): { summaries: QuestionSummary[]; hidden: string[] } {
  const summaries: QuestionSummary[] = [];
  const hidden: string[] = [];
  for (const q of shareableQuestions(config)) {
    if (!shared.includes(q.id)) continue;
    const mine = rows.filter((r) => r.question_id === q.id);
    if (mine.length === 0) {
      hidden.push(q.id);
      continue;
    }
    const n = Number(mine[0].answers);
    if (q.type === "single" || q.type === "multi") {
      const count = (id: string) => Number(mine.find((r) => r.value === id)?.count ?? 0);
      summaries.push({
        id: q.id,
        type: q.type,
        text: q.text,
        n,
        options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label, count: count(o.id), share: n ? count(o.id) / n : 0 })),
      });
      continue;
    }
    const distribution = mine
      .map((r) => ({ value: Number(r.value), count: Number(r.count) }))
      .filter((d) => Number.isFinite(d.value))
      .sort((a, b) => a.value - b.value);
    const total = distribution.reduce((s, d) => s + d.count, 0);
    const at = (k: number) => {
      let seen = 0;
      for (const d of distribution) {
        seen += d.count;
        if (k < seen) return d.value;
      }
      return distribution[distribution.length - 1]?.value ?? 0;
    };
    summaries.push({
      id: q.id,
      type: q.type === "scale" ? "scale" : "number",
      text: q.text,
      n: total,
      mean: total ? distribution.reduce((s, d) => s + d.value * d.count, 0) / total : null,
      median: total ? (total % 2 ? at((total - 1) / 2) : (at(total / 2 - 1) + at(total / 2)) / 2) : null,
      distribution,
    });
  }
  return { summaries, hidden };
}
