// Methode 2026-11-b (6 november 2026, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 9):
// - Oordeel per test volgens de beslisregel op de Test Card: de aantalregel voor sterke handelingen, anders de
//   kansregel (P(p > drempel) ≥ 0,80 geslaagd, P(p > faaldrempel) ≤ 0,20 niet geslaagd, Beta(1,1)). Test Cards
//   zonder vastgelegde regel (van vóór deze methode) rekenen met de kansregel. "Sterk bewezen" als ook de
//   Wilson-ondergrens boven de drempel ligt.
// - Kans per aanname: één factor per bron (sterkste ondersteunende signaal), tegenbewijs per signaal, plafond per
//   bewijsniveau (lib/domain/evidence.ts assumptionProbabilityV2).

import { assumptionProbabilityV2 } from "@/lib/domain/evidence";
import { FAIL_PROBABILITY, PASS_PROBABILITY, verdictV2 } from "@/lib/domain/stats";
import type { MethodModule } from "./types";

export const method2026_11_b: MethodModule = {
  version: "2026-11-b",
  label: "Methode 2026-11-b",
  usesCaps: true,
  usesRules: true,
  primaryDecides: false,
  rules: [
    `Percentagetests (landingpagina, prijstest op klikniveau, enquête, interviews): kansregel. Geslaagd als de kans dat het echte percentage boven de succesdrempel ligt minstens ${PASS_PROBABILITY * 100}% is (Beta-binomiaal, prior Beta(1,1)); niet geslaagd als de kans boven de faaldrempel hoogstens ${FAIL_PROBABILITY * 100}% is; anders onbeslist.`,
    "Sterke handelingen (aanbetaling, herhaalaankoop): aantalregel. Geslaagd als het vooraf afgesproken aantal na de eindconditie is gehaald.",
    "Sterk bewezen: geslaagd én de ondergrens van het 95%-interval boven de succesdrempel.",
    "Kans per aanname: een vaste factor per soort bewijs op de kansverhouding; ondersteunend bewijs telt per bron één keer (alleen het sterkste signaal), tegenbewijs per signaal; de kans is begrensd door het hoogste bewijsniveau.",
  ],
  probability: (claims, observations, prior, overrides, caps) => assumptionProbabilityV2(claims, observations, prior, overrides, caps),
  verdict: (h, input) =>
    verdictV2({ ...input, rule: h.decision_rule === "absolute" ? "absolute" : "probability", successCount: h.decision_rule === "absolute" ? (h.success_count ?? null) : null }),
};
