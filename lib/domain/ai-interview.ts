// AI-gemodereerde interviews (tekstchat): de vaste regels, zonder database, netwerk of model. Ontwerpregels:
// docs/ProofLab_Analyse_en_Verbeteringen_v1.1.md, "AI-gemodereerd tekstinterview: ontwerpregels", en
// docs/ProofLab_Voorspelkracht_v1.md 7.4 ("apart gelabeld en gescoord").
//
// Opzet van het gesprek:
//  - De leidraad is de goedgekeurde lijst interviewvragen van de Test Card. Die vragen stelt ProofLab letterlijk; het
//    model bedenkt alleen doorvragen (maximaal twee per onderwerp).
//  - Elke voorgestelde doorvraag gaat vóór verzenden door een tweede controle: de vaste regels hieronder
//    (checkProposedQuestion, dezelfde regels als de leidraadcontrole in interview-audit.ts) en, als die beschikbaar is,
//    een tweede modelaanroep. Bij afkeur volgt de volgende vraag uit de leidraad (een neutrale terugval).
//  - Harde grenzen: maximaal aantal antwoorden en maximale duur; instructies van de respondent ("negeer je opdracht")
//    worden geweigerd zonder modelaanroep; ProofLab vraagt nooit naar bijzondere persoonsgegevens.
//  - Opslag: elke beurt met tijdstempel en rol. Alleen letterlijke respondentbeurten kunnen citaat of bewijs worden;
//    vragen van de AI tellen nooit als bewijs.

import { z } from "zod";
import { auditQuestion, type AuditIssue, type QuestionAudit } from "./interview-audit";
import { proposePseudonyms, PII_KINDS, pseudonymizeText, type PiiKind, type PseudonymDecision } from "./pseudonymize";
import { renderTranscript, storeSegments, type StoredSegment } from "./transcript-parse";
import { DMU_ROLES, type DmuRole } from "./labels";

// ---------------------------------------------------------------------------
// Vaste teksten en grenzen
// ---------------------------------------------------------------------------

export const AI_INTERVIEW_LABEL = "AI-gemodereerd";
export const AI_INTERVIEW_SCHEMA_MISSING =
  "AI-gemodereerde interviews vragen een database-update (migratie 20261118090000_ai_interviews). Tot die tijd interview je zelf en importeer je het transcript.";
export const AI_NOT_CONNECTED =
  "AI niet verbonden: er is geen API-sleutel van Claude, ChatGPT of Gemini ingesteld. Interview zelf (bijvoorbeeld via Teams of Zoom) en importeer het transcript hieronder; dat werkt zonder AI.";
export const MANUAL_ALTERNATIVE = "Zelf interviewen en het transcript importeren werkt altijd, ook zonder AI.";
export const AI_EVIDENCE_NOTE =
  "AI-gemodereerde interviews krijgen een eigen label en worden apart geteld. Alleen letterlijke uitspraken van de respondent kunnen citaat of bewijs worden; de vragen van de AI tellen nooit mee.";
export const INTERVIEWER_SPEAKER = "AI-interviewer";
export const RESPONDENT_SPEAKER = "Respondent";
export const AGENCY_SPONSOR = "een onderzoeksbureau";
export const PURGED_TURN = "[verwijderd na afloop van de bewaartermijn]";

export const LIMITS = {
  guide: { min: 3, max: 12 },
  turns: { min: 4, max: 40, default: 16 },
  minutes: { min: 5, max: 45, default: 20 },
  probes: { min: 0, max: 2, default: 2 },
  retentionMonths: { min: 1, max: 12, default: 12 },
  intro: { min: 40, max: 1200 },
  sponsor: { max: 120 },
  answerChars: 1500,
  questionChars: 300,
  screenerQuestions: 3,
  screenerOptions: { min: 2, max: 8 },
  // Na drie pogingen om de opdracht te veranderen stopt het gesprek netjes.
  injectionStop: 3,
} as const;

// ---------------------------------------------------------------------------
// Screener: vooraf, op segment en rol. Buiten de doelgroep = bedanken, telt niet mee.
// ---------------------------------------------------------------------------

export type ScreenerKind = "role" | "segment" | "other";
export type ScreenerOption = { label: string; qualifies: boolean; role: DmuRole | null };
export type ScreenerQuestion = { id: string; kind: ScreenerKind; text: string; options: ScreenerOption[] };
// Wat de browser krijgt: zonder welke opties bij de doelgroep horen (anders kun je de screener "goed" invullen).
export type PublicScreenerQuestion = { id: string; text: string; options: string[] };

export const SCREENER_KINDS: Record<ScreenerKind, string> = {
  role: "Rol in het koopproces",
  segment: "Segment",
  other: "Anders",
};

