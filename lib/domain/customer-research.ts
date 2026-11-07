// Klantonderzoek vanuit stap 1 Markt: verkennende enquêtes en online interviews (schriftelijk). Pure functies,
// zonder database. Een verkennend onderzoek hangt aan een onderzoeksvraag, heeft geen go/no-go-drempels en beslist
// niets: niet over een aanname, niet over het besluit. De uitkomsten zijn zelfrapportage, geen waargenomen gedrag.
//
// Technisch is het een experiment van het type "survey" met een hypothese die als verkennend is gemarkeerd
// (hypotheses.exploratory, migratie 20261111090000_markt_klantonderzoek). Zo hergebruikt het de enquête-engine:
// de editor, de publieke pagina, de kwaliteitscontrole per antwoord, de uitnodigingen en de klantsignalen.

import { auditQuestion, type AuditIssue } from "./interview-audit";
import type { SurveyConfig, SurveyCountRow, SurveyQuestion } from "./survey";

export type StudyFormat = "survey" | "interview";

export const STUDY_FORMATS: Record<StudyFormat, { label: string; short: string; explain: string }> = {
  survey: {
    label: "Verkennende enquête",
    short: "Enquête",
    explain: "Gesloten en open vragen aan een grotere groep. Geeft richting: hoe vaak komt iets voor, hoe pakken mensen het nu aan.",
  },
  interview: {
    label: "Online interview (schriftelijk)",
    short: "Online interview",
    explain: "De geïnterviewde beantwoordt via een link open vragen over de laatste keer dat het probleem speelde. Geen live gesprek: je kunt niet doorvragen.",
  },
};

// Wat een verkennend onderzoek wel en niet is. Staat bij elk verkennend onderzoek in beeld.
export const EXPLORATORY_NOTE =
  "Verkennend: geeft richting bij een onderzoeksvraag, maar beslist niet over een aanname of het besluit. Antwoorden zijn zelfrapportage, geen waargenomen gedrag.";

// ---------------------------------------------------------------------------
// Verkennend of beslissend
// ---------------------------------------------------------------------------

type HypLike = { exploratory?: boolean | null; success_threshold_pct?: number | null; assumption_id?: string | null };

// Een hypothese is verkennend als hij zo is gemarkeerd, of (defensief) als er geen succesdrempel of aanname is:
// zonder drempel kan er geen oordeel zijn.
export function isExploratory(h: HypLike | null | undefined): boolean {
  if (!h) return false;
  return h.exploratory === true || h.success_threshold_pct == null || h.assumption_id == null;
}

// De hypothese als beslissende Test Card (met drempel en aanname), of null bij een verkennend onderzoek. Alle code
// die een oordeel, kans of Learning Card berekent, gebruikt dit: verkennend onderzoek valt daar dan buiten, zoals
// een experiment zonder hypothese. Voor hoofdtests en tests uit stap 3 verandert er niets.
export function decisive<T extends HypLike>(h: T | null | undefined): (T & { success_threshold_pct: number; assumption_id: string }) | null {
  if (!h || isExploratory(h)) return null;
  return h as T & { success_threshold_pct: number; assumption_id: string };
}

// ---------------------------------------------------------------------------
// Goedkeuren: de controlepunten
// ---------------------------------------------------------------------------

// De controlepunten bij goedkeuren. Voor tests uit stap 3 precies zoals voorheen. Een verkennend onderzoek vraagt
// geen pretest bij 3–5 mensen (er hangt geen beslissing aan), wel eerlijkheid en privacy; een online interview
// daarnaast een leidraad zonder sturende vragen.
export function approvalChecks(type: string, exploratory: boolean, format: StudyFormat = "survey"): string[] {
  if (exploratory && type === "survey") return format === "interview" ? ["check_honest", "check_privacy", "check_neutral"] : ["check_honest", "check_privacy"];
  if (type === "interview") return ["check_consent", "check_neutral"];
  if (type === "survey") return ["check_honest", "check_privacy", "check_pretest"];
  // Experimentencatalogus: een handmatig sjabloon heeft geen testpagina; wel eerlijkheid, privacy en budget.
  if (type === "manual") return ["check_honest", "check_privacy", "check_budget"];
  return ["check_reveal", "check_privacy", "check_budget"];
}

// ---------------------------------------------------------------------------
// Online interview (schriftelijk): sjabloon uit een interviewleidraad
// ---------------------------------------------------------------------------

export const CONSENT_QUESTION_ID = "toestemming";
export const CONSENT_YES = "ja";
export const CONSENT_NO = "nee";

