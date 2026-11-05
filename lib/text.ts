// Kleine teksthelpers voor rapport, PDF en Reality Check (gebruikerstest D3 en D13). Puur, zonder afhankelijkheden.

// Sluit een zin af met een punt, behalve als hij al op een leesteken eindigt (. ! ? …), ook als daarna nog een
// afsluitend aanhalingsteken of haakje staat ("…ja." of (zie bijlage).). Zo komt er nooit ".." of "?." in een rapport.
export function endSentence(s: string | null | undefined): string {
  const t = (s ?? "").replace(/\s+$/u, "");
  if (!t) return "";
  if (/[.!?…][\s"'”’»)\]]*$/u.test(t)) return t;
  return `${t}.`;
}

// Enkelvoud of meervoud bij een aantal: plural(1, "bevinding", "bevindingen") → "1 bevinding".
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}