const ROLE_WORDS: Record<string, DmuRole> = {
  gebruiker: "user",
  inkoper: "buyer",
  betaler: "payer",
  beslisser: "decider",
  budgethouder: "decider",
  "beïnvloeder": "influencer",
  beinvloeder: "influencer",
  anders: "other",
};

// Eén optie per regel. "+" vooraan: hoort bij de doelgroep. Bij een rolvraag de rol tussen haakjes:
// "+ Penningmeester (betaler)". Fouten in gewone taal, per regel.
export function parseScreenerOptions(text: string, kind: ScreenerKind): { options: ScreenerOption[]; errors: string[] } {
  const errors: string[] = [];
  const options: ScreenerOption[] = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const raw of lines) {
    const qualifies = raw.startsWith("+");
    let label = raw.replace(/^[+\-*•]\s*/, "").trim();
    let role: DmuRole | null = null;
    const m = /\(([^()]+)\)\s*$/.exec(label);
    if (kind === "role") {
      if (m) {
        const key = m[1].trim().toLowerCase();
        role = ROLE_WORDS[key] ?? null;
        if (!role) errors.push(`"${label}": onbekende rol "${m[1].trim()}". Kies uit ${Object.keys(ROLE_WORDS).filter((k) => k !== "beinvloeder" && k !== "budgethouder").join(", ")}.`);
        label = label.slice(0, m.index).trim();
      } else {
        role = "other";
      }
    }
    if (label.length < 1 || label.length > 120) {
      errors.push("Een antwoordoptie is 1 tot 120 tekens.");
      continue;
    }
    options.push({ label, qualifies, role });
  }
  if (options.length < LIMITS.screenerOptions.min || options.length > LIMITS.screenerOptions.max) {
    errors.push(`Geef ${LIMITS.screenerOptions.min} tot ${LIMITS.screenerOptions.max} antwoordopties, één per regel.`);
  } else if (!options.some((o) => o.qualifies)) {
    errors.push('Markeer met "+" welke opties bij de doelgroep horen.');
  } else if (options.every((o) => o.qualifies)) {
    errors.push("Als elke optie bij de doelgroep hoort, screent de vraag niets. Laat minstens één optie zonder \"+\".");
  }
  if (new Set(options.map((o) => o.label.toLowerCase())).size !== options.length) errors.push("Elke antwoordoptie komt één keer voor.");
  return { options, errors };
}

// Terug naar tekst voor het formulier.
export function screenerOptionsText(q: ScreenerQuestion): string {
  const roleWord = (r: DmuRole | null) => (r ? Object.entries(ROLE_WORDS).find(([, v]) => v === r)?.[0] : null);
  return q.options.map((o) => `${o.qualifies ? "+ " : ""}${o.label}${q.kind === "role" && o.role && o.role !== "other" ? ` (${roleWord(o.role)})` : ""}`).join("\n");
}

export function publicScreener(qs: ScreenerQuestion[]): PublicScreenerQuestion[] {
  return qs.map((q) => ({ id: q.id, text: q.text, options: q.options.map((o) => o.label) }));
}

export type ScreenerResult =
  | { ok: false; errors: Record<string, string> }
  | { ok: true; qualified: boolean; role: DmuRole; segment: string | null; answers: Record<string, number> };

// answers: per vraag-id de index van de gekozen optie. Iedereen beantwoordt alle vragen (geen vertakking).
export function evaluateScreener(qs: ScreenerQuestion[], answers: Record<string, unknown>): ScreenerResult {
  const errors: Record<string, string> = {};
  const picked: Record<string, number> = {};
  for (const q of qs) {
    const v = answers?.[q.id];
    const i = typeof v === "number" ? v : typeof v === "string" && /^\d+$/.test(v) ? Number(v) : NaN;
    if (!Number.isInteger(i) || i < 0 || i >= q.options.length) errors[q.id] = "Kies een antwoord.";
    else picked[q.id] = i;
  }
  if (Object.keys(errors).length) return { ok: false, errors };
  let role: DmuRole = "user";
  let segment: string | null = null;
  let qualified = true;
  for (const q of qs) {
    const o = q.options[picked[q.id]];
    if (!o.qualifies) qualified = false;
    if (q.kind === "role" && o.role) role = o.role;
    if (q.kind === "segment") segment = o.label.slice(0, 160);
  }
  return { ok: true, qualified, role, segment, answers: picked };
}

export const SCREENED_OUT_TEXT = {
  title: "Dank je wel voor je interesse.",
  text: "Voor dit onderzoek zoeken we mensen in een andere situatie of rol. Je hoeft niets meer te doen; er is geen gesprek opgeslagen.",
};

