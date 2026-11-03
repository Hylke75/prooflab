// Methode 2026-11-c (7 november 2026, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 10): bouwt voort op 2026-11-b.
// - Oordeel per test: zoals 2026-11-b (kansregel of aantalregel op de Test Card).
// - Kans per aanname: zoals 2026-11-b (één factor per bron, plafond per bewijsniveau), met de aanvullingen uit
//   golf A (lib/domain/evidence.ts assumptionProbabilityV3).

import { assumptionProbabilityV3 } from "@/lib/domain/evidence";
import { method2026_11_b } from "./2026-11-b";
import type { MethodModule } from "./types";

export const method2026_11_c: MethodModule = {
  version: "2026-11-c",
  label: "Methode 2026-11-c",
  usesCaps: true,
  usesRules: true,
  primaryDecides: false,
  rules: [...method2026_11_b.rules],
  probability: (claims, observations, prior, overrides, caps) => assumptionProbabilityV3(claims, observations, prior, overrides, caps),
  verdict: method2026_11_b.verdict,
};
