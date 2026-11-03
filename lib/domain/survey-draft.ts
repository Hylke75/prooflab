// Post-processing of the AI coach's first survey draft. The model proposes; this code decides what is kept:
// questions that ask hypothetically, steer or pitch are replaced by the model's past-behaviour version or
// dropped, the list is capped, ids are generated, and the result must pass SurveyConfigSchema. If the key
// question does not survive, the template's key question about a concrete recent action takes its place.

import { looksFixed, SurveyConfigSchema, templateSurvey, type SurveyConfig, type SurveyQuestion } from "./survey";
import { auditQuestion } from "./interview-audit";

export const MAX_DRAFT_QUESTIONS = 12;

export type DraftQuestion = {
  text: string;
  type: "single" | "multi" | "scale" | "number" | "text";
  help: string | null;
  required: boolean;
  options: string[];
  scale: { min: number; max: number; min_label: string; max_label: string } | null;
  show_if: { question_index: number; option_labels: string[] } | null;
  past_behaviour_version: string | null;
  // Choice questions: true when the options have a natural order (never shuffled), false when they may be shuffled.
  ordered_options?: boolean;
};

export type RawDraft = {
  title: string;
  intro: string;
  thank_you: string;
  estimated_minutes: number;
  questions: DraftQuestion[];
  key_question_index: number;
  success_option_labels: string[];
  // A first question that separates the target group from everyone else, with the answers that qualify.
  screening?: { question_index: number; qualifying_option_labels: string[] } | null;
  why: string[];
};

export type DraftResult = {
  config: SurveyConfig;
  origin: "ai" | "template";
  why: string[]; // 2–3 lines: why these questions
  changes: string[]; // what ProofLab changed in the AI proposal
};

const BLOCKING = new Set(["hypothetical", "leading", "pitch"]);

export function blockingIssues(text: string, productNames: string[]): string[] {
  return auditQuestion(text, { productNames }).filter((i) => BLOCKING.has(i.kind)).map((i) => i.kind);
}

const clean = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");

type Ctx = { assumption: string; audience: string; researcher: string; product: string; productNames: string[] };

export function templateDraft(ctx: Ctx, reason: string): DraftResult {
  return {
    config: templateSurvey({ assumption: ctx.assumption, audience: ctx.audience || "de doelgroep", researcher: ctx.researcher, product: ctx.product, screen: true }),
    origin: "template",
    why: [
      reason,
      "Dit is een sjabloon: vragen over recent gedrag, de huidige aanpak en uitgaven, met één kernvraag over een concrete handeling. De eerste vraag screent: wie de situatie nooit meemaakte, telt niet mee. Pas de woorden aan op jouw doelgroep.",
    ],
    changes: [],
  };
}

