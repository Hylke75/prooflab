// Surveys: the shape of a survey, validation of answers and the pre-registered key metric.
// A survey measures what people *say* (also about their own past behaviour); it never counts as observed
// behaviour. The key question and its "success" options are fixed in the Test Card before publishing.

import { z } from "zod";
import { wilson, type Interval } from "./stats";
import { numericFromInput } from "./verify";

export const QUESTION_TYPES = {
  single: "Eén keuze",
  multi: "Meerdere keuzes",
  scale: "Schaal",
  number: "Getal",
  text: "Open antwoord",
} as const;
export type QuestionType = keyof typeof QUESTION_TYPES;

const id = z.string().regex(/^[a-z0-9_-]{1,40}$/, "Gebruik alleen kleine letters, cijfers, - en _.");

export const OptionSchema = z.object({ id, label: z.string().trim().min(1).max(160) });

export const QuestionSchema = z
  .object({
    id,
    type: z.enum(["single", "multi", "scale", "number", "text"]),
    text: z.string().trim().min(5).max(300),
    help: z.string().trim().max(300).optional(),
    required: z.boolean().default(true),
    options: z.array(OptionSchema).max(12).optional(),
    // Scale: min..max with labels at both ends (e.g. 0–10 or 1–5).
    scale: z.object({ min: z.number().int().min(0).max(1), max: z.number().int().min(3).max(10), minLabel: z.string().max(60), maxLabel: z.string().max(60) }).optional(),
    // Show this question only when an earlier single/multi question has one of these options.
    showIf: z.object({ question: id, options: z.array(id).min(1) }).optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.type === "single" || q.type === "multi") && (!q.options || q.options.length < 2)) {
      ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft minstens twee antwoordopties nodig.` });
    }
    if (q.type === "scale" && !q.scale) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft een schaal nodig.` });
    const ids = (q.options ?? []).map((o) => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft dubbele opties.` });
  });

export const SurveyConfigSchema = z
  .object({
    title: z.string().trim().min(3).max(120),
    intro: z.string().trim().min(10).max(800),
    researcher: z.string().trim().min(2).max(120), // who asks: shown to respondents (honest about who is asking)
    questions: z.array(QuestionSchema).min(1).max(25),
    // Pre-registered metric: share of respondents to the key question who choose one of the success options.
    key_question: id,
    success_options: z.array(id).min(1),
    thank_you: z.string().trim().min(3).max(400),
    estimated_minutes: z.number().int().min(1).max(20),
  })
  .superRefine((c, ctx) => {
    const ids = c.questions.map((q) => q.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Elke vraag heeft een eigen id nodig." });
    const key = c.questions.find((q) => q.id === c.key_question);
    if (!key) {
      ctx.addIssue({ code: "custom", message: "Kies de kernvraag waarop de test wordt beoordeeld." });
      return;
    }
    if (key.type !== "single" && key.type !== "multi") ctx.addIssue({ code: "custom", message: "De kernvraag moet een keuzevraag zijn." });
    if (key.showIf) ctx.addIssue({ code: "custom", message: "De kernvraag moet aan iedereen worden gesteld." });
    const opts = new Set((key.options ?? []).map((o) => o.id));
    if (c.success_options.some((o) => !opts.has(o))) ctx.addIssue({ code: "custom", message: "De succesopties moeten bij de kernvraag horen." });
    if (key.options && c.success_options.length >= key.options.length) {
      ctx.addIssue({ code: "custom", message: "Niet alle opties kunnen 'succes' zijn: dan meet de vraag niets." });
    }
    for (const q of c.questions) {
      if (!q.showIf) continue;
      const idx = ids.indexOf(q.id);
      const dep = c.questions.findIndex((x) => x.id === q.showIf!.question);
      if (dep < 0 || dep >= idx) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" kan alleen afhangen van een eerdere vraag.` });
    }
  });

export type SurveyQuestion = z.infer<typeof QuestionSchema>;
export type SurveyConfig = z.infer<typeof SurveyConfigSchema>;
export type AnswerValue = string | string[] | number;
export type Answers = Record<string, AnswerValue>;

