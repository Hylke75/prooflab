// Honest test pages (research chapter 7.6): a test page may not promise what the product does not
// deliver. Deterministic red flags on top of the AI's own check; warnings only, the consultant decides.

const FLAGS: [RegExp, string][] = [
  [/\b(gegarandeerd|garantie|garanderen|garandeert)\b/i, "Belooft een garantie. Kun je die echt geven?"],
  [/\b100\s?%/i, "Noemt 100%. Absolute beloftes zijn zelden waar."],
  [/\b(nooit meer|altijd|voor altijd)\b/i, "Absolute belofte (altijd, nooit meer). Maak die concreet en waar."],
  [/(\bde beste\b|\bnummer 1\b|\bnr\.?\s?1\b|\bmarktleider\b|#1\b)/i, "Superlatief zonder bewijs (de beste, nummer 1)."],
  [/\b(duizenden|honderden|miljoenen)\s+(klanten|gebruikers|bedrijven)\b/i, "Noemt aantallen klanten die er nog niet zijn."],
  [/\b(bewezen|wetenschappelijk aangetoond|klinisch getest)\b/i, "Claimt bewijs dat er (nog) niet is."],
  [/\b(nu beschikbaar|direct leverbaar|vandaag nog)\b/i, "Suggereert dat het product al leverbaar is, terwijl de test daarna uitlegt dat het in ontwikkeling is."],
  [/\b\d+\s?x\s+(sneller|goedkoper|beter)\b/i, "Noemt een prestatie (x keer sneller) die nog niet gemeten is."],
];

export function honestyWarnings(...texts: (string | null | undefined)[]): string[] {
  const text = texts.filter(Boolean).join(" \n ");
  return FLAGS.filter(([re]) => re.test(text)).map(([, msg]) => msg);
}

export type CopyVariant = { headline: string; subline: string; offer: string; angle: string; ai_honesty_notes: string[] };
export type PreparedVariant = CopyVariant & { warnings: string[] };

// AI variants are trimmed to what the test page accepts and get the deterministic warnings too.
export function prepareVariants(variants: CopyVariant[]): PreparedVariant[] {
  return variants.slice(0, 3).map((v) => {
    const out = {
      headline: v.headline.trim().slice(0, 140),
      subline: v.subline.trim().slice(0, 300),
      offer: v.offer.trim().slice(0, 600),
      angle: v.angle.trim().slice(0, 200),
      ai_honesty_notes: v.ai_honesty_notes.map((n) => n.trim().slice(0, 300)).filter(Boolean).slice(0, 4),
    };
    return { ...out, warnings: honestyWarnings(out.headline, out.subline, out.offer) };
  });
}
