// Methode 2026-11-e (gebruikerstest A5, november 2026): bouwt voort op 2026-11-d.
// - Oordeel per test en status van een aanname: zoals 2026-11-d.
// - Kans per aanname: zoals 2026-11-d, met één aanvulling (lib/domain/evidence.ts assumptionProbabilityV5): een
//   weerlegde bevinding (status "refuted": minstens één gecontroleerde tegensprekende bron en geen enkele bevestigende)
//   waarop de aanname leunt (koppeling "ondersteunt"), telt als tegenbewijs. Conservatief gekozen: met de factor van een
//   onderbouwde schatting (1,2), niet die van een geverifieerde bevinding (1,5), omdat "weerlegd" op één secundaire bron
//   kan rusten. Een weerlegde tegenbevinding (koppeling "spreekt tegen") is geen steun en telt niet mee.
// - Dossiers op 2026-11-a t/m 2026-11-d rekenen ongewijzigd: daar weegt een weerlegde bevinding zoals een tegenstrijdige (0).

import { assumptionProbabilityV5 } from "@/lib/domain/evidence";
import { method2026_11_d } from "./2026-11-d";
import type { MethodModule } from "./types";

export const method2026_11_e: MethodModule = {
  version: "2026-11-e",
  label: "Methode 2026-11-e",
  usesCaps: true,
  usesRules: true,
  primaryDecides: true,
  refutedCounts: true,
  rules: [
    ...method2026_11_d.rules,
    "Een weerlegde bevinding (gecontroleerde bronnen spreken haar tegen, geen enkele bevestigt haar) waarop een aanname leunt, telt als tegenbewijs, met de factor van één secundaire bron (× 1,2 op de kansverhouding). Een weerlegde tegenbevinding telt niet als steun.",
  ],
  probability: (claims, observations, prior, overrides, caps) => assumptionProbabilityV5(claims, observations, prior, overrides, caps),
  verdict: method2026_11_d.verdict,
};