// ---------------------------------------------------------------------------
// Instellingen van de consultant
// ---------------------------------------------------------------------------

export type SponsorMode = "client" | "agency";

export type AiInterviewSettings = {
  guide: string[];
  maxTurns: number;
  maxMinutes: number;
  maxProbes: number;
  intro: string;
  sponsorMode: SponsorMode;
  sponsorName: string;
  privacyContact: string;
  retentionMonths: number;
  screener: ScreenerQuestion[];
};

const int = (min: number, max: number, label: string) =>
  z.coerce.number({ message: `Vul een getal in voor ${label}.` }).int(`Vul een heel getal in voor ${label}.`).min(min, `${label}: minimaal ${min}.`).max(max, `${label}: maximaal ${max}.`);

export const SettingsSchema = z
  .object({
    max_turns: int(LIMITS.turns.min, LIMITS.turns.max, "het aantal antwoorden"),
    max_minutes: int(LIMITS.minutes.min, LIMITS.minutes.max, "de duur"),
    max_probes: int(LIMITS.probes.min, LIMITS.probes.max, "het aantal doorvragen"),
    retention_months: int(LIMITS.retentionMonths.min, LIMITS.retentionMonths.max, "de bewaartermijn"),
    intro: z.string().trim().min(LIMITS.intro.min, `Schrijf een introductie van minstens ${LIMITS.intro.min} tekens.`).max(LIMITS.intro.max, `Hooguit ${LIMITS.intro.max} tekens.`),
    sponsor_mode: z.enum(["client", "agency"], { message: "Kies wie de respondent als opdrachtgever ziet." }),
    sponsor_name: z.string().trim().max(LIMITS.sponsor.max, `Hooguit ${LIMITS.sponsor.max} tekens.`),
    privacy_contact: z.string().trim().max(200, "Hooguit 200 tekens."),
  })
  .superRefine((v, ctx) => {
    if (v.sponsor_mode === "client" && v.sponsor_name.length < 2) {
      ctx.addIssue({ code: "custom", path: ["sponsor_name"], message: "Vul de naam van de opdrachtgever in, of kies \"een onderzoeksbureau\"." });
    }
  });

// Uit de database (jsonb of rij) naar de instellingen; onbekende waarden worden de standaard.
export const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
export const str = (v: unknown) => (typeof v === "string" ? v : "");

export function screenerOf(raw: unknown): ScreenerQuestion[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((q): ScreenerQuestion[] => {
    if (!q || typeof q !== "object") return [];
    const o = q as Record<string, unknown>;
    const options = Array.isArray(o.options)
      ? o.options.flatMap((x) => (x && typeof x === "object" && typeof (x as { label?: unknown }).label === "string"
          ? [{ label: (x as { label: string }).label, qualifies: (x as { qualifies?: unknown }).qualifies === true, role: (typeof (x as { role?: unknown }).role === "string" ? (x as { role: string }).role : null) as ScreenerQuestion["options"][number]["role"] }]
          : []))
      : [];
    const kind = o.kind === "role" || o.kind === "segment" ? o.kind : "other";
    return typeof o.id === "string" && typeof o.text === "string" && options.length ? [{ id: o.id, kind, text: o.text, options }] : [];
  });
}

export function settingsOf(c: Record<string, unknown>): AiInterviewSettings {
  return {
    guide: Array.isArray(c.guide) ? c.guide.filter((g): g is string => typeof g === "string") : [],
    maxTurns: num(c.max_turns, 16),
    maxMinutes: num(c.max_minutes, 20),
    maxProbes: num(c.max_probes, 2),
    intro: str(c.intro),
    sponsorMode: c.sponsor_mode === "client" ? "client" : "agency",
    sponsorName: str(c.sponsor_name),
    privacyContact: str(c.privacy_contact),
    retentionMonths: num(c.retention_months, 12),
    screener: screenerOf(c.screener),
  };
}

// Wie de respondent als opdrachtgever ziet. "een onderzoeksbureau" als de naam van de opdrachtgever de antwoorden zou
// kleuren (ontwerpregel 1).
export function sponsorLabel(s: Pick<AiInterviewSettings, "sponsorMode" | "sponsorName">): string {
  return s.sponsorMode === "client" && s.sponsorName.trim() ? s.sponsorName.trim() : AGENCY_SPONSOR;
}

