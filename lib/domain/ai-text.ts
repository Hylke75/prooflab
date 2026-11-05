// Gebruikerstest D10: AI-tekst zonder interne codes. De samenvatting voor de AI gebruikt al Nederlandse labels, maar
// een model kan toch een code teruggeven ("[refuted]", "status: test_more", "inconclusive"). sanitizeAiText vervangt
// bekende codes op codeplekken door hun label; blijft er daarna een code over (een woord met een liggend streepje),
// dan is de tekst onbruikbaar en geeft de functie null: de aanroeper laat die uitdaging dan vallen.
//
// Puur, zodat de regels met unittests vastliggen.

import { ASSUMPTION_STATUS, CLAIM_STATUS, COMPETITOR_KINDS, DECISIONS, EXPERIMENT_STATES } from "./labels";

const VERDICT_LABELS: Record<string, string> = { pass: "geslaagd", fail: "niet geslaagd", inconclusive: "onbeslist", running: "loopt nog" };
const CARD_STATUS: Record<string, string> = { draft: "concept", approved: "goedgekeurd" };

// Eén label per code. Bij dubbele codes (refuted, inconclusive, approved) gaat het label voor bevindingen en aannames voor.
export const AI_CODE_LABELS: Record<string, string> = (() => {
  const out: Record<string, string> = {};
  const put = (code: string, label: string) => {
    if (!(code in out)) out[code] = label.toLowerCase();
  };
  for (const [k, v] of Object.entries(CLAIM_STATUS)) put(k, v.label);
  for (const [k, v] of Object.entries(ASSUMPTION_STATUS)) put(k, v.label);
  for (const [k, v] of Object.entries(VERDICT_LABELS)) put(k, v);
  for (const [k, v] of Object.entries(EXPERIMENT_STATES)) put(k, v.label);
  for (const [k, v] of Object.entries(CARD_STATUS)) put(k, v);
  for (const [k, v] of Object.entries(DECISIONS)) put(k, v.label);
  for (const [k, v] of Object.entries(COMPETITOR_KINDS)) put(k, v.label);
  return out;
})();

const CODES = Object.keys(AI_CODE_LABELS).sort((a, b) => b.length - a.length).join("|");
// Een code tussen haken, aanhalingstekens of backticks: "[refuted]", "(test_more)", "`verified`", "'live'".
const WRAPPED = new RegExp(`([\\[(\`'"“‘])\\s*(${CODES})\\s*([\\])\`'"”’])`, "gi");
// Een code na een veldnaam: "status: refuted", "oordeel = pass", "state live".
const AFTER_FIELD = new RegExp(`\\b(status|oordeel|uitslag|verdict|state|toestand|besluit|actie|action|kind)(\\s*[:=]?\\s*)(${CODES})\\b`, "gi");
// Codes met een liggend streepje zijn nooit gewone Nederlandse woorden.
const SNAKE_KNOWN = new RegExp(`\\b(${Object.keys(AI_CODE_LABELS).filter((c) => c.includes("_")).join("|")})\\b`, "gi");
const SNAKE_ANY = /\b[a-z]+(?:_[a-z0-9]+)+\b/i;

function replaceCodes(text: string): string {
  const label = (code: string) => AI_CODE_LABELS[code.toLowerCase()] ?? code;
  return text
    .replace(WRAPPED, (_m, _open: string, code: string) => `(${label(code)})`)
    .replace(AFTER_FIELD, (_m, field: string, sep: string, code: string) => `${field}${sep}${label(code)}`)
    .replace(SNAKE_KNOWN, (code: string) => label(code));
}

export function sanitizeAiText(text: string | null | undefined): string | null {
  if (text == null) return null;
  const out = replaceCodes(text);
  return SNAKE_ANY.test(out) ? null : out;
}

// Voor een lijst AI-uitdagingen: titel en toelichting opgeschoond; met een resterende code valt de uitdaging weg.
export function sanitizeChallenges<T extends { title: string; detail: string }>(list: T[]): T[] {
  const out: T[] = [];
  for (const c of list) {
    const title = sanitizeAiText(c.title);
    const detail = sanitizeAiText(c.detail);
    if (title == null || detail == null) continue;
    out.push({ ...c, title, detail });
  }
  return out;
}

// Voor vrije AI-tekst die niet kan wegvallen (bijv. de toelichting bij een AI-voorspelling): bekende codes worden
// labels; een resterende code wordt leesbaar gemaakt (liggende streepjes worden spaties).
export function cleanAiText(text: string): string {
  return replaceCodes(text).replace(/\b[a-z]+(?:_[a-z0-9]+)+\b/gi, (m) => m.replace(/_/g, " "));
}
