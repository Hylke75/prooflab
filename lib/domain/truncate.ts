// Kort een titel in op een woordgrens met "…" erachter (fase B1), zodat een titel nooit midden in een woord stopt.
// De volledige tekst hoort dan in een tooltip (title-attribuut). Witruimte wordt eerst samengevoegd. Is het eerste woord
// alleen al te lang, dan wordt dat woord afgekapt: anders bleef er niets over.
export function truncateWords(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  if (max < 2 || clean.length <= max) return clean;
  const room = clean.slice(0, max - 1); // ruimte voor "…"
  const space = room.lastIndexOf(" ");
  // Valt de grens precies op een spatie, dan past het laatste woord nog helemaal.
  const cut = clean[max - 1] === " " ? room : space > 0 ? room.slice(0, space) : room;
  return `${cut.replace(/[\s,;:·–—-]+$/, "")}…`;
}
