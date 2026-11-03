// Survey distribution: address lists, personal links, the invitation e-mail and the public submit body. Pure
// functions without Node APIs (also used in the browser); hashes and tokens live in survey-tokens.ts. Answers via a
// personal invitation come from known people; open-link answers stay separate.

import { z } from "zod";
import { isVisible, validateAnswers, type Answers, type SurveyConfig, type SurveyQuestion } from "./survey";

export const MAX_INVITES = 2000;
// Resend accepts a few requests per second; 25 mails per server-action call keeps each call well under a minute.
export const SEND_BATCH_SIZE = 25;
export const REMINDER_AFTER_DAYS = 3;
export const MAX_SUBMIT_CHARS = 24_000;

// ---------------------------------------------------------------------------
// 1. Addresses
// ---------------------------------------------------------------------------

export type Recipient = { email: string; name: string | null };

const EMAIL_RE = /^[^\s@<>()[\]",;:\\]+@[^\s@<>()[\]",;:\\]+\.[a-z]{2,}$/i;

export function normalizeEmail(raw: string): string {
  return raw.trim().replace(/^mailto:/i, "").toLowerCase();
}

export function isEmail(raw: string): boolean {
  const e = normalizeEmail(raw);
  return e.length <= 254 && e.split("@")[0].length <= 64 && EMAIL_RE.test(e);
}

function cleanName(raw: string): string | null {
  const n = raw.trim().replace(/^["']+|["']+$/g, "").replace(/\s+/g, " ").trim().slice(0, 80);
  return n || null;
}

export type ParsedList = { recipients: Recipient[]; invalid: string[]; duplicates: number };

// One address per line, "Naam <adres>", or a pasted Outlook list separated by semicolons. Duplicates are
// removed (first occurrence wins), invalid entries are reported back literally.
export function parseAddressList(text: string): ParsedList {
  const items: string[] = [];
  for (const line of text.split(/\r?\n|;/)) {
    const t = line.trim();
    if (!t) continue;
    // "a@x.nl, b@y.nl" on one line (no names): split on commas.
    if (!t.includes("<") && t.includes(",") && t.split(",").every((p) => !p.trim() || p.includes("@"))) {
      items.push(...t.split(",").map((p) => p.trim()).filter(Boolean));
    } else items.push(t);
  }
  return dedupe(
    items.map((item) => {
      const m = /^(.*?)<([^<>]+)>\s*$/.exec(item);
      return m ? { raw: item, email: m[2], name: cleanName(m[1]) } : { raw: item, email: item, name: null };
    }),
  );
}

function dedupe(entries: { raw: string; email: string; name: string | null }[]): ParsedList {
  const seen = new Set<string>();
  const recipients: Recipient[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const e of entries) {
    if (!isEmail(e.email)) {
      invalid.push(e.raw.slice(0, 120));
      continue;
    }
    const email = normalizeEmail(e.email);
    if (seen.has(email)) {
      duplicates++;
      continue;
    }
    seen.add(email);
    recipients.push({ email, name: e.name });
  }
  return { recipients, invalid, duplicates };
}

// Minimal RFC 4180 parser. Dutch Excel exports use semicolons; the delimiter is taken from the first line.
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, "");
  const first = src.split(/\r?\n/, 1)[0] ?? "";
  const count = (ch: string) => first.split(ch).length - 1;
  const delim = [";", ",", "\t"].sort((a, b) => count(b) - count(a))[0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) {
      row.push(cell);
      cell = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(cell);
      if (row.some((x) => x.trim())) rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) rows.push(row);
  return rows;
}

