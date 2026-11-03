// Deterministic audit of interview guides and transcripts (research chapter 7.4). Good problem
// interviews ask about past behaviour; hypothetical, leading, pitching, closed and double questions
// produce answers that predict behaviour poorly. Warnings only: the consultant decides.

export type IssueKind = "hypothetical" | "leading" | "pitch" | "closed" | "double";

export type AuditIssue = { kind: IssueKind; message: string; suggestion: string };
export type QuestionAudit = { index: number; text: string; issues: AuditIssue[] };

export const ISSUE_LABEL: Record<IssueKind, string> = {
  hypothetical: "Hypothetisch",
  leading: "Sturend",
  pitch: "Verkoopt het idee",
  closed: "Gesloten ja/nee-vraag",
  double: "Dubbele vraag",
};

type Options = { productNames?: string[] };

const informal = (q: string) => /\b(je|jij|jou|jouw|jullie)\b/i.test(q) && !/\b(u|uw)\b/i.test(q);

function suggestion(kind: IssueKind, q: string): string {
  const inf = informal(q);
  const [heeft, deed, doet] = inf ? ["heb je", "deed je", "doe je"] : ["heeft u", "deed u", "doet u"];
  switch (kind) {
    case "hypothetical":
      return `Vraag naar gedrag in het verleden: "Wanneer ${heeft} voor het laatst …? Wat ${deed} toen precies?"`;
    case "leading":
      return `Stel de vraag neutraal: "Hoe ${doet} dat nu?" of "Wat ging er de laatste keer mis?"`;
    case "pitch":
      return `Laat het idee weg en vraag naar het probleem: "Vertel eens over de laatste keer dat ${inf ? "je" : "u"} hiermee te maken had."`;
    case "closed":
      return `Open de vraag: "Vertel eens over de laatste keer dat …" of "Hoe ${doet} dat nu?"`;
    case "double":
      return "Splits dit in twee losse vragen, elk met een eigen vraagteken.";
  }
}

