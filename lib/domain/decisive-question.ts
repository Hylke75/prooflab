// Fase B4: de beslissende vraag en welke aannames die direct raken (eerste tiebreak in de rangorde).
//
// De beslissende vraag is de onderzoeksvraag met is_decisive (fase B2). Bestaat die kolom nog niet, of is er geen
// vraag als beslissend aangewezen, dan geldt de eerste onderzoeksvraag (laagste position). Zonder onderzoeksvragen
// valt hij terug op de beslisvraag van het idee.
//
// Een aanname raakt de beslissende vraag direct als er een bevinding van die vraag aan gekoppeld is
// (assumption_claims → claims.question_id), of als de tekst van de aanname en de vraag minstens twee inhoudswoorden
// delen. Pure functies, zonder runtime-imports.

export type QuestionRow = { id: string; question: string; position: number | null; is_decisive?: boolean | null; created_at?: string | null };

export function pickDecisiveQuestion<T extends QuestionRow>(questions: T[]): T | null {
  if (questions.length === 0) return null;
  const marked = questions.find((q) => q.is_decisive === true);
  if (marked) return marked;
  return [...questions].sort((a, b) => (a.position ?? Number.MAX_SAFE_INTEGER) - (b.position ?? Number.MAX_SAFE_INTEGER) || String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")))[0];
}

// Woorden zonder betekenis voor de overlap (lidwoorden, voegwoorden, hulpwerkwoorden en woorden die in bijna elke
// aanname of vraag staan).
const STOP = new Set(
  (
    "de het een en of maar dat die dit deze wat wie welk welke hoe waar wanneer waarom als dan ook niet geen wel " +
    "voor van met door bij naar over uit tot aan op in om te is zijn was waren wordt worden kan kunnen wil willen " +
    "moet moeten zal zullen gaat gaan heeft hebben er hun hen zij wij we ons onze jullie je jouw u uw ze zich " +
    "genoeg veel meer minder minstens zo zoals nog al echt binnen eerste klanten klant doelgroep idee oplossing"
  ).split(" "),
);

// Een grove stam: kleine letters, zonder leestekens, de eerste zes letters (makelaars ~ makelaarskantoren).
function stems(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .split(/[^a-z0-9€]+/)
      .filter((w) => w.length >= 4 && !STOP.has(w))
      .map((w) => w.slice(0, 6)),
  );
}

export const MIN_SHARED_WORDS = 2;

export function sharedWords(a: string, b: string): number {
  const x = stems(a);
  let n = 0;
  for (const w of stems(b)) if (x.has(w)) n++;
  return n;
}

export function relatesToDecisive(
  statement: string,
  question: { id: string | null; text: string } | null,
  linkedQuestionIds: Iterable<string | null | undefined>,
): boolean {
  if (!question) return false;
  if (question.id) for (const q of linkedQuestionIds) if (q && q === question.id) return true;
  return sharedWords(statement, question.text) >= MIN_SHARED_WORDS;
}