export function isVisible(q: SurveyQuestion, answers: Answers): boolean {
  if (!q.showIf) return true;
  const a = answers[q.showIf.question];
  const chosen = Array.isArray(a) ? a : typeof a === "string" ? [a] : [];
  return chosen.some((x) => q.showIf!.options.includes(x));
}

// Validates and normalises the answers a respondent submitted against the published survey. Unknown
// questions, hidden questions and invalid values are dropped; required visible questions must be present.
export function validateAnswers(config: SurveyConfig, raw: unknown): { ok: true; answers: Answers } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Geen antwoorden ontvangen." };
  const input = raw as Record<string, unknown>;
  const out: Answers = {};
  for (const q of config.questions) {
    if (!isVisible(q, out)) continue;
    const v = input[q.id];
    const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required) return { ok: false, error: `Beantwoord de vraag: "${q.text}"` };
      continue;
    }
    const opts = new Set((q.options ?? []).map((o) => o.id));
    if (q.type === "single") {
      if (typeof v !== "string" || !opts.has(v)) return { ok: false, error: `Kies een antwoord bij: "${q.text}"` };
      out[q.id] = v;
    } else if (q.type === "multi") {
      const arr = Array.isArray(v) ? v : [v];
      if (!arr.every((x) => typeof x === "string" && opts.has(x))) return { ok: false, error: `Kies geldige antwoorden bij: "${q.text}"` };
      out[q.id] = [...new Set(arr as string[])];
    } else if (q.type === "scale") {
      const n = Number(v);
      if (!Number.isInteger(n) || n < q.scale!.min || n > q.scale!.max) return { ok: false, error: `Kies een waarde op de schaal bij: "${q.text}"` };
      out[q.id] = n;
    } else if (q.type === "number") {
      // Same reading as everywhere in ProofLab: "1.200" is twelve hundred, "2,5" is two and a half.
      const n = typeof v === "number" ? v : numericFromInput(String(v));
      if (n == null || !Number.isFinite(n) || n < 0 || n > 1e9) return { ok: false, error: `Vul een getal in bij: "${q.text}"` };
      out[q.id] = n;
    } else {
      const s = String(v).trim().slice(0, 2000);
      if (s) out[q.id] = s;
      else if (q.required) return { ok: false, error: `Beantwoord de vraag: "${q.text}"` };
    }
  }
  return { ok: true, answers: out };
}

export type ResponseRow = { answers: Answers; source: "invitation" | "open_link"; channel: string; duration_ms: number | null };

// Very fast completions are not believable answers (likely a bot or click-through). Two seconds per question,
// at least eight seconds overall.
export function minimumDurationMs(config: SurveyConfig): number {
  return Math.max(8000, config.questions.length * 2000);
}

export type KeyMetric = { n: number; successes: number; interval: Interval; tooFast: number };

// The pre-registered metric over believable responses. Invitation and open-link responses can be counted
// separately; only invitation responses come from known people.
export function keyMetric(config: SurveyConfig, rows: ResponseRow[], source?: "invitation" | "open_link"): KeyMetric {
  const min = minimumDurationMs(config);
  let n = 0;
  let successes = 0;
  let tooFast = 0;
  for (const r of rows) {
    if (source && r.source !== source) continue;
    if (r.duration_ms != null && r.duration_ms < min) {
      tooFast++;
      continue;
    }
    const a = r.answers[config.key_question];
    if (a == null) continue;
    n++;
    const chosen = Array.isArray(a) ? a : [String(a)];
    if (chosen.some((x) => config.success_options.includes(x))) successes++;
  }
  return { n, successes, interval: wilson(successes, n), tooFast };
}

export type QuestionSummary =
  | { id: string; type: "single" | "multi"; text: string; n: number; options: { id: string; label: string; count: number; share: number }[] }
  | { id: string; type: "scale" | "number"; text: string; n: number; mean: number | null; median: number | null; distribution: { value: number; count: number }[] }
  | { id: string; type: "text"; text: string; n: number; answers: string[] };