// Toestemming staat bovenaan als eerste, verplichte vraag. Wie "nee" kiest, stopt daar: het antwoord telt niet mee
// (de screening van de enquête-engine) en er worden geen verdere antwoorden bewaard.
export function consentQuestion(researcher: string): SurveyQuestion {
  return {
    id: CONSENT_QUESTION_ID,
    type: "single",
    text: "Doet u mee aan dit schriftelijke interview?",
    help: `${researcher} gebruikt uw antwoorden alleen voor dit onderzoek. Vul geen namen, e-mailadressen of telefoonnummers in. U kunt op elk moment stoppen.`.slice(0, 300),
    required: true,
    options: [
      { id: CONSENT_YES, label: "Ja, ik heb de uitleg gelezen en doe vrijwillig mee" },
      { id: CONSENT_NO, label: "Nee, ik doe niet mee" },
    ],
  };
}

// Vragen over recent, concreet gedrag (de "mom test"): de laatste keer, wat er gebeurde, wat het kostte, wat er al
// geprobeerd is. Geen vragen over de toekomst, geen pitch. Elke vraag is open.
export function interviewGuide(): string[] {
  return [
    "Vertel eens over de laatste keer dat u hiermee te maken had. Wat gebeurde er precies?",
    "Hoe heeft u het die keer aangepakt, stap voor stap?",
    "Wat was daarbij het lastigste?",
    "Wat kostte het u: tijd, geld of iets anders? Een schatting is goed.",
    "Welke oplossingen heeft u eerder geprobeerd? Wat beviel daaraan wel en niet?",
    "Wie was er verder bij betrokken?",
    "Wie besliste uiteindelijk over de aanpak?",
    "Wat heeft u sindsdien veranderd aan hoe u het aanpakt?",
  ];
}

const clean = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);

export type StudyContext = { title: string; goal: string; audience: string; researcher: string };

// Het online interview: toestemming bovenaan, daarna alleen open vragen uit de leidraad.
export function onlineInterviewConfig(ctx: StudyContext, guide: string[] = interviewGuide()): SurveyConfig {
  const researcher = clean(ctx.researcher, 120) || "de onderzoeker";
  const audience = clean(ctx.audience, 200) || "mensen uit de doelgroep";
  const questions: SurveyQuestion[] = [
    consentQuestion(researcher),
    ...guide
      .map((t) => clean(t, 300))
      .filter((t) => t.length >= 5)
      .slice(0, 15)
      .map((text, i): SurveyQuestion => ({ id: `v${i + 1}`, type: "text", text, required: false })),
  ];
  return {
    title: (clean(ctx.title, 120) || "Online interview").padEnd(3, "."),
    intro: clean(
      `Dit is een schriftelijk interview van ${researcher}. We willen begrijpen hoe ${audience} hiermee omgaan. ${ctx.goal ? `Waarom we het vragen: ${clean(ctx.goal, 300)} ` : ""}U beantwoordt open vragen over wat u de afgelopen tijd echt deed; er zijn geen goede of foute antwoorden. Het duurt ongeveer tien minuten. Uw antwoorden worden niet gekoppeld aan uw naam.`,
      800,
    ),
    researcher,
    questions,
    key_question: "",
    success_options: [],
    screening: { question: CONSENT_QUESTION_ID, qualifying: [CONSENT_YES] },
    thank_you: "Dank u wel voor uw tijd en uw eerlijke antwoorden.",
    estimated_minutes: Math.min(20, Math.max(5, questions.length * 2)),
    purpose: "explore",
    format: "interview",
  };
}

// Een lege verkennende enquête om zelf te vullen: één open vraag over de laatste keer.
export function emptyExploratorySurvey(ctx: StudyContext): SurveyConfig {
  const researcher = clean(ctx.researcher, 120) || "de onderzoeker";
  const audience = clean(ctx.audience, 200) || "de doelgroep";
  return {
    title: (clean(ctx.title, 120) || `Onderzoek onder ${audience}`).slice(0, 120).padEnd(3, "."),
    intro: clean(`Wij onderzoeken hoe ${audience} hiermee omgaan. Er zijn geen goede of foute antwoorden; we vragen naar wat u de afgelopen tijd echt deed.`, 800),
    researcher,
    questions: [{ id: "q1", type: "text", text: "Vertel eens over de laatste keer dat u hiermee te maken had. Wat gebeurde er?", required: false }],
    key_question: "",
    success_options: [],
    thank_you: "Dank u wel voor het invullen.",
    estimated_minutes: 3,
    purpose: "explore",
    format: "survey",
  };
}

