// Report labels follow checkable rules per dossier, never an LLM score or a % "chance of success".

export type DossierLabel = "Verkenning" | "Onderbouwd marktbeeld" | "Eerste gedragsbewijs" | "Herhaald marktgedragsbewijs";

export type LabelInput = {
  claims: { status: string; domain: string | null; sourceType: string | null }[];
  competitorKinds: string[];
  sizingComputed: boolean;
  behaviourCards: { verdict: string; channels: string[]; endedOn: string | null }[]; // approved learning cards of behaviour experiments
};

export function dossierLabel(i: LabelInput): { label: DossierLabel; missing: string[] } {
  const good = i.claims.filter((c) => c.status === "verified" || c.status === "estimate");
  const domains = new Set(good.map((c) => c.domain).filter(Boolean));
  const strong = good.some((c) => c.sourceType === "official_statistic" || c.sourceType === "primary_document");
  const marketMissing: string[] = [];
  if (good.length < 3) marketMissing.push("minstens 3 onderbouwde bevindingen");
  if (domains.size < 2) marketMissing.push("bronnen van minstens 2 onafhankelijke uitgevers");
  if (!strong) marketMissing.push("een officiële statistiek of primaire bron");
  if (i.competitorKinds.length < 3) marketMissing.push("minstens 3 aanbieders of alternatieven");
  if (!i.competitorKinds.some((k) => k === "alternative" || k === "status_quo")) marketMissing.push("het huidige alternatief of 'niets doen'");
  if (!i.sizingComputed) marketMissing.push("een berekende marktomvang (of expliciet 'niet vastgesteld')");
  if (marketMissing.length) return { label: "Verkenning", missing: marketMissing };

  if (i.behaviourCards.length === 0) return { label: "Onderbouwd marktbeeld", missing: ["een afgerond gedragsexperiment met goedgekeurde Learning Card"] };

  const passes = i.behaviourCards.filter((c) => c.verdict === "pass");
  const distinct = new Set(passes.map((c) => `${c.endedOn?.slice(0, 7)}|${[...c.channels].sort().join(",")}`));
  if (passes.length >= 2 && distinct.size >= 2) return { label: "Herhaald marktgedragsbewijs", missing: [] };
  return { label: "Eerste gedragsbewijs", missing: ["een tweede geslaagd gedragsexperiment in een andere periode of via een ander kanaal"] };
}
