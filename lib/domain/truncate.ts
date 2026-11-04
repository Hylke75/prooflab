// Kort een titel in op een woordgrens met "…" erachter (fase B1), zodat een titel nooit midden in een woord stopt.
// De volledige tekst hoort dan in een tooltip (title-attribuut). Witruimte wordt eerst samengevoegd. Is het eerste woord
// alleen al te lang, dan wordt dat woord afgekapt: anders bleef er niets over.
// Gebruikerstest C4: de voorgestelde naam van een experiment ("Klantinterviews: <aanname>") stopt op een woordgrens met
// "…" in plaats van midden in een woord of getal ("… (200"). Maximaal 90 tekens, zoals de titel op de testpagina.
export const EXPERIMENT_TITLE_MAX = 90;
export function experimentTitle(typeLabel: string, statement: string, max = EXPERIMENT_TITLE_MAX): string {
  return truncateWords(`${typeLabel}: ${statement}`, max);
}

export function truncateWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (max < 2 || clean.length <= max) return clean;
  const room = clean.slice(0, max - 1); // ruimte voor "…"
  const space = room.lastIndexOf(" ");
  // Valt de grens precies op een spatie, dan past het laatste woord nog helemaal.
  const cut = clean[max - 1] === " " ? room : space > 0 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:·–—-]+$/, "")}…`;
}
