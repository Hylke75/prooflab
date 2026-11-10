// Fase B5: "Analyseer en maak de leerkaart" vult "Daaruit leren we" en "Daarom gaan we" als voorstel. De AI mag
// het voorstel formuleren; zonder AI (of als die faalt) maakt ProofLab het regelgebaseerd uit de berekende uitkomst
// en de vooraf vastgelegde drempels. Het voorstel wordt in de metrics van de kaart bewaard (die liggen vast), zodat
// zichtbaar blijft of de consultant het aanpaste. Een voorstel is nooit bewijs: de uitkomst zelf komt uit de metingen.

export type LearningInput = {
  assumption: string;
  verdict: "pass" | "fail" | "inconclusive";
  rule: "absolute" | "probability" | "interval" | string;
  n: number;
  successes: number;
  minSample: number;
  successThresholdPct: number;
  failThresholdPct: number | null;
  successCount: number | null;
  probability: number | null;
  belowSample: boolean;
  endReason: string | null;
  isPrimary: boolean;
  metricNumerator: string;
  followUp: string;
};

export type LearningProposal = { we_learned: string; therefore: string; source: "ai" | "rules" };

const pctText = (x: number) => `${Math.round(x * 1000) / 10}%`.replace(".", ",");

export function ruleBasedLearning(i: LearningInput): LearningProposal {
  const share = i.n > 0 ? pctText(i.successes / i.n) : "geen deelnemers";
  const measured =
    i.rule === "absolute"
      ? `${i.successes} van ${i.n} deelnemers (${i.metricNumerator}); afgesproken was minstens ${i.successCount ?? "?"}`
      : `${i.successes} van ${i.n} (${share}) ${i.metricNumerator}; de succesdrempel was ${i.successThresholdPct}%${i.failThresholdPct != null ? `, de faaldrempel ${i.failThresholdPct}%` : ""}`;
  const chance = i.probability != null && i.rule === "probability" ? ` De kans dat het echte percentage boven de succesdrempel ligt is ${pctText(i.probability)}.` : "";
  const role = i.isPrimary ? "" : " Dit was een verkennende test: hij geeft richting, maar beslist niet over de aanname.";
  const follow = i.followUp.trim() ? ` ${i.followUp.trim().replace(/\.?$/, ".")}` : "";

  if (i.belowSample) {
    return {
      source: "rules",
      we_learned: `Nog niets over "${i.assumption}": de test is afgerond met ${i.n} van minimaal ${i.minSample} deelnemers, dus de uitkomst telt niet mee.${i.endReason ? ` Reden: ${i.endReason}` : ""}`,
      therefore: `We herhalen de test met minstens ${i.minSample} deelnemers voordat we over deze aanname besluiten.`,
    };
  }
  if (i.verdict === "pass") {
    return {
      source: "rules",
      we_learned: `De aanname "${i.assumption}" wordt gesteund volgens de vooraf vastgelegde regel: ${measured}.${chance}${role}`,
      therefore: i.isPrimary
        ? `We nemen deze uitkomst mee in het besluit volgens de beslisregel en toetsen daarna de volgende riskante aanname.${follow}`
        : `We zetten een hoofdtest op voor deze aanname voordat ze als gesteund telt.${follow}`,
    };
  }
  if (i.verdict === "fail") {
    return {
      source: "rules",
      we_learned: `De aanname "${i.assumption}" wordt niet gesteund volgens de vooraf vastgelegde regel: ${measured}.${chance}${role}`,
      therefore: "We passen aanbod, doelgroep of belofte aan en toetsen opnieuw, of stoppen met deze richting als de aanname onmisbaar is.",
    };
  }
  return {
    source: "rules",
    we_learned: `Onbeslist over "${i.assumption}": ${measured}. De uitkomst ligt tussen de faal- en de succesdrempel, dus deze test beslist niets.${chance}${role}`,
    therefore: `We herhalen of verlengen de test met meer deelnemers, of kiezen een test met sterker bewijs, voordat we besluiten.${follow}`,
  };
}

// Een AI-voorstel wordt alleen overgenomen als het past: niet leeg, binnen de lengte, en zonder een uitkomst die
// tegen de berekende uitspraak ingaat (bijv. "gesteund" bij een niet-geslaagde test). Anders de regelgebaseerde tekst.
export function acceptAiLearning(ai: { we_learned: string; therefore: string } | null, i: LearningInput): LearningProposal {
  const rules = ruleBasedLearning(i);
  if (!ai) return rules;
  const learned = ai.we_learned.trim();
  const therefore = ai.therefore.trim();
  if (learned.length < 10 || therefore.length < 5 || learned.length > 1500 || therefore.length > 1500) return rules;
  const l = learned.toLowerCase();
  const claimsPass = /\b(bevestigd|bewezen|gesteund|geslaagd)\b/.test(l) && !/\bniet\s+(bevestigd|bewezen|gesteund|geslaagd)\b/.test(l);
  if (i.verdict !== "pass" && claimsPass) return rules;
  return { we_learned: learned, therefore, source: "ai" };
}

// Staat het voorstel nog ongewijzigd op de kaart? Dan toont het scherm het label "Voorstel".
export function isUnchangedProposal(card: { we_learned: string; therefore: string }, metrics: unknown): { learned: boolean; therefore: boolean; source: "ai" | "rules" } | null {
  const p = (metrics as { proposal?: Partial<LearningProposal> } | null)?.proposal;
  if (!p || typeof p.we_learned !== "string" || typeof p.therefore !== "string") return null;
  return { learned: card.we_learned.trim() === p.we_learned.trim(), therefore: card.therefore.trim() === p.therefore.trim(), source: p.source === "ai" ? "ai" : "rules" };
}
