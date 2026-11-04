// Fase 1 · punt 3: pseudonimiseren vóór opslag en vóór AI. Regelgebaseerd en deterministisch: er gaat geen tekst naar
// een AI-dienst zolang de namen er nog in staan. ProofLab doet een voorstel {gevonden → label}; de consultant zet
// labels aan of uit, past ze aan en markeert zelf extra namen. De server stelt het voorstel opnieuw op uit het
// origineel en controleert het resultaat (recheckPseudonymized), zodat een weggelaten of gewijzigde keuze niet stil
// doorglipt. Bewaard worden alleen de gepseudonimiseerde tekst en de labels met aantallen, nooit de originele namen.
//
// Pseudonimiseren is geen anonimiseren: een functie, een clubnaam die niet herkend is of een verhaal kan iemand nog
// steeds herkenbaar maken. De consultant blijft verantwoordelijk (PSEUDONYMIZE_NOTICE).

import type { Segment } from "./transcript-parse";

export const PSEUDONYMIZE_NOTICE =
  "Pseudonimiseren is geen anonimiseren. ProofLab vervangt herkende namen, clubs, e-mailadressen, telefoonnummers, IBAN's en postcodes door labels, maar mist er soms één, en een functie of verhaal kan iemand nog steeds herkenbaar maken. Jij blijft verantwoordelijk: lees het voorbeeld na en markeer wat ProofLab mist.";

export const PII_KINDS = {
  speaker: { label: "Spreker", prefix: "Spreker", locked: false },
  person: { label: "Persoon", prefix: "Persoon", locked: false },
  club: { label: "Club of vereniging", prefix: "Club", locked: false },
  organisation: { label: "Organisatie", prefix: "Organisatie", locked: false },
  email: { label: "E-mailadres", prefix: "E-mail", locked: true },
  phone: { label: "Telefoonnummer", prefix: "Telefoon", locked: true },
  iban: { label: "IBAN", prefix: "IBAN", locked: true },
  postcode: { label: "Postcode", prefix: "Postcode", locked: false },
} as const;
export type PiiKind = keyof typeof PII_KINDS;
export const PII_KIND_KEYS = Object.keys(PII_KINDS) as PiiKind[];

// Eén regel van het voorstel. `group` bundelt varianten van één persoon (volledige naam, voornaam, achternaam) onder
// hetzelfde label; aan- of uitzetten en het label aanpassen gebeurt per groep.
export type PseudonymItem = { term: string; kind: PiiKind; label: string; group: string; count: number; enabled: boolean; locked: boolean };
// Wat de consultant terugstuurt: per term aan/uit en het label.
export type PseudonymDecision = { term: string; kind: PiiKind; label: string; enabled: boolean };

// ---------------------------------------------------------------------------
// Woordenlijsten
// ---------------------------------------------------------------------------

// Veelvoorkomende voornamen in Nederland. Bewust zonder namen die ook een gewoon woord aan het begin van een zin zijn
// ("Ben", "Wil", "Max", "Mag", "Roos" en "Hoop").
export const FIRST_NAMES = new Set(
  (
    "Aad Adrie Ahmed Ali Anna Anne Annemieke Anouk Arjan Arie Astrid Ayoub Bart Bas Bert Bianca Bo Bob Bram Carla Charlotte Chris Cor Daan Daniel Danielle " +
    "Daphne Dennis Dick Dirk Edwin Elif Ellen Els Emma Emre Erik Esther Eva Evelien Fatima Femke Fenna Finn Fleur Floor Frank Freek Frits Gerard Gerda Gerrit " +
    "Gert Gijs Hanna Hannah Hans Harm Hendrik Henk Henny Herman Hugo Ilse Inge Ingrid Iris Isa Jaap Jan Janneke Jasmijn Jasper Jayden Jeroen Jesse Johan " +
    "Joke Joost Joris Judith Julia Jurgen Karin Kees Kevin Klaas Koen Lars Laura Levi Liam Lieke Linda Lisa Lisanne Lotte Lucas Luuk Maarten Manon Marcel " +
    "Marco Marieke Marije Mariska Marjolein Mark Marloes Martijn Maud Mees Mehmet Merel Michiel Mike Milan Mila Mirjam Mohamed Mohammed Monique Nicole Niels " +
    "Nina Noa Noah Noor Patrick Paul Peter Petra Piet Pieter Pim Priya Remco Renate Richard Ria Rik Rob Robert Roel Romy Ronald Ruben Rutger Ruud Saar Sander " +
    "Sandra Sanne Sara Saskia Sem Simone Sjoerd Sophie Stefan Stijn Sven Teun Tess Thijs Thomas Tim Tom Truus Tygo Vincent Wendy Willem Wim Wouter Yara " +
    "Youssef Yvonne Zoë"
  ).split(/\s+/),
);

