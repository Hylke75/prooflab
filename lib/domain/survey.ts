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

// fixed: the option keeps its place when the order is shuffled (typically "Anders" or "Weet ik niet" at the end).
export const OptionSchema = z.object({ id, label: z.string().trim().min(1).max(160), fixed: z.boolean().optional() });

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
    // Choice questions only: present the (non-fixed) options in a different order per respondent, against order
    // effects. Never for scales or options with a natural order ("week, maand, jaar").
    shuffle: z.boolean().optional(),
    // Attention check (instructed-response item, single choice): believable respondents choose this option.
    attention: z.object({ option: id }).optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.type === "single" || q.type === "multi") && (!q.options || q.options.length < 2)) {
      ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft minstens twee antwoordopties nodig.` });
    }
    if (q.type === "scale" && !q.scale) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft een schaal nodig.` });
    const ids = (q.options ?? []).map((o) => o.id);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" heeft dubbele opties.` });
    if (q.shuffle && q.type !== "single" && q.type !== "multi") {
      ctx.addIssue({ code: "custom", message: `Vraag "${q.text}": alleen bij keuzevragen kan de volgorde worden gehusseld.` });
    }
    if (q.attention) {
      if (q.type !== "single") ctx.addIssue({ code: "custom", message: `Controlevraag "${q.text}" moet een vraag met één keuze zijn.` });
      else if (!ids.includes(q.attention.option)) ctx.addIssue({ code: "custom", message: `Controlevraag "${q.text}": kies het juiste antwoord.` });
      if (!q.required) ctx.addIssue({ code: "custom", message: `Controlevraag "${q.text}" moet verplicht zijn.` });
      if (q.showIf) ctx.addIssue({ code: "custom", message: `Controlevraag "${q.text}" moet aan iedereen worden gesteld.` });
    }
  });

const baseShape = {
  title: z.string().trim().min(3).max(120),
  intro: z.string().trim().min(10).max(800),
  researcher: z.string().trim().min(2).max(120), // who asks: shown to respondents (honest about who is asking)
  questions: z.array(QuestionSchema).min(1).max(25),
  thank_you: z.string().trim().min(3).max(400),
  estimated_minutes: z.number().int().min(1).max(20),
};

function checkConditions(c: { questions: SurveyQuestionBase[] }, ctx: z.RefinementCtx) {
  const ids = c.questions.map((q) => q.id);
  if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: "Elke vraag heeft een eigen id nodig." });
  for (const q of c.questions) {
    if (!q.showIf) continue;
    const idx = ids.indexOf(q.id);
    const dep = c.questions.findIndex((x) => x.id === q.showIf!.question);
    if (dep < 0 || dep >= idx) ctx.addIssue({ code: "custom", message: `Vraag "${q.text}" kan alleen afhangen van een eerdere vraag.` });
  }
}
type SurveyQuestionBase = z.infer<typeof QuestionSchema>;

export const SurveyConfigSchema = z
  .object({
    ...baseShape,
    // Pre-registered metric: share of respondents to the key question who choose one of the success options.
    key_question: id,
    success_options: z.array(id).min(1),
    // Screening: the first question decides whether someone belongs to the target group. Who chooses none of the
    // qualifying options is thanked and stops there; the response is stored but not counted in the key metric.
    screening: z.object({ question: id, qualifying: z.array(id).min(1) }).optional(),
  })
  .superRefine((c, ctx) => {
    checkConditions(c, ctx);
    const key = c.questions.find((q) => q.id === c.key_question);
    if (!key) {
      ctx.addIssue({ code: "custom", message: "Kies de kernvraag waarop de test wordt beoordeeld." });
      return;
    }
    if (key.type !== "single" && key.type !== "multi") ctx.addIssue({ code: "custom", message: "De kernvraag moet een keuzevraag zijn." });
    if (key.showIf) ctx.addIssue({ code: "custom", message: "De kernvraag moet aan iedereen worden gesteld." });
    if (key.attention) ctx.addIssue({ code: "custom", message: "De kernvraag kan geen controlevraag zijn." });
    const opts = new Set((key.options ?? []).map((o) => o.id));
    if (c.success_options.some((o) => !opts.has(o))) ctx.addIssue({ code: "custom", message: "De succesopties moeten bij de kernvraag horen." });
    if (key.options && c.success_options.length >= key.options.length) {
      ctx.addIssue({ code: "custom", message: "Niet alle opties kunnen 'succes' zijn: dan meet de vraag niets." });
    }
    if (c.screening) {
      const s = c.screening;
      const sq = c.questions.find((q) => q.id === s.question);
      if (!sq || (sq.type !== "single" && sq.type !== "multi")) {
        ctx.addIssue({ code: "custom", message: "De screeningsvraag moet een keuzevraag zijn." });
        return;
      }
      if (c.questions[0].id !== sq.id) ctx.addIssue({ code: "custom", message: "De screeningsvraag moet de eerste vraag zijn." });
      if (sq.id === c.key_question) ctx.addIssue({ code: "custom", message: "De screeningsvraag kan niet ook de kernvraag zijn." });
      if (sq.attention) ctx.addIssue({ code: "custom", message: "De screeningsvraag kan geen controlevraag zijn." });
      const sOpts = new Set((sq.options ?? []).map((o) => o.id));
      if (s.qualifying.some((o) => !sOpts.has(o))) ctx.addIssue({ code: "custom", message: "De doelgroepantwoorden moeten bij de screeningsvraag horen." });
      if (s.qualifying.length >= sOpts.size) ctx.addIssue({ code: "custom", message: "Niet alle antwoorden van de screeningsvraag kunnen bij de doelgroep horen: dan screent de vraag niemand." });
    }
  });

