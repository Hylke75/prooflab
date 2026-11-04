// Gebruikerstest D6: alternatieven die de Reality Check (AI) noemt, zijn voorstellen (competitors.origin = 'proposal'),
// geen gevonden aanbieders. Een voorstel heeft nog geen bron: het telt nergens mee (concurrentiekaart, Reality
// Check-regel, rapport, dossierstatus) en opdrachtgevers zien het niet (ook afgedwongen in de database). Overnemen kan
// alleen met een website of een gekoppelde bevinding; daarna is het een gewone aanbieder (origin 'manual').
//
// Puur, zodat de regels met unittests vastliggen.

export const PROPOSAL_ORIGIN = "proposal";
export const PROPOSAL_LABEL = "Voorstel, nog geen bron";

export const isProposal = (c: { origin?: string | null }): boolean => c.origin === PROPOSAL_ORIGIN;

// Alleen echte aanbieders en alternatieven (zonder voorstellen).
export function withoutProposals<T extends { origin?: string | null }>(list: T[]): T[] {
  return list.filter((c) => !isProposal(c));
}

// Waarom een voorstel nog niet over te nemen is (null = mag).
export function proposalAdoptionProblem(row: { website: string | null; claim_id: string | null }): string | null {
  if (row.website?.trim() || row.claim_id) return null;
  return "Een voorstel neem je pas over met een website of een gekoppelde bevinding met bron. Zonder bron blijft het een voorstel.";
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

// Welke genoemde alternatieven nieuw zijn: niet leeg, niet dubbel en nog niet in het dossier (ook niet als voorstel).
export function newProposals(
  named: { name: string; why?: string | null }[],
  existing: { name: string }[],
  max = 3,
): { name: string; why: string | null }[] {
  const seen = new Set(existing.map((c) => norm(c.name)));
  const out: { name: string; why: string | null }[] = [];
  for (const n of named) {
    const name = n.name.replace(/\s+/g, " ").trim().slice(0, 120);
    const key = norm(name);
    if (name.length < 2 || !key || seen.has(key)) continue;
    seen.add(key);
    out.push({ name, why: n.why?.replace(/\s+/g, " ").trim().slice(0, 400) || null });
    if (out.length >= max) break;
  }
  return out;
}
