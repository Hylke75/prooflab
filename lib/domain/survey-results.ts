// Survey results: the pre-registered key metric with its split per source and channel, warnings about the
// origin of the answers, the CSV export and the open answers that become customer signals. Pure functions.
// Survey answers are self-reported: they never count as observed behaviour.

import { keyMetric, minimumDurationMs, type AnswerValue, type KeyMetric, type ResponseRow, type SurveyConfig } from "./survey";

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

const tooFastRow = (config: SurveyConfig, r: ResponseRow) => r.duration_ms != null && r.duration_ms < minimumDurationMs(config);

export function surveySplit(config: SurveyConfig, rows: ResponseRow[], minSample: number): SurveySplit {
  const all = keyMetric(config, rows);
  const invitation = keyMetric(config, rows, "invitation");
  const openLink = keyMetric(config, rows, "open_link");
  const channels = new Map<string, { channel: string; n: number; successes: number }>();
  const contents = new Map<string | null, { content: string | null; n: number; successes: number }>();
  for (const r of rows) {
    if (tooFastRow(config, r)) continue;
    const a = r.answers[config.key_question];
    if (a == null) continue;
    const success = (Array.isArray(a) ? a : [String(a)]).some((x) => config.success_options.includes(x));
    const c = channels.get(r.channel) ?? { channel: r.channel, n: 0, successes: 0 };
    c.n++;
    if (success) c.successes++;
    channels.set(r.channel, c);
    const key = r.content ?? null;
    const p = contents.get(key) ?? { content: key, n: 0, successes: 0 };
    p.n++;
    if (success) p.successes++;
    contents.set(key, p);
  }
  const openLinkShare = all.n ? openLink.n / all.n : null;
  const warnings: string[] = [];
  if (openLinkShare != null && openLinkShare > OPEN_LINK_WARNING_SHARE) {
    warnings.push(
      `Open link: herkomst niet te controleren. ${Math.round(openLinkShare * 100)}% van de antwoorden komt via de open link; AI-agents en mensen buiten de doelgroep vullen open enquêtes overtuigend in. Weeg de uitgenodigde respondenten zwaarder.`,
    );
  }
  if (all.tooFast > 0) {
    warnings.push(`${all.tooFast} ${all.tooFast === 1 ? "antwoord is" : "antwoorden zijn"} niet meegeteld: sneller ingevuld dan geloofwaardig (minder dan ${Math.round(minimumDurationMs(config) / 1000)} seconden).`);
  }
  if (rows.length > 0 && invitation.n < minSample) {
    warnings.push(`Pas ${invitation.n} van de minimaal ${minSample} antwoorden komen van persoonlijk uitgenodigde, bekende respondenten.`);
  }
  return {
    all,
    invitation,
    openLink,
    byChannel: [...channels.values()].sort((a, b) => b.n - a.n),
    byContent: [...contents.values()].sort((a, b) => b.n - a.n),
    responses: rows.length, openLinkShare, warnings };
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
  const min = minimumDurationMs(config);
  const header = ["respons", "datum", "bron", "kanaal", "duur_seconden", "meegeteld", ...config.questions.map((q, i) => `${i + 1}. ${q.text}`)];
  const lines = [header.map(csvCell).join(SEP)];
  rows.forEach((r, i) => {
    const fast = r.duration_ms != null && r.duration_ms < min;
    lines.push(
      [
        String(i + 1),
        r.created_at.slice(0, 10),
        SOURCE_LABEL[r.source],
        r.channel,
        r.duration_ms == null ? "" : String(Math.round(r.duration_ms / 1000)),
        fast ? "nee (te snel)" : "ja",
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
    if (tooFastRow(config, r)) return;
    for (const q of textQs) {
      const v = r.answers[q.id];
      if (typeof v !== "string") continue;
      const text = redactContact(v.replace(/\s+/g, " ").trim());
      if (text) out.push({ text, question: q.id, source: r.source, respondent: i + 1 });
    }
  });
  return out;
}