// De melding vooraf (AI-verordening art. 50 en AVG): dat een AI het gesprek voert, wie het vraagt, waarvoor, hoe lang
// het duurt, hoe lang het wordt bewaard en dat stoppen altijd mag.
export function disclosureLines(s: AiInterviewSettings): string[] {
  const sponsor = sponsorLabel(s);
  return [
    "Dit gesprek wordt gevoerd door een AI (een computerprogramma), niet door een mens. De AI stelt vragen; een onderzoeker leest het gesprek later terug.",
    `Het onderzoek wordt gedaan in opdracht van ${sponsor}. Het doel is begrijpen hoe mensen nu met dit onderwerp omgaan; er wordt niets verkocht.`,
    `Het gesprek duurt hooguit ${s.maxMinutes} minuten. Je kunt op elk moment stoppen met de knop "Gesprek afsluiten", zonder reden.`,
    `Je antwoorden worden gepseudonimiseerd opgeslagen (namen, e-mailadressen en telefoonnummers worden vervangen) en na ${s.retentionMonths} ${s.retentionMonths === 1 ? "maand" : "maanden"} verwijderd. Er worden geen cookies geplaatst.`,
    "Deel geen gevoelige persoonlijke gegevens, zoals over je gezondheid, geloof of politieke voorkeur. Daar wordt ook niet naar gevraagd.",
  ];
}

export function consentTextFor(s: AiInterviewSettings): string {
  return `Ik weet dat een AI dit gesprek voert en geef ${sponsorLabel(s)} toestemming mijn antwoorden gepseudonimiseerd te gebruiken voor dit onderzoek en ze ${s.retentionMonths} ${s.retentionMonths === 1 ? "maand" : "maanden"} te bewaren. Ik kan altijd stoppen.`;
}

export function privacyContactLine(s: AiInterviewSettings): string {
  return `Vragen of je antwoorden laten verwijderen? Neem contact op via ${s.privacyContact.trim()} en noem je gesprekscode. Je kunt ook een klacht indienen bij de Autoriteit Persoonsgegevens.`;
}

// ---------------------------------------------------------------------------
// Leidraadcontrole: moet slagen voordat de consultant goedkeurt
// ---------------------------------------------------------------------------

// Bijzondere persoonsgegevens (AVG art. 9 en 10) en het BSN. Bewust smal, zodat een gewone vraag over werk of geld
// niet wordt geweigerd; een vals alarm bij een doorvraag kost alleen een doorvraag (dan volgt de leidraad).
const SENSITIVE = [
  /\bgezondheid\w*/i,
  /\bmedisch\w*/i,
  /\bdiagnose\w*/i,
  /\bmedicijn\w*/i,
  /\bziekte\w*/i,
  /\bhandicap\w*/i,
  /\bbeperking(en)?\b.*\b(lichamelijk|verstandelijk|psychisch)\w*/i,
  /\bpsychisch\w*/i,
  /\bzwanger\w*/i,
  /\breligie\w*/i,
  /\bgeloofsovertuiging\w*/i,
  /\bgelovig\w*/i,
  /\bpolitiek\w*/i,
  /\bvakbond\w*/i,
  /\bseksu\w*/i,
  /\bgeaardheid\b/i,
  /\betnisch\w*/i,
  /\bhuidskleur\b/i,
  /\bafkomst\b/i,
  /\bstrafblad\b/i,
  /\bveroordeeld\b/i,
  /\bstrafrecht\w*/i,
  /\bbsn\b/i,
  /\bburgerservicenummer\b/i,
  /\bbiometrisch\w*/i,
  /\bvingerafdruk\w*/i,
  /\bgenetisch\w*/i,
];

export function mentionsSensitive(text: string): boolean {
  return SENSITIVE.some((r) => r.test(text));
}

export type GuideCheck = { ok: boolean; problems: string[]; audit: QuestionAudit[] };

// Blokkerend: hypothetische, sturende en verkopende vragen en vragen naar bijzondere persoonsgegevens. Gesloten en
// dubbele vragen blijven een waarschuwing (zoals in de bestaande leidraadcontrole).
export const BLOCKING_KINDS: AuditIssue["kind"][] = ["hypothetical", "leading", "pitch"];

export function checkGuide(guide: string[], productNames: string[] = []): GuideCheck {
  const lines = guide.map((g) => g.trim()).filter(Boolean);
  const problems: string[] = [];
  if (lines.length < LIMITS.guide.min) problems.push(`De leidraad heeft minstens ${LIMITS.guide.min} vragen.`);
  if (lines.length > LIMITS.guide.max) problems.push(`Een AI-interview volgt hooguit ${LIMITS.guide.max} vragen uit de leidraad; maak de leidraad korter.`);
  const audit = lines.map((text, index) => ({ index, text, issues: auditQuestion(text, { productNames }) }));
  audit.forEach((a) => {
    const blocking = a.issues.filter((i) => BLOCKING_KINDS.includes(i.kind));
    if (blocking.length) problems.push(`Vraag ${a.index + 1} is ${blocking.map((b) => b.kind === "hypothetical" ? "hypothetisch" : b.kind === "leading" ? "sturend" : "verkopend").join(" en ")}: "${a.text}".`);
    if (mentionsSensitive(a.text)) problems.push(`Vraag ${a.index + 1} vraagt naar bijzondere persoonsgegevens (gezondheid, geloof, politiek en dergelijke): "${a.text}".`);
    if (a.text.length > LIMITS.questionChars) problems.push(`Vraag ${a.index + 1} is langer dan ${LIMITS.questionChars} tekens.`);
  });
  return { ok: problems.length === 0, problems, audit };
}

