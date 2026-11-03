// Kwaliteit van de beslisvraag bij de intake. Puur (geen I/O), zodat elke regel getest is.
//
// Een goede beslisvraag noemt een keuze ("investeren we …", "lanceren we …") met wat er op het spel staat
// en wanneer er besloten wordt. Vage vragen ("Is er voldoende markt?") geven een waarschuwing met een
// concreet herschrijfvoorbeeld. Het is nooit een blokkade: de consultant beslist.

export const STAKE_KINDS = ["amount", "time", "capacity"] as const;
export type StakeKind = (typeof STAKE_KINDS)[number];

export const STAKE_LABELS: Record<StakeKind, { label: string; unit: string; placeholder: string }> = {
  amount: { label: "Bedrag", unit: "euro", placeholder: "Bijv. 25000" },
  time: { label: "Tijd", unit: "uur", placeholder: "Bijv. 120" },
  capacity: { label: "Capaciteit", unit: "fte", placeholder: "Bijv. 1,5" },
};

export const isStakeKind = (v: unknown): v is StakeKind => typeof v === "string" && (STAKE_KINDS as readonly string[]).includes(v);

// "€ 25.000", "120 uur", "1,5 fte": de leesbare inzet, ook bewaard in ideas.decision_stakes.
export function formatStake(kind: StakeKind, value: number): string {
  const n = value.toLocaleString("nl-NL", { maximumFractionDigits: kind === "amount" ? 0 : 1 });
  if (kind === "amount") return `€ ${n}`;
  return `${n} ${STAKE_LABELS[kind].unit}`;
}

// Werkwoorden die een echte keuze aanduiden. Vervoegingen worden via de stam herkend.
const CHOICE_VERBS = [
  "investeer",
  "investeren",
  "lanceer",
  "lanceren",
  "start",
  "starten",
  "begin",
  "beginnen",
  "stop",
  "stoppen",
  "kies",
  "kiezen",
  "neem",
  "nemen", // aannemen, overnemen
  "aannemen",
  "bouw",
  "bouwen",
  "ontwikkel",
  "ontwikkelen",
  "verkoop",
  "verkopen",
  "breid",
  "uitbreiden",
  "openen",
  "sluiten",
  "huur",
  "huren",
  "koop",
  "kopen",
  "besteden",
  "besteed",
  "inzetten",
  "zetten",
  "doorgaan",
  "gaan",
  "introduceren",
  "introduceer",
  "uitrollen",
  "rol",
  "betreden",
  "afstoten",
  "schrappen",
  "vervangen",
  "verhogen",
  "verlagen",
  "pivoteren",
  "pivot",
] as const;

const VERB_RE = new RegExp(`\\b(${CHOICE_VERBS.join("|")})\\w*`, "i");

// Bekende vage formuleringen: ze vragen naar een toestand van de wereld, niet naar een keuze.
const VAGUE_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\b(is|zijn)\s+er\s+(genoeg|voldoende)\s+(markt|vraag|klanten|interesse|animo)\b/i, reason: "Deze vraag gaat over de markt in het algemeen, niet over een keuze die jij maakt." },
  { re: /\b(is|zijn)\s+er\s+(een\s+)?(markt|vraag|behoefte|interesse)\b/i, reason: "Deze vraag gaat over de markt in het algemeen, niet over een keuze die jij maakt." },
  { re: /\bkan\s+(dit|het|dat)\s+(werken|slagen|lukken)\b/i, reason: "'Kan dit werken?' heeft geen grens: bijna alles kan werken onder de juiste voorwaarden." },
  { re: /\b(is|wordt)\s+(dit|het)\s+(een\s+)?(goed\s+idee|succes|haalbaar|interessant)\b/i, reason: "'Goed' of 'interessant' is niet toetsbaar; noem de keuze en wat er op het spel staat." },
  { re: /\bheeft\s+(dit|het)\s+(potentie|potentieel|toekomst|kans)\b/i, reason: "'Potentie' is niet toetsbaar; noem de keuze en wat er op het spel staat." },
  { re: /\bwillen\s+(mensen|klanten)\s+(dit|het)\b/i, reason: "Deze vraag gaat over meningen van klanten, niet over een keuze die jij maakt." },
];

export type DecisionQuality = {
  ok: boolean;
  warnings: string[];
  example: string | null; // concreet herschrijfvoorbeeld bij een waarschuwing
};

export type DecisionContext = {
  title?: string | null;
  audience?: string | null;
  stake?: { kind: StakeKind; value: number } | null;
  deadline?: string | null; // YYYY-MM-DD
};

function deadlineText(deadline: string | null | undefined): string {
  if (!deadline || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return "vóór de beslisdatum";
  const [y, m, d] = deadline.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("nl-NL", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  return `vóór ${date}`;
}

// Een herschrijfvoorbeeld dat de keuze, de inzet, de doelgroep en de datum noemt (met wat al bekend is).
export function rewriteExample(ctx: DecisionContext = {}): string {
  const stake = ctx.stake && ctx.stake.value > 0 ? formatStake(ctx.stake.kind, ctx.stake.value) : "€ 25.000";
  const what = ctx.title?.trim() ? `in "${ctx.title.trim()}"` : "in een eerste versie";
  const who = ctx.audience?.trim() ? ` voor ${ctx.audience.trim().replace(/^\p{Lu}(?!\p{Lu})/u, (c) => c.toLowerCase())}` : "";
  return `Investeren we ${stake} ${what}${who}, en beslissen we dat ${deadlineText(ctx.deadline)}?`;
}

// Waarschuwingen voor een vage beslisvraag. Lege of heel korte vragen laat de schemacontrole afhandelen.
export function assessDecisionQuestion(question: string, ctx: DecisionContext = {}): DecisionQuality {
  const q = question.trim();
  if (q.length < 10) return { ok: true, warnings: [], example: null };
  const warnings: string[] = [];
  for (const p of VAGUE_PATTERNS) {
    if (p.re.test(q) && !warnings.includes(p.reason)) warnings.push(p.reason);
  }
  if (!VERB_RE.test(q)) warnings.push("Er staat geen keuze in de vraag. Noem wat je gaat doen: investeren, lanceren, starten, stoppen, kiezen, aannemen of bouwen.");
  return warnings.length ? { ok: false, warnings, example: rewriteExample(ctx) } : { ok: true, warnings: [], example: null };
}