// What the public page receives (get_public_survey): without the key question, the success options, the
// qualifying screening answers and the correct answer of attention checks.
export const PublicSurveyConfigSchema = z
  .object({ ...baseShape, screening: z.object({ question: id }).optional() })
  .superRefine((c, ctx) => checkConditions(c, ctx));
export type PublicSurveyConfig = z.infer<typeof PublicSurveyConfigSchema>;

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

// ---------------------------------------------------------------------------
// Screening
// ---------------------------------------------------------------------------

const chosenOf = (a: AnswerValue | undefined): string[] => (Array.isArray(a) ? a : typeof a === "string" ? [a] : []);

type ScreeningLike = { question: string; qualifying?: string[] } | undefined;

// Whether the respondent belongs to the target group. Without screening (or without the qualifying options, as on
// the public page) everyone qualifies; without a qualifying answer to the screening question nobody does.
export function isQualified(config: { screening?: ScreeningLike }, answers: Answers): boolean {
  const s = config.screening;
  if (!s?.qualifying) return true;
  const q = s.qualifying;
  return chosenOf(answers[s.question]).some((x) => q.includes(x));
}

// Validates and normalises the answers a respondent submitted against the published survey. Unknown
// questions, hidden questions and invalid values are dropped; required visible questions must be present.
// A respondent who does not pass the screening question is done after it: later answers are dropped.
export function validateAnswers(
  config: { questions: SurveyQuestion[]; screening?: ScreeningLike },
  raw: unknown,
): { ok: true; answers: Answers; screenedOut: boolean } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Geen antwoorden ontvangen." };
  const input = raw as Record<string, unknown>;
  const out: Answers = {};
  for (const q of config.questions) {
    if (!isVisible(q, out)) continue;
    const v = input[q.id];
    const empty = v == null || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (q.required || config.screening?.question === q.id) return { ok: false, error: `Beantwoord de vraag: "${q.text}"` };
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
    if (config.screening?.question === q.id && !isQualified(config, out)) return { ok: true, answers: out, screenedOut: true };
  }
  return { ok: true, answers: out, screenedOut: false };
}

// ---------------------------------------------------------------------------
// Option order per respondent
// ---------------------------------------------------------------------------

// "Anders", "Weet ik niet", "Geen van deze": options that belong at the end and stay there when shuffling.
const FIXED_LABEL = /^\s*(anders|overig|overige|iets anders|weet( ik)? (het )?niet|geen idee|geen van (deze|alle|allen|beide)|n\.?v\.?t\.?|niet van toepassing|zeg ik liever niet|wil ik niet zeggen)(\b|$)/i;
export const looksFixed = (label: string) => FIXED_LABEL.test(label);

