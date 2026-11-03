// Pure helpers for the survey editor in the experiment builder. They keep a survey consistent while the
// consultant edits it (ids, options, conditions, the key question) and turn validation and the question
// audit into Dutch messages. The browser uses them for the live editor, the server again before saving.

import type { z } from "zod";
import { SurveyConfigSchema, type QuestionType, type SurveyConfig, type SurveyQuestion } from "./survey";
import { auditQuestion, type AuditIssue, type IssueKind } from "./interview-audit";

export const MAX_EDITOR_QUESTIONS = 25;
export const MAX_OPTIONS = 12;

// Ids are generated, never typed: q1, q2, … and o1, o2, … unique within their list.
export function nextId(prefix: "q" | "o", existing: string[]): string {
  const used = new Set(existing);
  let i = existing.length + 1;
  while (used.has(`${prefix}${i}`)) i++;
  return `${prefix}${i}`;
}

const DEFAULT_SCALE = { min: 1, max: 5, minLabel: "Helemaal niet", maxLabel: "Heel erg" };

export function newQuestion(type: QuestionType, existingIds: string[]): SurveyQuestion {
  return withType({ id: nextId("q", existingIds), type: "text", text: "", required: true }, type);
}

// Changes the type and keeps what still fits: choice types keep (or get) two options, a scale gets ends.
export function withType(q: SurveyQuestion, type: QuestionType): SurveyQuestion {
  const next: SurveyQuestion = { ...q, type };
  delete next.options;
  delete next.scale;
  if (type === "single" || type === "multi") {
    next.options = q.options && q.options.length >= 2 ? q.options : [{ id: "o1", label: "" }, { id: "o2", label: "" }];
  }
  if (type === "scale") next.scale = q.scale ?? DEFAULT_SCALE;
  return next;
}

export const isChoice = (q: Pick<SurveyQuestion, "type">) => q.type === "single" || q.type === "multi";

export function updateQuestion(c: SurveyConfig, id: string, patch: Partial<SurveyQuestion>): SurveyConfig {
  return { ...c, questions: c.questions.map((q) => (q.id === id ? { ...q, ...patch } : q)) };
}

export function changeType(c: SurveyConfig, id: string, type: QuestionType): SurveyConfig {
  const q = c.questions.find((x) => x.id === id);
  if (!q) return c;
  let next: SurveyConfig = { ...c, questions: c.questions.map((x) => (x.id === id ? withType(x, type) : x)) };
  // A question that is no longer a choice cannot be the key question or carry conditions of others.
  if (type !== "single" && type !== "multi") next = forgetChoices(next, id);
  return next;
}

export function addQuestion(c: SurveyConfig, type: QuestionType = "single"): SurveyConfig {
  if (c.questions.length >= MAX_EDITOR_QUESTIONS) return c;
  return { ...c, questions: [...c.questions, newQuestion(type, c.questions.map((q) => q.id))] };
}

// Removing a question also removes the conditions that depended on it and, if it was the key question,
// the pre-registered key (the consultant picks a new one).
export function removeQuestion(c: SurveyConfig, id: string): SurveyConfig {
  const next = forgetChoices({ ...c, questions: c.questions.filter((q) => q.id !== id) }, id);
  return next;
}

function forgetChoices(c: SurveyConfig, id: string): SurveyConfig {
  return {
    ...c,
    key_question: c.key_question === id ? "" : c.key_question,
    success_options: c.key_question === id ? [] : c.success_options,
    questions: c.questions.map((q) => (q.showIf?.question === id ? stripCondition(q) : q)),
  };
}

function stripCondition(q: SurveyQuestion): SurveyQuestion {
  const rest = { ...q };
  delete rest.showIf;
  return rest;
}

// Moves a question one place up (-1) or down (+1). Conditions that would then point at a later question
// are removed, so the survey never shows a question based on an answer that comes after it.
export function moveQuestion(c: SurveyConfig, id: string, dir: -1 | 1): SurveyConfig {
  const i = c.questions.findIndex((q) => q.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= c.questions.length) return c;
  const qs = [...c.questions];
  [qs[i], qs[j]] = [qs[j], qs[i]];
  const pos = new Map(qs.map((q, k) => [q.id, k]));
  return {
    ...c,
    questions: qs.map((q, k) => (q.showIf && (pos.get(q.showIf.question) ?? Infinity) >= k ? stripCondition(q) : q)),
  };
}