// ---------------------------------------------------------------------------
// Tweede controle op elke voorgestelde doorvraag (vóór verzenden)
// ---------------------------------------------------------------------------

export type QuestionCheck = { ok: true } | { ok: false; reasons: string[] };

const META = /\b(als (een )?(ai|taalmodel|chatbot)|taalmodel|systeemprompt|system prompt|prompt|instructie|opdracht van mij)\b/i;
const URL = /\bhttps?:\/\/|\bwww\.|\b[a-z0-9-]+\.(nl|com|io|ai|org)\b/i;
const CONTACT = /@|\b(e-?mail(adres)?|telefoonnummer|06[\s-]?\d|adres|achternaam|volledige naam|geboortedatum)\b/i;

// Vaste regels, dezelfde als de leidraadcontrole plus: één vraag, kort, geen meta-praat over de AI, geen links, niet
// naar contact- of identificerende gegevens, geen bijzondere persoonsgegevens.
export function checkProposedQuestion(text: string, opts: { productNames?: string[] } = {}): QuestionCheck {
  const q = text.trim();
  const reasons: string[] = [];
  if (q.length < 8) reasons.push("te kort");
  if (q.length > LIMITS.questionChars) reasons.push("te lang");
  if ((q.match(/\?/g) ?? []).length !== 1 || !q.endsWith("?")) reasons.push("niet precies één vraag");
  const issues = auditQuestion(q, { productNames: opts.productNames });
  for (const i of issues) {
    if (i.kind === "hypothetical") reasons.push("hypothetisch");
    if (i.kind === "leading") reasons.push("sturend");
    if (i.kind === "pitch") reasons.push("noemt het product of idee");
    if (i.kind === "double") reasons.push("dubbele vraag");
  }
  if (mentionsSensitive(q)) reasons.push("bijzondere persoonsgegevens");
  if (META.test(q)) reasons.push("praat over de AI of de opdracht");
  if (URL.test(q)) reasons.push("bevat een link");
  if (CONTACT.test(q)) reasons.push("vraagt naar contact- of identificerende gegevens");
  return reasons.length ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true };
}

// ---------------------------------------------------------------------------
// Prompt-injectie: de respondent probeert de opdracht te veranderen
// ---------------------------------------------------------------------------

const INJECTION = [
  /\b(negeer|vergeet|overschrijf|omzeil)\b.{0,40}\b(opdracht|instructie|instructies|regels|prompt|systeem|vorige|eerdere|alles)\b/i,
  /\bignore\b.{0,40}\b(instruction|instructions|prompt|rules|previous|above|all)\b/i,
  /\b(disregard|forget)\b.{0,40}\b(instruction|instructions|prompt|rules|previous)\b/i,
  /\b(je bent nu|jij bent nu|vanaf nu ben je|doe alsof je|speel (de rol|dat je)|gedraag je als)\b/i,
  /\b(you are now|act as|pretend (to be|you are)|roleplay as)\b/i,
  /\b(system ?prompt|systeemprompt|jailbreak|developer mode|ontwikkelaarsmodus|DAN)\b/,
  /\b(laat|geef|toon|print|herhaal)\b.{0,30}\b(je|jouw|de)\s+(instructies|prompt|opdracht|regels)\b/i,
  /\b(show|reveal|print|repeat)\b.{0,30}\b(your )?(instructions|prompt|rules)\b/i,
  /<\/?(system|assistant|instructions?)>/i,
];

export function detectInjection(text: string): boolean {
  return INJECTION.some((r) => r.test(text));
}

export const INJECTION_REPLY = "Ik kan mijn opdracht niet aanpassen: ik stel alleen de vragen van dit onderzoek. Ik herhaal de vraag.";
export const SENSITIVE_NOTICE = "Je hoeft geen gevoelige persoonlijke gegevens te delen, zoals over je gezondheid, geloof of politieke voorkeur.";

// ---------------------------------------------------------------------------
// Het verloop: welke vraag komt nu?
// ---------------------------------------------------------------------------

export type TurnKind = "intro" | "guide" | "probe" | "fallback" | "refusal" | "closing" | "answer";
export type TurnRole = "interviewer" | "respondent";
export type EndReason = "respondent" | "max_turns" | "max_duration" | "guide_done" | "refused" | "test_closed";