// Polite requests ("Zou u kunnen vertellen …", "Wilt u beschrijven …") are not hypothetical.
const POLITE = /\b(zou|zouden|wil|wilt)\s+(u|je|jij|jullie)\s+(eens\s+|mij\s+|me\s+|ons\s+)?(kunnen\s+)?(vertellen|beschrijven|uitleggen|laten zien|toelichten|schetsen)\b/i;
const HYPOTHETICAL = [
  /\bzou(den)?\s+(u|je|jij|jullie)\b/i,
  /\bzou(den)?\s+(onze|ons|het|dit|dat|een|zo'n)\b.*\b(u|je|jij|jullie)\b/i,
  /\b(gaat|ga)\s+(u|je|jij)\b/i,
  /\b(wilt|wil)\s+(u|je|jij)\b/i,
  /\bals\s+(er|we|wij|ons product|onze oplossing)\b.*\b(zou|zouden|zal|zult|gaat)\b/i,
  /\b(in de toekomst|stel je voor|stel dat|stelt u zich voor)\b/i,
];
const LEADING = [
  /\b(vindt|vind)\s+(u|je|jij)\s+(ook\s+)?niet\s+dat\b/i,
  /\b(bent|ben)\s+(u|je|jij)\s+het\s+(ermee\s+|er\s+mee\s+)?(daar\s+)?(mee\s+)?eens\b/i,
  /\bis\s+het\s+niet\s+zo\b/i,
  /\b(toch|niet waar)\s*\?\s*$/i,
  /\b(hoe handig|hoe fijn|hoe vervelend)\b/i,
];
const PITCH = [/\bons\s+(product|idee|platform|systeem|concept)\b/i, /\bonze\s+(oplossing|app|dienst|tool|software)\b/i];
const CLOSED_START = /^\s*(heeft|hebt|heb|bent|ben|is|doet|doe|gebruikt|gebruik|kent|ken|zijn)\s+(u|je|jij|het|er|jullie)\b/i;
const QUESTION_WORD = "wat|hoe|waarom|wanneer|wie|welke|welk|waar|hoeveel|waarmee|waardoor";
const DOUBLE = new RegExp(`\\s(en|of)\\s+(${QUESTION_WORD}|(heeft|hebt|heb|bent|ben|is|doet|doe|zou|gaat|wilt|wil|kunt|kun|gebruikt)\\s+(u|je|jij|het|er))\\b`, "i");

export function auditQuestion(raw: string, opts: Options = {}): AuditIssue[] {
  const q = raw.trim();
  if (!q) return [];
  const issues: AuditIssue[] = [];
  const add = (kind: IssueKind, message: string) => issues.push({ kind, message, suggestion: suggestion(kind, q) });

  if (!POLITE.test(q) && HYPOTHETICAL.some((r) => r.test(q))) {
    add("hypothetical", /\b(gebruiken|betalen|kopen|aanschaffen|overstappen|proberen)\b/i.test(q)
      ? "Vraagt naar toekomstig gebruik of betalen. Mensen voorspellen hun eigen gedrag slecht."
      : "Hypothetische of toekomstgerichte vraag. Antwoorden zeggen weinig over echt gedrag.");
  }
  if (LEADING.some((r) => r.test(q))) add("leading", "Stuurt naar een antwoord. De respondent gaat eerder mee met de vraagsteller.");
  const names = (opts.productNames ?? []).map((n) => n.trim()).filter((n) => n.length >= 3);
  const lower = q.toLowerCase();
  if (PITCH.some((r) => r.test(q)) || names.some((n) => lower.includes(n.toLowerCase()))) {
    add("pitch", "Noemt het product of idee. Dan praat je over je oplossing in plaats van over hun probleem.");
  }
  if (CLOSED_START.test(q) && !issues.some((i) => i.kind === "leading")) add("closed", "Begint als ja/nee-vraag; je krijgt een kort antwoord zonder verhaal.");
  if ((q.match(/\?/g) ?? []).length <= 1 && DOUBLE.test(q)) add("double", "Twee vragen in één: het antwoord gaat vaak maar over één ervan.");
  return issues;
}

export function auditGuide(lines: string[], opts: Options = {}): QuestionAudit[] {
  return lines
    .map((text, index) => ({ index, text: text.trim() }))
    .filter((l) => l.text)
    .map((l) => ({ ...l, issues: auditQuestion(l.text, opts) }));
}

export function guideSummary(audit: QuestionAudit[]): { flagged: number; total: number } {
  return { flagged: audit.filter((a) => a.issues.length > 0).length, total: audit.length };
}

// ---------------------------------------------------------------------------
// Transcripts: which interviewer turns steered or pitched? Answers to those weigh less.
// ---------------------------------------------------------------------------

export type TurnAudit = { line: number; text: string; issues: AuditIssue[] };

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function interviewerPrefix(interviewerNames: string[] = []): RegExp {
  const names = interviewerNames.map((n) => n.trim()).filter((n) => n.length >= 2).map(escape);
  const alts = ["I", "Interviewer", "Q", "Vraag", ...names].join("|");
  // Optional timestamp in front, e.g. "[00:01:12] Interviewer:" or "00:01 I:".
  return new RegExp(`^\\s*(?:\\[?\\d{1,2}:\\d{2}(?::\\d{2})?\\]?\\s*)?(?:${alts})\\s*:\\s*`, "i");
}

export function auditTranscript(transcript: string, opts: Options & { interviewerNames?: string[] } = {}): TurnAudit[] {
  const prefix = interviewerPrefix(opts.interviewerNames);
  const out: TurnAudit[] = [];
  transcript.split(/\r?\n/).forEach((raw, i) => {
    if (!prefix.test(raw)) return;
    const text = raw.replace(prefix, "").trim();
    // Closed and double questions happen in conversation; only steering and pitching weigh answers down.
    const issues = auditQuestion(text, opts).filter((x) => x.kind === "hypothetical" || x.kind === "leading" || x.kind === "pitch");
    if (issues.length) out.push({ line: i + 1, text, issues });
  });
  return out;
}