export function addOption(c: SurveyConfig, qid: string): SurveyConfig {
  return {
    ...c,
    questions: c.questions.map((q) => {
      if (q.id !== qid || !isChoice(q) || (q.options ?? []).length >= MAX_OPTIONS) return q;
      const opts = q.options ?? [];
      return { ...q, options: [...opts, { id: nextId("o", opts.map((o) => o.id)), label: "" }] };
    }),
  };
}

export function updateOption(c: SurveyConfig, qid: string, oid: string, label: string): SurveyConfig {
  return {
    ...c,
    questions: c.questions.map((q) => (q.id === qid ? { ...q, options: (q.options ?? []).map((o) => (o.id === oid ? { ...o, label } : o)) } : q)),
  };
}

// Removing an option also removes it from the success options and from conditions on it.
export function removeOption(c: SurveyConfig, qid: string, oid: string): SurveyConfig {
  return {
    ...c,
    success_options: c.key_question === qid ? c.success_options.filter((o) => o !== oid) : c.success_options,
    questions: c.questions.map((q) => {
      if (q.id === qid) return { ...q, options: (q.options ?? []).filter((o) => o.id !== oid) };
      if (q.showIf?.question === qid) {
        const options = q.showIf.options.filter((o) => o !== oid);
        return options.length ? { ...q, showIf: { ...q.showIf, options } } : stripCondition(q);
      }
      return q;
    }),
  };
}

export function setKeyQuestion(c: SurveyConfig, qid: string): SurveyConfig {
  const q = c.questions.find((x) => x.id === qid);
  if (!q || !isChoice(q)) return c;
  // The key question is asked to everyone.
  const questions = c.questions.map((x) => (x.id === qid ? stripCondition(x) : x));
  return { ...c, questions, key_question: qid, success_options: c.key_question === qid ? c.success_options : [] };
}

export function toggleSuccess(c: SurveyConfig, oid: string, on: boolean): SurveyConfig {
  const set = new Set(c.success_options);
  if (on) set.add(oid);
  else set.delete(oid);
  const key = c.questions.find((q) => q.id === c.key_question);
  // Keep the option order of the question.
  return { ...c, success_options: (key?.options ?? []).map((o) => o.id).filter((id) => set.has(id)) };
}

export function setCondition(c: SurveyConfig, qid: string, dependsOn: string | null, options: string[] = []): SurveyConfig {
  return {
    ...c,
    questions: c.questions.map((q) => {
      if (q.id !== qid) return q;
      if (!dependsOn || q.id === c.key_question) return stripCondition(q);
      return { ...q, showIf: { question: dependsOn, options } };
    }),
  };
}

// Earlier choice questions a question can depend on.
export function conditionCandidates(c: SurveyConfig, qid: string): SurveyQuestion[] {
  const idx = c.questions.findIndex((q) => q.id === qid);
  return c.questions.slice(0, Math.max(0, idx)).filter(isChoice);
}

// ---------------------------------------------------------------------------
// Test Card metric from the key question
// ---------------------------------------------------------------------------

const quoteList = (labels: string[]) => {
  const q = labels.map((l) => `"${l}"`);
  return q.length <= 1 ? (q[0] ?? "") : `${q.slice(0, -1).join(", ")} of ${q[q.length - 1]}`;
};

export function metricFromKey(c: SurveyConfig): { metric_label: string; metric_numerator: string; metric_denominator: string } {
  const key = c.questions.find((q) => q.id === c.key_question);
  const labels = (key?.options ?? []).filter((o) => c.success_options.includes(o.id)).map((o) => o.label.trim() || "(optie zonder tekst)");
  if (!key || labels.length === 0) {
    return {
      metric_label: "Kernvraag: gekozen succesantwoord",
      metric_numerator: "respondenten die een succesantwoord kozen (kies de kernvraag en de succesopties)",
      metric_denominator: "respondenten die de kernvraag beantwoordden",
    };
  }
  const short = key.text.trim().replace(/\?$/, "");
  return {
    metric_label: `Kernvraag: ${short.length > 80 ? `${short.slice(0, 79).trimEnd()}…` : short}`.slice(0, 200),
    metric_numerator: `respondenten die ${quoteList(labels)} kozen`.slice(0, 200),
    metric_denominator: "respondenten die de kernvraag beantwoordden",
  };
}