// Turns the model output into a valid survey, or falls back to the template with an explanation.
export function sanitiseDraft(raw: RawDraft, ctx: Ctx): DraftResult {
  const changes: string[] = [];
  const kept: { q: SurveyQuestion; from: number }[] = [];
  const indexMap = new Map<number, string>(); // AI index → kept id
  const optionMap = new Map<string, Map<string, string>>(); // kept id → label (lower) → option id

  (raw.questions ?? []).forEach((d, from) => {
    let text = clean(d.text, 300);
    const issues = blockingIssues(text, ctx.productNames);
    if (issues.length) {
      const alt = clean(d.past_behaviour_version, 300);
      if (alt.length >= 5 && blockingIssues(alt, ctx.productNames).length === 0) {
        changes.push(`Vraag "${text}" herschreven naar gedrag in het verleden: "${alt}".`);
        text = alt;
      } else {
        changes.push(`Vraag "${text}" weggelaten (${issues.map((k) => ({ hypothetical: "hypothetisch", leading: "sturend", pitch: "verkoopt het idee" })[k as "pitch"]).join(", ")}).`);
        return;
      }
    }
    if (text.length < 5) return;
    const id = `q${kept.length + 1}`;
    const q: SurveyQuestion = { id, type: d.type, text, required: d.required !== false };
    const help = clean(d.help, 300);
    if (help) q.help = help;
    if (d.type === "single" || d.type === "multi") {
      const labels = [...new Set((d.options ?? []).map((o) => clean(o, 160)).filter(Boolean))].slice(0, 12);
      if (labels.length < 2) {
        changes.push(`Vraag "${text}" weggelaten: minder dan twee antwoordopties.`);
        return;
      }
      // Nominal options are shuffled per respondent; "Anders" / "Weet ik niet" keep their place at the end.
      const shuffle = d.ordered_options === false;
      q.options = labels.map((label, i) => (shuffle && looksFixed(label) ? { id: `o${i + 1}`, label, fixed: true } : { id: `o${i + 1}`, label }));
      if (shuffle) q.shuffle = true;
      optionMap.set(id, new Map(q.options.map((o) => [o.label.toLowerCase(), o.id])));
    }
    if (d.type === "scale") {
      const min = d.scale?.min === 0 ? 0 : 1;
      const max = Math.min(10, Math.max(3, Math.round(Number(d.scale?.max) || 5)));
      q.scale = { min, max, minLabel: clean(d.scale?.min_label, 60) || "Helemaal niet", maxLabel: clean(d.scale?.max_label, 60) || "Heel erg" };
    }
    if (d.show_if && indexMap.has(d.show_if.question_index) && d.show_if.question_index < from) {
      const dep = indexMap.get(d.show_if.question_index)!;
      const opts = (d.show_if.option_labels ?? []).map((l) => optionMap.get(dep)?.get(clean(l, 160).toLowerCase())).filter((x): x is string => !!x);
      if (opts.length) q.showIf = { question: dep, options: [...new Set(opts)] };
    }
    kept.push({ q, from });
    indexMap.set(from, id);
  });

  // Cap at twelve questions; the key question always stays.
  const keyId = indexMap.get(raw.key_question_index) ?? null;
  let questions = kept.map((k) => k.q);
  if (questions.length > MAX_DRAFT_QUESTIONS) {
    const keep = new Set(questions.slice(0, MAX_DRAFT_QUESTIONS).map((q) => q.id));
    if (keyId && !keep.has(keyId)) {
      keep.delete(questions[MAX_DRAFT_QUESTIONS - 1].id);
      keep.add(keyId);
    }
    changes.push(`Ingekort tot ${MAX_DRAFT_QUESTIONS} vragen: een korte enquête wordt vaker en zorgvuldiger ingevuld.`);
    questions = questions.filter((q) => keep.has(q.id));
    const ids = new Set(questions.map((q) => q.id));
    questions = questions.map((q) => (q.showIf && !ids.has(q.showIf.question) ? withoutCondition(q) : q));
  }

  let key = questions.find((q) => q.id === keyId && (q.type === "single" || q.type === "multi"));
  let success: string[] = [];
  if (key) {
    const map = optionMap.get(key.id)!;
    success = [...new Set((raw.success_option_labels ?? []).map((l) => map.get(clean(l, 160).toLowerCase())).filter((x): x is string => !!x))];
    if (success.length === 0 || success.length >= (key.options ?? []).length) key = undefined;
  }
  if (!key) {
    // The template's key question asks about a concrete recent action; it replaces a missing or unusable key.
    const t = templateSurvey({ assumption: ctx.assumption, audience: ctx.audience || "de doelgroep", researcher: ctx.researcher, product: ctx.product });
    const tKey = t.questions.find((q) => q.id === t.key_question)!;
    const id = `q${questions.length + 1}`;
    if (questions.length >= MAX_DRAFT_QUESTIONS) questions = questions.slice(0, MAX_DRAFT_QUESTIONS - 1);
    const ids = new Set(questions.map((q) => q.id));
    questions = questions.map((q) => (q.showIf && !ids.has(q.showIf.question) ? withoutCondition(q) : q));
    key = { ...tKey, id };
    questions = [...questions, key];
    success = t.success_options;
    changes.push("De voorgestelde kernvraag was niet bruikbaar; ProofLab gebruikt de kernvraag uit het sjabloon (actief gezocht naar een oplossing).");
  } else if (key.showIf) {
    questions = questions.map((q) => (q.id === key!.id ? withoutCondition(q) : q));
  }

  // Screening: the proposed question moves to the top; it must be a choice question other than the key question,
  // and some (not all) of its answers must qualify.
  let screening: SurveyConfig["screening"];
  if (raw.screening) {
    const sid = indexMap.get(raw.screening.question_index);
    const sq = questions.find((q) => q.id === sid);
    const map = sid ? optionMap.get(sid) : undefined;
    const qualifying = map ? [...new Set((raw.screening.qualifying_option_labels ?? []).map((l) => map.get(clean(l, 160).toLowerCase())).filter((x): x is string => !!x))] : [];
    if (!sq || !map || sq.id === key.id) {
      changes.push("De voorgestelde screeningsvraag was niet bruikbaar en is niet als screening ingesteld.");
    } else if (qualifying.length === 0 || qualifying.length >= (sq.options ?? []).length) {
      changes.push(`Vraag "${sq.text}" is niet als screening ingesteld: de doelgroepantwoorden waren niet duidelijk.`);
    } else {
      questions = [{ ...withoutCondition(sq), required: true }, ...questions.filter((q) => q.id !== sq.id)];
      screening = { question: sq.id, qualifying: (sq.options ?? []).map((o) => o.id).filter((id) => qualifying.includes(id)) };
    }
  }

  const config = {
    title: clean(raw.title, 120),
    intro: clean(raw.intro, 800),
    researcher: ctx.researcher,
    questions,
    key_question: key.id,
    success_options: success,
    ...(screening ? { screening } : {}),
    thank_you: clean(raw.thank_you, 400) || "Dank u wel voor het invullen.",
    estimated_minutes: Math.min(20, Math.max(1, Math.round(Number(raw.estimated_minutes) || Math.ceil(questions.length / 2)))),
  };
  const parsed = SurveyConfigSchema.safeParse(config);
  if (!parsed.success) return templateDraft(ctx, "Het AI-voorstel voldeed niet aan de regels voor een enquête; daarom staat hieronder het sjabloon.");
  const why = (raw.why ?? []).map((w) => clean(w, 300)).filter(Boolean).slice(0, 3);
  return {
    config: parsed.data,
    origin: "ai",
    why: why.length ? why : ["De vragen gaan over recent gedrag in plaats van meningen over de toekomst."],
    changes: changes.slice(0, 8),
  };
}

function withoutCondition(q: SurveyQuestion): SurveyQuestion {
  const rest = { ...q };
  delete rest.showIf;
  return rest;
}
