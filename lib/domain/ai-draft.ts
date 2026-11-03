// AI-concepten en wat de mens eraan veranderde (golf A, punt 17). Bij onderzoeksvragen, enquêtes en promoberichten
// die door AI zijn voorgesteld, bewaart ProofLab het AI-origineel. Zo blijft zichtbaar of een mens het concept heeft
// aangepast ("door mens aangepast: ja/nee") en hoeveel regels er veranderden. Pure functies, zonder database.

export type DraftEdit = { edited: boolean; changedLines: number; originalLines: number; currentLines: number };

const lines = (s: string) =>
  s
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 0);

// Lengte van de langste gemeenschappelijke deelreeks (regels in dezelfde volgorde).
function lcs(a: string[], b: string[]): number {
  const prev = new Array<number>(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i++) {
    let diag = 0;
    for (let j = 1; j <= b.length; j++) {
      const up = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : Math.max(prev[j], prev[j - 1]);
      diag = up;
    }
  }
  return prev[b.length];
}

// Gewijzigde regels: een aangepaste regel telt één keer; toegevoegde en verwijderde regels tellen elk mee
// (max(verwijderd, toegevoegd)). Witruimte en lege regels tellen niet.
export function draftEdit(original: string, current: string): DraftEdit {
  const a = lines(original);
  const b = lines(current);
  const common = lcs(a, b);
  const changedLines = Math.max(a.length - common, b.length - common);
  return { edited: changedLines > 0, changedLines, originalLines: a.length, currentLines: b.length };
}

// "Door mens aangepast: ja (3 regels gewijzigd)" of "Door mens aangepast: nee".
export function describeDraftEdit(e: DraftEdit): string {
  return e.edited ? `Door mens aangepast: ja (${e.changedLines} ${e.changedLines === 1 ? "regel" : "regels"} gewijzigd)` : "Door mens aangepast: nee";
}

// Tekst van een onderzoeksvraag zoals die wordt vergeleken: de vraag en het klaar-criterium.
export function questionDraftText(q: { question: string; done_criterion?: string | null }): string {
  return [q.question, q.done_criterion ?? ""].join("\n");
}

type SurveyLike = {
  title: string;
  intro: string;
  thank_you?: string;
  questions: { text: string; help?: string; options?: { label: string }[]; scale?: { minLabel: string; maxLabel: string } }[];
};

// Een enquête als regels: titel, inleiding, per vraag de vraag, toelichting en antwoordopties, en de bedankt-tekst.
export function surveyDraftText(c: SurveyLike): string {
  const out = [c.title, c.intro];
  for (const q of c.questions) {
    out.push(q.text);
    if (q.help) out.push(q.help);
    for (const o of q.options ?? []) out.push(`- ${o.label}`);
    if (q.scale) out.push(`${q.scale.minLabel} … ${q.scale.maxLabel}`);
  }
  if (c.thank_you) out.push(c.thank_you);
  return out.join("\n");
}
