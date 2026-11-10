// Commandomenu (Ctrl+K / ⌘K, Linear-patroon): elke pagina, taak en idee op naam te vinden. Puur, zodat de lijst en het
// zoeken met unittests vastliggen; de component CommandMenu toont en opent.

export type CommandGroup = "Dit idee" | "Ideeën" | "Werkruimte" | "Acties";
export type Command = {
  id: string;
  label: string;
  group: CommandGroup;
  // Extra zoekwoorden (ook de oude vaktermen, zodat "learning card" de leerkaart vindt).
  keywords?: string;
  href?: string;
  // Een actie zonder adres: de component weet wat ermee moet.
  action?: "dossier-search";
};

export function buildCommands({
  ideaId,
  ideas,
  isConsultant,
  isOwner,
}: {
  ideaId: string | null;
  ideas: { id: string; title: string }[];
  isConsultant: boolean;
  isOwner: boolean;
}): Command[] {
  const out: Command[] = [];
  if (ideaId) {
    const b = `/app/ideas/${ideaId}`;
    const idea: [string, string, string, string?][] = [
      ["wat-nu", "Wat nu? (volgende taak)", "", "overzicht takenlijst voortgang"],
      ["markt", "Markt: marktbeeld", "/research", "onderzoek beslisvraag"],
      ["bronnen", "Markt: bronnen en bevindingen", "/research?tab=sources", "bron toevoegen citaat fragment"],
      ["concurrenten", "Markt: concurrenten en alternatieven", "/research?tab=competitors", "aanbieders"],
      ["doelgroep", "Markt: doelgroepen", "/research?tab=customers", "klant segment jtbd"],
      ["klantonderzoek", "Markt: klantonderzoek", "/research?tab=klantonderzoek", "enquête interview"],
      ["marktomvang", "Markt: marktomvang", "/research?tab=sizing", "tam sam som marktpotentieel"],
      ["aannames", "Aannames: opschrijven", "/assumptions?stap=opschrijven", "aanname toevoegen voorstellen"],
      ["risicokaart", "Aannames: risicokaart", "/assumptions?stap=kiezen", "belangrijkste kiezen hoofdtest"],
      ["beslisregel", "Aannames: beslisregel", "/assumptions?stap=regel#beslisregel", "go-regel doorgaan"],
      ["model", "Aannames: businessmodel", "/model", "canvas propositie"],
      ["testen", "Testen: je tests", "/experiments", "experimenten bord"],
      ["testkaart", "Testen: nieuwe testkaart", "/experiments?nieuw=1", "test card testplan experiment opzetten"],
      ["geleerd", "Besluit: wat heb je geleerd?", "/evidence?stap=geleerd", "leerkaart learning card"],
      ["check", "Besluit: klopt het echt?", "/evidence?stap=check", "realiteitscheck reality check pre-mortem"],
      ["besluit", "Besluit: neem je besluit", "/evidence?stap=besluit", "doorgaan stoppen bijsturen"],
      ["bewijs", "Besluit: alle bewijs op een rij", "/evidence?stap=bewijs", "observaties"],
      ["uitkomst", "Voorspelling en uitkomst", "/outcome", "forecast basispercentage"],
      ["rapport", "Rapport", "/report", "pdf delen"],
      ["hulp", "Hulp en methode", "/hulp", "begrippen uitleg methode catalogus"],
      ["catalogus", "Alle testmethodes", "/experiments/catalogus", "catalogus experimentencatalogus"],
    ];
    for (const [id, label, path, keywords] of idea) out.push({ id: `idee-${id}`, label, group: "Dit idee", href: `${b}${path}`, keywords });
    out.push({ id: "zoek-dossier", label: "Zoek in dit dossier", group: "Acties", action: "dossier-search", keywords: "zoeken vinden /" });
  }
  for (const i of ideas) if (i.id !== ideaId) out.push({ id: `open-${i.id}`, label: `Open idee: ${i.title}`, group: "Ideeën", href: `/app/ideas/${i.id}`, keywords: "dossier" });
  out.push({ id: "alle-ideeen", label: "Alle ideeën", group: "Werkruimte", href: "/app", keywords: "overzicht dashboard home" });
  if (isConsultant) {
    out.push({ id: "nieuw-idee", label: "Nieuw idee onderzoeken", group: "Acties", href: "/app/ideas/new", keywords: "intake toevoegen" });
    out.push({ id: "klanten", label: "Klanten", group: "Werkruimte", href: "/app/clients", keywords: "opdrachtgevers uitnodigen" });
    out.push({ id: "voorspelkwaliteit", label: "Voorspelkwaliteit", group: "Werkruimte", href: "/app/forecasts", keywords: "kalibratie brier" });
  }
  if (isOwner) {
    out.push({ id: "status", label: "Systeemstatus", group: "Werkruimte", href: "/app/status", keywords: "ai sleutels e-mail instellingen" });
    out.push({ id: "privacy", label: "Privacyverzoeken", group: "Werkruimte", href: "/app/privacy", keywords: "avg verwijderen" });
  }
  out.push({ id: "uitleg", label: "Zo werkt ProofLab", group: "Werkruimte", href: "/app/help", keywords: "help uitleg" });
  return out;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9/ ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// Zoeken: alle woorden van de zoekterm moeten voorkomen (in naam of zoekwoorden). Treffers in de naam gaan voor, en
// een naam die met de zoekterm begint het eerst. Lege zoekterm: alles in de oorspronkelijke volgorde.
export function filterCommands(list: Command[], query: string): Command[] {
  const q = norm(query);
  if (!q) return list;
  const words = q.split(" ");
  const scored: { c: Command; score: number; i: number }[] = [];
  list.forEach((c, i) => {
    const label = norm(c.label);
    const all = `${label} ${norm(c.keywords ?? "")}`;
    if (!words.every((w) => all.includes(w))) return;
    const inLabel = words.filter((w) => label.includes(w)).length;
    const starts = label.startsWith(q) || label.split(" ").some((part) => part.startsWith(words[0])) ? 1 : 0;
    scored.push({ c, score: inLabel * 10 + starts * 5, i });
  });
  return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((s) => s.c);
}