// The column that holds e-mail addresses: a header named like "e-mail", otherwise the column where most of
// the first rows are addresses. -1 when nothing looks like an address.
export function guessEmailColumn(rows: string[][]): number {
  const header = rows[0] ?? [];
  const byName = header.findIndex((h) => /^\s*(e-?mail(adres|address)?|mail(adres)?|email address)\s*$/i.test(h));
  if (byName >= 0) return byName;
  const width = Math.max(0, ...rows.slice(0, 21).map((r) => r.length));
  let best = -1;
  let bestHits = 0;
  for (let c = 0; c < width; c++) {
    const hits = rows.slice(0, 21).filter((r) => isEmail(r[c] ?? "")).length;
    if (hits > bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}

export function guessNameColumn(rows: string[][]): number {
  return (rows[0] ?? []).findIndex((h) => /^\s*(naam|name|voornaam|first ?name|volledige naam|full ?name)\s*$/i.test(h));
}

export function recipientsFromCsv(rows: string[][], emailCol: number, nameCol = -1): ParsedList {
  if (emailCol < 0) return { recipients: [], invalid: [], duplicates: 0 };
  // The first row is a header unless it already holds an address.
  const body = rows.length && !isEmail(rows[0][emailCol] ?? "") ? rows.slice(1) : rows;
  return dedupe(
    body
      .filter((r) => (r[emailCol] ?? "").trim())
      .map((r) => ({ raw: (r[emailCol] ?? "").trim(), email: r[emailCol] ?? "", name: nameCol >= 0 ? cleanName(r[nameCol] ?? "") : null })),
  );
}

export function sliceBatches<T>(items: readonly T[], size = SEND_BATCH_SIZE): T[][] {
  if (size < 1) throw new Error("Batchgrootte moet minstens 1 zijn.");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// 2. Hashes, tokens and links
// ---------------------------------------------------------------------------

export const isToken = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9_-]{32}$/.test(s);
export const isEmailHash = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{64}$/.test(s);
export const isSlug = (s: unknown): s is string => typeof s === "string" && /^[a-f0-9]{14}$/.test(s);

const base = (appUrl: string) => appUrl.replace(/\/+$/, "");

export function publicPath(type: string, slug: string): string {
  return `${type === "survey" ? "/s" : "/t"}/${slug}`;
}

export function channelLink(appUrl: string, type: string, slug: string, channel: string): string {
  return `${base(appUrl)}${publicPath(type, slug)}?utm_source=${encodeURIComponent(channel)}`;
}

export function invitationLink(appUrl: string, slug: string, token: string): string {
  return `${base(appUrl)}/s/${slug}?u=${token}`;
}

export function unsubscribeLink(appUrl: string, token: string, eHash: string): string {
  return `${base(appUrl)}/s/afmelden?u=${token}&e=${eHash}`;
}

// RFC 8058 one-click target for the List-Unsubscribe header (mail clients POST here).
export function oneClickUnsubscribeLink(appUrl: string, token: string, eHash: string): string {
  return `${base(appUrl)}/api/s/afmelden?u=${token}&e=${eHash}`;
}

// ---------------------------------------------------------------------------
// 3. The invitation e-mail
// ---------------------------------------------------------------------------

export type InvitationTemplate = { subject: string; body: string };

export function defaultInvitation(s: { researcher: string; title: string; intro: string; minutes: number }): InvitationTemplate {
  return {
    subject: `Wil je ${s.minutes} minuten meedenken? ${s.title}`.slice(0, 150),
    body: `Hallo {naam},

Ik doe onderzoek en zou graag jouw ervaring horen.

${s.title}
${s.intro}

Het invullen duurt ongeveer ${s.minutes} ${s.minutes === 1 ? "minuut" : "minuten"}. Dit is je persoonlijke link:
{link}

Meedoen is vrijwillig en er wordt niets verkocht. Alvast hartelijk dank.

Met vriendelijke groet,
${s.researcher}`,
  };
}

export function defaultReminder(s: { researcher: string; title: string; minutes: number }): InvitationTemplate {
  return {
    subject: `Herinnering: ${s.title}`.slice(0, 150),
    body: `Hallo {naam},

Een paar dagen geleden vroeg ik je mee te denken in een kort onderzoek (${s.title}). Heb je er nog geen tijd voor
gehad? De vragenlijst staat nog open en duurt ongeveer ${s.minutes} ${s.minutes === 1 ? "minuut" : "minuten"}:
{link}

Dit is de enige herinnering. Geen tijd of geen interesse? Dan hoef je niets te doen.

Met vriendelijke groet,
${s.researcher}`,
  };
}

export function checkTemplate(t: InvitationTemplate): string | null {
  const subject = t.subject.trim();
  if (subject.length < 3 || subject.length > 150) return "Geef een onderwerp van 3 tot 150 tekens.";
  if (/[\r\n]/.test(t.subject)) return "Het onderwerp mag geen regelovergang bevatten.";
  const body = t.body.trim();
  if (body.length < 20 || body.length > 4000) return "De tekst moet tussen 20 en 4.000 tekens lang zijn.";
  return null;
}

export function privacyLine(researcher: string): string {
  return `Je ontvangt deze e-mail omdat ${researcher} je persoonlijk uitnodigt voor dit onderzoek. Er wordt niets verkocht. Je antwoorden worden alleen voor dit onderzoek gebruikt en hooguit 12 maanden bewaard; je e-mailadres wordt na 180 dagen verwijderd. Deze e-mail bevat geen trackingpixels of trackinglinks.`;
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export type RenderedEmail = { subject: string; text: string; html: string };

// Plain text plus a minimal HTML twin: no images, no remote resources, no rewritten links. The personal link
// and the unsubscribe link are the only links. The privacy and unsubscribe footer cannot be edited away.
export function renderInvitationEmail(input: {
  template: InvitationTemplate;
  name: string | null;
  link: string;
  unsubscribeUrl: string;
  researcher: string;
}): RenderedEmail {
  const name = input.name?.replace(/[\r\n<>]/g, " ").trim() || null;
  let body = input.template.body.trim().replace(/\r\n/g, "\n");
  body = name ? body.replaceAll("{naam}", name) : body.replace(/[ \t]*\{naam\}/g, "");
  body = body.includes("{link}") ? body.replaceAll("{link}", input.link) : `${body}\n\n${input.link}`;
  const footer = `${privacyLine(input.researcher)}\nGeen e-mails meer over dit onderzoek? Meld je af: ${input.unsubscribeUrl}`;
  const text = `${body}\n\n—\n${footer}`;

  const linkify = (escaped: string) =>
    [input.link, input.unsubscribeUrl].reduce((s, url) => s.split(escapeHtml(url)).join(`<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`), escaped);
  const para = (s: string) => `<p style="margin:0 0 14px">${linkify(escapeHtml(s)).replace(/\n/g, "<br>")}</p>`;
  const html = `<!doctype html><html lang="nl"><body style="margin:0;padding:24px;background:#ffffff;color:#151b28;font:15px/1.6 Arial,Helvetica,sans-serif"><div style="max-width:560px">${body
    .split(/\n{2,}/)
    .map(para)
    .join("")}<hr style="border:0;border-top:1px solid #e6e8e5;margin:22px 0"><p style="margin:0;color:#5f6879;font-size:12px">${linkify(escapeHtml(footer)).replace(/\n/g, "<br>")}</p></div></body></html>`;
  return { subject: input.template.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 150), text, html };
}

// ---------------------------------------------------------------------------
// 4. Invitation status
// ---------------------------------------------------------------------------

export type InvitationRow = { status: string; sent_at: string | null; reminded_at: string | null; error: string | null };

const DAY = 24 * 60 * 60 * 1000;

// One reminder (reminded_at), at least three days after the first mail, only to people who did not respond.
export function canRemind(r: InvitationRow, now = new Date()): boolean {
  if (r.status !== "sent" || !r.sent_at || r.error || r.reminded_at) return false;
  return now.getTime() - new Date(r.sent_at).getTime() >= REMINDER_AFTER_DAYS * DAY;
}

export type InvitationCounts = {
  invited: number;
  sent: number;
  pending: number;
  failed: number; // failed to send, can be retried (bounces and complaints are counted separately)
  responded: number;
  unsubscribed: number;
  remindable: number;
  bounced: number; // hard bounce reported by the e-mail provider
  complained: number; // marked as spam by the recipient
};

export function invitationCounts(rows: (InvitationRow & { delivery_issue?: string | null })[], now = new Date()): InvitationCounts {
  const c: InvitationCounts = { invited: rows.length, sent: 0, pending: 0, failed: 0, responded: 0, unsubscribed: 0, remindable: 0, bounced: 0, complained: 0 };
  for (const r of rows) {
    if (r.sent_at) c.sent++;
    if (r.delivery_issue === "bounced") c.bounced++;
    else if (r.delivery_issue === "complained") c.complained++;
    if (r.status === "pending") c.pending++;
    if (r.status === "failed" && !r.delivery_issue) c.failed++;
    if (r.status === "responded") c.responded++;
    if (r.status === "unsubscribed") c.unsubscribed++;
    if (canRemind(r, now)) c.remindable++;
  }
  return c;
}

// CSV of personal links for consultants who mail from their own tool. Cells that a spreadsheet would read as a
// formula are neutralised.
export function linksCsv(rows: { email: string; link: string; unsubscribe: string }[]): string {
  const cell = (s: string) => {
    const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
    return /[";,\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return ["email;link;afmeldlink", ...rows.map((r) => [r.email, r.link, r.unsubscribe].map(cell).join(";"))].join("\r\n") + "\r\n";
}

// ---------------------------------------------------------------------------
// 5. Public submit
// ---------------------------------------------------------------------------

const AnswerValue = z.union([z.string().max(2000), z.array(z.string().max(40)).max(12), z.number()]);

export const SurveySubmitSchema = z.object({
  answers: z.record(z.string().max(40), AnswerValue),
  consent: z.boolean(),
  duration_ms: z.number().int().min(0).max(86_400_000).optional(),
  token: z.string().max(64).optional(),
  utm_source: z.string().max(40).optional(),
  utm_content: z.string().max(40).optional(), // post code of the invitation post the link came from
  website: z.string().max(200).optional(), // honeypot: real people leave it empty; filled = bot, nothing stored
});
export type SurveySubmit = z.infer<typeof SurveySubmitSchema>;

export function parseSubmitBody(raw: string): { ok: true; body: SurveySubmit } | { ok: false; status: 400 | 413 } {
  if (raw.length > MAX_SUBMIT_CHARS) return { ok: false, status: 413 };
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, status: 400 };
  }
  const p = SurveySubmitSchema.safeParse(json);
  if (!p.success) return { ok: false, status: 400 };
  if (Object.keys(p.data.answers).length > 30) return { ok: false, status: 400 };
  if (p.data.token != null && !isToken(p.data.token)) return { ok: false, status: 400 };
  return { ok: true, body: p.data };
}

export type SubmitResult = "ok" | "closed" | "consent" | "invalid" | "rate" | "duplicate";
export type SubmitOutcome = { done: boolean; message: string };

// Dutch message for every outcome of submit_survey(). done = the respondent is finished (nothing to retry).
export function submitMessage(result: string, invited: boolean): SubmitOutcome {
  switch (result as SubmitResult) {
    case "ok":
      return { done: true, message: "Je antwoorden zijn opgeslagen." };
    case "duplicate":
      return { done: true, message: invited ? "Via deze persoonlijke link is de enquête al ingevuld. Dank je wel." : "Je hebt deze enquête al ingevuld. Dank je wel." };
    case "closed":
      return { done: true, message: "Deze enquête is gesloten. Je antwoorden zijn niet opgeslagen." };
    case "consent":
      return { done: false, message: "Geef toestemming om je antwoorden te versturen." };
    case "rate":
      return { done: false, message: "Er komen nu veel antwoorden binnen vanaf dit netwerk. Probeer het over een minuut opnieuw." };
    case "invalid":
      return invited
        ? { done: true, message: "Deze persoonlijke link is niet meer geldig. Je antwoorden zijn niet opgeslagen." }
        : { done: false, message: "Je antwoorden konden niet worden verwerkt. Controleer ze en probeer het opnieuw." };
    default:
      return { done: false, message: "Er ging iets mis bij het opslaan. Probeer het opnieuw." };
  }
}

// ---------------------------------------------------------------------------
// 6. Respondent-side checks (the public form; the server validates again)
// ---------------------------------------------------------------------------

// One message per visible question that is missing or invalid, for the error summary and inline errors.
export function questionErrors(questions: SurveyQuestion[], answers: Answers): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const q of questions) {
    if (!isVisible(q, answers)) continue;
    // validateAnswers only reads config.questions; check this one question on its own.
    const single = { questions: [{ ...q, showIf: undefined }] } as unknown as SurveyConfig;
    const r = validateAnswers(single, { [q.id]: answers[q.id] });
    if (!r.ok) errors[q.id] = r.error;
  }
  return errors;
}

// Only the answers to questions the respondent actually saw are sent.
export function visibleAnswers(questions: SurveyQuestion[], answers: Answers): Answers {
  const out: Answers = {};
  for (const q of questions) {
    if (!isVisible(q, out)) continue;
    const v = answers[q.id];
    if (v == null || v === "" || (Array.isArray(v) && v.length === 0)) continue;
    out[q.id] = v;
  }
  return out;
}