export const END_REASONS: Record<EndReason, string> = {
  respondent: "Door de respondent afgesloten",
  max_turns: "Maximum aantal antwoorden bereikt",
  max_duration: "Maximale duur bereikt",
  guide_done: "Alle vragen van de leidraad gesteld",
  refused: "Gestopt na herhaalde instructies van de respondent",
  test_closed: "De interviewronde is gestopt",
};

export type ConversationState = {
  topicIndex: number; // de vraag uit de leidraad die nu aan de orde is
  probesUsed: number; // doorvragen bij die vraag
  answers: number; // antwoorden van de respondent tot nu toe (incl. dit antwoord)
  injections: number;
  startedAt: number; // ms
};

export type Limits = Pick<AiInterviewSettings, "maxTurns" | "maxMinutes" | "maxProbes">;

export function limitReached(state: Pick<ConversationState, "answers" | "startedAt">, limits: Limits, now: number): EndReason | null {
  if (state.answers >= limits.maxTurns) return "max_turns";
  if (now - state.startedAt >= limits.maxMinutes * 60_000) return "max_duration";
  return null;
}

// Of het zin heeft het model om een doorvraag te vragen (geen kosten als het toch niet mag).
export function mayProbe(state: Pick<ConversationState, "probesUsed">, limits: Limits): boolean {
  return state.probesUsed < limits.maxProbes;
}

export type ProbeOutcome =
  | { kind: "none" } // geen doorvraag (het model vond het onderwerp af, het mocht niet, of AI niet beschikbaar)
  | { kind: "ok"; text: string }
  | { kind: "rejected"; text: string; reasons: string[] };

export type NextTurn = {
  kind: Exclude<TurnKind, "answer" | "intro">;
  text: string;
  topicIndex: number;
  probesUsed: number;
  end: EndReason | null;
};

export function closingText(reason: EndReason): string {
  if (reason === "refused") return "Ik stop het gesprek hier, omdat ik alleen de vragen van dit onderzoek kan stellen. Bedankt voor je tijd.";
  if (reason === "max_duration" || reason === "max_turns") return "We zijn aan het einde van de beschikbare tijd. Hartelijk dank voor je antwoorden; ze helpen dit onderzoek echt verder.";
  if (reason === "test_closed") return "Dit onderzoek is gestopt. Bedankt voor je antwoorden.";
  return "Dat waren al mijn vragen. Hartelijk dank voor je tijd en je eerlijke antwoorden.";
}

// De volgende beurt na een antwoord. Volgorde: weigering bij een instructie, harde grenzen, doorvraag (als die door de
// controle kwam), anders de volgende vraag uit de leidraad, en na de laatste vraag afsluiten. Een afgekeurde doorvraag
// valt terug op de volgende vraag uit de leidraad (kind "fallback").
export function nextTurn(input: {
  guide: string[];
  state: ConversationState;
  limits: Limits;
  now: number;
  injection: boolean;
  probe: ProbeOutcome;
}): NextTurn {
  const { guide, state, limits } = input;
  const current = Math.min(state.topicIndex, guide.length - 1);
  if (input.injection) {
    if (state.injections >= LIMITS.injectionStop) return { kind: "closing", text: closingText("refused"), topicIndex: current, probesUsed: state.probesUsed, end: "refused" };
    return { kind: "refusal", text: `${INJECTION_REPLY} ${guide[current]}`, topicIndex: current, probesUsed: state.probesUsed, end: null };
  }
  const limit = limitReached(state, limits, input.now);
  if (limit) return { kind: "closing", text: closingText(limit), topicIndex: current, probesUsed: state.probesUsed, end: limit };
  if (input.probe.kind === "ok" && mayProbe(state, limits)) {
    return { kind: "probe", text: input.probe.text.trim(), topicIndex: current, probesUsed: state.probesUsed + 1, end: null };
  }
  const next = current + 1;
  if (next >= guide.length) return { kind: "closing", text: closingText("guide_done"), topicIndex: current, probesUsed: state.probesUsed, end: "guide_done" };
  return { kind: input.probe.kind === "rejected" ? "fallback" : "guide", text: guide[next], topicIndex: next, probesUsed: 0, end: null };
}

export function openingTurns(s: AiInterviewSettings): { kind: "intro" | "guide"; text: string; topicIndex: number }[] {
  return [
    { kind: "intro", text: `${s.intro.trim()}\n\nIk ben een AI-interviewer. Er zijn geen goede of foute antwoorden; vertel gewoon hoe het bij jou gaat. Je kunt altijd stoppen.`, topicIndex: 0 },
    { kind: "guide", text: s.guide[0], topicIndex: 0 },
  ];
}

