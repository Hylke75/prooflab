// Methode 2026-11-d (4 november 2026, docs/ProofLab_Voorspelkracht_v1.md hoofdstuk 13): bouwt voort op 2026-11-c.
// - Oordeel per test en status van een aanname: zoals 2026-11-c (beslisregel op de Test Card, alleen de hoofdtest beslist).
// - Kans per aanname: zoals 2026-11-c, maar ook tegenbewijs telt per bron één keer (alleen het sterkste
//   tegensignaal per bron), net als ondersteunend bewijs (lib/domain/evidence.ts assumptionProbabilityV4).
//   Vijf bezwaren van één geïnterviewde verlagen de kans dus één keer; bezwaren van verschillende geïnterviewden
//   tellen elk mee, afnemend per soort. De afnemende factor binnen dezelfde wervingsgroep blijft alleen voor
//   ondersteunend bewijs gelden.

import { assumptionProbabilityV4 } from "@/lib/domain/evidence";
import { method2026_11_c } from "./2026-11-c";
import type { MethodModule } from "./types";

export const method2026_11_d: MethodModule = {
  version: "2026-11-d",
  label: "Methode 2026-11-d",
  usesCaps: true,
  usesRules: true,
  primaryDecides: true,
  rules: [
    ...method2026_11_c.rules,
    "Tegenbewijs telt per bron één keer, net als ondersteunend bewijs: per bron (bijvoorbeeld één interview) telt alleen het sterkste tegensignaal. Tegenbewijs uit verschillende bronnen telt elk mee, afnemend per soort.",
  ],
  probability: (claims, observations, prior, overrides, caps) => assumptionProbabilityV4(claims, observations, prior, overrides, caps),
  verdict: method2026_11_c.verdict,
};