// FNV-1a: a stable 32-bit hash of the seed, the start state of a small PRNG (mulberry32).
function seedOf(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// The order in which one respondent sees the options: deterministic for the same seed (a reload shows the same
// order), different between respondents. Fixed options keep their position; only the others change places.
export function presentOptions<T extends { id: string; fixed?: boolean }>(options: T[], shuffle: boolean | undefined, seed: string): T[] {
  if (!shuffle) return options;
  const free = options.filter((o) => !o.fixed);
  const rnd = prng(seedOf(seed));
  for (let i = free.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [free[i], free[j]] = [free[j], free[i]];
  }
  let k = 0;
  return options.map((o) => (o.fixed ? o : free[k++]));
}

// The questions with their options in this respondent's order (seed: invitation token or visitor code).
export function presentQuestions(questions: SurveyQuestion[], seed: string): SurveyQuestion[] {
  return questions.map((q) =>
    (q.type === "single" || q.type === "multi") && q.shuffle && q.options ? { ...q, options: presentOptions(q.options, true, `${seed}:${q.id}`) } : q,
  );
}

// ---------------------------------------------------------------------------
// Believability
// ---------------------------------------------------------------------------

export const QUALITY_VALUES = ["ok", "too_fast", "attention", "straightlining"] as const;
export type Quality = (typeof QUALITY_VALUES)[number];
export const QUALITY_LABELS: Record<Exclude<Quality, "ok">, string> = {
  too_fast: "te snel",
  attention: "controlevraag",
  straightlining: "zelfde antwoord overal",
};
// Straightlining: the same value on every scale question, from this many answered scale questions on.
export const STRAIGHTLINE_MIN_SCALES = 4;

export type ResponseRow = {
  answers: Answers;
  source: "invitation" | "open_link";
  channel: string;
  duration_ms: number | null;
  // The post code (utm_content) of the open link the response came through, if any.
  content?: string | null;
  // Stored by the submit route (assessResponse) in survey_responses; computed here when absent.
  qualified?: boolean;
  quality?: Quality;
};

// Very fast completions are not believable answers (likely a bot or click-through). Two seconds per question,
// at least eight seconds overall.
export function minimumDurationMs(config: { questions: unknown[] }): number {
  return Math.max(8000, config.questions.length * 2000);
}

// An attention check that was shown and not answered as instructed.
export function failsAttention(config: { questions: SurveyQuestion[] }, answers: Answers): boolean {
  return config.questions.some((q) => q.attention && isVisible(q, answers) && answers[q.id] !== q.attention.option);
}

// The same value on every answered scale question, with at least STRAIGHTLINE_MIN_SCALES of them.
export function straightlined(config: { questions: SurveyQuestion[] }, answers: Answers): boolean {
  const values = config.questions
    .filter((q) => q.type === "scale")
    .map((q) => answers[q.id])
    .filter((v): v is number => typeof v === "number");
  return values.length >= STRAIGHTLINE_MIN_SCALES && values.every((v) => v === values[0]);
}

// The one rule for a believable response. The submit route stores its outcome (survey_responses.qualified and
// .quality), so the database counts with exactly this rule; no SQL re-implements it. Order: screened out, then
// too fast, a failed attention check, the same answer on every scale question.
export function assessResponse(config: SurveyConfig, answers: Answers, durationMs: number | null): { qualified: boolean; quality: Quality } {
  if (!isQualified(config, answers)) return { qualified: false, quality: "ok" };
  if (durationMs != null && durationMs < minimumDurationMs(config)) return { qualified: true, quality: "too_fast" };
  if (failsAttention(config, answers)) return { qualified: true, quality: "attention" };
  if (straightlined(config, answers)) return { qualified: true, quality: "straightlining" };
  return { qualified: true, quality: "ok" };
}

export type ResponseStatus = Quality | "screened_out";

export function responseStatus(config: SurveyConfig, r: ResponseRow): ResponseStatus {
  const a = r.qualified != null && r.quality != null ? { qualified: r.qualified, quality: r.quality } : assessResponse(config, r.answers, r.duration_ms);
  return a.qualified ? a.quality : "screened_out";
}
export const isBelievable = (config: SurveyConfig, r: ResponseRow) => responseStatus(config, r) === "ok";

export const STATUS_LABEL: Record<ResponseStatus, string> = { ok: "ja", screened_out: "nee (buiten doelgroep)", too_fast: "nee (te snel)", attention: "nee (controlevraag)", straightlining: "nee (zelfde antwoord overal)" };

// null when the key question was not answered.
export function isKeySuccess(config: Pick<SurveyConfig, "key_question" | "success_options">, answers: Answers): boolean | null {
  const a = answers[config.key_question];
  if (a == null) return null;
  return (Array.isArray(a) ? a : [String(a)]).some((x) => config.success_options.includes(x));
}

// ---------------------------------------------------------------------------
// The key metric
// ---------------------------------------------------------------------------

// Counts per source, channel and post code: the shape the database function survey_key_counts() returns.
export type SurveyCountRow = {
  source: "invitation" | "open_link";
  channel: string;
  content: string | null; // post code (utm_content) of an open link; null without one
  responses: number; // all stored responses
  n: number; // believable responses from the target group that answered the key question
  successes: number;
  too_fast: number;
  screened_out: number;
  failed_attention: number;
  straightlining: number;
};

export function countResponses(config: SurveyConfig, rows: ResponseRow[]): SurveyCountRow[] {
  const map = new Map<string, SurveyCountRow>();
  for (const r of rows) {
    const k = `${r.source}|${r.channel}|${r.content ?? ""}`;
    const c = map.get(k) ?? { source: r.source, channel: r.channel, content: r.content ?? null, responses: 0, n: 0, successes: 0, too_fast: 0, screened_out: 0, failed_attention: 0, straightlining: 0 };
    c.responses++;
    const status = responseStatus(config, r);
    if (status === "screened_out") c.screened_out++;
    else if (status === "too_fast") c.too_fast++;
    else if (status === "attention") c.failed_attention++;
    else if (status === "straightlining") c.straightlining++;
    else {
      const success = isKeySuccess(config, r.answers);
      if (success != null) {
        c.n++;
        if (success) c.successes++;
      }
    }
    map.set(k, c);
  }
  return [...map.values()];
}

export type KeyMetric = {
  n: number;
  successes: number;
  interval: Interval;
  responses: number;
  tooFast: number;
  screenedOut: number;
  failedAttention: number;
  straightlining: number;
};

export function keyMetricFromCounts(counts: SurveyCountRow[], source?: "invitation" | "open_link"): KeyMetric {
  const m = { n: 0, successes: 0, responses: 0, tooFast: 0, screenedOut: 0, failedAttention: 0, straightlining: 0 };
  for (const c of counts) {
    if (source && c.source !== source) continue;
    m.n += c.n;
    m.successes += c.successes;
    m.responses += c.responses;
    m.tooFast += c.too_fast;
    m.screenedOut += c.screened_out;
    m.failedAttention += c.failed_attention;
    m.straightlining += c.straightlining;
  }
  return { ...m, interval: wilson(m.successes, m.n) };
}

// Responses from the target group that are not believable (too fast, attention check, same answer everywhere).
export const notBelievable = (k: Pick<KeyMetric, "tooFast" | "failedAttention" | "straightlining">) => k.tooFast + k.failedAttention + k.straightlining;

// "te snel 2 · controlevraag 1": the reasons, for the results page and warnings.
export function notBelievableText(k: Pick<KeyMetric, "tooFast" | "failedAttention" | "straightlining">): string {
  const parts: [number, string][] = [
    [k.tooFast, QUALITY_LABELS.too_fast],
    [k.failedAttention, QUALITY_LABELS.attention],
    [k.straightlining, QUALITY_LABELS.straightlining],
  ];
  return parts.filter(([n]) => n > 0).map(([n, l]) => `${l} ${n}`).join(" · ");
}

// The pre-registered metric over believable responses from the target group. Invitation and open-link responses
// can be counted separately; only invitation responses come from known people.
export function keyMetric(config: SurveyConfig, rows: ResponseRow[], source?: "invitation" | "open_link"): KeyMetric {
  return keyMetricFromCounts(countResponses(config, rows), source);
}

export type QuestionSummary =
  | { id: string; type: "single" | "multi"; text: string; n: number; options: { id: string; label: string; count: number; share: number }[] }
  | { id: string; type: "scale" | "number"; text: string; n: number; mean: number | null; median: number | null; distribution: { value: number; count: number }[] }
  | { id: string; type: "text"; text: string; n: number; answers: string[] };

// Per-question summary of believable responses (for the results page and the report).
// Attention checks are left out: they say nothing about the topic.
export function summarise(config: SurveyConfig, rows: ResponseRow[]): QuestionSummary[] {
  const ok = rows.filter((r) => isBelievable(config, r));
  return config.questions.filter((q) => !q.attention).map((q): QuestionSummary => {
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
// question about a concrete recent action (not "would you…"). With screen: who never met the situation is thanked
// after the first question and not counted (outside the target group).
export function templateSurvey(input: { assumption: string; audience: string; researcher: string; product: string; screen?: boolean }): SurveyConfig {
  const config: SurveyConfig = {
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
        shuffle: true,
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
  if (input.screen) config.screening = { question: "laatst", qualifying: ["week", "maand", "kwartaal", "langer"] };
  return config;
}