// Tussenvoegsels, langste eerst ("van der" vóór "van").
export const TUSSENVOEGSELS = ["van der", "van den", "van de", "van 't", "in 't", "op de", "uit de", "van", "de", "der", "den", "ter", "ten", "te", "'t", "von", "le", "la", "du"];

// Woorden die als functie of rol in een gesprek staan en geen naam zijn (sprekerlabels die niet vervangen hoeven).
const ROLE_SPEAKERS = /^(interviewer|interviewee|geïnterviewde|geinterviewde|respondent|deelnemer( [a-z0-9]+)?|onderzoeker|consultant|vraag|antwoord|q|a|i|r|(spreker|speaker|persoon) [a-z0-9]+|penningmeester|voorzitter|secretaris|trainer|coach|bestuurslid|ouder|lid)$/i;

// ---------------------------------------------------------------------------
// Patronen
// ---------------------------------------------------------------------------

const L = "\\p{L}\\p{M}";
const CAP = `\\p{Lu}[${L}'’-]*`;
const TV = TUSSENVOEGSELS.map((t) => t.replace(/'/g, "['’]").replace(/ /g, "\\s+")).join("|");

const PATTERNS: { kind: PiiKind; re: RegExp }[] = [
  { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  // IBAN (NL en andere landen), met of zonder spaties.
  { kind: "iban", re: /\b[A-Z]{2}\d{2}[ ]?[A-Z]{4}(?:[ ]?\d{2,4}){2,5}\b/g },
  // Telefoon: +31 6 12345678, 06-12345678, 020 123 4567, 0031 20 1234567.
  { kind: "phone", re: /(?:\+|00)\d{2}[\s-]?(?:\(0\))?[\s-]?\d(?:[\s-]?\d){7,10}\b|\b0\d(?:[\s-]?\d){8}\b/g },
  // Postcode: 1234 AB (niet SA, SD, SS).
  { kind: "postcode", re: /\b[1-9]\d{3}[ ]?(?!SA\b|SD\b|SS\b)[A-Z]{2}\b/g },
  // Clubs en verenigingen: FC/VV/SV… + naam, "voetbalvereniging X", "tennisclub De Kei".
  { kind: "club", re: new RegExp(`\\b(?:FC|VV|SV|RKSV|RKVV|SC|HC|HV|KV|ZV|CSV|AV|MHC|LTC|TC|VC|BC)\\s+${CAP}(?:\\s+${CAP}){0,3}`, "gu") },
  { kind: "club", re: new RegExp(`(?<![${L}])[${L}]*(?:vereniging|club)\\s+(?:(?:De|Het|'t)\\s+)?${CAP}(?:\\s+${CAP}){0,2}`, "gu") },
  // Organisaties: "Stichting X", "X B.V.", "X BV", "X N.V.".
  { kind: "organisation", re: new RegExp(`\\bStichting\\s+(?:(?:De|Het)\\s+)?${CAP}(?:\\s+${CAP}){0,3}`, "gu") },
  { kind: "organisation", re: new RegExp(`${CAP}(?:\\s+${CAP}){0,3}\\s+(?:B\\.V\\.|BV|N\\.V\\.|NV)(?![${L}])`, "gu") },
  // Aanspreekvorm + achternaam: "meneer Jansen", "mevrouw de Boer", "dhr. Visser".
  { kind: "person", re: new RegExp(`\\b(?:meneer|mevrouw|mevr\\.|dhr\\.|mw\\.|mr\\.|dr\\.)\\s+(?:(?:${TV})\\s+)?${CAP}`, "giu") },
  // Bekende voornaam, eventueel met tussenvoegsel en achternaam: "Jan", "Jan de Vries", "Kees van der Berg".
  { kind: "person", re: new RegExp(`(?<![${L}])(?:${[...FIRST_NAMES].sort((a, b) => b.length - a.length).join("|")})(?:\\s+(?:(?:${TV})\\s+)?\\p{Lu}[${L}'’-]+)?(?![${L}])`, "gu") },
];

const isFirstName = (w: string) => FIRST_NAMES.has(w);

// De voornaam vooraan een kandidaat ("Jan de Vries" → "Jan"); alleen bekende voornamen tellen.
function personFromCandidate(m: string): string | null {
  const parts = m.split(/\s+/);
  if (!isFirstName(parts[0])) return null;
  // "Jan Bij" of "Sanne Wat": een tweede woord met hoofdletter is alleen een achternaam als er een tussenvoegsel
  // staat of als het geen gewoon zinswoord is (heuristiek: langer dan 3 letters en niet op een zinsbegin-lijst).
  if (parts.length === 2 && /^(Bij|Wat|Hoe|Dat|Die|Dit|Het|Een|En|Of|Maar|Want|Toen|Dan|Nu|Ja|Nee|Ok|Oké|Ik|Je|We|Wij|Zij|Hij|Ze|Van|Voor|Met|Op|In|Uit|Naar|Over)$/.test(parts[1])) return parts[0];
  return m;
}

// Normaliseer een term voor vergelijken (spaties, hoofdletters bij e-mail).
const key = (kind: PiiKind, term: string) => `${kind === "email" ? term.toLowerCase() : term.replace(/\s+/g, " ")}`;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
}

// Een hele term: niet midden in een woord ("Jan" niet in "Janssen" of "januari").
export function termRegex(term: string, kind: PiiKind): RegExp {
  return new RegExp(`(?<![${L}\\p{N}@.])${escapeRe(term)}(?![${L}\\p{N}@])`, kind === "email" ? "giu" : "gu");
}

export function countTerm(text: string, term: string, kind: PiiKind): number {
  return (text.match(termRegex(term, kind)) ?? []).length;
}

// ---------------------------------------------------------------------------
// Detectie
// ---------------------------------------------------------------------------

export type Found = { term: string; kind: PiiKind };

// Alles wat de regels in een tekst vinden (zonder sprekers; die komen uit de segmenten).
export function detectPii(text: string): Found[] {
  const out = new Map<string, Found>();
  const taken: [number, number][] = [];
  const overlaps = (a: number, b: number) => taken.some(([x, y]) => a < y && b > x);
  for (const { kind, re } of PATTERNS) {
    re.lastIndex = 0;
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      let term = m[0].trim().replace(/[.,;:]+$/, (s) => (/B\.V\.|N\.V\.$/.test(m[0]) ? s : ""));
      if (kind === "person" && !/^(meneer|mevrouw|mevr|dhr|mw|mr|dr)\b/i.test(term)) {
        const p = personFromCandidate(term);
        if (!p) continue;
        term = p;
      }
      if (kind === "phone" && term.replace(/\D/g, "").length < 10) continue;
      const end = start + term.length;
      if (overlaps(start, end)) continue;
      taken.push([start, end]);
      const k = `${kind}|${key(kind, term)}`;
      if (!out.has(k)) out.set(k, { term, kind });
    }
  }
  return [...out.values()];
}