// Een opzet (AI of sjabloon) als verkennende enquête. De kernvraag mag blijven: dan zie je hoeveel mensen een
// concrete handeling noemen, zonder dat daar een drempel of oordeel aan hangt.
export function asExploratory(config: SurveyConfig): SurveyConfig {
  return { ...config, purpose: "explore", format: "survey" };
}

export function studyFormatOf(config: { format?: string | null } | null | undefined): StudyFormat {
  return config?.format === "interview" ? "interview" : "survey";
}

// ---------------------------------------------------------------------------
// Leidraadcontrole
// ---------------------------------------------------------------------------

// De open vragen van een onderzoek door dezelfde controle als een interviewleidraad (hypothetisch, sturend,
// verkopend, gesloten, dubbel). Waarschuwingen, geen blokkade; de consultant beslist.
export function auditStudy(config: Pick<SurveyConfig, "questions">, productNames: string[] = []): { id: string; text: string; issues: AuditIssue[] }[] {
  return config.questions
    .filter((q) => q.id !== CONSENT_QUESTION_ID && !q.attention)
    .map((q) => ({ id: q.id, text: q.text, issues: auditQuestion(q.text, { productNames }) }))
    .filter((a) => a.issues.length > 0);
}

// ---------------------------------------------------------------------------
// Respons tellen
// ---------------------------------------------------------------------------

// Bruikbare antwoorden: per persoon (de engine slaat per uitnodiging of bezoeker één antwoord op), uit de
// doelgroep (of met toestemming) en geloofwaardig (niet te snel, controlevraag goed, niet overal hetzelfde).
export function usableResponses(counts: Pick<SurveyCountRow, "responses" | "screened_out" | "too_fast" | "failed_attention" | "straightlining">[]): {
  responses: number;
  usable: number;
  excluded: number;
} {
  let responses = 0;
  let excluded = 0;
  for (const c of counts) {
    responses += c.responses;
    excluded += c.screened_out + c.too_fast + c.failed_attention + c.straightlining;
  }
  return { responses, usable: Math.max(0, responses - excluded), excluded };
}

// ---------------------------------------------------------------------------
// Het verkennende onderzoek als hypothese (zonder drempels)
// ---------------------------------------------------------------------------

export const DEFAULT_TARGET: Record<StudyFormat, number> = { survey: 30, interview: 8 };
export const DEFAULT_DAYS = 21;

export type StudyInput = {
  format: StudyFormat;
  goal: string;
  audience: string;
  targetN: number;
  maxDays: number;
  researchQuestionId: string;
};

// De velden van de hypothese voor een verkennend onderzoek. Geen succesdrempel, geen beslisregel, geen aanname:
// het streefaantal en de looptijd zijn alleen planning.
export function exploratoryHypothesis(input: StudyInput) {
  const interview = input.format === "interview";
  return {
    assumption_id: null,
    research_question_id: input.researchQuestionId,
    exploratory: true,
    we_believe: clean(input.goal, 600),
    target_group: clean(input.audience, 300),
    test_method: interview ? "Online interview (schriftelijk): open vragen via een link" : "Verkennende enquête via een link",
    metric_label: interview ? "Bruikbare interviews" : "Bruikbare antwoorden",
    metric_numerator: interview ? "geïnterviewden met toestemming en een geloofwaardig antwoord" : "respondenten uit de doelgroep met een geloofwaardig antwoord",
    metric_denominator: "alle ontvangen antwoorden",
    success_threshold_pct: null,
    fail_threshold_pct: null,
    decision_rule: null,
    success_count: null,
    min_sample: Math.min(5000, Math.max(1, Math.round(input.targetN))),
    max_duration_days: Math.min(180, Math.max(1, Math.round(input.maxDays))),
  };
}

export const STUDY_SCHEMA_MISSING =
  "Klantonderzoek vanuit Markt vraagt een database-update (migratie 20261111090000_markt_klantonderzoek). Tot die tijd maak je een enquête of interview als test in stap 3 Testen.";

// Of een databasefout betekent dat de migratie voor klantonderzoek nog niet is toegepast (onbekende kolom).
export function missingStudySchema(error: { message?: string | null; code?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const m = error.message ?? "";
  return error.code === "PGRST204" || error.code === "42703" || (/exploratory|research_question_id/.test(m) && /column|schema cache/i.test(m));
}