// Per-question summary of believable responses (for the results page and the report).
export function summarise(config: SurveyConfig, rows: ResponseRow[]): QuestionSummary[] {
  const min = minimumDurationMs(config);
  const ok = rows.filter((r) => r.duration_ms == null || r.duration_ms >= min);
  return config.questions.map((q): QuestionSummary => {
    const vals = ok.map((r) => r.answers[q.id]).filter((v) => v != null);
    if (q.type === "single" || q.type === "multi") {
      const counts = new Map<string, number>();
      for (const v of vals) for (const x of Array.isArray(v) ? v : [String(v)]) counts.set(x, (counts.get(x) ?? 0) + 1);
      return {
        id: q.id,
        type: q.type,
        text: q.text,
        n: vals.length,
        options: (q.options ?? []).map((o) => ({ id: o.id, label: o.label, count: counts.get(o.id) ?? 0, share: vals.length ? (counts.get(o.id) ?? 0) / vals.length : 0 })),
      };
    }
    if (q.type === "scale" || q.type === "number") {
      const nums = vals.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
      const dist = new Map<number, number>();
      for (const x of nums) dist.set(x, (dist.get(x) ?? 0) + 1);
      const median = nums.length ? (nums.length % 2 ? nums[(nums.length - 1) / 2] : (nums[nums.length / 2 - 1] + nums[nums.length / 2]) / 2) : null;
      return {
        id: q.id,
        type: q.type,
        text: q.text,
        n: nums.length,
        mean: nums.length ? nums.reduce((s, x) => s + x, 0) / nums.length : null,
        median,
        distribution: [...dist.entries()].sort((a, b) => a[0] - b[0]).map(([value, count]) => ({ value, count })),
      };
    }
    return { id: q.id, type: "text", text: q.text, n: vals.length, answers: vals.map(String) };
  });
}

// A sound first draft without AI: questions about past behaviour, current solution and spend, and one key
// question about a concrete recent action (not "would you…").
export function templateSurvey(input: { assumption: string; audience: string; researcher: string; product: string }): SurveyConfig {
  return {
    title: `Onderzoek onder ${input.audience}`.slice(0, 120),
    intro: `Wij onderzoeken hoe ${input.audience} hiermee omgaan. Het invullen duurt ongeveer drie minuten. Er zijn geen goede of foute antwoorden; we vragen naar wat u de afgelopen tijd echt deed.`.slice(0, 800),
    researcher: input.researcher,
    questions: [
      {
        id: "laatst",
        type: "single",
        text: "Wanneer had u voor het laatst met deze situatie te maken?",
        required: true,
        options: [
          { id: "week", label: "In de afgelopen week" },
          { id: "maand", label: "In de afgelopen maand" },
          { id: "kwartaal", label: "In de afgelopen drie maanden" },
          { id: "langer", label: "Langer geleden" },
          { id: "nooit", label: "Nog nooit" },
        ],
      },
      {
        id: "aanpak",
        type: "text",
        text: "Hoe heeft u het die laatste keer aangepakt?",
        required: false,
        showIf: { question: "laatst", options: ["week", "maand", "kwartaal", "langer"] },
      },
      {
        id: "gezocht",
        type: "single",
        text: "Heeft u in het afgelopen jaar actief gezocht naar een betere oplossing (bijvoorbeeld offertes opgevraagd, tools geprobeerd of iemand ingehuurd)?",
        required: true,
        options: [
          { id: "ja_betaald", label: "Ja, en ik heb ervoor betaald" },
          { id: "ja_gezocht", label: "Ja, ik heb gezocht maar niets gekocht" },
          { id: "nee", label: "Nee" },
        ],
      },
      {
        id: "uitgaven",
        type: "number",
        text: "Hoeveel heeft u daar in het afgelopen jaar ongeveer aan uitgegeven (in euro)?",
        help: "Een schatting is goed. Vul 0 in als u niets uitgaf.",
        required: false,
        showIf: { question: "gezocht", options: ["ja_betaald"] },
      },
      {
        id: "last",
        type: "scale",
        text: "Hoeveel last had u er de laatste keer van?",
        required: true,
        scale: { min: 1, max: 5, minLabel: "Geen last", maxLabel: "Veel last" },
      },
      { id: "toelichting", type: "text", text: "Wat maakte het lastig, of juist niet?", required: false },
    ],
    key_question: "gezocht",
    success_options: ["ja_betaald", "ja_gezocht"],
    thank_you: "Dank u wel. Uw antwoorden helpen ons dit beter te begrijpen.",
    estimated_minutes: 3,
  };
}