// Varianten van een sprekernaam die ook in de tekst kunnen staan: de volledige naam, de voornaam en de achternaam
// (met tussenvoegsel, "de Vries"); een achternaam alleen als hij minstens vier letters heeft.
export function nameVariants(full: string): string[] {
  const name = full.replace(/\s+/g, " ").trim();
  const parts = name.split(" ");
  const out = [name];
  if (parts.length >= 2) {
    out.push(parts[0]);
    const rest = parts.slice(1).join(" ");
    const tv = TUSSENVOEGSELS.find((t) => rest.toLowerCase().startsWith(`${t} `));
    if (tv) {
      out.push(rest);
      const surname = rest.slice(tv.length + 1);
      if (surname.length >= 4) out.push(surname.charAt(0).toUpperCase() + surname.slice(1));
    } else if (rest.length >= 4) out.push(rest);
  }
  return [...new Set(out)];
}

const letter = (i: number) => (i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + Math.floor(i / 26) - 1)}${String.fromCharCode(65 + (i % 26))}`);

// Het voorstel voor een transcript: sprekers (met varianten in de tekst) en wat de regels vinden, met per groep een
// label en het aantal keren dat het voorkomt. Extra namen (door de consultant gemarkeerd) worden personen.
export function proposePseudonyms(segments: Pick<Segment, "speaker" | "text">[], extraNames: string[] = []): PseudonymItem[] {
  const text = segments.map((s) => s.text).join("\n");
  const items: PseudonymItem[] = [];
  const seen = new Set<string>();
  const counters: Partial<Record<PiiKind, number>> = {};
  const nextLabel = (kind: PiiKind) => {
    const n = (counters[kind] = (counters[kind] ?? 0) + 1);
    return kind === "speaker" ? `Spreker ${letter(n - 1)}` : `${PII_KINDS[kind].prefix} ${n}`;
  };
  const add = (term: string, kind: PiiKind, label: string, group: string, count: number) => {
    const k = key(kind === "speaker" ? "person" : kind, term);
    if (seen.has(k) || term.length < 2) return;
    seen.add(k);
    items.push({ term, kind, label, group, count, enabled: true, locked: PII_KINDS[kind].locked });
  };

  // 1. Sprekers.
  const speakers = [...new Set(segments.map((s) => s.speaker).filter((x): x is string => !!x && !ROLE_SPEAKERS.test(x.trim())))];
  for (const sp of speakers) {
    const label = nextLabel("speaker");
    const group = `speaker:${sp}`;
    const asSpeaker = segments.filter((s) => s.speaker === sp).length;
    nameVariants(sp).forEach((v, i) => add(v, "speaker", label, group, (i === 0 ? asSpeaker : 0) + countTerm(text, v, "person")));
  }

  // 2. Extra namen van de consultant (met varianten).
  for (const raw of extraNames) {
    const name = raw.replace(/\s+/g, " ").trim().slice(0, 80);
    if (name.length < 2 || seen.has(key("person", name))) continue;
    const label = nextLabel("person");
    for (const v of nameVariants(name)) if (countTerm(text, v, "person") > 0 || v === name) add(v, "person", label, `extra:${name}`, countTerm(text, v, "person"));
  }

  // 3. Wat de regels vinden. Een voornaam die al bij een spreker hoort, krijgt het label van die spreker.
  for (const f of detectPii(text)) {
    if (seen.has(key(f.kind === "speaker" ? "person" : f.kind, f.term))) continue;
    if (f.kind === "person") {
      const first = f.term.split(/\s+/)[0];
      const owner = items.find((it) => (it.kind === "speaker" || it.kind === "person") && it.term === first);
      if (owner) {
        add(f.term, owner.kind, owner.label, owner.group, countTerm(text, f.term, "person"));
        continue;
      }
    }
    const label = nextLabel(f.kind);
    add(f.term, f.kind, label, `${f.kind}:${f.term}`, countTerm(text, f.term, f.kind));
    // Een volledige naam: de voornaam en achternaam los ook onder hetzelfde label.
    if (f.kind === "person" && /\s/.test(f.term) && !/^(meneer|mevrouw|mevr|dhr|mw|mr|dr)\b/i.test(f.term)) {
      for (const v of nameVariants(f.term).slice(1)) if (countTerm(text, v, "person") > 0) add(v, "person", label, `person:${f.term}`, countTerm(text, v, "person"));
    }
  }
  return items;
}

// ---------------------------------------------------------------------------
// Toepassen
// ---------------------------------------------------------------------------

export const LABEL_RE = /^[\p{L}\p{N} .,'’()-]{2,40}$/u;

// Langste termen eerst, zodat "Jan de Vries" vóór "Jan" wordt vervangen.
function ordered(decisions: PseudonymDecision[]): PseudonymDecision[] {
  return decisions.filter((d) => d.enabled && d.term.trim().length >= 2).sort((a, b) => b.term.length - a.term.length);
}

// Vervangen met telling per label (langste term eerst, dus elke plek telt één keer).
export function pseudonymizeCounting(text: string, decisions: PseudonymDecision[], counts?: Map<string, number>): string {
  let out = text;
  for (const d of ordered(decisions)) {
    out = out.replace(termRegex(d.term, d.kind === "speaker" ? "person" : d.kind), () => {
      counts?.set(d.label, (counts.get(d.label) ?? 0) + 1);
      return d.label;
    });
  }
  return out;
}

export function pseudonymizeText(text: string, decisions: PseudonymDecision[]): string {
  return pseudonymizeCounting(text, decisions);
}

// De segmenten met vervangen sprekers en tekst. Een spreker zonder (actieve) keuze blijft staan.
export function applyPseudonyms<T extends Pick<Segment, "speaker" | "text">>(segments: T[], decisions: PseudonymDecision[]): T[] {
  const speakerLabel = new Map(decisions.filter((d) => d.enabled && d.kind === "speaker").map((d) => [d.term, d.label]));
  return segments.map((s) => ({
    ...s,
    speaker: s.speaker ? (speakerLabel.get(s.speaker.replace(/\s+/g, " ").trim()) ?? pseudonymizeText(s.speaker, decisions)) : s.speaker,
    text: pseudonymizeText(s.text, decisions),
  }));
}

// ---------------------------------------------------------------------------
// Hercontrole op de server
// ---------------------------------------------------------------------------

export type DecisionInput = { term?: unknown; kind?: unknown; label?: unknown; enabled?: unknown };

// De definitieve keuzes: het voorstel dat de server zelf opstelt uit het origineel, met de keuzes van de consultant
// erover. Wat in het voorstel staat maar in de keuzes ontbreekt, blijft aan; vergrendelde soorten (e-mail, telefoon,
// IBAN) kunnen niet uit. Een label mag geen van de gevonden termen bevatten. Extra termen van de consultant (die het
// voorstel niet kent) worden toegevoegd als ze echt in de tekst staan.
export function resolveDecisions(
  segments: Pick<Segment, "speaker" | "text">[],
  input: DecisionInput[],
  extraNames: string[] = [],
): { decisions: PseudonymDecision[]; errors: string[] } {
  const proposal = proposePseudonyms(segments, extraNames);
  const text = segments.map((s) => s.text).join("\n");
  const errors: string[] = [];
  const byKey = new Map<string, DecisionInput>();
  for (const d of input.slice(0, 2000)) if (typeof d?.term === "string") byKey.set(d.term.replace(/\s+/g, " ").trim(), d);
  const terms = proposal.map((p) => p.term.toLowerCase());
  // Een label mag geen gevonden naam bevatten ("Jan de Vries" als label voor "Jan" maakt niets onherkenbaar).
  const labelOk = (label: string) => LABEL_RE.test(label) && !terms.some((t) => t.length >= 3 && countTerm(label.toLowerCase(), t, "email") > 0);
  const decisions: PseudonymDecision[] = proposal.map((p) => {
    const d = byKey.get(p.term);
    const label = typeof d?.label === "string" ? d.label.replace(/\s+/g, " ").trim() : p.label;
    const enabled = p.locked ? true : d ? d.enabled !== false : true;
    if (!labelOk(label)) {
      errors.push(`Het label voor "${PII_KINDS[p.kind].label.toLowerCase()}" is ongeldig of bevat een naam uit de tekst. Gebruik bijvoorbeeld "${p.label}".`);
      return { term: p.term, kind: p.kind, label: p.label, enabled };
    }
    return { term: p.term, kind: p.kind, label, enabled };
  });
  // Extra termen uit de keuzes die het voorstel niet heeft (bijv. een achternaam die de consultant zelf markeerde).
  const known = new Set(proposal.map((p) => p.term));
  for (const [term, d] of byKey) {
    if (known.has(term) || term.length < 2 || term.length > 80 || d.enabled === false) continue;
    const kind = typeof d.kind === "string" && (PII_KIND_KEYS as string[]).includes(d.kind) ? (d.kind as PiiKind) : "person";
    const label = typeof d.label === "string" ? d.label.replace(/\s+/g, " ").trim() : "";
    if (!labelOk(label)) {
      errors.push(`Geef "${term.slice(0, 40)}" een geldig label (2–40 tekens, zonder de naam zelf).`);
      continue;
    }
    if (countTerm(text, term, kind === "speaker" ? "person" : kind) === 0 && !segments.some((s) => s.speaker === term)) continue;
    decisions.push({ term, kind, label, enabled: true });
  }
  return { decisions, errors };
}

export type Recheck = { ok: boolean; problems: string[] };

// Na het toepassen: geen e-mailadres, telefoonnummer of IBAN meer; geen actieve term meer in de tekst of als spreker.
export function recheckPseudonymized(after: Pick<Segment, "speaker" | "text">[], decisions: PseudonymDecision[]): Recheck {
  const text = after.map((s) => `${s.speaker ?? ""}\n${s.text}`).join("\n");
  const problems: string[] = [];
  for (const f of detectPii(text)) {
    if (PII_KINDS[f.kind].locked) problems.push(`Er staat nog een ${PII_KINDS[f.kind].label.toLowerCase()} in de tekst.`);
  }
  const labels = new Set(decisions.map((d) => d.label));
  for (const d of decisions) {
    if (!d.enabled || labels.has(d.term)) continue;
    // Een term die (deels) in een label staat, telt niet ("Club 1" bevat geen originele term na validatie).
    if (countTerm(text, d.term, d.kind === "speaker" ? "person" : d.kind) > 0) problems.push(`"${PII_KINDS[d.kind].label}" is niet overal vervangen.`);
  }
  return { ok: problems.length === 0, problems: [...new Set(problems)] };
}

// ---------------------------------------------------------------------------
// Wat er bewaard wordt
// ---------------------------------------------------------------------------

export type LabelSummary = { labels: { label: string; kind: PiiKind; count: number }[]; declined: number };

// interviews.pseudonym_labels: alleen labels, soorten en aantallen (nooit de originele termen).
export function labelSummary(segments: Pick<Segment, "speaker" | "text">[], decisions: PseudonymDecision[]): LabelSummary {
  const counts = new Map<string, number>();
  const speakerLabel = new Map(decisions.filter((d) => d.enabled && d.kind === "speaker").map((d) => [d.term, d.label]));
  for (const s of segments) {
    const asSpeaker = s.speaker ? speakerLabel.get(s.speaker.replace(/\s+/g, " ").trim()) : undefined;
    if (asSpeaker) counts.set(asSpeaker, (counts.get(asSpeaker) ?? 0) + 1);
    pseudonymizeCounting(s.text, decisions, counts);
  }
  const kindOf = new Map(decisions.map((d) => [d.label, d.kind]));
  const labels = [...new Set(decisions.filter((d) => d.enabled).map((d) => d.label))].map((label) => ({ label, kind: kindOf.get(label)!, count: counts.get(label) ?? 0 }));
  return { labels, declined: decisions.filter((d) => !d.enabled).length };
}