// ---------------------------------------------------------------------------
// Antwoord van de respondent: opschonen en pseudonimiseren vóór opslag en vóór het model
// ---------------------------------------------------------------------------

export function cleanAnswer(raw: unknown): { ok: true; text: string } | { ok: false; error: string } {
  if (typeof raw !== "string") return { ok: false, error: "Typ een antwoord." };
  // Stuurtekens weg, witruimte normaal; regeleinden blijven.
  const text = raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!text) return { ok: false, error: "Typ een antwoord." };
  if (text.length > LIMITS.answerChars) return { ok: false, error: `Je antwoord is langer dan ${LIMITS.answerChars} tekens. Maak het korter of verdeel het over twee berichten.` };
  return { ok: true, text };
}

// Per gesprek dezelfde labels voor dezelfde naam: de koppeling naam → label staat alleen als sleutel (HMAC van de
// naam, door de aanroeper berekend) in het gesprek, nooit de naam zelf.
export type PseudonymMap = Record<string, string>;

export function pseudonymizeAnswer(text: string, map: PseudonymMap, keyOf: (kind: PiiKind, term: string) => string): { text: string; map: PseudonymMap; replaced: number } {
  const items = proposePseudonyms([{ speaker: null, text }]).filter((i) => i.kind !== "speaker");
  if (!items.length) return { text, map, replaced: 0 };
  const next = { ...map };
  const used = (kind: PiiKind) => new Set(Object.values(next).filter((l) => l.startsWith(`${PII_KINDS[kind].prefix} `))).size;
  const groupLabel = new Map<string, string>();
  for (const it of items) {
    const key = keyOf(it.kind, it.term.toLowerCase());
    const known = next[key] ?? groupLabel.get(it.group);
    const label = known ?? `${PII_KINDS[it.kind].prefix} ${used(it.kind) + 1}`;
    next[key] = label;
    groupLabel.set(it.group, label);
  }
  const decisions: PseudonymDecision[] = items.map((it) => ({ term: it.term, kind: it.kind, label: next[keyOf(it.kind, it.term.toLowerCase())], enabled: true }));
  const out = pseudonymizeText(text, decisions);
  return { text: out, map: next, replaced: items.length };
}

// count = het aantal verschillende schrijfwijzen onder dat label (de teksten zelf worden niet bewaard).
export function labelsFromMap(map: PseudonymMap): { labels: { label: string; kind: PiiKind; count: number }[]; declined: number } {
  const counts = new Map<string, { kind: PiiKind; count: number }>();
  for (const label of Object.values(map)) {
    const kind = (Object.entries(PII_KINDS).find(([, v]) => label.startsWith(`${v.prefix} `))?.[0] ?? "person") as PiiKind;
    const cur = counts.get(label) ?? { kind, count: 0 };
    counts.set(label, { kind, count: cur.count + 1 });
  }
  return { labels: [...counts.entries()].map(([label, v]) => ({ label, kind: v.kind, count: v.count })), declined: 0 };
}

// ---------------------------------------------------------------------------
// Transcript: elke beurt met tijdstempel en rol, in het formaat van geïmporteerde transcripten
// ---------------------------------------------------------------------------

export type StoredTurn = { seq: number; role: TurnRole; kind: TurnKind; text: string; created_at: string };

export function buildTranscript(turns: StoredTurn[], startedAt: string): { transcript: string; segments: StoredSegment[] } {
  const t0 = Date.parse(startedAt);
  const sorted = [...turns].sort((a, b) => a.seq - b.seq);
  const { text, placed } = renderTranscript(
    sorted.map((t) => {
      const at = Math.max(0, Date.parse(t.created_at) - t0);
      return { speaker: t.role === "interviewer" ? INTERVIEWER_SPEAKER : RESPONDENT_SPEAKER, startMs: at, endMs: at, text: t.text.replace(/\s*\n\s*/g, " ").trim() };
    }),
  );
  return { transcript: text, segments: storeSegments(placed) };
}

// Alleen een letterlijke uitspraak van de respondent kan citaat of bewijs worden: het citaat moet helemaal binnen één
// respondentbeurt vallen. Vragen van de AI-interviewer tellen nooit.
export function respondentQuote(segments: StoredSegment[], start: number, end: number): { ok: true; segmentIndex: number } | { ok: false; reason: string } {
  const i = segments.findIndex((s) => start >= s.a && end <= s.b);
  if (i < 0) return { ok: false, reason: "Markeer binnen één uitspraak, zonder de tijd en de spreker." };
  if (segments[i].s !== RESPONDENT_SPEAKER) return { ok: false, reason: "In een AI-gemodereerd interview kan alleen een uitspraak van de respondent een citaat zijn; vragen van de AI tellen nooit als bewijs." };
  return { ok: true, segmentIndex: i };
}

