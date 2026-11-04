// Fase B2, punt 6: "Wat dit betekent voor je grootste onzekerheid".
//
// Hooguit drie bevindingen (met bron) die de grootste onzekerheid het sterkst ondersteunen of ondermijnen. Een
// ondermijnende bevinding (zoals een gratis alternatief bij een prijsvraag) krijgt het label "Risico". De AI stelt
// de selectie voor; zonder AI (of als die faalt) doet een eenvoudige regel dat, zichtbaar als "voorstel op basis
// van regels". De consultant kan de selectie aanpassen. Een AI-tekst is geen bron: alleen bestaande bevindingen
// met een gecontroleerd citaat komen in aanmerking.
//
// Puur: geen database en geen AI-aanroep.

import { uncertaintyTopic, type UncertaintyTopic } from "@/lib/research-questions";

export type UncertaintyEffect = "supports" | "undermines";
export const MAX_PICKS = 3;

export const EFFECT_LABEL: Record<UncertaintyEffect, { label: string; pill: string }> = {
  undermines: { label: "Risico", pill: "coral" },
  supports: { label: "Steunt", pill: "green" },
};

export const ORIGIN_LABEL: Record<string, string> = {
  ai: "AI-voorstel",
  rules: "Voorstel op basis van regels",
  consultant: "Gekozen door de consultant",
};

export type Candidate = {
  id: string;
  statement: string;
  status: string;
  section: string;
  questionId: string | null;
  // Alle vindplaatsen weerspreken het idee (tegenbewijs).
  counter: boolean;
};

export type Pick = { claimId: string; effect: UncertaintyEffect; reason: string; rank: number };

// Alleen bevindingen met een gecontroleerd citaat die (nog) iets zeggen: geverifieerd, schatting of betwist.
export function uncertaintyCandidates<C extends Candidate>(claims: C[]): C[] {
  return claims.filter((c) => c.status === "verified" || c.status === "estimate" || c.status === "contested");
}

const FREE = /\bgratis\b|\bfree\b|kosteloos|zonder kosten|€\s?0\b|0 euro/i;
const PRICE = /prijs|prijz|€|euro|abonnement|betaal|tarief|kost/i;

const SECTION_FOR: Partial<Record<UncertaintyTopic, string[]>> = {
  pricing: ["pricing", "competition"],
  alternatives: ["competition"],
  size: ["sizing", "market"],
  problem: ["customers"],
  channels: ["market", "customers"],
};

// Het regelvoorstel: bevindingen bij de beslissende vraag, tegenbewijs en (bij een prijsvraag) gratis
// alternatieven en prijzen wegen het zwaarst. Een gratis alternatief of tegenbewijs ondermijnt de onzekerheid.
export function rulePicks(candidates: Candidate[], uncertainty: string | null, decisiveQuestionId: string | null): Pick[] {
  const topic = uncertaintyTopic(uncertainty);
  const sections = SECTION_FOR[topic] ?? [];
  const scored = uncertaintyCandidates(candidates).map((c) => {
    const free = FREE.test(c.statement);
    const priced = PRICE.test(c.statement);
    let score = 0;
    if (decisiveQuestionId && c.questionId === decisiveQuestionId) score += 3;
    if (sections.includes(c.section)) score += 2;
    if (topic === "pricing" && free) score += 3;
    if (topic === "pricing" && priced) score += 1;
    if (c.counter) score += 1;
    if (c.status === "verified") score += 1;
    const undermines = c.counter || (topic === "pricing" && free);
    const reason = undermines
      ? topic === "pricing" && free
        ? "Een gratis alternatief maakt het lastiger om deze prijs te vragen."
        : "Deze bevinding spreekt het idee tegen."
      : decisiveQuestionId && c.questionId === decisiveQuestionId
        ? "Bevinding bij de beslissende vraag."
        : "Raakt het onderwerp van de grootste onzekerheid.";
    return { c, score, effect: (undermines ? "undermines" : "supports") as UncertaintyEffect, reason };
  });
  return scored
    .filter((s) => s.score >= 3)
    .sort((a, b) => b.score - a.score || (a.effect === "undermines" ? -1 : 1) - (b.effect === "undermines" ? -1 : 1))
    .slice(0, MAX_PICKS)
    .map((s, i) => ({ claimId: s.c.id, effect: s.effect, reason: s.reason, rank: i + 1 }));
}

// Het AI-voorstel controleren: alleen bekende kandidaten (via hun verwijzing), geen dubbele, hooguit drie, een
// geldig effect en een korte reden.
export function validateAiPicks(picks: { ref: string; effect: string; reason: string }[], refs: Map<string, string>): Pick[] {
  const out: Pick[] = [];
  for (const p of picks) {
    const claimId = refs.get(p.ref);
    if (!claimId || out.some((o) => o.claimId === claimId)) continue;
    if (p.effect !== "supports" && p.effect !== "undermines") continue;
    out.push({ claimId, effect: p.effect, reason: p.reason.replace(/\s+/g, " ").trim().slice(0, 300) || "Raakt de grootste onzekerheid.", rank: out.length + 1 });
    if (out.length === MAX_PICKS) break;
  }
  return out;
}

// De onzekerheid in woorden: uit de intake, anders de beslissende vraag.
export function uncertaintyText(keyUncertainty: string | null | undefined, decisiveQuestion: string | null | undefined): string | null {
  const u = (keyUncertainty ?? "").trim();
  if (u) return u;
  const q = (decisiveQuestion ?? "").trim();
  return q || null;
}
