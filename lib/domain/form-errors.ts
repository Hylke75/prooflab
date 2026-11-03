// Fase B1: foutmeldingen per veld voor formulieren met een server action (ActionForm). Per veld de eerste melding,
// in de volgorde van het formulier, plus één samenvatting voor bij de knop.

export type FieldErrors = Record<string, string>;
type Issue = { path: readonly PropertyKey[]; message: string };

// Zet validatiefouten (bijv. van zod) om naar één melding per veld. Een eigen tekst per veld (messages) gaat voor de
// algemene tekst van de validator.
export function fieldErrorsFrom(issues: readonly Issue[], messages: Partial<Record<string, string>> = {}): FieldErrors {
  const out: FieldErrors = {};
  for (const i of issues) {
    const key = String(i.path[0] ?? "");
    if (!key || out[key]) continue;
    out[key] = messages[key] ?? i.message;
  }
  return out;
}

// Samenvatting bij de knop: wat is niet opgeslagen en hoeveel punten moeten nog worden aangevuld.
export function savedNothing(what: string, errors: FieldErrors): string {
  const n = Object.keys(errors).length;
  if (n === 0) return `${what} is niet opgeslagen.`;
  return n === 1 ? `${what} is nog niet opgeslagen: 1 punt moet nog worden aangevuld.` : `${what} is nog niet opgeslagen: ${n} punten moeten nog worden aangevuld.`;
}