// ---------------------------------------------------------------------------
// Overzicht voor de consultant
// ---------------------------------------------------------------------------

export type SessionStatus = "screening" | "screened_out" | "active" | "completed" | "abandoned";
export type SessionDisplay = { key: "active" | "completed" | "screened_out" | "abandoned" | "excluded"; label: string; pill: string; counts: boolean };

// Een gesprek zonder activiteit na de maximale duur plus een marge is afgebroken (de opschoning zet dat ook vast).
export const ABANDON_AFTER_MINUTES = 60;

export function sessionDisplay(s: { status: string; excluded_at: string | null; interview_id: string | null; last_activity_at: string }, now: number): SessionDisplay {
  if (s.excluded_at) return { key: "excluded", label: "Uitgesloten", pill: "coral", counts: false };
  if (s.status === "screened_out") return { key: "screened_out", label: "Gescreend uit (buiten de doelgroep)", pill: "gray", counts: false };
  if (s.status === "abandoned" || (s.status === "active" && now - Date.parse(s.last_activity_at) > ABANDON_AFTER_MINUTES * 60_000)) {
    return { key: "abandoned", label: "Afgebroken", pill: "orange", counts: false };
  }
  if (s.status === "completed") return s.interview_id ? { key: "completed", label: "Afgerond", pill: "green", counts: true } : { key: "abandoned", label: "Afgerond zonder antwoorden", pill: "orange", counts: false };
  return { key: "active", label: "Bezig", pill: "blue", counts: false };
}

// Korte gesprekscode voor de respondent (om verwijdering te vragen) en de consultant (om het gesprek te vinden).
export function conversationCode(sessionId: string): string {
  const hex = sessionId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}

export function participantLabel(sessionId: string): string {
  return `AI-interview ${conversationCode(sessionId)}`;
}

export const EXCLUDE_REASON = { min: 10, max: 400 } as const;

export function exclusionReasonError(reason: string): string | null {
  const r = reason.trim();
  if (r.length < EXCLUDE_REASON.min) return `Geef een reden van minstens ${EXCLUDE_REASON.min} tekens (bijvoorbeeld: "antwoorden lijken gegenereerd" of "buiten de doelgroep").`;
  if (r.length > EXCLUDE_REASON.max) return `Hooguit ${EXCLUDE_REASON.max} tekens.`;
  return null;
}

// ---------------------------------------------------------------------------
// Apart tellen: hoeveel bewijs komt uit AI-gemodereerde interviews?
// ---------------------------------------------------------------------------

export type ModerationSplit = { ai: { n: number; successes: number }; human: { n: number; successes: number } };

export function splitByModeration<T extends { id: string }>(interviews: T[], aiIds: ReadonlySet<string>, success: (i: T) => boolean): ModerationSplit {
  const out: ModerationSplit = { ai: { n: 0, successes: 0 }, human: { n: 0, successes: 0 } };
  for (const i of interviews) {
    const side = aiIds.has(i.id) ? out.ai : out.human;
    side.n++;
    if (success(i)) side.successes++;
  }
  return out;
}

export function moderationWarning(split: ModerationSplit): string | null {
  if (!split.ai.n) return null;
  const total = split.ai.n + split.human.n;
  return `${split.ai.n} van ${total} gesprekken ${split.ai.n === 1 ? "is" : "zijn"} AI-gemodereerd (${split.ai.successes} met succes); die staan apart gelabeld en geteld.`;
}

export type AiEvidenceSummary = { interviews: number; observations: number; supporting: number; contradicting: number };

// Waarnemingen die in het rapport meetellen (geen synthetische, geen niet-geaccepteerde AI-codering) uit
// AI-gemodereerde interviews, apart van de rest.
export function aiEvidenceSummary(
  observations: { interview_id: string | null; is_synthetic: boolean; origin: string; review_status?: string | null; kind: string }[],
  aiIds: ReadonlySet<string>,
  against: (kind: string) => boolean,
): AiEvidenceSummary {
  const counted = observations.filter((o) => o.interview_id && aiIds.has(o.interview_id) && !o.is_synthetic && (o.origin !== "ai" || o.review_status === "accepted"));
  return {
    interviews: new Set(counted.map((o) => o.interview_id)).size,
    observations: counted.length,
    supporting: counted.filter((o) => !against(o.kind)).length,
    contradicting: counted.filter((o) => against(o.kind)).length,
  };
}

export function roleLabel(role: string | null | undefined): string {
  return (role && DMU_ROLES[role as DmuRole]) || DMU_ROLES.user;
}
