// Methode 2026-11-a: de rekenwijze tot en met 5 november 2026, ongewijzigd en reproduceerbaar.
// - Kans per aanname: factor per soort bewijs op de odds, afnemend per soort (lib/domain/evidence.ts
//   assumptionProbability), zonder samenvoegen per bron en zonder plafond.
// - Oordeel per test: de intervalregel (geslaagd als de ondergrens van het 95%-Wilson-interval boven de
//   succesdrempel ligt; niet geslaagd als de bovengrens onder de faaldrempel ligt).

import { assumptionProbability } from "@/lib/domain/evidence";
import { verdictV1 } from "@/lib/domain/stats";
import type { MethodModule } from "./types";

export const method2026_11_a: MethodModule = {
  version: "2026-11-a",
  label: "Methode 2026-11-a",
  usesCaps: false,
  usesRules: false,
  primaryDecides: false,
  rules: [
    "Oordeel per test: geslaagd als ook de ondergrens van het 95%-interval boven de succesdrempel ligt; niet geslaagd als ook de bovengrens onder de faaldrempel ligt; anders onbeslist.",
    "Kans per aanname: een vaste factor per soort bewijs op de kansverhouding, afnemend meegeteld per soort; geen samenvoegen per bron en geen plafond.",
  ],
  probability: (claims, observations, prior, overrides) => assumptionProbability(claims, observations, prior, overrides),
  verdict: (_h, input) => verdictV1(input),
};