// ---------------------------------------------------------------------------
// Validation and audit in Dutch
// ---------------------------------------------------------------------------

const FIELD: Record<string, string> = {
  title: "De titel",
  intro: "De introductie",
  researcher: "Wie vraagt (onderzoeker)",
  thank_you: "De bedanktekst",
  estimated_minutes: "De geschatte duur",
  key_question: "De kernvraag",
  success_options: "De succesopties",
  questions: "De vragenlijst",
  text: "de vraagtekst",
  label: "de tekst van een antwoordoptie",
  help: "de toelichting",
  options: "de antwoordopties",
  min: "het begin van de schaal",
  max: "het einde van de schaal",
  minLabel: "het label aan het begin van de schaal",
  maxLabel: "het label aan het einde van de schaal",
};

type Issue = z.core.$ZodIssue;

function dutch(issue: Issue): string {
  const last = [...issue.path].reverse().find((p) => typeof p === "string") as string | undefined;
  const field = FIELD[last ?? ""] ?? "Dit veld";
  const cap = field.charAt(0).toUpperCase() + field.slice(1);
  if (issue.code === "too_small") {
    if (issue.origin === "string") return `${cap} is te kort (minimaal ${issue.minimum} tekens).`;
    if (issue.origin === "array") return last === "questions" ? "Voeg minstens één vraag toe." : last === "success_options" ? "Kies minstens één succesoptie bij de kernvraag." : `${cap}: te weinig items.`;
    return `${cap} is te laag (minimaal ${issue.minimum}).`;
  }
  if (issue.code === "too_big") {
    if (issue.origin === "string") return `${cap} is te lang (maximaal ${issue.maximum} tekens).`;
    if (issue.origin === "array") return `${cap}: maximaal ${issue.maximum}.`;
    return `${cap} is te hoog (maximaal ${issue.maximum}).`;
  }
  if (issue.code === "invalid_format") return last === "key_question" ? "Kies de kernvraag waarop de test wordt beoordeeld." : `${cap} heeft een ongeldige vorm.`;
  if (issue.code === "invalid_type") return `${cap} ontbreekt of is ongeldig.`;
  if (issue.code === "custom") return issue.message;
  return `${cap} is ongeldig.`;
}

// Validation errors with the place they belong ("Vraag 3: …"), deduplicated, schema messages in Dutch.
export function surveyErrors(raw: unknown): string[] {
  const r = SurveyConfigSchema.safeParse(raw);
  if (r.success) return [];
  const out: string[] = [];
  for (const issue of r.error.issues) {
    const qi = issue.path[0] === "questions" && typeof issue.path[1] === "number" ? issue.path[1] : null;
    const oi = qi != null && issue.path[2] === "options" && typeof issue.path[3] === "number" ? issue.path[3] : null;
    const msg = dutch(issue);
    const where = qi != null && issue.code !== "custom" ? `Vraag ${qi + 1}${oi != null ? `, optie ${oi + 1}` : ""}: ` : "";
    const line = `${where}${where ? msg.charAt(0).toLowerCase() + msg.slice(1) : msg}`;
    if (!out.includes(line)) out.push(line);
  }
  return out;
}

// Kinds that matter for a written survey. A closed question is normal in a survey (answer options).
export const SURVEY_AUDIT_KINDS: IssueKind[] = ["hypothetical", "leading", "pitch", "double"];

export function auditSurveyQuestion(text: string, productNames: string[] = []): AuditIssue[] {
  return auditQuestion(text, { productNames }).filter((i) => SURVEY_AUDIT_KINDS.includes(i.kind));
}

export function auditSurvey(c: SurveyConfig, productNames: string[] = []): { id: string; index: number; issues: AuditIssue[] }[] {
  return c.questions.map((q, index) => ({ id: q.id, index, issues: auditSurveyQuestion(q.text, productNames) })).filter((a) => a.issues.length > 0);
}

// Parses the JSON the editor posts; null when it is not an object.
export function parseSurveyJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length > 200_000) return null;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : null;
  } catch {
    return null;
  }
}
